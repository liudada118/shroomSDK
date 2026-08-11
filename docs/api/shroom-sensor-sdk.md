# ShroomSensorSDK API

`ShroomSensorSDK` 是本地串口采集入口。

## Constructor

```js
const sdk = new ShroomSensorSDK({
  dbDir,
  dbPath,
  exportDir,
  store,
  exporter,
  profiles,
  lineOrders,
  extraLineOrders,
  zeroCalibrator,
  pathService,
  license,
  licenseService,
  commandRouter,
  reportService,
  pythonClient,
});
```

## 方法

| 方法 | 说明 |
| --- | --- |
| `getStore()` | 懒加载 `CaptureStore` |
| `getExporter()` | 懒加载 `CsvExporter` |
| `registerProfile(sensorType, profile)` | 注册或覆盖 profile |
| `registerLineOrder(name, handler)` | 注册线序 |
| `listLineOrders()` | 列出线序名称 |
| `applyLineOrder(name, data, context)` | 手动执行线序 |
| `listPorts(options)` | 枚举串口 |
| `open(options)` | 打开串口 session |
| `startCapture(session, options)` | 开始采集 |
| `stopCapture(session)` | 停止采集 |
| `listCaptures(filter)` | 列出采集记录 |
| `replay(options)` | 构建回放 timeline |
| `exportCsv(options)` | 导出 CSV |
| `close()` | 关闭 store |

## open(options)

```js
const session = await sdk.open({
  sensorType: 'hand0205',
  channels: {
    sit: 'COM3',
  },
  profile: {},
});
```

`open()` 返回 `SensorSession`。

## SensorSession 事件

| 事件 | 说明 |
| --- | --- |
| `open` | 所有配置的 channel 打开完成 |
| `channelOpen` | 单个 channel 打开 |
| `rawFrame` | 收到原始帧 |
| `frame` | 收到解析后的标准帧 |
| `error` | 串口错误 |
| `channelClose` | 单个 channel 关闭 |
| `captureStart` | 开始采集 |
| `captureStop` | 停止采集 |
| `close` | session 关闭 |
