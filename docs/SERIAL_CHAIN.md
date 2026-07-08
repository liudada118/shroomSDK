# 本地串口链路

本地串口链路用于产品实验室直接验证硬件，不需要启动 `E:\shroom1` 主项目。

## 数据流

```text
物理传感器
  -> serialport
  -> DelimiterParser
  -> ProtocolRegistry.parse
  -> ZeroCalibrator
  -> session.on('frame')
  -> MemoryCaptureStore 或 CaptureStore
```

## 运行 demo

列出串口：

```powershell
cd E:\shroomSDK
npm run sdk:serial-demo -- --list-ports
```

读取真实串口：

```powershell
npm run sdk:serial-demo -- --sensor hand0205 --channel sit --port COM3
```

无硬件验证：

```powershell
npm run sdk:serial-demo -- --mock
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
- 做产品实验时，建议主项目和本地串口 demo 不要同时抢同一个 COM。
- 真实产品接入建议优先通过 `BackendSdkClient` 调主项目后端；底层硬件实验再用本地串口链路。
