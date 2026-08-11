# 采集、回放、导出

SDK 支持把实时 frame 存储成采集记录，之后用于回放和 CSV 导出。

## 存储选择

| 存储 | 适合场景 |
| --- | --- |
| `MemoryCaptureStore` | demo、测试、无数据库验证 |
| `CaptureStore` | 正式采集，写入 SQLite |

## 开始采集

```js
const { ShroomSensorSDK, MemoryCaptureStore } = require('shroom-backend-sdk');

const sdk = new ShroomSensorSDK({
  store: new MemoryCaptureStore(),
});

const session = await sdk.open({
  sensorType: 'hand0205',
  channels: { sit: 'COM3' },
});

const capture = sdk.startCapture(session, {
  name: 'demo_capture',
  hz: 12,
  metadata: {
    operator: 'lab',
  },
});
```

## 停止采集

```js
sdk.stopCapture(session);
```

## 查看采集记录

```js
const captures = sdk.listCaptures({
  sensorType: 'hand0205',
});
```

## 回放

```js
const timeline = sdk.replay({
  captureName: 'demo_capture',
  sensorType: 'hand0205',
});

console.log(timeline.length);
console.log(timeline.seconds);
console.log(timeline.frames[0]);
```

## 导出 CSV

```js
const result = await sdk.exportCsv({
  captureName: 'demo_capture',
  sensorType: 'hand0205',
  language: 'zh',
});

console.log(result.files);
```

CSV 字段包括序号、秒数、时间戳、通道、最大值、最小值、平均值、总和、点数、矩阵数据、姿态数据、原始帧 HEX 和附加信息。
