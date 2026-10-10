# Backend Capabilities

本页对应后端 SDK 的完整功能链：**串口、采集、存储、回放、CSV、简单算法通道**。六项使用同一种标准帧，实时数据、入库数据、回放数据和导出数据不需要分别适配。

```text
串口字节
  -> 协议解析
  -> 线序 / 手套 Mapping / 清零
  -> AlgorithmChannel
  -> frame 事件
  -> CaptureController
  -> CaptureStore
  -> ReplayPlayer / CsvExporter
```

| 能力 | SDK 入口 | 状态 |
| :--- | :--- | :--- |
| 串口 | `SerialManager` / `connectSerial()` | 已完成 |
| 采集 | `CaptureController` / `startCapture()` | 已完成 |
| 存储 | `CaptureStore` / `MemoryCaptureStore` | 已完成 |
| 回放 | `ReplayService` / `ReplayPlayer` | 已完成 |
| CSV | `CsvExporter` / `exportCsv()` | 已完成 |
| 简单算法通道 | `AlgorithmChannel` / `registerAlgorithm()` | 已完成 |

## Serial

串口能力参考 `E:\shroom` 的连接管理方式，SDK 提供串口枚举、WCH/CH34 筛选、自动波特率识别、连接锁、重试、超时、断流状态、重扫、写串口和统一错误码。

```js
const { ShroomSensorSDK } = require('shroom-backend-sdk');

const sdk = new ShroomSensorSDK();
const result = await sdk.connectSerial({
  mode: 'auto',
  maxPorts: 2,
  resolveDevice: async ({ path }) => ({
    sensorType: 'hand0205',
    channel: path === 'COM3' ? 'left' : 'right',
  }),
});

console.log(sdk.getSerialState());
await sdk.writeSerial(result.sessions[0].sessionId, 'left', [0xaa, 0x55]);
```

需要指定端口时使用手动连接：

```js
const result = await sdk.connectSerial({
  mode: 'manual',
  sensorType: 'hand0205',
  channels: { left: 'COM3', right: 'COM4' },
});
```

完整连接参数和错误码见 [本地串口链路](./SERIAL_CHAIN.md)。

## Capture

采集参考 `E:\shroom1` 的生产链路：按通道独立限频、批量事务入库、定时 flush、停止采集 flush、关闭串口前 flush，并可设置磁盘余量保护。

```js
const session = result.sessions[0].session;
const capture = sdk.startCapture(session, {
  name: 'glove_test',
  frequencyMode: 'custom', // serial 表示保存每个有效串口帧
  frequencyHz: 60,
  dataField: 'matrixData',
  batchSize: 200,
  flushIntervalMs: 250,
  minFreeBytes: 2 * 1024 * 1024 * 1024,
});

session.on('captureFlush', ({ count }) => console.log('落盘', count));
session.on('captureError', ({ error }) => console.error(error.code, error.message));

const stopped = sdk.stopCapture(session);
console.log(stopped.stats.storedFrames);
```

`custom` 模式按 `frequencyHz` 取样；`serial` 模式保存每个成功解析的串口帧。多个串口通道使用各自的采样时钟，不会互相限频。

## Storage

默认使用 SQLite，数据库文件为 `<cwd>/db/sdk_capture.db`。不需要落盘时注入 `MemoryCaptureStore`，两种存储使用相同接口。

```js
const { MemoryCaptureStore, ShroomSensorSDK } = require('shroom-backend-sdk');

const sdk = new ShroomSensorSDK({
  dbPath: 'D:/sensor-data/sdk.db',
  // store: new MemoryCaptureStore(),
});

const captures = sdk.listCaptures({
  sensorType: 'hand0205',
  limit: 20,
  offset: 0,
});

const frames = sdk.getCaptureFrames({
  captureId: captures[0].id,
  channel: 'left',
  fromTimestamp: 1000,
  toTimestamp: 5000,
  limit: 1000,
});

console.log(sdk.countCaptures({ sensorType: 'hand0205' }));
console.log(sdk.countCaptureFrames({ captureId: captures[0].id }));
sdk.deleteCapture({ captureId: captures[0].id });
```

删除采集会在一个事务中同时删除采集记录和所属帧。分页前可调用 `countCaptures()` 或 `countCaptureFrames()` 获取总数。

## Replay

`sdk.replay()` 返回静态时间线；`sdk.createReplay()` 返回可控制的 `ReplayPlayer`。

```js
const player = sdk.createReplay({
  captureId: 12,
  channel: 'left',
  speed: 1,
  loop: false,
  applyAlgorithms: true,
});

player.on('frame', (frame) => {
  render(frame.data);
  console.log(frame.algorithmResults);
});

player.on('end', () => console.log('回放结束'));

player.play();
player.pause();
player.seek(100);
player.step(1);
player.setSpeed(2);
player.setLoop(true);
player.stop();
```

回放间隔使用采集帧的真实时间戳差值，再除以播放倍速。`applyAlgorithms: true` 会让历史帧重新经过当前算法通道。

## CSV

CSV 从存储中的同一标准帧导出，支持按采集、传感器、通道和时间区间筛选。

```js
const output = await sdk.exportCsv({
  captureId: 12,
  channel: 'left',
  fromTimestamp: 1000,
  toTimestamp: 5000,
  language: 'zh',
  outputPath: 'D:/sensor-data/glove-left.csv',
});

console.log(output.files, output.rows);
```

导出列包含时间、通道、压力统计、矩阵、姿态、原始帧、算法结果和附加信息。数组和对象使用 JSON 字符串保存，不会改变点位顺序。

## Algorithm Channel

算法通道位于标准帧生成后、实时事件和采集入库前。算法只需接收数组并返回可 JSON 序列化的结果，SDK 会将结果写入 `frame.algorithmResults`。

```js
const {
  ShroomSensorSDK,
  createPressureStatsAlgorithm,
} = require('shroom-backend-sdk');

const sdk = new ShroomSensorSDK();

sdk.registerAlgorithm(
  'pressureStats',
  createPressureStatsAlgorithm({ threshold: 10 }),
);

sdk.registerAlgorithm('centerOfPressure', (data, { frame }) => {
  const width = frame.matrix?.width || 16;
  let weight = 0;
  let x = 0;
  let y = 0;
  data.forEach((value, index) => {
    weight += value;
    x += (index % width) * value;
    y += Math.floor(index / width) * value;
  });
  return weight ? { x: x / weight, y: y / weight } : { x: 0, y: 0 };
});

session.on('frame', (frame) => {
  console.log(frame.algorithmResults.pressureStats);
  console.log(frame.algorithmResults.centerOfPressure);
});
```

管理接口：

| 方法 | 说明 |
| :--- | :--- |
| `registerAlgorithm(name, handler, options?)` | 注册同步算法 |
| `unregisterAlgorithm(name)` | 删除算法 |
| `algorithmChannel.enable(name, enabled)` | 启用或停用算法 |
| `algorithmChannel.list()` | 查看算法名称和状态 |
| `processAlgorithms(frame, context?)` | 不连接串口时手动处理一帧 |

默认错误策略是隔离单个算法：失败结果写为 `{ ok: false, error }`，同时发出 `algorithmError`，其他算法和串口链路继续运行。构造 SDK 时设置 `algorithmErrorMode: 'throw'` 可改为严格模式。

算法必须是同步函数。耗时算法、Python 服务和 GPU 推理应放在独立进程，通过队列或注入客户端对接，避免阻塞串口事件循环。
