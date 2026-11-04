# 手套分包协议与数据

从 **0.4.0** 起，`product: 'glove'` 和 `connectGlove()` 使用分包手套入口，规范 ID 为 `handGloveSegmented`。安装命令为 `npm install --save-exact shroom-sdk@0.4.0`；Node 与浏览器项目需使用同一版本，并重新构建前端。0.3.0 只提供整包手套；整包设备升级后必须显式使用 `handGloveFullPacket`。

## 一步取数

完成驱动安装、串口选择和 SDK 授权后：

```js
import { readProduct } from 'shroom-sdk/quick-flow';

const device = await readProduct({
  product: 'glove',         // 分包协议；不是 handGloveFullPacket
  path: 'COM3',             // 替换为 listPorts() 查询到的实际串口
  side: 'left',             // 这条串口所接实物是左手；决定左右手线序
  onData(data) {            // 两个有效包合并后才调用一次
    console.log(data.pressure);                // 256 个原始 ADC
    console.log(data.fingers.thumb.raw);        // 大拇指主体 12 点
    console.log(data.fingers.index.pulp.raw[0]); // 食指独立指腹点
    console.log(data.palm.matrix);              // 手掌 72 点，保留实际行长
  },
  onError(error) {
    console.error(error.code, error.message);
  },
});
// 结束使用时 await device.close()；如已创建 WS，则 await server.close()。
```

后续 `createWS / startRecording / stopRecording / downloadRecording` 仍使用原来的四个函数。浏览器 Web Serial 直接连接时使用 `connectGlove({ side, onData })`，且必须在点击回调中调用。

## 一只手一个串口

每只手套独占一个串口和一个设备连接。`side` 由应用按实物明确设置，决定左右手线序与输出标识；不会根据包内第二字节推断实物左右手。两只手使用两个不同的 `path`，分别调用 `readProduct()` 并设置 left/right。当前功能不在一个串口内自动路由双手，也不提供路由模式参数。

## 串口协议

固定波特率 **921600**。两个包分别以 `AA 55 03 99` 结尾；下表长度不包含各自的 4 字节帧尾。

| 包 | 长度 | 字段 |
| --- | --- | --- |
| 首包 | 130 字节 | `1` + 包类型字节 + 前 128 个压力 ADC |
| 尾包 | 146 字节 | `2` + 相同包类型字节 + 后 128 个压力 ADC + 16 字节 IMU |

第一个字节的 `1 / 2` 是首包/尾包标志，**不是帧序号**。第二字节 `packetType` 保留原始 0–255 值，只用于检查同连接的首尾包类型是否一致，不代表实物手侧。配对成功后得到 256 个压力 ADC，按显式 `side` 生成分区；收到首包时尚无完整数据，不触发 `onData`。

SDK 处理串口分次送达和多个包连续到达，但这与设备协议的“130 + 146 分包”是两回事。收到孤立/重复尾包、坏长度、非法包或配对超时，不发布不完整数据；首包缓存最多保留 1 秒，重连/reset 和单字节控制包 `3` 会清除缓存。每条连接只缓存最新一份首包；新首包替换旧首包，类型不匹配的尾包不输出并清掉旧首包，避免随后再拼入过时数据。

协议没有 CRC、连续帧序号或转义。配对保护不能证明检测出所有同类型丢包错配；载荷中出现完整帧尾字节序列也可能导致该帧被丢弃。可靠性要求更高时需固件补充校验和帧标识，而非由 SDK 猜测缺失数据。

## 返回数据

| 字段 | 含义 |
| --- | --- |
| `product` | 固定 `handGloveSegmented` |
| `protocol` | 固定 `segmented` |
| `side` | 明确选择的 `left / right` |
| `packetType` | 首尾包相同的原始类型字节（0–255），仅作配对校验，不决定左右手 |
| `raw / pressure` | 合并后的 256 个 `Uint8Array` ADC |
| `fingers.*.raw` | 五指各 12 个主体点；`.pulp.raw` 是独立指腹点 |
| `palm` | 72 点手掌，行长 `[12, 15, 15, 15, 15]` |
| `imu.raw` | 16 个原始字节；不承诺姿态解算或物理单位 |
| `timestamp` | 主机解码时间，不是设备采样序号 |

分包帧**没有 `sequence` 字段**，不能把包标志或包类型字节当作序号。五指主体 60 点、指腹 5 点、手掌 72 点合计 137 个映射位置，从原 256 通道按左右手点位表直接提取。`pressureMatrix / values / rows / cols` 保留旧展示兼容形式，业务优先读取命名分区，不把整个手套看作规则矩阵。ADC、归一化值均不是已标定的物理压力。

## 整包设备迁移

`handGloveFullPacket` 仍保留原来的 274 字节整包解析与 `sequence` 字段。现有整包设备升级本修订时，必须明确选择它：

```js
const device = await readProduct({
  product: 'handGloveFullPacket', // 保留整包协议，不使用已改为分包的 glove 别名
  path: 'COM3',
  side: 'left',
  onData: data => console.log(data.fingers, data.palm),
});
```

本次没有自动识别分包/整包，也没有把两种协议混入同一个解析器。Python 仍没有手套产品入口；通用 Mock 不模拟手套分包协议。

## 来源与验证范围

协议依据上位机 `C:/code/shroom1.0` 的 `sdk/backend/sensors/handGloveDouble.js`、`backend/extensions/built-in-sensors/handPacketRuntime.js` 与 `backend/extensions/built-in-sensors/legacySerialFrameRuntime.js`。其中单手单串口使用显式手侧；来源另有自动双手路由模式，本 SDK 未接入该模式。代码及合成字节测试不代替实际固件、左右手、触点线序和持续采集的真机验收。
