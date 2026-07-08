# API Reference

## BackendSdkClient

用于连接正在运行的 Shroom 后端。

```js
const { BackendSdkClient } = require('shroom-backend-sdk');

const client = new BackendSdkClient({
  httpBaseUrl: 'http://127.0.0.1:19245',
  wsUrl: 'ws://127.0.0.1:19999',
});
```

### 后端契约

```js
const contract = await client.getContract();
```

读取 `/api/sdk/contract`，并更新 SDK 内部路由表。

### 串口

```js
await client.listSerialPorts();
await client.getSerialStatus();
await client.openSerial({ role: 'sit', port: 'COM3' });
await client.closeSerial({ role: 'sit' });
```

`role` 常用值：

- `sit`
- `back`
- `head`
- `sensor`

### 传感器类型

```js
await client.getCurrentSensor();
await client.setSensorType('hand0205');
```

### 实时数据

```js
client.on('frame', (frame) => {
  console.log(frame.channelId, frame.value?.length);
});

client.connectRealtime({ channels: ['sit'] });
```

也可以手动订阅：

```js
client.subscribe(['sit', 'back']);
client.unsubscribe('sit');
```

### 采集

```js
await client.startCollection({
  name: 'demo_capture',
  frequencyHz: 12,
});

await client.stopCollection();
```

### Display Systems

```js
const list = await client.listDisplaySystems();
const detail = await client.getDisplaySystem('demo-id');
```

## ShroomSensorSDK

用于 SDK 本地直接读取串口。

```js
const { ShroomSensorSDK, MemoryCaptureStore } = require('shroom-backend-sdk');

const sdk = new ShroomSensorSDK({
  store: new MemoryCaptureStore(),
});
```

### 列出串口

```js
const ports = await sdk.listPorts();
```

### 打开串口

```js
const session = await sdk.open({
  sensorType: 'hand0205',
  channels: {
    sit: 'COM3',
  },
});
```

### 监听帧

```js
session.on('rawFrame', (event) => {
  console.log(event.channel, event.rawFrame.length);
});

session.on('frame', (frame) => {
  console.log(frame.channel, frame.stats);
});
```

### 启动本地采集

```js
const capture = sdk.startCapture(session, {
  name: 'local_demo',
  hz: 12,
});

sdk.stopCapture(session);
```

### 关闭

```js
await session.close();
sdk.close();
```
