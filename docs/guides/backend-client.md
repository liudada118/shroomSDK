# 连接主项目后端

`BackendSdkClient` 用于连接正在运行的 Shroom 主项目后端。它不直接打开串口，而是通过主项目提供的 HTTP 和 WebSocket 接口完成控制。

## 适用场景

- 前端或第三方工具控制主项目后端。
- 使用主项目已有的串口管理、展示系统和采集逻辑。
- 需要订阅实时 WebSocket frame。
- 不想直接接触主项目内部 `server.js`、parser 或 runtime 模块。

## 最小链路

```js
const { BackendSdkClient } = require('shroom-backend-sdk');

const client = new BackendSdkClient({
  httpBaseUrl: 'http://127.0.0.1:19245',
  wsUrl: 'ws://127.0.0.1:19999',
});

await client.getContract();
await client.setSensorType('hand0205');
await client.openSerial({ role: 'sit', port: 'COM3' });

client.on('frame', console.log);
client.connectRealtime({ channels: ['sit'] });
```

## 常用 HTTP 能力

| 方法 | 作用 |
| --- | --- |
| `getContract()` | 读取后端 SDK contract，并刷新路由表 |
| `getChannels()` | 读取后端通道信息 |
| `listSerialPorts()` | 枚举串口 |
| `getSerialStatus(role)` | 查看串口连接状态 |
| `openSerial({ role, port })` | 打开指定角色串口 |
| `closeSerial({ role })` | 关闭指定角色串口 |
| `getCurrentSensor()` | 查看当前传感器类型 |
| `setSensorType(type)` | 切换传感器类型 |
| `startCollection(options)` | 开始采集 |
| `stopCollection()` | 停止采集 |
| `listDisplaySystems()` | 获取展示系统 metadata |
| `getDisplaySystem(id)` | 获取展示系统详情 |

## WebSocket 订阅

```js
client.on('open', () => console.log('ws open'));
client.on('frame', (frame) => {
  console.log(frame.channelId, frame.value?.length);
});
client.on('message', (message) => {
  console.log(message.type);
});

client.connectRealtime({ channels: ['sit', 'back'] });
```

也可以手动订阅和取消：

```js
client.subscribe(['sit']);
client.unsubscribe('sit');
```

## 采集

```js
await client.startCollection({
  name: 'sdk_demo',
  frequencyHz: 12,
});

await client.stopCollection();
```
