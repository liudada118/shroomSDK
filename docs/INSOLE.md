# 鞋垫 A 版接入

要求 SDK **0.3.0 或更高版本**。旧项目运行 `npm install --save-exact shroom-sdk@0.3.0` 升级。请让 Node 服务端与浏览器项目安装相同版本，并重新构建前端，避免旧 WS 客户端不认识新增字段。

鞋垫使用同一套五步函数：`readProduct → createWS → startRecording → stopRecording → downloadRecording`。产品名为 `jqInsole`，连接时也接受 `insole`；返回帧始终使用 `jqInsole`。本页只说明鞋垫新增参数与数据结构，授权、WS、SQLite 采集沿用[快速接入](QUICK-START.md)。

## 连接参数

```js
import { readProduct } from 'shroom-sdk/quick-flow';
import { listPorts } from 'shroom-sdk/node';

// 接入前先查询，再按实际设备选择 path；不要默认取第一个串口。
console.table(await listPorts());

// 在已完成 SDK 授权的项目中调用；path 必须替换为列表中的实际串口。
let device;
try {
  device = await readProduct({
    product: 'jqInsole',
    side: 'left',        // 必填：由实物确认 left / right，不靠压力或串口猜脚侧。
    protocol: '12bit',    // 12bit（默认）或 8bit，必须与设备固件一致。
    baudRate: 921600,     // 默认值；支持的其他波特率见下文，不会自动扫速。
    path: 'COM3',
    onData(frame) {
      console.log(frame.sensors.raw); // A 版 112 个真实传感器的 ADC。
    },
    onError(error) { console.error(error.code, error.message); },
    onStateChange(state) { console.log(state.state); }, // Node 串口状态/重连。
  });
} catch (error) {
  console.error(error.code, error.message); // 首次打开、参数或授权失败。
}
// 应用退出时 await device?.close()；采集中断后需显式重新 startRecording。
```

支持波特率：`921600`、`1500000`、`3000000`、`460800`、`256000`、`115200`、`9600`。SDK 不探测协议/速率，也不把另一只脚的串口当作重连目标。浏览器直连使用 Web Serial 端口选择；`path`、`listPorts()`、`onStateChange` 是上述 Node 示例的用法。左右鞋垫各自创建连接。

## 读取哪组数据

| 字段 | 形状与类型 | 含义 |
| --- | --- | --- |
| `raw` | `Uint8Array(512)` / `(256)` | 原始 ADC 字节；12-bit 每点两个字节，小端序；不包含头或 IMU |
| `pressure` | `Uint16Array(256)` / `Uint8Array(256)` | 完整扫描 ADC；名称沿用产品帧结构，单位不是 kPa |
| `pressureMatrix` | 与 `pressure` 同类型、同顺序 | 16×16 扫描矩阵，不是鞋形点阵 |
| `values` | `Float32Array(256)` | 扫描 ADC / `fullScale`，相对值0–1 |
| `sensors.raw` | `Uint16Array(112)` / `Uint8Array(112)` | 按 A 版点位表排列的112个真实传感器 ADC |
| `sensors.values` | `Float32Array(112)` | 对应112点的归一化相对值 |
| `sensors.sourceIndices` | `Uint16Array(112)` | 每个真实点在256个扫描通道中的下标 |
| `sensors.positions` | 112个 `{row,col,xMm,yMm}` | 原始坐标；row=0..13、col=0..7，不加镜像、平移或缩放 |
| `imu.raw` | `Uint8Array(40)` / `(16)` | 原始 IMU 字节 |
| `imu.quaternion` | `Float32Array(4)` | 原始 w/x/y/z，不重新归一化、不派生姿态 |
| `imu.gyroscope` / `imu.acceleration` | 各 `Float32Array(3)` | 仅12-bit提供原始 x/y/z；8-bit缺少这些字段 |

表中两种类型依次对应 `12bit` / `8bit`。每帧另有 `side`、`protocol`、`bitDepth`（12/8）、`fullScale`（4095/255）。仅8-bit有 `sequence`，内容是分段包的单字节 index，不承诺时间或采样次数语义。12-bit不伪造序号。`timestamp` 是主机解码时间。

`sensors.rows=14`、`sensors.cols=8`。来源页面的28×8显示布局含112个插值点，SDK只输出112个真实点。基础 `min/max/avg/area/center` 按16×16扫描矩阵计算，其中 `area` 使用归一化阈值0.02；`center` 不是物理足底重心。

## 协议与边界

| 协议 | 线上格式 | 逻辑载荷 / `parser.frameLength` |
| --- | --- | --- |
| 12-bit | `AA 55 03 99` + ADC512字节 + IMU40字节，共556字节 | 552字节，去除4字节头 |
| 8-bit | 相同头 + type + index + payload；type1载荷128字节、type2载荷144字节 | 两段拼成272字节，去除两段各6字节头 |

12-bit ADC 为256个小端无符号16位整数，超过4095会丢弃候选帧并逐字节重新找头。IMU使用小端 float32：四元数16字节；12-bit后接陀螺仪12字节、加速度12字节。任意 IMU 分量非有限数会丢帧。没有 CRC 或帧尾，范围检查不能替代硬件完整性校验。

8-bit ADC 为原始8位数据，不是把12-bit显示结果压缩为8位。只配对 **1秒内相邻、同index的 type1→type2**；错序、不同index、噪声、超时或新首段都会清理旧首段，避免跨序号/回绕拼接。工作缓冲最多556字节，另保留一个128字节首段；半包可跨串口读取，多帧可在同一次读取中拆出。`reset()` 清空半包和统计。`droppedCount` 记录无效候选帧及废弃/未配对分段，不是精确硬件丢包数。

WS 编解码会校验全部鞋垫扩展字段、长度、ADC范围、归一化值、点位映射和原始IMU的一致性，并复制为独立快照。12-bit ADC不会截断为字节；有符号IMU不会被误判为非法负值。Node重连保留原协议与脚侧；连接中断时当前采集以错误结束，不自动续录。

## 数据来源与未确认信息

适配依据为用户提供的 `JQInsoleStudio_v2.3_dev_3.html`：协议1325–1356行；A版坐标1366–1399行；线序1818–1842行；ADC/IMU解码2435–2526行。SDK坐标只取源表第1、3、…、27行。第 b 个原始行（0..13）、第 dc 个源列（1..8）的通道下标为：

```text
right: (8 - dc) * 16 + 2 + b
left:  (dc + 7) * 16 + 13 - b
```

源文件没有可靠的脚侧/版型标识。陀螺仪与加速度单位、IMU坐标系、设备采样频率、坐标的脚跟/脚趾方向尚未由硬件资料确认，SDK不自行推断。不启用来源中未选用的B版，也不移植显示插值、阈值滤波、压力标定、力换算、姿态融合或左右脚压力猜测。源码适配与合成字节测试不能替代真实设备验证。
