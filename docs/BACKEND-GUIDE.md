# 后端 SDK API

按接口查阅串口、模拟数据、帧解析、点位配置、后端通讯和存储。每个接口列出用途、调用方式、参数、返回值、示例与注意事项；语言下拉框同时切换正文与本页目录。

快速接入的 `readProduct / createWS` 分别调用本页的 `connectProduct / serveDevice`；采集与下载也复用同一服务方法。查看[五函数与基础 API 对应表](CUSTOM.md#quick-to-base)，或直接查下方参数。

## 环境与导入 {#setup}

真实设备先完成[驱动安装](DRIVERS.md)与[SDK 授权](LICENSE.md)。CH34x 驱动缺失时系统不能提供串口；Windows 使用 [CH341SER.EXE](https://shroom.jq-industries.com/drive/CH341SER.EXE)，macOS 使用 [CH34xVCPDriver.zip](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)。安装后重插设备、重启采集程序再查询。SDK 许可证不按设备型号限制产品接口或通用串口，但产品协议仍需匹配实际硬件。

<div data-sdk-language="node">

### Node.js 入口 {#node-import}

使用 Node.js 18+。在含有 `node/`、`web/` 和 `package.json` 的 SDK 解压目录运行：

```bash
npm install
```

```js
import { Shroom, BackendSdkClient, createFramer, decodeFrame, resolveShape,
  getLayout, listLayouts, getProduct, listProducts,
  connectGlove, connectHandPad, connectProduct, listDeviceProducts, serveDevice,
  ShroomError, asShroomError, ERROR_CODES } from './node/index.js';
```

示例保存为根目录的 `.mjs` 文件，用 `node 文件名.mjs` 运行。真实串口依赖 `serialport`；快速 WS 采集服务依赖 `ws` 与 SQLite 驱动 `better-sqlite3`，均由 SDK 根目录的 `npm install` 安装。模拟数据和核心解析不需要串口硬件或采集数据库。

</div>

<div data-sdk-language="python">

### Python 入口 {#python-import}

使用 Python 3.10+，进入含有 `python/` 的解压目录：

```bash
python -m pip install "./python[serial]"
```

```python
from shroom_sdk import Shroom, Framer, decode_frame, resolve_shape, get_layout, ShroomError
```

示例保存为 `.py` 文件，用 `python 文件名.py` 运行。串口需要 pySerial；Mock 与核心解析没有第三方运行依赖。Python 是同步读取模型，不提供 JavaScript 的帧回调接口。

</div>

SDK 使用 ZIP 或本地依赖安装，尚未发布公共 npm / PyPI 包。浏览器接入见 [前端通讯 API](FRONTEND-COMMUNICATION.md)，Canvas 见 [渲染 API](RENDERING.md)。

## 串口 {#serial}

Node.js / 浏览器连接已封装的整包手套与手部检测垫时，优先使用产品入口，SDK 内置协议、波特率与映射，应用直接处理 `onData`。通用 `connect()` 保留为进阶入口；Python 仍使用通用串口与矩阵 API，不提供本节中的 JS 产品入口或整包手套协议。

通用接入路线是 **查询端口 → 配置连接 → 自动解析 → 错误诊断**。端口查询只枚举系统可见端口，不识别硬件型号；查询、参数校验、打开、运行与关闭都有错误处理入口。

<div data-sdk-language="node">

### Shroom.connectGlove(options) {#node-connect-glove}

**用途**：连接整包手套 `handGloveFullPacket`，内置 921600 波特率、整包解析和左右手映射。浏览器提供同名方法。

| 参数 | 类型 | 必填 / 默认值 |
| --- | --- | --- |
| `side` | `'left' \| 'right'` | 必填，明确选择左右手 |
| `path` | `string` | Node 可选；省略时仅恰好一个端口才自动选择 |
| `port / filters` | 浏览器串口对象 / 筛选数组 | 仅浏览器可选；未给 port 时由用户选择端口 |
| `onData` | `(data) => void` | 可选，在打开前注册的数据回调 |
| `onError` | `(error: ShroomError) => void` | 可选，在打开前注册的运行错误回调 |

**返回值**：`Promise<ProductDevice<GloveFrame>>`；产品设备有 `onData / onFrame / onError / state / getDiagnostics() / close()`，`info` 含 product、label、side，数据字段见[产品帧](#node-product-data)。具名 `connectGlove()` 是相同入口。

**示例**：

```js
import { Shroom } from './node/index.js';
try {
  const device = await Shroom.connectGlove({
    path: 'COM3', side: 'left',
    onData: (data) => {
      console.log(data.fingers.thumb.raw);
      console.log(data.fingers.index.pulp.raw[0]);
      console.log(data.palm.matrix);
    },
    onError: (error) => console.error(error.code, error.stage, error.suggestion),
  });
  process.once('SIGINT', () => { void device.close().catch(console.error); });
} catch (error) {
  console.error(error.code, error.message, error.suggestion);
}
```

**注意事项**：`side` 不能从包类型或端口推断。Node 零端口为 `PORT_NOT_FOUND`、多端口为 `PORT_AMBIGUOUS`，不会随意打开第一个；显式 path 仍需由应用选择。浏览器必须在用户手势中调用，不扫描硬件型号。连接前失败仍拒绝 Promise，不交给 `onError`。不接受 `baudRate / delimiter / rows / cols / layout` 等底层协议覆盖；其他协议使用通用 `connect()`。

### Shroom.connectHandPad(options) {#node-connect-hand-pad}

**用途**：连接手部检测垫 `hand`，内置 1000000 波特率、1024 点、32×32 与 `mat32` 点位映射。

**参数**：可选对象；Node 使用 `path / onData / onError`，浏览器使用 `port / filters / onData / onError`。端口选择、回调注册和错误行为与 `connectGlove()` 相同，不需要 side。

**返回值**：`Promise<ProductDevice<HandPadFrame>>`，支持相同的产品设备方法；具名 `connectHandPad()` 是相同入口。

**示例**：

```js
const device = await Shroom.connectHandPad({
  path: 'COM3',
  onData: (data) => console.log(data.values, data.center),
  onError: (error) => console.error(error.code, error.suggestion),
});
process.once('SIGINT', () => { void device.close().catch(console.error); });
```

**注意事项**：输出已映射，无需应用传波特率、矩阵尺寸或 layout；不接受这些参数覆盖。相对 ADC 不等于 kPa / N，产品入口不执行压力标定。

### Shroom.connectProduct(options) {#node-connect-product}

**用途**：按明确的产品标识连接，统一实现产品选择菜单。

**参数**：必填 `product`，支持手套 `'glove' / 'handGloveFullPacket'`、检测垫 `'pad' / 'hand'`；其余选项与对应产品方法一致。手套必须提供 `side: 'left' | 'right'`，检测垫不传 side。

**返回值**：对应产品设备的 Promise，与相应 `connectGlove()` / `connectHandPad()` 相同；具名 `connectProduct()` 是相同入口。

**示例**：`await Shroom.connectProduct({ product: 'handGloveFullPacket', path: 'COM3', side: 'right', onData: console.log })`。

**注意事项**：快速 `readProduct()` 在 Node 直接调用本接口，复用相同校验、解析与返回设备。别名只用于连接，`device.info.product` 和 `frame.product` 仍为正式 ID `handGloveFullPacket / hand`。product 是调用方的选择，不是硬件自动识别结果；通用协议继续使用 `Shroom.connect()`。Python 未提供这些产品方法。

### Shroom.listDeviceProducts() {#node-device-products}

**用途**：列出已实现高层连接的产品，供应用构建可直连产品菜单。

**参数**：无。**返回值**：`DeviceProductInfo[]`，每项为 `{ product, label, family, baudRate, payloadLength, sensorPoints, rows, cols }`；具名 `listDeviceProducts()` 是相同入口。

| product | label / family | 波特率 / payload 字节数 | 采样点数 / 产品数据 |
| --- | --- | --- | --- |
| `handGloveFullPacket` | 触觉手套（整包）/ glove | 921600 / 274 | 256 / 五指、独立指腹与手掌分区 |
| `hand` | 手部检测垫 / mat | 1000000 / 1024 | 1024 / 32×32 |

**示例**：`console.log(Shroom.listDeviceProducts())`。

**注意事项**：同步返回，不查询串口，不验证产品是否在线。手套业务点位以 `fingers / palm` 分区为准，不将返回元数据中的 `rows / cols` 作为整只手套的点位规模。旧 `listProducts()` 是通用矩阵产品与线序菜单，旧 `listLayouts()` 是走线表；不要据此假定每个旧产品都已有高层连接封装。

### device.onData(handler) {#node-on-data}

**用途**：订阅高层产品数据；是产品设备 `onFrame()` 的别名。

**参数**：必填同步函数 `(data) => void`。**返回值**：`() => void` 取消订阅函数。

**示例**：`const off = device.onData((data) => console.log(data.pressure))`；结束监听用 `off()`。手套分区字段见下节。

**注意事项**：需要从首帧开始接收时，优先在连接选项中提供 `onData`，它在打开端口前注册。首帧可能早于连接 Promise 完成，回调应直接使用传入的 data，不要假定外层 `const device` 已初始化；需要访问设备时可先声明 `let device` 并判空，或连接后调用 `device.onData()`。`onData` 和 `onFrame` 订阅相同数据，不要重复订阅后再把同一帧计算两次；回调错误为 `CALLBACK_FAILED`，不自动停止采集。

### 产品帧与整包手套数据 {#node-product-data}

| 产品 | 原始压力字段 | 推荐业务字段 | 其他字段 |
| --- | --- | --- | --- |
| `hand` | `raw / pressure`：1024 个扫描顺序 ADC | `pressureMatrix`：1024 个映射 ADC；`values`：归一化 32×32 | 基础 Frame 的矩阵统计与时间戳 |
| `handGloveFullPacket` | `raw / pressure`：256 个压力 ADC | `fingers.*.raw`：五指主体；`fingers.*.pulp.raw`：独立指腹；`palm.matrix`：72 点手掌 | `side / sequence / packetType / imu.raw`，IMU 原始字节数为 16 |

整包手套固定 274 字节 payload：序号 1 字节、包类型 1 字节、压力 256 字节、IMU 16 字节，包尾为 `AA 55 03 99`。左右手映射由必填 side 决定，不能通过 packetType 猜测。

**示例**：手套读取 `data.fingers.thumb.raw`、`data.fingers.index.pulp.raw[0]` 和 `data.palm.matrix`。手部检测垫按行列读取 `data.values[y * data.cols + x]`，已映射 ADC 使用 `data.pressureMatrix`；两个产品的原始扫描数据均使用 `data.pressure`。

**五指、独立指腹与手掌**：直接访问 `data.fingers.thumb / index / middle / ring / little`，分别是大拇指、食指、中指、无名指、小拇指，每指主体 4×3、12 点；各指的 `.pulp` 是独立 1×1 指腹分区。`data.palm` 为手掌，声明 rows=5、cols=15，实际行长 `[12, 15, 15, 15, 15]`，共 72 点，不补零。左右手按各自表提取，调用方无需依据对象顺序或切片位置区分手指。

| GloveRegion 字段 | 类型 | 含义 |
| --- | --- | --- |
| `name` | `string` | 中文分区名称 |
| `rows / cols` | `number` | 行数与声明列宽；每行实际长度见 rowLengths |
| `rowLengths` | `number[]` | 按点位表保留的各行点数 |
| `sourceIndices` | `Uint16Array` | 按行展开的 0-based 原扫描索引，用户表的 1-based 点号已减 1 |
| `raw` | `Uint8Array` | 对应源索引的 ADC，无额外补零 |
| `values` | `Float32Array` | raw 按父帧相同 fullScale 归一化 |
| `matrix` | `number[][]` | ADC 按实际行长组成的二维数组，不是归一化值 |

**分区示例**：

```js
const thumb = data.fingers.thumb;
console.log(thumb.raw);                     // 大拇指主体 12 点
console.log(data.fingers.index.pulp.raw[0]); // 食指独立指腹 ADC
console.log(data.palm.matrix);              // 5 行，首行 12 点，其余各 15 点
console.log(data.palm.sourceIndices);       // 对应原 256 点扫描的 0-based 索引
```

五指主体 60 点、独立指腹 5 点、手掌 72 点合计 137 个映射位置，不要求覆盖全部 256 通道。分区直接依照左右手点位表从原始 `pressure` 提取，通过命名属性访问，不从其他矩阵切片获取。五指和手掌的统计由应用按目标分区计算，不把基础 Frame 的矩阵统计解释为这些分区的汇总。分区 `raw / matrix` 是 ADC，分区 `values` 是相对值，都不是力、物理压力或弯曲角度。

点位表中的 `btPacketSize: 128` 仅为表元数据，不新增蓝牙或双包传输。连接仍是 274 字节整包串口，IMU 仍只保留 16 字节原始数据。上述分区仅 Node.js / 浏览器整包手套提供，Python 和通用 Mock 未实现。

**注意事项**：两种产品的 `raw / pressure`、手套分区的 `raw` 和 `imu.raw` 均为 `Uint8Array`；手套 `palm.matrix` 为按实际行长排列的 ADC 二维数组，分区 `values` 为 `Float32Array`。手部检测垫的 `pressureMatrix` 为 `Uint8Array`、`values` 为 `Float32Array`。产品帧带有 `product` 标识；手套 `sequence` 为可能回绕的单字节序号，不是毫秒时间戳。产品解析和映射已完成，不再调用 `decodeFrame()` 或套用 layout。产品诊断 frameLength 在首个合法包前为 0，之后为 payload 字节数（手套 274 / 手垫 1024），不是映射后的点数。IMU 仅保留原始字节，不承诺单位解析或姿态解算；不提供手势识别或物理压力标定。其他手套协议仍需单独适配。

### Shroom.listPorts() {#node-list-ports}

**用途**：枚举当前机器的串口；具名函数 `listPorts()` 是相同入口。

**参数**：无。**返回值**：`Promise<PortInfo[]>`，无设备时为空数组。字段为 `path`，以及可选的 `manufacturer / serialNumber / vendorId / productId`。

**示例**：

```js
import { Shroom } from './node/index.js';
console.log(await Shroom.listPorts());
```

**注意事项**：需要 `serialport`。查询失败拒绝为 `ShroomError`；空数组表示没有可见端口。端口路径如 `COM3`、`/dev/ttyUSB0`，查询不会识别产品、协议或线序。

### Shroom.connect(options) {#node-connect}

**用途**：通用串口进阶入口，打开真实串口并按调用方参数分帧与解码。具名 `connectSerial(options)` 是同一入口；已支持的手套和检测垫优先用上面的产品方法。

**调用方式**：`await Shroom.connect(options)`。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `path` | `string` | 可选，未提供时选择第一个端口；生产应用建议明确指定 |
| `baudRate` | `number` | `1000000`，正整数，与设备一致 |
| `delimiter / minLength / maxLength / lockLength` | 分帧选项 | 同 `createFramer()` |
| `rows / cols / points / fullScale / threshold / layout` | 解码选项 | 同 `decodeFrame()` |

**返回值**：`Promise<Device>`；查询、配置或打开失败以 `ShroomError` 拒绝 Promise，成功后用 `onFrame()` 接收帧。

**示例**：

```js
import { Shroom } from './node/index.js';
const device = await Shroom.connect({ path: 'COM3', baudRate: 1000000, rows: 32, cols: 32 });
device.onError((error) => console.error(error.code, error.stage, error.suggestion));
const unsubscribe = device.onFrame((frame) => console.log(frame.max));
process.once('SIGINT', async () => { unsubscribe(); await device.close(); });
```

**注意事项**：先校验串口、拆帧及解码配置，再打开端口；参数限制见下面对应接口。端口不存在、占用或权限不足时失败；不要与上位机共用同一端口。JS `Device` 没有 `write()` 或 `device.on('error')`，运行期使用 `onError()`；SDK 不自动重连。

### Shroom.mock(options) {#node-mock}

**用途**：创建模拟设备；具名 `createMockDevice()` 相同。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `rows / cols` | `number` | 各 `32`，正整数，总点数不超过 1048576 |
| `fps` | `number` | `30`，有限数值，范围为 `1000 / 2147483647` 至 `1000`（含边界，约 `4.657e-7` 至 `1000`） |
| 其他解码选项 | `DecodeOptions` | 同 `decodeFrame()` |

**返回值**：同步 `Device`，不是 Promise。自动产生帧，结束时必须关闭。

**示例**：

```js
import { Shroom } from './node/index.js';
const device = Shroom.mock({ rows: 32, cols: 32, fps: 20 });
const unsubscribe = device.onFrame((frame) => console.log(frame.timestamp, frame.area));
try { await new Promise((resolve) => setTimeout(resolve, 1000)); }
finally { unsubscribe(); await device.close(); }
```

**注意事项**：JS Mock 没有随机种子参数；可用 `state / getDiagnostics()` 观察模拟设备生命周期和产帧状态。字节与帧计数记录模拟生成量，帧长在首帧前为 0、首帧后为模拟 payload 点数，丢帧为 0，不是串口吞吐。

### device.onFrame(handler) {#node-on-frame}

**用途**：订阅串口或 Mock 每一帧。

**参数**：必填函数 `(frame: Frame) => void`，同步调用。**返回值**：`() => void` 取消订阅函数。

**示例**：已有连接 `device` 时：

```js
const unsubscribe = device.onFrame((frame) => console.log(frame.avg, frame.center));
// 结束这个监听：
unsubscribe();
```

**注意事项**：多个监听可以共存；回调异常会记录，其他监听继续。异步回调不会被等待，避免重计算与无限积累数据。

### device.onError(handler) {#node-on-error}

**用途**：接收连接成功后的串口读取、解析、设备运行或应用帧回调错误。

**参数**：必填函数 `(error: ShroomError) => void`。**返回值**：`() => void` 取消订阅函数；多个监听可以共存。

**示例**：

```js
const offError = device.onError((error) => {
  console.error(error.code, error.stage, error.message, error.suggestion);
  console.log(device.getDiagnostics());
});
// 某个模块不再处理错误时：offError();
```

**注意事项**：查询、配置和连接尚未成功时的失败由相应 Promise 拒绝，不会交给这个监听。串口读取、解析或断开错误会自动停止并尝试清理，应用可检查快照并 `await device.close()` 确认清理结果，再决定何时重新连接。应用帧回调异常报告为 `CALLBACK_FAILED`、阶段为 `callback`，不会停止采集或中断其他帧订阅，不应当作设备断线。错误回调异常不会阻止其他监听。

### device.state / getDiagnostics() {#node-diagnostics}

**用途**：读取串口或 Mock 的生命周期与诊断快照。

**参数**：无。**返回值**：`state` 为 `'open' | 'closed' | 'error'`；`getDiagnostics()` 同步返回 `{ source, state, bytesReceived, frameCount, droppedCount, frameLength, lastError, status, hint }`。

**示例**：`console.log(device.state, device.getDiagnostics())`。

**注意事项**：读取快照不会等待数据，也不会探测硬件或自动判断根因。字段和 `status` 含义见[设备信息与诊断](#diagnostics)。

### ShroomError / asShroomError / ERROR_CODES {#node-errors}

**用途**：统一识别、记录与展示查询、配置、连接和运行错误；均从 Node.js 或浏览器入口具名导入。

| 接口 | 参数 | 返回值 |
| --- | --- | --- |
| `new ShroomError(code, message, options?)` | 错误码、可读消息；可选 `{ stage, suggestion, details, cause }` | 带对应字段的 `ShroomError` |
| `asShroomError(error, options?)` | 捕获的异常；可选 code、stage、message、suggestion、details 等上下文 | `ShroomError`；已是此类型时原样返回 |
| `ERROR_CODES` | 无 | 公开错误码常量对象 |

**示例**：

```js
import { Shroom, asShroomError } from './node/index.js';
try {
  console.log(await Shroom.listPorts());
  const device = await Shroom.connect({ path: 'COM3', baudRate: 1000000 });
  device.onError((error) => console.error(error.code, error.suggestion));
  process.once('SIGINT', async () => { await device.close(); });
} catch (error) {
  const failure = asShroomError(error);
  console.error(failure.code, failure.stage, failure.message, failure.suggestion);
}
```

**注意事项**：`stage` 指出 `query / configure / connect / read / parse / close / callback` 等失败阶段，`suggestion` 是下一步检查建议，`details` 保留相关上下文，`cause` 保留底层异常。`toJSON()` 返回可序列化字段，不含 cause。`asShroomError()` 默认按 connect 阶段处理，可用 options 明确阶段。不要依赖系统错误消息字符串匹配业务分支；后端网络客户端有自己的错误契约，见[通讯](#communication)。

| 常见 code | 处理方向 |
| --- | --- |
| `INVALID_CONFIG / DEPENDENCY_MISSING` | 修正参数，或按错误提示安装对应依赖（如 `serialport / ws / better-sqlite3`） |
| `PORT_NOT_FOUND / PORT_AMBIGUOUS` | 重新查询并明确选择端口 |
| `PERMISSION_DENIED / PORT_BUSY / CONNECTION_FAILED` | 核对权限、占用、驱动与原始原因 |
| `UNSUPPORTED_ENVIRONMENT / USER_CANCELLED` | 浏览器环境不支持，或用户取消选择；取消可单独静默处理 |
| `DISCONNECTED / READ_FAILED / PARSE_FAILED / CLOSE_FAILED` | 串口读取、解析或断开错误自动停止并尝试清理；应用用 close() 确认结果并处理关闭失败，决定何时恢复 |
| `CALLBACK_FAILED` | 检查应用帧回调，设备不一定发生故障 |

### device.close() {#node-close}

**用途**：停止 Mock 或关闭串口，并清理监听。

**参数**：无。**返回值**：`Promise<void>`。**示例**：`await device.close()`。

**注意事项**：在程序退出或组件卸载时显式释放设备。重复调用幂等；正常关闭后 `state` 为 `closed`，不再产帧；故障释放后可保留 `error` 状态及最近错误供排查。SDK 不会自动重连。

### createFramer(options) {#node-framer}

**用途**：把字节流切成 payload，不连接串口、不解码数值。

| 参数 | 类型 | 默认值 |
| --- | --- | --- |
| `delimiter` | `number[] / Uint8Array` | `[0xAA, 0x55, 0x03, 0x99]`，1～64 个 0～255 的整数字节；导出为 `DEFAULT_DELIMITER` |
| `minLength` | `number` | `8`，0～1048576 的整数 |
| `maxLength` | `number` | `8192`，1～1048576 的整数，不小于 minLength |
| `lockLength` | `boolean` | `true` |

**返回值**：带 `push / reset / droppedCount / frameLength` 的切帧器。**示例**：`const framer = createFramer({ minLength: 8 })`。

**注意事项**：非法配置立即抛 `ShroomError`。连续 3 个相同长度后锁定；锁定后不匹配帧丢弃，连续 12 帧新长度可重新锁定。两端分隔符界定完整 payload。

### framer.push(chunk) / reset() {#node-framer-push}

**用途**：追加字节并提取全部完整 payload；重置时清空缓存、锁定和计数。

| 接口 | 参数 | 返回值 |
| --- | --- | --- |
| `push(chunk)` | 必填 `Uint8Array` | `Uint8Array[]`；未成帧时为空数组 |
| `reset()` | 无 | `void` |

**示例**：

```js
import { createFramer, decodeFrame } from './node/index.js';
const framer = createFramer();
const packet = Uint8Array.from([0xAA, 0x55, 0x03, 0x99, 1, 2, 3, 4, 5, 6, 7, 8, 0xAA, 0x55, 0x03, 0x99]);
for (const payload of framer.push(packet)) console.log(decodeFrame(payload, { rows: 2, cols: 4 }));
framer.reset();
```

**注意事项**：跨 chunk 分隔符自动缓存。`droppedCount` 为丢弃帧数，`frameLength` 未锁定时为 `0`。

### decodeFrame(payload, options) {#node-decode-frame}

**用途**：把完整 payload 转为统一 `Frame`，适用于应用自己的数据源。

**参数**：必填 `payload: Uint8Array`，不含分隔符；可选选项见 [Frame 与解码参数](#frame)。

**返回值**：同步 `Frame`；非 raw 排列采用该排列尺寸，缺失采样点填 `0`。

**示例**：

```js
import { decodeFrame } from './node/index.js';
const frame = decodeFrame(Uint8Array.from([0, 64, 128, 255]), { rows: 2, cols: 2 });
console.log(frame.values, frame.center);
```

**注意事项**：提前校验行列、点数、满量程、阈值和布局；非法选项抛 `ShroomError`。`raw` 是 payload 子视图，长期保存应复制。默认满量程对应通常的 0～1；修改 `fullScale` 可能超过 `1`。不做物理压力标定。

### resolveShape(points, options) {#node-resolve-shape}

**用途**：按点数推断矩阵。

| 参数 | 类型 | 必填 / 默认值 |
| --- | --- | --- |
| `points` | `number` | 必填，采样点数 |
| `options.rows / options.cols` | `number` | 可选，应成对提供；两者有效时优先使用 |

**返回值**：`{ rows, cols }`；平方数为方阵，否则为 `1 × points`。

**示例**：`resolveShape(1024)` 得到 `{ rows: 32, cols: 32 }`。

**注意事项**：此函数不读取 `layout`，排列尺寸由 `decodeFrame()` 处理。

### getLayout(name) / listLayouts() {#node-layout}

**用途**：获取或枚举点位排列，不改变 ADC 数值。

| 接口 | 参数 | 返回值 |
| --- | --- | --- |
| `getLayout(name)` | 可选排列名，如 `'mat32'` | `{ rows, cols, perm: Int32Array }`；raw、未提供或未知名称为 `null` |
| `listLayouts()` | 无 | `{ name, label, rows, cols }[]` |

**示例**：

```js
import { getLayout, listLayouts } from './node/index.js';
console.log(listLayouts(), getLayout('mat32').perm[0]);
```

**注意事项**：`perm[显示位置]` 为原始下标，`-1` 表示空点。排列被缓存，不应修改。导出的 `LAYOUTS` 是排列定义集合，产品菜单用下面的接口。

### listProducts() / getProduct(name) {#node-products}

**用途**：提供产品名称、线序和尺寸，面向产品选择菜单。

| 接口 | 参数 | 返回值 |
| --- | --- | --- |
| `listProducts()` | 无 | `ProductInfo[]`，保持菜单顺序 |
| `getProduct(name)` | 产品标识，如 `'fast256'` | `{ name, label, layout, rows, cols }`；未知名称为 `null` |

**示例**：

```js
import { Shroom, listProducts, getProduct } from './node/index.js';
console.log(listProducts());
const product = getProduct('fast256');
if (!product) throw new Error('未知产品');
const device = Shroom.mock({ rows: product.rows, cols: product.cols, layout: product.layout });
await device.close();
```

**注意事项**：导出的 `PRODUCTS` 是原始定义数组。raw 产品使用通用接口时必须传相应 `rows / cols`，查产品不会连接硬件。此表仍用于通用矩阵产品，整包手套走 `connectGlove({ side })` 与 `listDeviceProducts()`，不使用通用 layout；其他协议和多串口整椅采集不因此获得支持。

### Shroom.renderAscii(frame, options) {#node-ascii}

**用途**：转换为终端彩色热力图；具名 `renderAscii()` 相同。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `frame` | `Frame` | 必填 |
| `options.width` | `number` | `32`，输出列数不超过原始列数 |
| `options.colormap` | 名称或函数 | `'jet'` |
| `options.gain` | `number` | `1`，仅影响显示 |

**返回值**：包含 ANSI 24 位背景色转义的 `string`，不自行打印。

**示例**：

```js
import { Shroom, decodeFrame } from './node/index.js';
const frame = decodeFrame(Uint8Array.from([0, 64, 128, 255]), { rows: 2, cols: 2 });
console.log(Shroom.renderAscii(frame, { width: 16 }));
```

**注意事项**：终端需支持 ANSI 真彩色；调色板见 [渲染 API](RENDERING.md#colormap)。Node.js 不提供 Canvas 渲染器。

</div>

<div data-sdk-language="python">

### Shroom.list_ports() {#python-list-ports}

**用途**：枚举系统串口；顶层 `list_ports()` 相同。

**参数**：无。**返回值**：`list[PortInfo]`，没有设备时为空列表。

**字段**：`path / description / manufacturer / serial_number / vendor_id / product_id`；USB ID 是整数或 `None`，与 Node.js 命名及类型不同。

**示例**：

```python
from shroom_sdk import Shroom
print(Shroom.list_ports())
```

**注意事项**：安装 `pyserial`，不是另一个名为 `serial` 的包。查询只枚举系统端口，不自动识别设备协议、波特率或布局；查询失败应捕获结构化错误。

### Shroom.connect(path, **options) {#python-connect}

**用途**：同步打开串口；顶层 `connect()` 返回同一类 `SerialDevice`。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `path` | `str \| None` | `None`，仅单个端口时自动选择；多个端口必须指定 |
| `baud_rate` | `int` | `1_000_000`，正整数 |
| `delimiter / min_length / max_length / lock_length` | 分帧选项 | 同 `Framer()` |
| `rows / cols / points / full_scale / threshold / layout` | 解码选项 | 同 `decode_frame()` |

**返回值**：`SerialDevice`，支持 `with`、同步读取、写入与关闭，不是协程。

**示例**：

```python
from shroom_sdk import Shroom
with Shroom.connect("COM3", baud_rate=1_000_000, rows=32, cols=32) as device:
    frame = device.read_frame(timeout=5.0)
    if frame is not None:
        print(frame.max, frame.center)
```

**注意事项**：串口、拆帧和解码参数在打开端口前校验，失败抛结构化 `ShroomError`。配置错误兼容 `ValueError`，I/O 错误兼容 `OSError`；单线程负责读取，`with` 自动释放，没有自动重连。

### Shroom.mock(**options) {#python-mock}

**用途**：创建同步模拟设备；顶层 `mock()` 相同。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `rows / cols` | `int` | 各 `32`，正整数 |
| `fps` | `float` | `30`，有限数值，范围为 `1000 / 2147483647` 至 `1000`（含边界，约 `4.657e-7` 至 `1000`） |
| `seed` | `int \| None` | `None`，可控制噪声随机种子 |
| 其他解码选项 | 关键字参数 | 同 `decode_frame()` |

**返回值**：`MockDevice`，按读取或迭代产生帧，没有后台采集线程。

**示例**：

```python
from shroom_sdk import Shroom
with Shroom.mock(rows=32, cols=32, fps=20, seed=1) as device:
    for index, frame in enumerate(device):
        print(frame.max)
        if index >= 19:
            break
```

**注意事项**：没有 JavaScript 的 `onFrame()`，使用同步读取接口。

### device.read_frame(timeout) {#python-read-frame}

**用途**：阻塞等待一帧，适用于串口与 Mock。

**参数**：`timeout: float | None`，默认 `1.0` 秒，有限正数；`None` 持续等待。

**返回值**：`Frame | None`，超时返回 `None`，不代表永久断线。

**示例**：`frame = device.read_frame(timeout=2.0)`，使用前检查是否为 `None`。

**注意事项**：读流或解析失败向调用方抛出结构化异常；超时的 `None` 不代表永久断线，可结合 `get_diagnostics()` 排查。不要在 UI 线程执行阻塞读取。

### device.frames(timeout) / 迭代 {#python-frames}

**用途**：连续产生帧；`for frame in device` 等价于默认 `frames()`。

**参数**：timeout 同 `read_frame()`，默认 `1.0` 秒。**返回值**：`Iterator[Frame]`；超时继续等待，不产出 `None` 或结束。

**示例**：

```python
from shroom_sdk import Shroom
with Shroom.mock() as device:
    for index, frame in enumerate(device.frames(timeout=1.0)):
        print(frame.timestamp)
        if index >= 2:
            break
```

**注意事项**：用 `break`、关闭或中断结束；无限迭代不是后台订阅。

### device.write(data) {#python-write}

**用途**：在真实 `SerialDevice` 上发送调用方提供的协议命令。

**参数**：必填 `data: bytes`，来自实际设备协议。**返回值**：实际写入字节数 `int`。

**示例**：已有连接与协议命令 `command` 时，`written = device.write(command)`。

**注意事项**：Mock 没有 `write()`；SDK 不内置启动、标定或归零命令。写入失败向调用方抛出结构化异常，不能臆造命令。

### device.close() / with {#python-close}

**用途**：标记关闭、释放串口、清空待处理帧。

**参数**：无。**返回值**：`None`。**示例**：`device.close()`，推荐用 `with Shroom.connect(...) as device:`。

**注意事项**：可读取 `closed: bool` 和 `state`；重复关闭不再次操作设备，与 JS 异步关闭不同。正常关闭为 `closed`，读写或解析故障后释放仍保留 `error` 状态与最近错误；关闭本身失败也记录为 error 并抛出。

### device.state / get_diagnostics() {#python-diagnostics}

**用途**：读取 `SerialDevice` 或 `MockDevice` 的生命周期和诊断快照。

**参数**：无。**返回值**：`state` 为 `open / closed / error`；`get_diagnostics()` 返回字典，键为 `source / state / bytes_received / frame_count / dropped_count / frame_length / last_error / status / hint`。

**示例**：`print(device.state, device.get_diagnostics())`；在 `read_frame()` 返回 `None` 时读取快照，可区分当前有无字节和完整帧。

**注意事项**：同步返回，不发起读取或后台采集；诊断字段、状态与限制见[设备信息与诊断](#diagnostics)。

### ShroomError {#python-errors}

**用途**：在同步调用处统一处理查询、配置、打开、读写、解析和关闭失败。

**字段**：`code` 为错误码，`stage` 为发生阶段，`suggestion` 为检查建议，`details` 为上下文；`str(error)` 返回可读消息。

**示例**：

```python
from shroom_sdk import Shroom, ShroomError
try:
    print(Shroom.list_ports())
    with Shroom.connect("COM3", rows=32, cols=32) as device:
        frame = device.read_frame(timeout=2)
        if frame is None:
            print(device.get_diagnostics())
except ShroomError as error:
    print(error.code, error.stage, str(error), error.suggestion)
```

**注意事项**：配置异常兼容 `ValueError`，I/O 异常兼容 `OSError`，缺依赖兼容 `ImportError`，关闭后读写还兼容 `RuntimeError`。错误对象保留 `cause / __cause__`，`to_dict()` 返回不含 cause 的错误快照。没有 JavaScript 的 `onError()` 回调、Promise 或后台线程。读取超时保持返回 `None`。

### Framer(**options) {#python-framer}

**用途**：构造切帧器，不打开设备。

| 参数 | 类型 | 默认值 |
| --- | --- | --- |
| `delimiter` | 字节序列 | `bytes((0xAA, 0x55, 0x03, 0x99))`，1～64 个 0～255 的整数字节；导出为 `DEFAULT_DELIMITER` |
| `min_length` | `int` | `8`，至少 `1` |
| `max_length` | `int` | `8192`，不小于最小长度，不超过 1048576 |
| `lock_length` | `bool` | `True` |

**返回值**：带 `push / reset / dropped_count / frame_length` 的 `Framer`。

**示例**：`framer = Framer(min_length=8, lock_length=True)`。

**注意事项**：空分隔符或非法长度抛 `ValueError`。3 帧锁定、12 帧重新锁定规则与 Node.js 相同。

### framer.push(chunk) / reset() {#python-framer-push}

**用途**：追加字节并返回完整 payload；重置清空缓存和计数。

| 接口 | 参数 | 返回值 |
| --- | --- | --- |
| `push(chunk)` | 必填 `bytes / bytearray / memoryview` | `list[bytes]`，可以为空 |
| `reset()` | 无 | `None` |

**示例**：

```python
from shroom_sdk import Framer, DEFAULT_DELIMITER, decode_frame
framer = Framer()
packet = DEFAULT_DELIMITER + bytes(range(1, 9)) + DEFAULT_DELIMITER
for payload in framer.push(packet):
    print(decode_frame(payload, rows=2, cols=4))
framer.reset()
```

**注意事项**：payload 不含分隔符，为独立快照；错误字节类型抛 `TypeError`。未锁定 `frame_length` 为零。

### decode_frame(payload, **options) {#python-decode-frame}

**用途**：将一个完整 payload 解码为 `Frame`。

**参数**：必填 `bytes / bytearray / memoryview`，不含分隔符；选项见 [Frame 与解码参数](#frame)。

**返回值**：同步 `Frame`，`raw` 为字节快照，`values` 为 `array('f')`。

**示例**：

```python
from shroom_sdk import decode_frame
frame = decode_frame(bytes((0, 64, 128, 255)), rows=2, cols=2)
print(frame.values, frame.center.x)
```

**注意事项**：行列成对；`full_scale` 为有限正数，`threshold` 为有限非负数。非法类型抛 `TypeError`，非法值抛 `ValueError`。mat32 显式使用 `rows=32, cols=32`。

### resolve_shape(points, rows=..., cols=...) {#python-resolve-shape}

**用途**：推断矩阵尺寸。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `points` | `int` | 必填，非负整数 |
| `rows / cols` | `int \| None` | 各 `None`，设置时必须成对且为正整数 |

**返回值**：`tuple[int, int]`；平方数为方阵，否则 `(1, points)`。

**示例**：`resolve_shape(1024)` 得到 `(32, 32)`。

**注意事项**：不是 JS 的对象返回值；只设一个维度抛 `ValueError`。

### get_layout(layout, rows, cols) {#python-layout}

**用途**：获取显示位置到原始下标的映射。

| 参数 | 类型 | 必填 / 说明 |
| --- | --- | --- |
| `layout` | `str / Sequence[int] / None` | 必填，raw 或 None 为原序；mat32 为内置排列；也可给自定义序列 |
| `rows / cols` | `int` | 必填，mat32 必须 `32 × 32` |

**返回值**：`tuple[int, ...] | None`；原序为 `None`。

**示例**：`get_layout([3, 2, 1, 0], 2, 2)` 得到 `(3, 2, 1, 0)`。

**注意事项**：自定义排列必须是完整 `0 .. rows*cols-1` 置换，不支持 `-1` 空点；未知内置名抛 `ValueError`。Python 没有完整 JS 产品表、`listProducts()` 或 `listLayouts()`。

### Shroom.render_ascii(frame, width=..., gain=...) {#python-ascii}

**用途**：产生纯字符热力图；顶层 `render_ascii()` 相同。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `frame` | `Frame` | 必填 |
| `width` | `int` | `32`，正整数，输出列数不超过原始列数 |
| `gain` | `float` | `1.0`，有限正数 |

**返回值**：`str`，使用 ` .:-=+*#%@` 字符，没有 ANSI 颜色。

**示例**：

```python
from shroom_sdk import Shroom, decode_frame
frame = decode_frame(bytes((0, 64, 128, 255)), rows=2, cols=2)
print(Shroom.render_ascii(frame, width=16, gain=1.0))
```

**注意事项**：没有 JS 的 colormap 参数；可选 Matplotlib 图形示例不是 Canvas API。

</div>

### Frame 与解码参数 {#frame}

通用连接、Mock 与直接解码共用下表；Python 用关键字参数，JS 放进 options。JS 高层产品入口固定这些参数，不接受覆盖；其附加字段见[产品帧](BACKEND-GUIDE.md?language=node#node-product-data)。

| Node.js / Python 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `rows / cols` | 正整数 | 成对提供；未提供时按点数推断，非方阵显式指定 |
| `points` | 非负整数 | 默认 payload 长度，只取前 N 字节，不超过 1048576；实际取值截至 payload 长度 |
| `fullScale / full_scale` | 有限正数 | `255`，归一化分母 |
| `threshold` | 有限非负数 | `0.02`，有效点统计阈值 |
| `layout` | 排列 | `'raw'`，两语言支持范围不同 |

| Frame 字段 | JS / Python 类型 | 含义 |
| --- | --- | --- |
| `raw` | `Uint8Array / bytes` | 原始字节，0～255，保持扫描顺序 |
| `values` | `Float32Array / array('f')` | 按显示排列输出，长度为 rows × cols |
| `rows / cols` | `number / int` | 输出矩阵形状 |
| `min / max / avg` | `number / float` | 输出矩阵极值与平均值 |
| `area` | `number / int` | 大于阈值的点数，不是物理面积 |
| `center` | `{ x, y } / Center` | 0～1 重心，无有效点时 (0.5, 0.5) |
| `timestamp` | `number / int` | Unix 毫秒时间戳 |

默认满量程下通常为 0～1 相对 ADC，不是 kPa / N。Python 使用 `center.x / center.y`；后端网络 JSON 不等于此 Frame。

矩阵总点数不超过 1048576。JS 的未知排列名称仍按 raw 回退，Python 会拒绝未知名称；两种语言都不会自动判断真实产品和线序。

### 设备信息与诊断 {#diagnostics}

| Node.js / Python 字段 | 说明 |
| --- | --- |
| `info` | 来源、端口、波特率或 Mock 配置；未推断行列可能为空 |
| `state` | `open / closed / error` 生命周期状态 |
| `bytesReceived / bytes_received` | 真实串口收到的字节数，为零时优先检查设备发送 |
| `frameCount / frame_count` | 成功切出的 payload 数；字节增长而它不增长时检查协议 |
| `droppedCount / dropped_count` | 无效或不匹配锁定长度的丢帧数 |
| `frameLength / frame_length` | 已锁定帧长，未锁定为零 |
| `lastError / last_error` | 最近错误的可序列化快照，无错误时为 null / None；不含 cause |
| `status / hint` | 当前观测分类和检查建议，来自诊断快照 |

`getDiagnostics() / get_diagnostics()` 对串口与 Mock 均可用；Mock 的字节数和帧数反映模拟生成量，两种语言的帧长都在首帧前为 0、首帧后为模拟 payload 点数，丢帧为 0，不能视为串口吞吐。`status` 为 `waiting-data`（还没有字节）、`waiting-frame`（有字节尚未成帧）、`streaming`（曾产出帧）、`closed` 或 `error`。计数和 hint 用于缩小排查范围，不能自动判定根因；`streaming` 不证明设备仍在持续发送，也不代表协议、尺寸与线序都正确。Python 串口 frame_count 统计切帧器接受的 payload 数，批量读取时可能大于已返回给应用的 Frame 数。info 的行列为调用配置，应以实际 Frame 的尺寸为准。真机排错见 [串口参考](SERIAL.md)。

## 通讯 {#communication}

`serveDevice()` 将当前 SDK 设备发布为独立 WS/HTTP 服务；已有主项目后端则使用 `BackendSdkClient` 查询、控制和订阅。两者协议不同，按实际数据源选择。

<div data-sdk-language="node">

### serveDevice(device, options) {#node-serve-device}

**用途**：订阅已连接设备，在同一端口提供 WS 帧、录制控制和 HTTP 文件下载。快速 `createWS()` 调用本接口；具名 `serveDevice` 与 `Shroom.serveDevice` 相同。

| 参数 | 默认值 / 说明 |
| --- | --- |
| `device` | 必填；提供 `onData(handler)` 或 `onFrame(handler)`，订阅返回取消函数；可提供 `info / onError` |
| `options.port` | `19999`；整数 `0–65535`，`0` 由系统分配端口 |
| `options.host` | `'127.0.0.1'`，默认只监听本机 |
| `options.recordingsDir` | 当前工作目录下 `.shroom-recordings`；新记录保存到该目录的 `recordings.sqlite` |
| `options.allowedOrigins` | 可选明确来源数组，含协议与端口，不支持通配符；跨机监听必填 |
| `options.maxBufferedBytes` | `1048576`，单个 WS 客户端发送缓冲上限，最小 `1024`；超限断开慢客户端 |
| `options.maxQueueFrames` | `1000`，待写入录制帧数上限，整数 `1–100000`；超限以错误结束记录 |

**返回值**：`Promise<DeviceServer>`；`server.url` 为 WS 地址，`server.httpUrl` 为同服务 HTTP 地址，`host / port` 为实际监听值。

```js
const server = await serveDevice(device, { port: 19999 });
console.log(server.url); // 给浏览器 connectStream 使用
```

**授权与生命周期**：真实源先激活 SDK，服务检查读取与 `stream` 权限，开始录制另需 `recording`；内置模拟源可直接验证。设备必须输出有效 Frame/产品帧。创建失败拒绝 Promise；成功后关闭服务会等待文件写完、断开客户端并解除订阅，**不会关闭 device**，调用方仍需 `await device.close()`。`createWS()` 在此基础上增加失败清理和统一关闭设备。

默认只允许本机 HTTP/HTTPS 网页来源，拒绝 `file://` 的空来源；跨机需配置 `host / allowedOrigins`，HTTPS 页面需外部 WSS 代理。服务不内置 TLS，来源校验不替代公网身份认证。

### server 的采集、下载与关闭 {#node-server}

| 方法 | 返回值 / 行为 |
| --- | --- |
| `startRecording({ label })` | `Promise<RecordingSession>`；开始单个标签会话 |
| `stopRecording()` | Promise 等待写入结束，返回本次记录；不停止设备取数 |
| `getRecordingStatus()` | 同步返回最近会话快照；从未开始时为 `null` |
| `listRecordings()` | `Promise<RecordingSession[]>`，按开始时间倒序 |
| `getRecordingUrl(id, { format })` | 同步返回本服务 HTTP URL；校验 UUID 和 `csv / jsonl`，不检查文件存在，也不下载 |
| `close()` | `Promise<void>`；幂等关闭服务并等待录制收尾，不关闭 device |

录制参数、结果字段及错误见[采集基础 API](STORAGE.md#recording-api)；基础下载必须明确 ID，见[下载与 URL](STORAGE.md#recording-url)。快速入口的起停函数调用以上同名方法，不另建一套录制实现。

### new BackendSdkClient(options) {#backend-client}

**用途**：创建已有后端网络客户端；浏览器也有同名类。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| `httpBaseUrl` | `string` | `'http://127.0.0.1:19245'` |
| `wsUrl` | `string` | `'ws://127.0.0.1:19999'`，独立配置 |
| `timeoutMs` | `number` | `10000` 毫秒，有限正数 |
| `headers` | `HeadersInit` | `{}`，HTTP 请求头 |
| `contract / routes` | 对象 | 可选已知契约 / 路由覆盖 |
| `fetchImpl / WebSocketImpl` | 函数 / 构造器 | 环境实现；Node 按需使用 ws |

**返回值**：`BackendSdkClient`，构造不发请求。

**示例**：

```js
import { BackendSdkClient } from './node/index.js';
const client = new BackendSdkClient({ httpBaseUrl: 'http://127.0.0.1:19245', wsUrl: 'ws://127.0.0.1:19999' });
```

**注意事项**：URL 不接受内嵌凭据、query 或 hash。HTTP headers 不等于浏览器 WS 鉴权；鉴权由后端负责。

### client.getContract(options) {#backend-contract}

**用途**：查询并缓存契约，更新 HTTP 路由与订阅消息类型。

**参数**：可选 `{ refresh: boolean }`，默认 `false`。**返回值**：`Promise<BackendContract>`。

**示例**：`await client.getContract()`；强制刷新用 `await client.getContract({ refresh: true })`。

**注意事项**：已有契约且不刷新时不发请求；显式 routes 覆盖优先于契约。

### HTTP 查询接口 {#backend-queries}

**用途**：只读查询状态和元数据。下表均返回 Promise，字段由后端定义。

| 接口 | 参数 | 返回结果 |
| --- | --- | --- |
| `getChannels()` | 无 | 原始 JSON 包 |
| `getWsStatus()` | 无 | 原始 JSON 包 |
| `listDisplaySystems()` | 无 | 原始 JSON 包 |
| `getDisplaySystem(id)` | 必填 string ID | 原始 JSON 包 |
| `listSerialPorts()` | 无 | 已解包数据 |
| `getSerialStatus(role?)` | 可选 string；省略不带 role 查询条件 | 已解包数据 |
| `getCurrentSensor()` | 无 | 已解包数据 |

**示例**：`console.log(await client.listSerialPorts(), await client.getSerialStatus('sit'))`。

**注意事项**：已解包方法将 `{ code: 0, data }` 返回为 data，原始包方法保留外层；非零业务码仍抛错。逐接口说明见 [BackendSdkClient API](../BACKEND.md#queries)。

### 设备与采集控制 {#backend-controls}

**用途**：显式请求后端改变状态，不会自动执行。

| 接口 | 参数 / 默认值 | 返回值 |
| --- | --- | --- |
| `setSensorType(type)` | 必填后端认可的 string 类型 | `Promise<unknown>` 已解包数据 |
| `openSerial(options)` | role='sit'；port/path/portPath 至少一个，按此顺序选择 | 同上 |
| `closeSerial(options?)` | role='sit' | 同上 |
| `startCollection(options?)` | 后端定义对象，默认 {} | 同上 |
| `stopCollection()` | 无 | 同上 |

**示例**：确认设备后，`await client.openSerial({ role: 'sit', port: 'COM3' })`；结束用 `await client.closeSerial({ role: 'sit' })`。

**注意事项**：操作后端机器的端口，写操作不自动重试。采集文件、路径和数据库结构由后端决定。

### client.connectRealtime(options) {#backend-realtime}

**用途**：建立 WS；打开后订阅所选通道。

| 参数 | 类型 | 默认值 |
| --- | --- | --- |
| `channels` | `string / string[]` | `[]`，不自动订阅通道 |
| `timeoutMs` | `number` | 客户端 timeoutMs，毫秒 |
| `protocols` | `string / string[]` | 未指定，WS 子协议 |

**返回值**：立即返回 `WebSocket`，不是 Promise；用 open 事件确认就绪。

**示例**：

```js
import { BackendSdkClient } from './node/index.js';
const client = new BackendSdkClient();
await client.getContract();
client.on('error', (error) => console.error(error.message));
client.on('frame', (frame) => console.log(frame.channelId, frame.value));
client.connectRealtime({ channels: ['sit'] });
process.once('SIGINT', () => client.disconnectRealtime());
```

**注意事项**：没有自动重连。`disconnectRealtime()` 返回 void，清理连接和定时器并发出 close；后端没有发送设备数据时可收到零帧。

### subscribe / unsubscribe / sendRealtime {#backend-subscriptions}

**用途**：在已打开连接上管理订阅或发送 JSON。

| 接口 | 参数 | 返回值 |
| --- | --- | --- |
| `subscribe(channels)` | 必填 string/string[]，非空字符串去重 | void |
| `unsubscribe(channels)` | 同上 | void |
| `sendRealtime(message)` | 必填可 JSON 序列化的值 | void |

**示例**：`client.on('open', () => client.subscribe(['sit', 'back']))`。

**注意事项**：连接未打开时抛错，不排队重放。消息必须符合后端协议。

### on / once / off / removeAllListeners {#backend-events}

**用途**：管理事件监听；均返回客户端自身。

| 接口 | 参数 |
| --- | --- |
| `on(event, handler)` | 必填事件名和函数，持续监听 |
| `once(event, handler)` | 必填事件名和函数，仅一次 |
| `off(event, handler)` | 同一函数，移除对应监听 |
| `removeAllListeners(event?)` | 省略事件名时移除全部 |

| 事件 | 回调参数 |
| --- | --- |
| open | 无 |
| close | 关闭事件 |
| error | Error |
| message | 已解析消息 |
| frame | 后端原始 JSON 帧，批量消息逐帧分发 |
| raw | 无法解析为 JSON 的字符串 |

**示例**：`const handler = (frame) => console.log(frame); client.on('frame', handler); client.off('frame', handler)`。

**注意事项**：HTTP 失败由 Promise 拒绝，不自动触发 error。网络帧不自动归一化、点位重排或转为统一 Frame。

### client.request() / route() {#backend-request}

**用途**：通用 HTTP 请求和命名路由解析。

**调用方式**：`await client.request(routeOrName, options)` / `client.route(name, params)`。

**参数**：request 默认 GET、客户端超时，支持 JSON body、query、routeParams、headers、signal、raw；完整表见 [通用 HTTP 请求](../BACKEND.md#request)。route 必填路由名，路径参数需要齐全。

**返回值**：request 为 `Promise<T>`，route 为编码后的根相对路径 string。

**示例**：`await client.request('serialStatus', { query: { role: 'sit' }, timeoutMs: 5000 })`。

**注意事项**：只允许配置后端下的根相对路径，不接受任意远程 URL。

</div>

<div data-sdk-language="python">

### Python 网络通讯支持范围 {#python-network}

**当前 Python SDK 未包含 `BackendSdkClient`，没有已有后端的 HTTP / WebSocket 客户端、通道订阅或采集控制接口。**

Python 可直连串口，在应用中分析和保存。后端已占用设备时，使用现有 Node.js 客户端订阅，或自行开发符合 [后端 API 契约](../BACKEND.md) 的 Python 网络适配；不能调用不存在的 Python SDK 方法。

</div>

## 存储 {#storage}

Node.js 快速服务已提供带标签会话录制、SQLite 持久化及 CSV / JSONL 导出，见[数据存储与下载](STORAGE.md)。新记录写入 `recordingsDir/recordings.sqlite` 的 `sessions / frames` 表，事务批写后才计入 `frameCount`，停止调用等待入库队列排空；下载从 SQLite 分页读取并流式导出。同目录旧版 JSONL 记录仍可读，不自动迁移。以下保留基础帧转换和应用侧保存示例；Python 没有快速服务或录制控制 API。

<div data-sdk-language="node">

### 帧快照与 JSONL（应用示例） {#node-save}

**用途**：复制帧中的字节视图，再写文件。这不是新增 SDK save() API。

**输入**：Frame。**输出**：应用快照对象和 UTF-8 frames.jsonl。

**示例**：最多缓存 100 帧，短时采集后写入：

```js
import { writeFile } from 'node:fs/promises';
import { Shroom } from './node/index.js';
const snapshots = [];
const device = Shroom.mock({ rows: 32, cols: 32, fps: 20 });
const unsubscribe = device.onFrame((frame) => {
  if (snapshots.length >= 100) return;
  snapshots.push({ timestamp: frame.timestamp, rows: frame.rows, cols: frame.cols,
    raw: Array.from(frame.raw), values: Array.from(frame.values),
    min: frame.min, max: frame.max, avg: frame.avg, area: frame.area, center: { ...frame.center } });
});
try { await new Promise((resolve) => setTimeout(resolve, 2500)); }
finally { unsubscribe(); await device.close(); }
await writeFile('frames.jsonl', snapshots.map((frame) => JSON.stringify(frame)).join('\n') + '\n', 'utf8');
```

**注意事项**：持续采集需要有界队列、批量落盘、文件轮转与磁盘异常处理，不应无限积累帧。

</div>

<div data-sdk-language="python">

### frame.to_dict() {#python-to-dict}

**用途**：生成 JSON 可序列化快照，保留与 JS 一致的字段名。

**参数**：无。**返回值**：dict；raw/values 变为列表，center 变为 `{ "x": ..., "y": ... }`。

**示例**：

```python
import json
from shroom_sdk import decode_frame
frame = decode_frame(bytes((0, 64, 128, 255)), rows=2, cols=2)
print(json.dumps(frame.to_dict(), ensure_ascii=False))
```

**注意事项**：只转换，不写文件或入库；不能直接把含 array/Center 的对象假设成可序列化字典。

### frame.matrix() {#python-matrix}

**用途**：按行列返回二维 values，无需 NumPy。

**参数**：无。**返回值**：`list[list[float]]`，rows 行、cols 列，行优先。

**示例**：`matrix = frame.matrix()`。

**注意事项**：数值是解码后的相对值，不是原始字节或物理单位。

### 写入 JSONL（应用示例） {#python-save}

**用途**：用 Python 标准库保存有限帧，不是 SDK 数据库接口。

**输入**：Frame。**输出**：UTF-8 JSONL 文件。

**示例**：

```python
import json
from shroom_sdk import Shroom
with Shroom.mock(fps=20) as device, open("frames.jsonl", "w", encoding="utf-8") as output:
    for index, frame in enumerate(device):
        output.write(json.dumps(frame.to_dict(), ensure_ascii=False) + "\n")
        if index >= 99:
            break
```

也可运行 CLI：`python -m shroom_sdk --frames 100 --json > frames.jsonl`。省略端口为 Mock；真实设备加 `COM3 --rows 32 --cols 32`。重定向编码由 shell 决定。

**注意事项**：示例会覆盖同名输出文件；真实应用需设计文件名、异常处理与轮转。

</div>

### 数据库与能力边界 {#storage-boundary}

Node.js 快速服务提供本地 SQLite 采集库、会话列表、带标签录制及 CSV / JSONL 导出，并校验对应 SDK 功能授权；不提供业务数据库、通用 SQL 查询、录制回放、力学标定或手势算法。SDK 不依赖 Electron，上位机数据库的表结构与本服务不同，不能直接混用。`BackendSdkClient.startCollection()` 仍只请求已有后端，不是 `stream.startRecording()`；Python 没有这两类网络控制接口。

长期保存仍需应用制定容量、备份和访问控制策略，并记录协议、产品、点位配置和采样信息。更多见 [数据存储参考](STORAGE.md)。
