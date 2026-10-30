# BackendSdkClient API

连接已经运行的 Shroom 主项目后端，使用 HTTP 查询 / 控制和 WebSocket 订阅 JSON 帧。适用于 Node.js、Electron 与浏览器；Python 未提供此客户端。它不会启动后端、自动开串口或自动采集，Shroom Monitor 和开发者网站本身不等于这个后端。

## 导入与构造 {#constructor}

### 导入方式 {#imports}

SDK 根目录下的 Node.js `.mjs` 文件：

```js
import { BackendSdkClient } from './node/index.js';
```

SDK 根目录下的浏览器 ES 模块页面：

```js
import { BackendSdkClient } from './web/index.js';
```

本地依赖安装后也可从 `shroom-sdk/backend` 或 `shroom-sdk/node` 导入；这不代表已发布 npm 包。经典脚本 `web/shroom.bundle.js` 对应 `Shroom.BackendSdkClient`。

### new BackendSdkClient(options) {#client-options}

**用途**：构造客户端，不发送请求。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `httpBaseUrl` | string | `http://127.0.0.1:19245`，HTTP / HTTPS 基址 |
| `wsUrl` | string | `ws://127.0.0.1:19999`，独立的 WS / WSS 地址 |
| `timeoutMs` | number | `10000` 毫秒，HTTP 与 WS 打开超时，有限正数 |
| `headers` | HeadersInit | `{}`，HTTP 默认请求头 |
| `contract` | BackendContract 或 null | `null`，预置契约 |
| `routes` | Record<string, string> | `{}`，显式路由覆盖，优先于契约 |
| `fetchImpl` | typeof fetch | 当前环境 fetch；Node.js 18+ 内置 |
| `WebSocketImpl` | WS 构造器 | 当前环境 WebSocket；Node 入口无原生实现时按需加载 ws |

**返回值**：`BackendSdkClient`。URL 协议不符、带凭据 / query / hash 或超时非法时抛 `TypeError`。

**示例**：后续片段假定已有 `client`：

```js
const client = new BackendSdkClient({
  httpBaseUrl: 'http://127.0.0.1:19245',
  wsUrl: 'ws://127.0.0.1:19999',
  timeoutMs: 10000,
});
```

**注意事项**：127.0.0.1 是客户端所在机器。HTTP 与 WS 分别设置；headers 仅用于 HTTP，不会自动添加到浏览器 WS 握手。

### 客户端属性 {#properties}

| 属性 | 类型 / 含义 |
| --- | --- |
| `httpBaseUrl / wsUrl` | 规范化地址 |
| `timeoutMs` | 默认超时毫秒数 |
| `contract` | 已加载契约或 null |
| `routes` | 当前路由映射 |
| `ws` | 当前 WebSocket 或 null |

这些属性用于观察状态，应用不应通过修改内部对象管理连接。

## HTTP 请求 {#http}

### client.getContract(options) {#get-contract}

**用途**：获取 / 缓存契约，更新 HTTP 路由与 WS 消息类型。

**参数**：可选 `{ refresh?: boolean }`，默认 false。**返回值**：`Promise<BackendContract>`，缓存命中不发请求。

**示例**：`await client.getContract({ refresh: true })`。

**注意事项**：返回必须为非数组对象；显式 routes 覆盖在刷新后保留。构造时给定契约也可缓存命中。

### client.request(routeOrName, options) {#request}

**用途**：执行命名路由或根相对路径的 JSON HTTP 请求。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `routeOrName` | string | 必填，如 serialStatus 或 /api/serial/status |
| `options.method` | string | GET |
| `options.body` | 可 JSON 序列化的值 | 未提供；给出时 JSON 序列化并设置 Content-Type |
| `options.query` | Record<string, string/number/boolean/null/undefined> | {}，空值跳过，其他转为字符串 |
| `options.raw` | boolean | false，true 保留原始 JSON 外层 |
| `options.routeParams` | Record<string, string/number> | 用于命名路由的占位符 |
| `options.headers` | HeadersInit | 覆盖默认同名 HTTP 请求头 |
| `options.signal` | AbortSignal | 未提供，用于外部取消 |
| `options.timeoutMs` | number | 客户端默认，有限正数，毫秒 |

**返回值**：`Promise<T>`。默认解包 `{ code: 0, data }` 为 data，没有 code 时原样返回；raw=true 保留外层，但仍校验非零业务码。空响应体为 null。

**示例**：

```js
const controller = new AbortController();
const status = await client.request('serialStatus', {
  query: { role: 'sit' }, timeoutMs: 5000, signal: controller.signal,
});
console.log(status);
```

**注意事项**：只允许同一配置后端下的根相对路径，禁止外部绝对 URL、协议相对路径和反斜杠。网络、HTTP 非成功、非 JSON、业务错误、超时或取消使 Promise 拒绝；不会自动触发 WS error 事件或重试写操作。

### client.route(name, params) {#route}

**用途**：解析当前契约中的命名路由。

**参数**：必填 name:string；可选 params 对象，默认 {}，必须包含模板要求的占位符。

**返回值**：编码后的路径 string。未知路由或缺参数抛 Error。

**示例**：`client.route('displaySystemById', { id: 'seat-1' })` 得到 `/api/display-systems/seat-1`。

**注意事项**：只解析路径，不发送网络请求。

## 状态与元数据查询 {#queries}

以下方法不操作设备；返回字段由实际后端定义。原始包仍会校验业务码。

### client.getChannels() {#get-channels}

**用途**：查询通道。**参数**：无。**返回值**：`Promise<unknown>` 原始 JSON 包。

**示例**：`console.log(await client.getChannels())`。**默认路由**：GET `/api/channels`。

### client.getWsStatus() {#get-ws-status}

**用途**：查询实时服务状态。**参数**：无。**返回值**：`Promise<unknown>` 原始 JSON 包。

**示例**：`console.log(await client.getWsStatus())`。**默认路由**：GET `/api/ws/status`。

### client.listDisplaySystems() {#list-display-systems}

**用途**：枚举展示系统。**参数**：无。**返回值**：`Promise<unknown>` 原始 JSON 包。

**示例**：`console.log(await client.listDisplaySystems())`。**默认路由**：GET `/api/display-systems`。

### client.getDisplaySystem(id) {#get-display-system}

**用途**：查一个展示系统。**参数**：必填 id:string，编码为路径参数。**返回值**：`Promise<unknown>` 原始 JSON 包。

**示例**：`await client.getDisplaySystem('seat-1')`。**默认路由**：GET `/api/display-systems/:id`。

### client.listSerialPorts() {#list-serial-ports}

**用途**：枚举后端机器的串口。**参数**：无。**返回值**：`Promise<unknown>` 已解包数据。

**示例**：`console.log(await client.listSerialPorts())`。**默认路由**：GET `/api/serial/ports`。

**注意事项**：不是 Node.js 的 `Shroom.listPorts()` 本机枚举。

### client.getSerialStatus(role) {#get-serial-status}

**用途**：查询串口状态。**参数**：可选 role:string；省略时不添加查询条件。**返回值**：`Promise<unknown>` 已解包数据。

**示例**：`await client.getSerialStatus('sit')`。**默认路由**：GET `/api/serial/status?role=sit`。

### client.getCurrentSensor() {#get-current-sensor}

**用途**：查询当前传感器。**参数**：无。**返回值**：`Promise<unknown>` 已解包数据。

**示例**：`await client.getCurrentSensor()`。**默认路由**：GET `/api/sensor/current`。

## 显式控制 {#controls}

以下接口改变后端设备或采集状态。只在应用明确需要时调用；不要把它们放入自动启动或只读探测代码。均返回已解包的 `Promise<unknown>`。

### client.setSensorType(type) {#set-sensor-type}

**用途**：切换后端传感器类型。**参数**：必填 type:string，取值由后端认可的类型决定。

**调用示例**：已获得有效 sensorType 后，`await client.setSensorType(sensorType)`。

**默认请求**：POST `/api/sensor/type`，body 为 `{ type }`。SDK 不自行校验产品类型是否合法。

### client.openSerial(options) {#open-serial}

**用途**：请求后端打开串口。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `role` | string | sit |
| `port / path / portPath` | string | 至少提供一个，按此顺序选择首个非空值 |

**示例**：确认后端目标端口后，`await client.openSerial({ role: 'sit', port: 'COM3' })`。

**默认请求**：POST `/api/serial/open`，body `{ role, port }`。缺少端口会同步抛 TypeError。

### client.closeSerial(options) {#close-serial}

**用途**：请求后端关闭串口。**参数**：可选 `{ role?: string }`，默认 role='sit'。

**示例**：`await client.closeSerial({ role: 'sit' })`。**默认请求**：POST `/api/serial/close`，body `{ role }`。

### client.startCollection(options) {#start-collection}

**用途**：请求后端开始采集。**参数**：可选后端定义对象，默认 {}。

**示例**：配置由后端契约确定后，`await client.startCollection(collectionOptions)`。

**默认请求**：POST `/api/collection/start`，body 为 options。保存位置、文件格式与数据库由后端负责，不是 SDK 内置存储。

### client.stopCollection() {#stop-collection}

**用途**：请求后端停止采集。**参数**：无。

**示例**：`await client.stopCollection()`。**默认请求**：POST `/api/collection/stop`，body {}。

## WebSocket {#websocket}

### client.connectRealtime(options) {#connect-realtime}

**用途**：打开或复用实时连接，连接就绪后订阅通道。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `channels` | string / string[] | []，非空字符串去重；空数组不自动订阅 |
| `timeoutMs` | number | 客户端默认，有限正数 |
| `protocols` | string / string[] | 可选，WS 子协议 |

**返回值**：立即返回 WebSocket，不是 Promise。已有正在打开的连接会累计待订阅通道，已打开的连接可追加订阅。

**示例**：

```js
client.on('error', (error) => console.error(error.message));
client.on('frame', (frame) => console.log(frame));
await client.getContract();
client.connectRealtime({ channels: ['sit', 'back'] });
```

**注意事项**：用 open 事件确认打开；SDK 不自动重连、不自动重放控制命令。

### client.disconnectRealtime() {#disconnect-realtime}

**用途**：清理 WS、监听、待订阅通道与握手定时器。

**参数**：无。**返回值**：void。**示例**：`client.disconnectRealtime()`。

**注意事项**：无连接时无操作；主动断开会发出客户端生成的 close 事件，wasClean 不表示后端已确认正常关闭。

### client.subscribe(channels) {#subscribe}

**用途**：订阅通道。**参数**：必填 string 或 string[]，非空字符串去重。**返回值**：void。

**示例**：在 open 回调中 `client.subscribe(['sit'])`。

**注意事项**：未连接时抛 Error；消息类型从契约读取，默认 subscribe。

### client.unsubscribe(channels) {#unsubscribe}

**用途**：取消通道订阅。**参数**：同 subscribe。**返回值**：void。

**示例**：已打开连接时 `client.unsubscribe('sit')`。

**注意事项**：默认消息类型 unsubscribe；取消订阅不等于关闭 WS。

### client.sendRealtime(message) {#send-realtime}

**用途**：发送自定义 JSON 消息。**参数**：必填 JSON 可序列化值。**返回值**：void。

**示例**：取得协议认可的 message 后，`client.sendRealtime(message)`。

**注意事项**：连接未打开时抛 Error；SDK 不校验后端的业务消息契约，不缓冲发送。

### client.handleRealtimeMessage(message) {#handle-realtime-message}

**用途**：高级消息适配入口，默认由内部 WS 读取调用。

**参数**：字符串或消息对象。**返回值**：void，通过事件输出。

**示例**：不访问设备的应用测试中，`client.handleRealtimeMessage(JSON.stringify({ frames: [{ channelId: 'test', value: [1, 2] }] }))`。

**注意事项**：无效 JSON 发 raw；有效消息发 message；frames 数组逐条发 frame，单对象存在 channelId / portId / value 任一字段时也发 frame。值不归一化、不重排。

## 事件监听 {#events}

### client.on(event, handler) / once(event, handler) {#on}

**用途**：持续 / 一次性监听。**参数**：必填事件名与函数。**返回值**：客户端自身，支持链式调用。

**示例**：`client.once('open', () => console.log('已连接'))`。

### client.off(event, handler) {#off}

**用途**：移除相同函数注册的监听，也可移除 once 的原函数。

**参数**：必填事件名和函数。**返回值**：客户端自身。**示例**：`client.off('frame', onFrame)`。

### client.removeAllListeners(event) {#remove-all-listeners}

**用途**：清理指定事件或全部监听。**参数**：可选事件名，省略则全部。**返回值**：客户端自身。

**示例**：`client.removeAllListeners('frame')`。不负责关闭 WS，退出仍需 disconnectRealtime()。

### 事件参数 {#event-payloads}

| 事件 | 回调参数 |
| --- | --- |
| open | 无 |
| close | 关闭事件对象 |
| error | Error，WS 错误 / 打开超时 |
| message | 已解析消息 |
| frame | BackendFrame，后端字段保留，批量帧逐条输出 |
| raw | 无法解析的原始字符串 |

HTTP 失败通过 Promise 拒绝，不自动发 error。用户事件回调应自行处理异常，不应让回调抛错中断消息分发。BackendFrame 不等于基础 SDK Frame，画热力图前需按后端真实协议适配。

## 运行与排错 {#troubleshooting}

### 只读示例 {#demo}

```bash
node node/backend-demo.js --help
node node/backend-demo.js --channels sit,back --duration 10000
```

示例读取契约、状态并订阅，结束时断开；不打开串口、切换传感器或启动采集。后端未发送数据时成功连接也可收到零帧。

### 安全与生命周期 {#safety}

浏览器需要后端允许实际来源的 CORS / WS Origin；HTTPS 页面使用 HTTPS / WSS。Electron 应自行设置 IPC 与权限边界。接口鉴权、付费权限和设备控制授权由后端负责，不是这个客户端的内置功能。

前端组件卸载或页面退出时断开连接，进程退出时同样释放。HTTP/WS 地址分别核对，确认部署机器和服务端口，勿将 JS 包中的 HTTP headers 当成 WS 鉴权。
