# 前端通讯 API

网页直连实机前先[安装并确认串口驱动](DRIVERS.md)，再激活 SDK 密钥。CH34x 设备缺少驱动时系统不能提供串口，浏览器选择框也可能为空。SDK 授权不限制设备型号；仅通过 WS 查看 Node 采集服务时，驱动应安装在连接 USB 设备的采集电脑上。

浏览器入口优先通过产品方法连接整包手套或手部检测垫，内置协议与映射；同时保留通用 Web Serial、Mock 和已有后端 HTTP / WebSocket。先确定设备由谁连接；本页按接口说明参数、返回值和生命周期。

五步流程中的网页 `readProduct({ url })` 直接调用下方 `connectStream()`。各快速函数与基础 API 的关系见[对应表](CUSTOM.md#quick-to-base)。

## 导入与环境 {#environment}

SDK 根目录的 HTML 页面通过本地 HTTP 服务打开，页面与 web/ 同级：

```js
import { Shroom, connectSerial, isSerialSupported, BackendSdkClient,
  ShroomError, asShroomError, ERROR_CODES } from './web/index.js';
```

Web Serial 需要支持该功能的浏览器、安全上下文（HTTPS / localhost）和用户授权；连接必须在用户手势中调用。模拟和网络后端入口不依赖 Web Serial。真实支持情况以运行时检测为准。

## SDK WS 数据连接 {#sdk-stream}

Node.js 先连接设备，再用 [serveDevice()](BACKEND-GUIDE.md#node-serve-device) 发布数据；网页通过此接口接收数据和控制采集。网页不再申请串口，驱动与 SDK 授权由连接设备的 Node 进程负责。

### connectStream(options) {#connect-stream}

从 `./web/index.js` 具名导入，或使用 `Shroom.connectStream()`。

| 参数 | 类型 / 默认值 | 说明 |
| --- | --- | --- |
| `url` | 可选 string | 完整 `ws://` 或 `wss://` 地址；提供时优先于 host/port，不接受账号、密码或 URL 片段 |
| `host` | string，`127.0.0.1` | 不带协议、路径的主机名或 IP |
| `port` | number，`19999` | 1–65535；与 Node 服务端口一致，不是网页端口 |
| `timeoutMs` | number，`10000` | ready 握手和每次控制请求的超时，范围 1–300000 毫秒 |
| `onData` | 可选 `(frame) => void` | 同步接收已校验、恢复 TypedArray 的产品帧；不重复映射点位 |
| `onError` | 可选 `(error) => void` | 接收网络、解码和回调错误；连接前失败仍需捕获 Promise |
| `WebSocketImpl` | 可选 WebSocket 构造函数 | 默认浏览器原生实现；用于其他运行端或测试 |

**返回值**：`Promise<StreamDevice>`，收到兼容的 ready 握手后才完成。例：`const stream = await connectStream({ url: 'ws://127.0.0.1:19999', onData: console.log })`。

默认服务用于同机 `http://localhost` 网页。HTTPS 网页须配置 WSS；客户端不会自动把 WS 升级成 WSS。跨机访问还须配置 Node 服务的 `host / allowedOrigins`。此连接使用 SDK 数据协议，不用于 `BackendSdkClient` 的既有后端通道。

### stream 的订阅、控制与关闭 {#stream-device}

| 成员 | 返回值与行为 |
| --- | --- |
| `onData(handler)` / `onFrame(handler)` | 注册同步帧回调，返回取消订阅函数 |
| `onError(handler)` | 注册运行期错误回调，返回取消订阅函数 |
| `onRecording(handler)` | 接收录制状态或 null，返回取消订阅函数 |
| `startRecording({ label })` / `stopRecording()` | Promise 返回录制结果；参数和起停语义见[采集 API](STORAGE.md#recording-api) |
| `getRecordingStatus()` / `listRecordings()` | Promise 查询服务端当前状态或记录列表 |
| `getRecordingUrl(id, options)` / `downloadRecording(id, options)` | 显式指定记录 ID；详见[下载与 URL](STORAGE.md#recording-url) |
| `close()` | Promise 关闭本连接，取消监听并拒绝未完成请求；不会停止 Node 端录制 |
| `state / info / recording / url` | 当前连接状态、数据源信息、最近收到的录制状态与 WS 地址 |

断线不自动重连，也不重发起停命令。`REQUEST_TIMEOUT` 只说明未收到响应，不能据此认定服务端未执行；重连或超时后先用 `getRecordingStatus()` 确认状态。网页结束本次采集应先明确停止，再关闭连接。

## Web Serial {#web-serial}

已支持的产品按 **选产品与手侧 → 用户选择端口 → onData 接收数据 → 错误诊断** 接入，无需填写波特率、帧长和线序。浏览器的产品与通用连接都必须由用户手势触发，不提供 Node.js 的 `listPorts()`，选择框不自动识别硬件型号。错误需要覆盖选择、配置、打开及运行过程。

### Shroom.connectGlove(options) {#connect-glove}

**用途**：选择并连接整包手套 `handGloveFullPacket`，内置 921600 波特率、274 字节 payload 解析及左右手的五指、指腹与手掌映射。

| 参数 | 类型 | 必填 / 默认值 |
| --- | --- | --- |
| `side` | `'left' \| 'right'` | 必填；由应用明确选择，不能从 packetType 推断 |
| `port` | 已授权 SerialPort | 可选；省略时弹设备选择框 |
| `filters` | USB 筛选对象数组 | 可选，作用与通用 connect() 相同 |
| `onData` | `(data) => void` | 可选，在打开端口前注册 |
| `onError` | `(error: ShroomError) => void` | 可选，在打开端口前注册 |

**返回值**：`Promise<ProductDevice<GloveFrame>>`；有 `onData / onFrame / onError / state / getDiagnostics() / close()`。

**示例**：

```js
document.querySelector('#connect').onclick = async () => {
  try {
    const device = await Shroom.connectGlove({
      side: 'left',
      onData: (data) => {
        console.log(data.fingers.thumb.raw);
        console.log(data.fingers.index.pulp.raw[0]);
        console.log(data.palm.matrix);
      },
      onError: (error) => console.error(error.code, error.suggestion),
    });
    window.addEventListener('pagehide', () => { void device.close().catch(console.error); }, { once: true });
  } catch (error) {
    if (error.code !== ERROR_CODES.USER_CANCELLED) console.error(error.message, error.suggestion);
  }
};
```

**注意事项**：连接前失败仍拒绝 Promise，不能只提供 onError。不接受 `baudRate / delimiter / rows / cols / layout` 等底层覆盖；自定义协议继续使用通用 `connect()`。只支持指定整包协议，不自动识别其他手套型号，也不提供 Python 同名入口。

### Shroom.connectHandPad(options) {#connect-hand-pad}

**用途**：连接手部检测垫 `hand`，内置 1000000 波特率、1024 点与 32×32 `mat32` 映射。

**参数**：可选 `{ port, filters, onData, onError }`，行为同 connectGlove，不使用 side。

**返回值**：`Promise<ProductDevice<HandPadFrame>>`。

**示例**：在点击回调内执行 `const device = await Shroom.connectHandPad({ onData: (data) => heatmap.render(data), onError: console.error })`，结束时 `await device.close()`。

**注意事项**：产品矩阵已映射，不要再次解码或重排；输入协议参数会报 `INVALID_CONFIG`，不会覆盖内置配置。

### Shroom.connectProduct(options) / listDeviceProducts() {#connect-product}

**用途**：按产品标识连接，或同步获取可直连产品清单。

**参数**：`connectProduct()` 必填 `product`：手套接受 `handGloveFullPacket / glove`，检测垫接受 `hand / pad`；其余与对应产品入口相同。手套必须提供 `side`，检测垫不传；`listDeviceProducts()` 无参数。

**返回值**：connectProduct 返回对应的产品设备 Promise；listDeviceProducts 返回 `{ product, label, family, baudRate, payloadLength, sensorPoints, rows, cols }[]`。

**示例**：`console.log(Shroom.listDeviceProducts())`；在点击回调中 `await Shroom.connectProduct({ product: 'handGloveFullPacket', side: 'right', onData: console.log })`。

**注意事项**：连接别名不改变返回的 `device.info.product / frame.product`，它们仍使用正式 ID `handGloveFullPacket / hand`。清单不查询硬件，不等于旧 `listProducts()` 的通用矩阵产品菜单；不要把所有旧产品都当成已有高层入口。

### 产品数据与 device.onData(handler) {#product-data}

**用途**：直接读取产品压力数据；产品设备的 `onData(handler)` 是 `onFrame(handler)` 别名，参数为同步函数，返回取消订阅函数。

| 产品 | 原始压力 | 映射后数据 | 其他字段 |
| --- | --- | --- | --- |
| `hand` | `raw / pressure`，1024 个原扫描 ADC | `pressureMatrix`，1024 个 ADC；`values`，归一化 32×32 | 基础 Frame 统计与时间戳 |
| `handGloveFullPacket` | `raw / pressure`，256 个 ADC | 旧 `pressureMatrix / values`，195 点、13×15 展示映射 | `fingers / palm / side / sequence / packetType / imu.raw`（16 字节） |

**示例**：`const off = device.onData((data) => heatmap.render(data))`；优先把首个回调作为连接选项 `onData` 提供，以避免连接期间漏掉首帧。

五指直接用 `data.fingers.thumb / index / middle / ring / little` 访问，每指主体 4×3、12 点，各指 `.pulp` 为独立 1×1 指腹点。例如 `data.fingers.thumb.raw`、`data.fingers.index.pulp.raw[0]`、`data.palm.matrix`；手掌 rows=5、cols=15，实际 rowLengths 为 `[12, 15, 15, 15, 15]`，共 72 点，不补零。

每个分区含 `name / rows / cols / rowLengths / sourceIndices / raw / values / matrix`。sourceIndices 是 `Uint16Array`，按行展开的原扫描 0-based 索引（用户表点号已减 1）；raw 是 ADC `Uint8Array`，values 是按父帧 fullScale 归一化的 `Float32Array`，matrix 是按实际行长排列的 ADC `number[][]`，不要假定 raw.length=rows*cols。

新分区按最新左右手表独立提取，共 137 个映射位置，不要求覆盖全部 256 通道；不能直接切片旧 pressureMatrix 取得。顶层 max/avg/area/center 等仍基于旧 195 点展示矩阵，未新增分区统计。分区值不是物理压力、力或弯曲角度。点位表 btPacketSize=128 不表示蓝牙或双包支持；当前仍为 274 字节整包串口和 16 字节 IMU 原数据。Python 与通用 Mock 不提供这些分区。

**注意事项**：首帧可能早于连接 Promise 完成，onData 直接使用传入的 data，不要依赖尚未初始化的外层 `const device`；需要设备引用时先声明 let 并判空，或在连接后订阅。压力字节与映射矩阵均为 `Uint8Array`，values 为 `Float32Array`；数据已经映射，不能再次套 layout。sequence 是可能回绕的单字节序号，不是时间戳。IMU 只交付原始字节，没有单位、姿态或手势识别承诺。通用 `Shroom.mock()` 不提供产品 onData、手套附加字段或 IMU；它只模拟基础矩阵。

### Shroom.isSupported() / isSerialSupported() {#supported}

**用途**：检测当前环境是否暴露 navigator.serial；两者相同。

**参数**：无。**返回值**：boolean。**示例**：`if (!Shroom.isSupported()) console.log('当前环境未开放 Web Serial')`。

**注意事项**：true 不代表设备已连接或用户已授权。file://、非安全来源或缺少浏览器能力时可能不可用。

### Shroom.connect(options) / connectSerial(options) {#connect}

**用途**：通用串口进阶入口，选择并打开设备，按应用配置读取字节、分帧和解码。已支持的产品优先使用上面的产品方法。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `baudRate` | number | 1000000，正整数 |
| `filters` | USB 筛选对象数组 | 未提供，展示可选端口；如 `[{ usbVendorId: 0x1a86 }]` |
| `port` | 已获得的浏览器 SerialPort | 未提供时弹授权选择框；不是 COM 路径字符串 |
| `delimiter / minLength / maxLength / lockLength` | 分帧选项 | 默认 AA 55 03 99、8、8192、true |
| `rows / cols / points / fullScale / threshold / layout` | 解码选项 | 见 [帧解析 API](BACKEND-GUIDE.md#frame) |

**返回值**：`Promise<Device>`。参数校验、取消选择、占用、权限或打开失败时以 `ShroomError` 拒绝 Promise。

**示例**：页面已有 connect 按钮：

```js
document.querySelector('#connect').onclick = async () => {
  try {
    const device = await Shroom.connect({ baudRate: 1000000, rows: 32, cols: 32 });
    device.onError((error) => console.error(error.code, error.stage, error.suggestion));
    device.onFrame((frame) => console.log(frame.max));
    window.addEventListener('pagehide', () => { void device.close().catch(console.error); }, { once: true });
  } catch (error) {
    if (error.code === ERROR_CODES.USER_CANCELLED) return;
    console.error(error.code, error.message, error.suggestion);
  }
};
```

**注意事项**：不要在页面加载时自动请求串口；Web 入口没有 path 参数。串口、拆帧与解码参数在打开端口前校验；行列成对、分隔符非空，具体范围见[串口与解码参数](BACKEND-GUIDE.md#node-framer)。真实应用应避免重复创建连接，完整生命周期示例在下方。

### device.onFrame(handler) {#on-frame}

**用途**：接收 Web Serial 或 Mock 的每一帧。

**参数**：必填 `(frame: Frame) => void`。**返回值**：`() => void` 取消监听函数。

**示例**：`const unsubscribe = device.onFrame((frame) => heatmap.render(frame))`；结束用 `unsubscribe()`。

**注意事项**：回调同步执行，异步处理不会被等待；帧的 raw 可能共享视图，异步保存前复制。不要把它当成网络客户端的 on('frame')。

### device.onError(handler) {#on-error}

**用途**：订阅连接成功后的读取、解析、断开或帧回调错误。

**参数**：必填 `(error: ShroomError) => void`。**返回值**：`() => void` 取消订阅函数。

**示例**：`const offError = device.onError((error) => console.error(error.code, error.stage, error.suggestion))`；结束监听用 `offError()`。

**注意事项**：连接尚未成功时用 `try / catch`。错误提供 `code / stage / message / suggestion / details / cause`，`asShroomError(error)` 可归一化未知异常。串口读取、解析或断开错误会自动停止并尝试清理，应用可 `await device.close()` 确认清理结果。`CALLBACK_FAILED` 是应用帧回调错误，不会停止采集或影响其他监听，不表示设备断线。没有自动重连或 `device.on('error')`。

### device.close() {#close}

**用途**：清理帧监听、取消 reader 并释放串口；Mock 时停止定时器。

**参数**：无。**返回值**：`Promise<void>`。**示例**：`await device.close()`。

**注意事项**：可重复调用，正常关闭后 `state` 为 `closed`；发生串口故障后可保留 `error` 状态和最近错误供排查。关闭失败会拒绝为结构化错误。清理应用内的其他监听仍由调用方负责。

### 设备属性与诊断 {#device-properties}

| 属性 | 说明 |
| --- | --- |
| info | source、baudRate 和调用方设置的 rows/cols |
| state | open / closed / error |
| bytesReceived | 真实串口接收字节数 |
| frameCount | 已切出的 payload 数 |
| droppedCount | 丢弃帧数 |
| frameLength | 已锁定长度，未锁定为零 |
| getDiagnostics() | 无参数，同步返回状态、计数、lastError、status 与 hint 快照 |

**示例**：`console.log(device.state, device.getDiagnostics())`。快照包含 `source / state / bytesReceived / frameCount / droppedCount / frameLength / lastError / status / hint`；最近错误为不含 cause 的可序列化快照。

产品设备的 `info` 还包含 `product / label`，手套另有 `side`；错误、状态和关闭语义与通用设备一致。

`status` 为 `waiting-data / waiting-frame / streaming / closed / error`，分别反映尚无字节、有字节尚未成帧、曾产出帧、关闭与错误。`streaming` 是累计观测，不证明设备仍在持续发送，也不保证尺寸或线序正确；`hint` 是排查建议，不能自动判定根因。Mock 也提供这些接口，字节数与帧数反映模拟生成量，帧长在首帧前为 0、首帧后为模拟 payload 点数，丢帧为 0，不是串口吞吐；输出形状以实际 Frame 为准。

## 模拟数据 {#mock}

### Shroom.mock(options) / createMockDevice(options) {#mock-device}

**用途**：无需硬件，生成与串口同结构的 Frame。具名函数从 web/index.js 导入。

| 参数 | 类型 | 默认值 |
| --- | --- | --- |
| rows / cols | number | 各 32，正整数，总点数不超过 1048576 |
| fps | number | 30，有限数值，范围为 `1000 / 2147483647` 至 `1000`（含边界，约 `4.657e-7` 至 `1000`） |
| 其他解码选项 | DecodeOptions | 与 decodeFrame 相同 |

**返回值**：同步 Device，不是 Promise。**示例**：`const device = Shroom.mock({ rows: 32, cols: 32, fps: 20 })`。

**注意事项**：同样需要取消监听和 close()；不需要串口授权。Mock 不会启动真实后端。

## 已有后端连接 {#backend}

### BackendSdkClient {#backend-client}

**用途**：设备已由后端连接时，网页通过 HTTP 查询 / 控制，WS 订阅，不重复打开串口。

**参数**：构造选项含 httpBaseUrl、wsUrl、timeoutMs、headers、contract、routes 与实现注入。默认 HTTP 127.0.0.1:19245、WS 127.0.0.1:19999，超时 10000 毫秒。

**返回值**：BackendSdkClient。所有方法、事件与参数表见 [后端通讯 API](../BACKEND.md#constructor)。

**示例**：

```js
const client = new BackendSdkClient({
  httpBaseUrl: 'http://127.0.0.1:19245', wsUrl: 'ws://127.0.0.1:19999',
});
client.on('error', (error) => console.error(error.message));
client.on('frame', (frame) => console.log(frame));
await client.getContract();
client.connectRealtime({ channels: ['sit'] });
window.addEventListener('pagehide', () => client.disconnectRealtime(), { once: true });
```

**注意事项**：CORS / WS Origin 由后端配置；HTTPS 页面用 HTTPS / WSS。构造不会发请求，不自动启动后端、控制设备或重连。HTTP headers 不会自动变成浏览器 WS 请求头。

### 网络帧与基础 Frame {#frame-adapter}

网络 frame 事件保留后端 JSON，字段与单位由后端决定，不保证存在基础 values/rows/cols。必须依据真实契约适配，不能将任意 JSON 直接传给 heatmap.render()，也不能臆造物理单位。

## 完整生命周期示例 {#example}

以下为通用串口进阶示例，页面放在 SDK 根目录，通过 HTTP 服务打开；重复连接和退出时释放旧设备。产品入口同样需要管理关闭与页面清理：

```html
<button id="connect">连接设备</button>
<button id="disconnect">断开</button>
<pre id="output"></pre>
<script type="module">
  import { Shroom, ERROR_CODES } from './web/index.js';
  const output = document.querySelector('#output');
  const connectButton = document.querySelector('#connect');
  let device;
  let unsubscribe;
  const showError = (error) => {
    output.textContent = `${error.code}: ${error.message}\n${error.suggestion}`;
  };
  async function disconnect() {
    unsubscribe?.();
    unsubscribe = undefined;
    const previous = device;
    device = undefined;
    if (previous) await previous.close();
  }
  connectButton.onclick = async () => {
    connectButton.disabled = true;
    try {
      // 先由点击触发选择框，再异步关闭旧设备，保留用户手势。
      const next = await Shroom.connect({ rows: 32, cols: 32, baudRate: 1000000 });
      const previous = device;
      unsubscribe?.();
      device = next;
      device.onError((error) => {
        showError(error);
        console.log(next.getDiagnostics());
      });
      unsubscribe = device.onFrame((frame) => { output.textContent = `最大值：${frame.max}`; });
      if (previous) await previous.close();
    } catch (error) {
      if (error.code !== ERROR_CODES.USER_CANCELLED) showError(error);
    }
    finally { connectButton.disabled = false; }
  };
  document.querySelector('#disconnect').onclick = () => { void disconnect().catch(showError); };
  window.addEventListener('pagehide', () => { void disconnect().catch(console.error); });
</script>
```

框架应用只在挂载后、用户授权动作中连接，卸载时执行相同清理；绘图接口见 [渲染 API](RENDERING.md)。
