# 本地串口链路

本地串口链路用于产品实验室直接验证硬件，不需要启动 `E:\shroom1` 主项目。

## 数据流

```text
物理传感器
  -> SerialManager（查口 / 波特率 / 重试 / 断流 / 重扫）
  -> SensorSession
  -> serialport
  -> DelimiterParser
  -> ProtocolRegistry.parse
  -> ZeroCalibrator
  -> session.on('frame')
  -> MemoryCaptureStore 或 CaptureStore
```

## 两种连接方式

### 手动连接

```js
const { ShroomSensorSDK } = require('shroom-backend-sdk');
const sdk = new ShroomSensorSDK();

const result = await sdk.connectSerial({
  sensorType: 'hand0205',
  channels: { left: 'COM3', right: 'COM4' },
});

const session = result.session;
session.on('frame', (frame) => console.log(frame.channel, frame.data));
```

### 一键连接

```js
const result = await sdk.connectSerial({
  sensorType: 'hand0205',
  maxPorts: 2,
});
```

一键连接会参考 `E:\shroom` 执行 WCH/CH34 筛选、波特率识别、临时串口关闭、资源释放等待和三次稳定连接。同时连接多类设备时，使用 `resolveDevice({ path, baudRate, deviceClass })` 返回对应的 `sensorType` 和 `channel`。

## 写串口

```js
await sdk.writeSerial(result.session, 'left', Buffer.from([0x01, 0x02]));

// 或直接使用 session
await result.session.write('left', 'AT+NAME=ESP32\r\n');
```

## 状态和断流

```js
sdk.serialManager.on('channelStale', ({ sessionId, channel, portPath }) => {
  console.error('串口断流', sessionId, channel, portPath);
});

const state = sdk.getSerialState();
console.log(state.sessions);     // 所有当前会话和通道在线状态
console.log(state.latestFrames); // 所有串口最新解析帧
```

通道状态包含 `status`、`online`、`open`、`lastDataAt`、`lastFrameAt`、`receivedFrames`、`goodFrames`、`badFrames`、`badFrameRate`、`dataQuality` 和 `lastError`。默认串口仍 open 但 5 秒没有数据时进入 `stale`，不会自动反复重连。

## 重新扫描

```js
const result = await sdk.rescanSerial({ sensorType: 'hand0205' });
```

重扫会先停止采集并关闭现有串口，等待资源锁释放，再重走一键连接。连接和重扫有全局互斥锁，重复操作返回 `CONN_BUSY`。

## 运行 demo

列出串口：

```powershell
cd E:\ShroomSDK
pnpm sdk:serial-demo -- --list-ports
```

读取真实串口：

```powershell
pnpm sdk:serial-demo -- --sensor hand0205 --channel sit --port COM3
```

无硬件验证：

```powershell
pnpm sdk:serial-demo -- --mock
```

## 常用参数

```powershell
--sensor hand0205
--channel sit
--port COM3
--duration 30000
--max-frames 100
--capture memory
--capture none
```

## 当前内置 profiles

常见值：

- `hand0205`
- `hand0205Double`
- `handGlove115200`
- `handGloveFullPacket`
- `hand`
- `handSinglePoint`
- `fast1024`
- `smallBed12B`
- `bed4096`
- `bed4096num`

## 输出 frame 结构

典型字段：

```js
{
  sensorType: 'hand0205',
  channel: 'sit',
  timestamp: 1783498163349,
  rawLength: 260,
  data: [],
  pressureData: [],
  rotate: [],
  matrix: { width: 16, height: 16 },
  stats: {},
  rawValues: []
}
```

## 注意

- 如果串口被主项目占用，本地 SDK 无法同时打开同一个端口。
- `PORT_BUSY`、`PORT_NOT_FOUND`、`BAUD_FAIL` 等是稳定 SDK 错误码，不要在业务层继续匹配操作系统错误字符串。
- 做产品实验时，建议主项目和本地串口 demo 不要同时抢同一个 COM。
- 真实产品接入建议优先通过 `BackendSdkClient` 调主项目后端；底层硬件实验再用本地串口链路。
