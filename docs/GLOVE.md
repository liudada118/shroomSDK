# 手套分包协议与数据

从 **0.4.0** 起，`product: 'glove'` 和 `connectGlove()` 使用分包手套入口，规范 ID 为 `handGloveSegmented`。安装命令为 `npm install --save-exact shroom-sdk@0.5.0`；Node 与浏览器项目需使用同一版本，并重新构建前端。0.3.0 只提供整包手套；整包设备升级后必须显式使用 `handGloveFullPacket`。

**0.5.0 新增：** Node 分包手套支持手动选口与自动识别。手动传 `path + side`；自动调用 `readProduct({ product: 'glove', onData, onError })`，内部复用基础 `connectProduct()` → `scanProductPorts()`。五个快速函数保持不变；0.4.0 仍需手动配置，自动识别要求升级到 0.5.0。

## 一步取数

使用SDK 0.5.0，安装驱动、连接手套并完成 SDK 授权后，只需：

```js
import { readProduct } from 'shroom-sdk/quick-flow';

const device = await readProduct({
  product: 'glove',         // 分包协议；不是 handGloveFullPacket
  // 省略 path 与 side：逐口检查分包数据，找到唯一有效手套后连接。
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
console.log(device.info.path, device.info.side); // 实际识别出的串口与左右手。
// 结束使用时 await device.close()；如已创建 WS，则 await server.close()。
```

后续 `createWS / startRecording / stopRecording / downloadRecording` 仍使用原来的四个函数。浏览器 Web Serial 直接连接时使用 `connectGlove({ side, onData })`，且必须在点击回调中调用。

同时插着左右手时，传 `side: 'left'` 或 `'right'` 筛选目标；同侧有多只手套仍会报 `PORT_AMBIGUOUS`，由应用选择 `path`，不会随意连接第一只。`side: 'auto'` 与省略手侧相同。需要限制探测范围时传 `scan: { paths: ['COM3', 'COM4'], timeoutMs: 1200 }`。

也可以选择手动直连，适用于已知串口及已发布 0.4.0：

```js
const device = await readProduct({
  product: 'glove',
  path: 'COM3', side: 'left', // 自己选择串口与实物手侧。
  onData: data => console.log(data.fingers, data.palm),
  onError: error => console.error(error.code, error.message),
});
```

两种方式任选其一。同时明确 path 与 left/right 且不传 scan 时，保持原来的手动映射行为；即使类型字节未知也不把它猜成另一手侧。显式 scan: {} 则会先核实该串口的数据。

## 一只手一个串口

每只手套独占一个串口和一个设备连接。当前固件用第二字节 `packetType=1` 表示左手、`packetType=2` 表示右手，自动扫描据此选择对应线序。它能区分左右手类型，**不是某一只设备的唯一序列号**；两只左手套都会报告 1，仍需用串口区分。驱动返回的 `serialNumber` 是另一个可选字段，不能把它与包类型混为一谈。

两只手分别建立两个连接，例如分别调用 `readProduct({ product: 'glove', side: 'left', onData })` 和右手入口。当前不在同一串口内路由双手；某串口同时出现左右手类型时，不把它报告为可自动连接的单手设备。

## 先扫描，再显示设备列表

`scanProductPorts()` 是 `shroom-sdk/node` 的基础 API，需要有效的 `serial` 授权。它实际打开串口读取协议，与只枚举端口的 `listPorts()` 不同；完整参数和结果见[串口自动扫描](SERIAL.md#node-scan)。

```js
import { scanProductPorts } from 'shroom-sdk/node';

const result = await scanProductPorts({ product: 'glove' });
console.table(result.devices); // path、side、packetType、baudRate 等已识别信息。
console.table(result.ports);   // 每个端口的 matched / unrecognized / error 结果。
// 扫描返回前已释放全部探测端口，可让用户从 devices 中选一个再连接。
```

每口默认读取 1200 ms，至少观察到 3 个同侧、类型一致的完整首尾配对才识别成功；未知类型、混合左右手或仅有首包均不作为有效设备。仅使用固定 921600 波特率，不自动尝试其他速率。扫描数据不会触发业务 `onData` 或进入采集，所有探测端口先释放，再开始正式连接。

自动连接零匹配报 `PORT_NOT_FOUND`，多个匹配报 `PORT_AMBIGUOUS`，`error.details.scan` 保留完整扫描报告；单个端口被占用或打不开可从 `ports` 的 `error` 项排查。驱动缺失或设备没有持续发送时，SDK 不能凭串口名称识别它。

自动连接确认后会固定 packetType；正式读取或原口重连收到另一手侧的有效帧时，以 PARSE_FAILED 停止，不默默切换手侧。端口号变化需重新扫描连接，原有自动重连仍固定原路径。

## 串口协议

固定波特率 **921600**。两个包分别以 `AA 55 03 99` 结尾；下表长度不包含各自的 4 字节帧尾。

| 包 | 长度 | 字段 |
| --- | --- | --- |
| 首包 | 130 字节 | byte[0]=`1`；byte[1]=手侧类型；byte[2..129]=前 128 个压力 ADC |
| 尾包 | 146 字节 | byte[0]=`2`；byte[1]=相同手侧类型；byte[2..129]=后 128 个压力 ADC；byte[130..145]=16 字节 IMU |

第一个字节的 `1 / 2` 是首包/尾包标志，**不是帧序号**；第二字节是 `packetType`，当前固件 1=左手、2=右手，两包必须相同。包含帧尾时，首包共 134 字节、尾包共 150 字节，一个完整采样共 284 字节；合并后的压力为 256 个单字节 ADC，IMU 为 16 个原始字节。不要混淆“第一个字节的 1/2”和“第二个字节的 1/2”。

自动扫描只接受已知手侧类型，正式帧仍保留原始 `packetType`。手动直连按显式 `side` 映射以兼容原使用方式；自动连接按识别出的手侧映射。收到首包时没有完整数据，不触发 `onData`。

SDK 处理串口分次送达和多个包连续到达，但这与设备协议的“130 + 146 分包”是两回事。收到孤立/重复尾包、坏长度、非法包或配对超时，不发布不完整数据；首包缓存最多保留 1 秒，重连/reset 和单字节控制包 `3` 会清除缓存。每条连接只缓存最新一份首包；新首包替换旧首包，类型不匹配的尾包不输出并清掉旧首包，避免随后再拼入过时数据。

协议没有 CRC、连续帧序号或转义。配对保护不能证明检测出所有同类型丢包错配；载荷中出现完整帧尾字节序列也可能导致该帧被丢弃。可靠性要求更高时需固件补充校验和帧标识，而非由 SDK 猜测缺失数据。

## 返回数据

| 字段 | 含义 |
| --- | --- |
| `product` | 固定 `handGloveSegmented` |
| `protocol` | 固定 `segmented` |
| `side` | 自动识别或手动指定的 `left / right`，用于点位映射 |
| `packetType` | 首尾包相同的原始类型字节；当前固件 1=左、2=右，不是唯一设备编号 |
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

自动扫描仅支持默认分包手套，不把整包设备当作匹配项；两种协议仍使用独立解析器。整包入口的 `side` 仍必填，不接受 `scan`。Python 通过 `connect_glove(path, side=...)` 使用同一分包解析规则，整包为 `connect_product("handGloveFullPacket", ...)`；通用 Mock 不模拟手套分包协议，产品模拟见各语言文档。

## 来源与验证范围

协议依据上位机 `C:/code/shroom1.0` 的 `sdk/backend/sensors/handGloveDouble.js`、`backend/extensions/built-in-sensors/handPacketRuntime.js` 与 `backend/extensions/built-in-sensors/legacySerialFrameRuntime.js`。本次补充其类型字节 1/2 的左右手语义用于单手单串口发现；来源中的单串口自动双手路由模式未接入。代码及合成字节测试不代替实际固件、左右手、触点线序和持续采集的真机验收。
