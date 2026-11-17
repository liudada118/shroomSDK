# 触觉足底：原始数据接入

SDK 0.7.0 的 Node.js 产品 ID 为 `footVideo`，连接别名为 `foot`。它与已有 `jqInsole` / `insole` 是两种不同协议，不使用旧鞋垫的 112 点物理表。本次不增加 Python 产品入口。

## 连接

先使用 `npm install --save-exact shroom-sdk@0.7.0` 安装 SDK，再安装串口驱动并完成含 `serial` 功能的 SDK 授权。使用本地候选包时改为 `npm install --save-exact ./shroom-sdk-0.7.0.tgz`。业务项目通过公开包名导入；直接运行源码副本时使用 `src/quick-flow.js`：

```js
import { readProduct } from 'shroom-sdk/quick-flow';

const device = await readProduct({
  product: 'foot',
  path: 'COM3',
  side: 'left',
  onData(frame) {
    console.log(frame.pressure);    // Uint8Array(256)，原扫描顺序 ADC
    console.log(frame.imu.raw);     // Uint8Array(16)，原始 IMU 字节
    console.log(frame.rawPackets);  // 两个完整原始包，包含包头与帧尾
  },
  onError: error => console.error(error.code, error.suggestion),
});

// 结束时 await device.close();
```

也可从 `shroom-sdk/node` 导入 `connectTactileFoot(options)`，或使用 `Shroom.connectTactileFoot(options)`。`path + side` 为手动直连；省略任一项或传 `side: 'auto'` 时，先用完整协议帧识别，只有唯一匹配才连接。

`scanProductPorts({ product: 'foot', side: 'left' })` 可先查询左脚候选；同侧接了多个设备时，必须用 `path` 指定。扫描只识别包类型和脚侧，不把类型字节当作设备序列号。探测样本不进入业务回调，自动连接及重连持续核对已识别的身份。

浏览器可用同版本 `readProduct({ url, onData })` 接收 Node 创建的 WS 服务。Web Serial 的 `connectTactileFoot` 仍需用户手势、明确 `side: 'left' | 'right'` 和支持的浏览器。

## 原始数据契约

波特率为 **921600**，每包帧尾为 `AA 55 03 99`。下表偏移为零基下标，载荷长度不含四字节帧尾：

| 内容 | 首包，130 字节载荷 | 尾包，146 字节载荷 |
| --- | --- | --- |
| `byte[0]` | `1`，首段 | `2`，尾段 |
| `byte[1]` | `3=左脚`、`4=右脚` | 必须与首包一致 |
| `bytes[2:130]` | 前 128 个 uint8 ADC | 后 128 个 uint8 ADC |
| `bytes[130:146]` | 无 | 16 个原始 IMU 字节 |

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `raw` / `pressure` | `Uint8Array(256)` | ADC 原值，0–255，按首包→尾包原扫描顺序拼接 |
| `imu.raw` | `Uint8Array(16)` | 原始 IMU 字节，包括无法解释为有限浮点数的字节组合 |
| `rawPackets` | `[Uint8Array(134), Uint8Array(150)]` | 首包、尾包各自的全部字节，包括两字节段头和四字节帧尾 |
| `packetType` / `side` | `3或4` / `left或right` | 以协议类型为准；显式侧别不匹配的包不发布 |
| `protocol` | `'segmented'` | 分包协议，没有连续设备序号 `sequence` |
| `timestamp` | `number` | 主机交付帧的毫秒时间，不是设备采样时钟 |

需要完整原始传输单元时，可在 Node 使用 `Buffer.concat(frame.rawPackets)`，结果为 284 字节。

兼容公共 Frame 的 `pressureMatrix` 与 `raw` 保持相同扫描顺序，`values` 为 ADC / 255。16×16 仅表示扫描存储形状，不表示足底物理位置；这些兼容字段不修改 `pressure` 或 `rawPackets`。SDK 不执行插值、60 点抽取、边界归零、基线扣除、左右镜像、滤波或力学标定，也不推断 IMU 四元数顺序、单位或姿态。

通过 `createWS`、`encodeStreamFrame/decodeStreamFrame`、SQLite 录制及 JSONL 导出时，`rawPackets` 与压力、IMU 原始字节均保留。CSV 的完整帧 JSON 列也保留这些字段。

## 直接输出原始 JSONL

在 SDK 源码根目录执行：

```powershell
# 无硬件，用真实解析器验证完整原始字段
node examples/node/tactile-foot-raw.js --mock --side left --frames 3

# 实机：授权辅助函数使用既有的 SHROOM_LICENSE_FILE 配置
$env:SHROOM_LICENSE_FILE = 'C:\path\sdk.license'
node examples/node/tactile-foot-raw.js --path COM3 --side left
```

每行输出完整的 `pressure`、`imuRaw` 和 `rawPackets` 数组。`--frames N` 可限制帧数，默认持续输出，Ctrl+C 释放串口；此命令行示例在运行期错误时退出，实机读取禁用自动重连以便明确记录中断。

## 组帧边界与来源

解析器仅配对同连接、同类型、一秒内相邻的首尾包；乱序、孤立尾包、超长段、未知类型及超时会丢弃候选并恢复到下一边界。重置或重连不保留旧半包。协议没有 CRC、连续帧标识和转义：完整帧丢失无法仅靠此协议发现，载荷内出现完整帧尾标记时可能丢帧，原始包字段只记录成功组成的帧，不是串口噪声或所有丢弃字节的日志。

协议布局依据 `C:/code/shroom1.0` 的 `sdk/backend/sensors/handGloveDouble.js`、`backend/extensions/built-in-sensors/legacySegmentedFrameProcessor.js` 和 `backend/kernel/serial/nativeSerialDetection.js`；`footVideo` 名称和 921600 波特率来自产品注册表。`3=左脚、4=右脚` 依据本次设备约定。验证使用合成字节、模拟串口和真实本地 WS/SQLite 链路；实际固件、左右脚和持续采集仍需真机核对。
