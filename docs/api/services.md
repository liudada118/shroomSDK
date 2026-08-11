# 协议、存储与服务 API

## ProtocolRegistry

用于管理 profile，并解析原始 buffer。

```js
const registry = new ProtocolRegistry(profiles, { lineOrders });
registry.registerProfile('mySensor', profile);
const profile = registry.getProfile('mySensor');
const frame = registry.parse('mySensor', rawBuffer, { channel: 'sit' });
```

## LineOrderRegistry

```js
const registry = new LineOrderRegistry();
registry.register('reverse', (data) => data.reverse());
registry.apply('reverse', [1, 2, 3]); // [3, 2, 1]
registry.list();
```

## CaptureStore

SQLite 存储：

```js
const store = new CaptureStore({
  dbDir: 'db',
  dbPath: 'db/sdk_capture.db',
});
```

常用方法：

- `createCapture({ name, sensorType, hz, metadata })`
- `finishCapture(captureId)`
- `insertFrame({ captureId, sensorType, channel, rawFrame, frame })`
- `listCaptures(filter)`
- `queryFrames(options)`
- `close()`

## MemoryCaptureStore

内存版存储，实现和 `CaptureStore` 相同的常用接口，适合测试和 demo。

## ReplayService

```js
const replay = new ReplayService({ store });
const timeline = replay.buildTimeline({ captureName, sensorType });
```

## CsvExporter

```js
const exporter = new CsvExporter({ store, exportDir: 'data' });
await exporter.exportCapture({ captureName, sensorType });
```

## ZeroCalibrator

用于记录清零基线，并对实时 frame 做扣除。

常见方法：

- `captureBaseline(frame)`
- `clearBaseline()`
- `apply(frame)`

## BackendCommandRouter

把旧后端 WebSocket/命令消息转换成事件：

```js
router.on('serial:open', ({ channel, portPath }) => {});
router.on('capture:start', (command) => {});
router.route(message);
```

## PathService / LicenseService / ReportService

这些服务用于运行路径、授权解析和报告生成适配，通常通过 `ShroomSensorSDK` 构造参数注入或直接从包入口引入。
