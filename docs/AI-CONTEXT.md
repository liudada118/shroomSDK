# Shroom SDK · 给 AI 的一步取数与五步调用说明

**先用 `readProduct()` 一个函数拿到产品数据。** 用户只要实时取数时，完成第 1 步即可，不要求先建 WS 或开始采集。需要网页接收、保存与下载时，再按需使用 `shroom-sdk/quick-flow` 的其余函数，组成 **取数 → 创建 WS → 开始采集 → 停止采集 → 下载**。

按下面的运行位置给用户短调用片段，接入已有程序与按钮；只有用户要求时才生成完整页面或工程。Node.js 连接 USB 设备，浏览器可通过 WS 接收数据并控制采集。本文的五步接口适用于 JavaScript；Python 的能力见文末。

## 接入前确认 {#prepare}

- **驱动**：CH34x 设备需有可用串口驱动，安装在连接 USB 的电脑上。[Windows CH341SER.EXE](https://shroom.jq-industries.com/drive/CH341SER.EXE) · [macOS CH34xVCPDriver.zip](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)。安装后重新插拔，确认系统能列出串口；Linux 检查驱动与权限，见[驱动排查](DRIVERS.md)。
- **安装**：Node.js 18+，在业务项目终端执行 `npm install shroom-sdk`，通过 npm 安装 SDK 及其声明的依赖。真实串口、WS 与 SQLite 分别需要 `serialport / ws / better-sqlite3` 可用。SDK 免登记下载，密钥另行申请；固定版本、下载 `.tgz` 与历史 URL 安装见[npm 安装](NPM.md)。
- **授权**：在 Node.js 连接实机前，按 [SDK 授权](LICENSE.md)调用 `await Shroom.activateLicense(key, { deviceId })`；`Shroom` 从 `shroom-sdk/node` 导入。应用保存稳定的安装标识，不能每次启动重新生成。仅取数需要 `serial`，完整五步还需 `stream / recording`；浏览器连接此 Node 服务时无需重复激活。不要导入精简安装包未交付的 `node/license-env.js`。
- **产品**：手套 `glove`、鞋垫 `insole` 必须指定实物 `side: 'left' | 'right'`；检测垫 `pad`、人体全身 `body` 不传side。规范ID依次为 `handGloveSegmented / jqInsole / hand / humanBody`。从 0.4.0 起，`glove` 与 `connectGlove()` 默认分包；0.3.0 只有整包手套。整包设备必须显式用 `handGloveFullPacket`，不能沿用默认入口。当前安装命令为 `npm install --save-exact shroom-sdk@0.4.0`；鞋垫/人体最低要求 0.3.0。升级时让 Node 和网页安装同版本并重新构建前端。端口枚举不能识别产品或侧别。
- **手套连接单位**：一只手一个串口。side 按该串口所接实物决定线序，packetType 仅是首尾包一致性校验字段（0–255），不表示左右手。双手使用两个不同 path 和两个设备对象；不要生成单串口自动路由代码。
- **鞋垫数据**：明确 `protocol: '12bit' | '8bit'`，默认12bit；默认921600波特率。`pressure`保留256通道原始ADC，12bit使用Uint16Array、范围0..4095，`raw`是512个原始ADC字节，不能先压到Uint8；8bit为256字节ADC。`sensors`是A版112个真实点，不是插值后的224点。IMU含原始四元数，12bit另含gyro/accel，未确定单位，不生成欧拉角或标定压力。详见[鞋垫协议](INSOLE.md)。
- **人体数据**：`raw / pressure`保留1024原扫描ADC，`regions`按十块物理矩阵映射400唯一通道，`sourceIndices`为0基索引；模型显示的14槽/翻转/插值不是采集数据。详见[人体线序](HUMAN-BODY.md)。新增产品没有内置 `createProductView`，由客户处理 `onData` 展示。
- **运行位置**：以下示例放在客户项目，统一从 `shroom-sdk/quick-flow` 导入；Node 使用 ESM，网页使用 Vite 等构建工具解析包名，并通过本机 `http://localhost` 访问。普通 HTML 无法直接解析包名：使用源码 ZIP，将导入改为 SDK 根目录的 `./quick-flow.js`，保留其依赖目录并以模块方式加载；不要双击 HTML。

SDK 密钥与上位机密钥互不通用。SDK 授权不限制传感器型号，但仍校验有效期、电脑名额与功能权限；授权不限制型号不等于所有协议已适配。在线及限定电脑数量的 RSA 授权需要持续联网复核。授权失效会中断实机与录制，已保存记录仍可查询下载。

## 接入前：搜索并选择串口 {#flow-ports}

在 Node.js 调用基础 API，不增加第六个快速函数。只列出串口，不识别型号或左右手，也不需要先打开串口或激活授权。

```js
import { listPorts } from 'shroom-sdk/node';

try {
  const ports = await listPorts();
  console.table(ports); // 在应用中展示给用户选择，不能直接连接 ports[0]。
  if (ports.length === 0) console.log('未发现串口，请检查驱动、USB 线和权限。');
} catch (error) {
  console.error(error.code, error.message);
}
```

将用户选择的 `path` 传给下方 `readProduct()`；这里的 `COM3` 只是示例值。插拔后可重新查询并更新选择框。

## 1. 取数：readProduct {#flow-read}

**运行在 Node.js。** 以下片段共享 `device`；`reportSdkError` 使用文末的[错误处理函数](#errors)。

```js
import { readProduct } from 'shroom-sdk/quick-flow';

let device;
try {
  device = await readProduct({
    product: 'glove', // 检测垫改为 'pad'，同时删除 side
    side: 'left',    // 按实际左手或右手设置
    path: 'COM3',    // 替换为系统中的实际串口
    onData(data) {
      // 持续返回已解析的产品帧；这里接入业务，不需要再次解析原始包。
      console.log(data.fingers, data.palm, data.imu.raw);
    },
    onError: reportSdkError, // 连接后的断线、读取或回调错误
  });
} catch (error) {
  reportSdkError(error); // 参数、授权或打开串口失败；不要继续创建 WS
}
```

这里已开始实时取数，尚未保存采集文件。检测垫回调改读 `data.pressureMatrix / data.values`；手套使用 `fingers / palm` 命名分区。`onData` 首帧可能早于连接 Promise 完成，回调内不要引用尚未赋值的 `device`。

Node 产品连接从 0.2.0 起默认自动重连，不要在业务 `onError` 里再创建一套重连循环。默认重试原 `path`，间隔 3000ms、最多 3 次；重连保留同一 `device`、原数据订阅和 WS 服务。可传 `reconnect: false` 关闭，或 `reconnect: { intervalMs: 3000, maxAttempts: 3 }` 配置；`onStateChange({ state, path, attempt, maxAttempts })` 或 `device.onStateChange(handler)` 用于更新界面，状态为 `open / reconnecting / error / closed`。状态回调可能早于 Promise 完成，同样不要引用尚未赋值的 `device`。

首次打开失败不会后台重试；主动 `close()`、授权失效、配置或解析错误不重连。SDK 不自动识别换号后的原设备，COM 号变化要重新查询、选择并连接。通用 Node `connectSerial()` 默认关闭重连，Web Serial、浏览器 WS 和 Python 没有本次自动重连能力。

## 2. 创建 WS：createWS {#flow-ws}

**Node.js 发布第 1 步的设备。** 创建失败会尝试释放设备；成功后交由 `server.close()` 统一关闭。

```js
import { createWS } from 'shroom-sdk/quick-flow';

let server;
if (device) { // 只有取数连接成功才继续
  try {
    server = await createWS(device, { port: 19999 });
    console.log(server.url); // ws://127.0.0.1:19999
  } catch (error) {
    reportSdkError(error); // 端口占用、依赖、权限或启动失败
  }
}
```

**浏览器连接一次**，后三步共享同一个 `stream`。连接成功前禁用采集按钮。浏览器也需要定义下面的 `reportSdkError`，它与 Node.js 是两个独立运行环境。

```js
import {
  readProduct, startRecording, stopRecording, downloadRecording,
} from 'shroom-sdk/quick-flow';

let stream;
try {
  stream = await readProduct({
    url: 'ws://127.0.0.1:19999', // 浏览器不再传 product、path 或 side
    onData: data => console.log(data.fingers, data.palm, data.imu.raw),
    onError: reportSdkError,
  });
  // 磁盘写入失败、缓冲溢出等也可能通过录制状态通知。
  stream.onRecording(recording => {
    if (recording?.status === 'error') reportSdkError(recording.error);
  });
} catch (error) {
  reportSdkError(error);
}
```

默认服务只监听本机，网页 HTTP 端口与 WS 数据端口不同。HTTPS 网页需要 WSS；跨电脑连接需配置 `host / allowedOrigins`，见[前端通讯](FRONTEND-COMMUNICATION.md#sdk-stream)。本流程使用 WebSocket，不需要浏览器直接申请串口，也不使用 Web Serial 支持检测来拦截此连接。

## 3. 开始采集：startRecording {#flow-start}

**放进浏览器的“开始采集”按钮。** 请求进行时禁用重复操作。

```js
try {
  const session = await startRecording(stream, { label: '本次采集' });
  console.log('已开始采集', session.id); // 帧保存在 Node 端
} catch (error) {
  reportSdkError(error); // 失败时不要把界面切换成“正在采集”
}
```

一个服务同时只保存一条活动记录。标签是本次记录的名称，不是文件 ID；再次成功开始会清除这个连接上一轮的快捷下载 ID。新记录保存在 Node 端 `recordingsDir/recordings.sqlite`，默认 `.shroom-recordings/recordings.sqlite`：`sessions` 保存会话，`frames` 保存帧。内部每批最多 200 帧、约每 250ms 事务批写，`frameCount` 只统计已提交帧；应用无需直接写 SQL。

## 4. 停止采集：stopRecording {#flow-stop}

**放进浏览器的“停止采集”按钮。** 等待收尾后检查结果，不能只看 Promise 是否成功。

```js
try {
  const recording = await stopRecording(stream);
  console.log('已保存帧数', recording.frameCount);
  if (recording.status === 'error') {
    reportSdkError(recording.error); // 可能只保留了部分数据，不能提示“采集成功”
  } else {
    console.log('采集已停止', recording.id);
  }
} catch (error) {
  reportSdkError(error); // 操作失败或未收到结果，需确认真实状态
}
```

停止保存这次记录，等待入库队列排空和会话状态保存，实时取数与 WS 仍继续。SDK 记住这次返回的记录 ID；无需在按钮之间另存 ID。`status: 'error'` 的记录可能仍有已保存数据，可尝试下载用于检查；应向用户明确标注异常与 `frameCount`，不要因零帧直接隐藏排查入口。

## 5. 下载：downloadRecording {#flow-download}

**放进浏览器的“下载”按钮。** 必须先完成同一 `stream` 的停止调用。

```js
try {
  downloadRecording(stream, { format: 'csv' });
  // 需要保留完整产品帧时改成 format: 'jsonl'。
} catch (error) {
  reportSdkError(error); // 尚未停止、格式错误或无浏览器下载环境
}
```

这是同步函数：在浏览器触发下载并返回 URL，**不代表文件已经保存成功**，后续 HTTP 失败不由此处的 `catch` 捕获。Node 服务需保持运行。CSV / JSONL 是从 SQLite 分页读取、流式生成的导出格式，不是新采集的存储格式；不直接下载数据库。CSV 数组与分区采用 JSON 单元格，JSONL 保留完整帧。同目录旧版 `.meta.json / .jsonl` 记录仍可查询下载，不自动重写，见[存储说明](STORAGE.md)。

后三个函数也能在 Node.js 传入同一个 `server`；`downloadRecording(server, options)` 此时只返回 HTTP URL，由应用负责下载。

## 错误处理与状态恢复 {#errors}

五步接口已有参数、连接、授权与采集状态检查，错误会返回调用方。应用负责把错误显示给用户；不能只注册 `onError` 就省略 `try / catch`。

| 错误出现在哪里 | 应用怎么接 |
| --- | --- |
| `readProduct / createWS / startRecording / stopRecording` 调用失败 | `try { await ... } catch (error) { ... }` |
| `downloadRecording` 调用失败 | 同步 `try / catch`，没有下载完成 Promise |
| 设备或 WS 的断线、解析、同步数据回调错误 | `readProduct({ onError })`；握手失败也可能同时触发此回调与 Promise 拒绝，界面应避免重复弹窗 |
| Node 串口正在重连或重试结束 | `onStateChange` 显示状态和尝试次数；不要因重连仍在进行就再调用 `readProduct()` |
| 录制过程写盘失败、溢出或中断 | `stream.onRecording()` 检查状态，并在停止后检查 `recording.status / error / frameCount`；不能假定只靠 `onError` 会收齐 |

下面是用于以上片段的最小日志函数；实际产品应把相同信息写到页面错误提示区。它兼容 SDK 错误、普通异常和创建/关闭时的多个错误，不从文案猜错误类型。

```js
function reportSdkError(error) {
  if (error instanceof AggregateError) {
    for (const cause of error.errors) reportSdkError(cause);
    return;
  }
  const code = error?.code ?? 'UNKNOWN_ERROR';
  const message = error?.message ?? String(error ?? '未知错误');
  console.error(`[${code}] ${message}`, error?.stage ?? '', error?.suggestion ?? '');
}
```

常见处理方向：

| 错误码 | 下一步 |
| --- | --- |
| `PORT_NOT_FOUND / PORT_AMBIGUOUS / PORT_BUSY` | 查驱动、实际端口及占用；多串口时明确 `path` |
| `LICENSE_REQUIRED / LICENSE_EXPIRED / LICENSE_FEATURE_DENIED` | 检查 SDK 产品密钥、有效期与功能；修复后重新连接 |
| `INVALID_CONFIG / INVALID_REQUEST` | 修正参数，或等待上次起停操作完成 |
| `RECORDING_ACTIVE / RECORDING_NOT_ACTIVE` | 核实当前采集状态，按实际状态启用按钮 |
| `REQUEST_TIMEOUT / DISCONNECTED` | 超时仅表示未收到回应，不能断言服务端没有执行；恢复连接后查询 `await stream.getRecordingStatus()`，再由用户决定下一步，不能自动重发开始/停止 |
| `RECORDING_WRITE_FAILED / RECORDING_OVERFLOW / RECORDING_INTERRUPTED` | 提示采集异常，检查磁盘、设备或授权，保留可用记录用于排查 |

`getRecordingStatus()` 的失败也要捕获。网页刷新或重新连接会得到新的 `stream`，不会恢复旧连接的快捷下载 ID；先用基础 API `stream.listRecordings()` 让用户选定记录，再调用 `stream.downloadRecording(id, { format: 'csv' })`。不可自动下载“最近一条”，也不要把记录标签当 ID。

串口断线时，当次采集以 `error` 收尾，保留已接收数据；重连成功不自动续录或补齐中断部分。等待恢复后由用户重新开始新记录。不要把“串口恢复”“网页 WS 恢复”和“采集已恢复”合成一个状态。

SDK 会隔离同步数据回调的异常并报告 `CALLBACK_FAILED`；异步业务回调应自行捕获拒绝。避免在高频 `onData` 中执行重绘、网络请求或无界堆积数据。

## 结束使用 {#cleanup}

- 要结束本次采集，明确调用并等待 `stopRecording()`。关闭网页或 `stream.close()` 不会替用户停止服务端录制。
- 浏览器退出订阅时 `await stream.close()`；Node.js 退出时 `await server.close()`，后者一并收尾录制并释放设备，关闭失败也要捕获。
- 只执行第 1 步时，自行 `await device.close()`。`createWS()` 创建失败已尝试释放设备，修复问题后重新 `readProduct()`。
- 基础 `serveDevice()` 不接管设备关闭责任；不要把它与快捷 `createWS()` 的生命周期混用。

## 产品数据与扩展 {#product-data}

| 产品 | 业务读取字段 | 注意 |
| --- | --- | --- |
| 分包手套 `glove` / `handGloveSegmented` | `fingers.*.raw`、`fingers.*.pulp.raw`、`palm.matrix`、`imu.raw` | 一只手一个串口，side 按实物决定线序，packetType 仅作首尾配对类型；原始压力 256 通道、手掌 72 点，行长 `[12, 15, 15, 15, 15]`；IMU 原始 16 字节；130+146 两包配对后交付一帧，无 sequence |
| 检测垫 `pad` | `pressureMatrix`、`values`，以及 `rows / cols` | 1024 点、32 × 32；产品入口已完成点位映射 |

ADC 与归一化相对值不是 kPa、牛顿、公斤或弯曲角度。手套以命名分区取数，不能编造整手的 `pressureMatrix / values` 展示映射；产品帧不要再次 `decodeFrame()` 或重复应用 layout。

五个函数调用的基础 API 是 `connectProduct / connectStream / serveDevice` 及其采集方法，见[五步与基础 API 对照](CUSTOM.md#quick-to-base)。新增产品时按[产品适配器指南](../src/core/products/README.md)增加协议、注册项与类型，避免在五步函数里新增产品分支。源码仓库的参数类型在 `src/quick-flow.d.ts`，基础类型在 `src/index.d.ts / src/node/index.d.ts`；兼容源码 ZIP 中这些路径不带 `src/`。

## 按需查阅的其他能力 {#references}

| 需求 | 参考与边界 |
| --- | --- |
| 浏览器直接连接 USB 串口 | [Web Serial](FRONTEND-COMMUNICATION.md#web-serial)：基础 `connectGlove / connectHandPad`，已激活后在用户点击中申请端口，要求受支持浏览器与安全上下文；与本文 WS 路线分开 |
| 二维产品显示或热力图 | [前端通讯与产品数据](FRONTEND-COMMUNICATION.md#product-data)、[渲染 API](RENDERING.md)：显示不控制采集起停 |
| 自定义协议与矩阵 | [基础与自定义](CUSTOM.md)、[串口](SERIAL.md)；不要覆盖产品接口的 `baudRate / delimiter / rows / cols / layout` |
| 无硬件开发 | [Mock](FRONTEND-COMMUNICATION.md#mock)：只验证基础矩阵与显示，不模拟手套分包/整包、IMU 或实际按压，不代表实机验收完成 |
| 已有主项目后端 | [BackendSdkClient](BACKEND.md)：连接已有服务，不启动服务；其 WS 协议与快速 WS 服务不同，不能混接 |
| Python | 独立下载 Python 包，读 [Python AI 上下文](../python/AI-CONTEXT.md)与 [Python SDK](../python/README.md)。目前只有通用串口、矩阵、模拟与显示，没有本文的产品五函数、手套分包/整包或 WS 录制服务；不要生成不存在的 Python 对应函数 |

本地采集 SQLite 已内置，SDK 数据库与上位机数据库不直接兼容，也不依赖 Electron。业务数据库、曲线、回放、算法、标定与云端上传由应用实现。不要因用户需要这些功能就绕过现有录制接口重新实现一套采集。接入验证以实机持续取数、明确起停、记录状态和实际下载内容为准。
