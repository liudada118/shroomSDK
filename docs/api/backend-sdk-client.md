# BackendSdkClient API

`BackendSdkClient` 连接正在运行的主项目后端，封装 HTTP 请求和 WebSocket 实时订阅。

## Constructor

```js
const client = new BackendSdkClient({
  httpBaseUrl: 'http://127.0.0.1:19245',
  wsUrl: 'ws://127.0.0.1:19999',
  fetchImpl,
  WebSocketImpl,
  contract,
  routes,
});
```

## HTTP 方法

| 方法 | 返回/作用 |
| --- | --- |
| `getContract({ refresh })` | 读取 `/api/sdk/contract` 并更新 routes |
| `getChannels()` | 获取通道信息 |
| `getWsStatus()` | 获取 WebSocket 状态 |
| `listDisplaySystems()` | 获取展示系统列表 |
| `getDisplaySystem(id)` | 获取展示系统详情 |
| `listSerialPorts()` | 枚举串口 |
| `getSerialStatus(role)` | 获取串口状态 |
| `getCurrentSensor()` | 获取当前传感器类型 |
| `setSensorType(type)` | 设置传感器类型 |
| `openSerial({ role, port })` | 打开串口 |
| `closeSerial({ role })` | 关闭串口 |
| `startCollection(options)` | 开始采集 |
| `stopCollection()` | 停止采集 |

## WebSocket 方法

| 方法 | 作用 |
| --- | --- |
| `connectRealtime({ channels })` | 连接 WebSocket，并可自动订阅 channel |
| `disconnectRealtime()` | 断开 WebSocket |
| `sendRealtime(message)` | 发送原始 WebSocket 消息 |
| `subscribe(channels)` | 订阅 channel |
| `unsubscribe(channels)` | 取消订阅 channel |

## 事件

| 事件 | 说明 |
| --- | --- |
| `open` | WebSocket 已连接 |
| `close` | WebSocket 已关闭 |
| `error` | WebSocket 错误 |
| `message` | 收到原始结构化消息 |
| `frame` | 收到实时 frame |
| `raw` | 收到无法 JSON 解析的消息 |
