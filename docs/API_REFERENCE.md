# API Reference

本页是参数级参考：每个入口的**全部** options、默认值和返回结构。只想看跑通流程的示例，看 [使用文档](./SDK_GUIDE.md)、[后端连接链路](./BACKEND_CLIENT.md)、[本地串口链路](./SERIAL_CHAIN.md)。

## 根入口导出

```js
const sdk = require('shroom-backend-sdk');
```

| 导出 | 类型 | 用途 |
| :--- | :--- | :--- |
| `ShroomSensorSDK` | class | 本地串口读取、解析、采集、回放、导出的门面 |
| `BackendSdkClient` | class | 连接已运行的主项目后端 HTTP / WebSocket |
| `ProtocolRegistry` | class | 传感器 profile 与解析器注册表 |
| `CaptureStore` | class | SQLite 采集存储 |
| `MemoryCaptureStore` | class | 内存采集存储，接口与 `CaptureStore` 对齐 |
| `CsvExporter` | class | 按采集记录导出 CSV |
| `ReplayService` | class | 由采集记录构建回放时间轴 |
| `ZeroCalibrator` | class | 清零基线记录与减除 |
| `BackendCommandRouter` | class | 把后端下发的扁平命令翻译成事件 |
| `LicenseService` | class | 授权密钥解析（解密函数由外部注入） |
| `PathService` | class | 运行目录创建与可写校验 |
| `ReportService` | class | 足压报告与热力图（算法由外部 `pythonClient` 注入） |
| `LineOrderRegistry` | class | 线序处理函数注册表 |
| `createProjectLineOrderRegistry` | function | 建一个线序注册表，见下方[线序](#线序) |
| `PROJECT_LINE_ORDER_NAMES` | `string[]` | 内置线序名列表，**当前为空数组** |
| `BACKEND_OPERATIONS` / `listBackendOperations` | data / function | 后端命令域与 SDK 能力的对应关系 |
| `DEFAULT_SENSOR_PROFILES` | object | 11 个内置 profile |
| `STANDARD_FRAME_DELIMITER` | Buffer | `AA 55 03 99` |
| `SMALL_BED_12B_FRAME_TAIL` | Buffer | `smallBed12B` 的帧尾 |
| `getDefaultBaudRate(sensorType)` | function | 按传感器类型推默认波特率 |

### 不在根入口的模块

以下符号存在但未从根入口转出，需要时走深路径导入：

| 符号 | 路径 |
| :--- | :--- |
| `SensorSession` | `shroom-backend-sdk/src/serial/SensorSession` |
| `resolveProfile` | `shroom-backend-sdk/src/profiles` |
| `summarizePort` / `hasWchSignature` | `shroom-backend-sdk/src/ShroomSensorSDK` |
| `parseFrame` / `parseDefaultFrame` / `readValues` / `applyLineOrder` | `shroom-backend-sdk/src/protocol/parsers` |
| `calculatePressureStats` / `normalizeNumericArray` / `toFiniteNumber` | `shroom-backend-sdk/src/utils/stats` |
| `sanitizeFilename` | `shroom-backend-sdk/src/config/PathService` |
| `parseMessage` | `shroom-backend-sdk/src/backend/BackendCommandRouter` |

## ShroomSensorSDK

### 构造参数

```js
const { ShroomSensorSDK } = require('shroom-backend-sdk');
const sdk = new ShroomSensorSDK({ dbDir: './db', exportDir: './data' });
```

全部 17 个 options，任意一项都可省略：

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `dbDir` | `string` | `<cwd>/db` | SQLite 目录，首次用到时自动创建 |
| `dbPath` | `string` | `<dbDir>/sdk_capture.db` | 直接指定库文件，优先于 `dbDir` |
| `exportDir` | `string` | `<cwd>/data` | CSV 输出目录 |
| `imageDir` | `string` | `<cwd>/img` | 传给 `PathService` 的图片目录 |
| `reportDir` | `string` | `<cwd>/pdf` | 传给 `PathService` 的报告目录 |
| `profiles` | `object` | `{}` | 追加或覆盖 profile，与 `DEFAULT_SENSOR_PROFILES` 浅合并 |
| `lineOrders` | `LineOrderRegistry` | 空注册表 | 整体替换线序注册表 |
| `extraLineOrders` | `object` | `{}` | 往默认注册表里追加 `{ 名字: 处理函数 }` |
| `store` | object | 惰性建 `CaptureStore` | 采集存储，传 `MemoryCaptureStore` 可完全不落盘 |
| `exporter` | object | 惰性建 `CsvExporter` | 导出实现 |
| `zeroCalibrator` | object | `new ZeroCalibrator()` | 清零实现 |
| `pathService` | object | `new PathService(...)` | 目录服务 |
| `licenseService` | object | `new LicenseService(license)` | 授权服务 |
| `license` | `object` | `{}` | 传给默认 `LicenseService` 的配置，见 [LicenseService](#licenseservice) |
| `commandRouter` | object | `new BackendCommandRouter()` | 命令路由 |
| `reportService` | object | `new ReportService(...)` | 报告服务 |
| `pythonClient` | object | `null` | 传给默认 `ReportService`，需要 `call(name, payload, opts)` |

`store` / `exporter` 是惰性的：不调用采集或导出就不会创建 SQLite 文件。

### 方法

| 方法 | 参数 | 返回 |
| :--- | :--- | :--- |
| `listPorts(options?)` | `{ onlyLikelySensorPorts?: boolean }` | `Promise<PortInfo[]>` |
| `open(options?)` | `{ sensorType?, profile?, channels }` | `Promise<SensorSession>` |
| `startCapture(session, options?)` | `{ name?, hz?, metadata? }` | `{ id, name, sensorType, hz, metadata }` |
| `stopCapture(session)` | — | 采集记录，未在采集中时为 `null` |
| `listCaptures(filter?)` | `{ sensorType? }` | 采集记录数组，按创建时间倒序 |
| `replay(options?)` | `{ captureId?, captureName?, sensorType? }` | `Timeline`，见 [ReplayService](#replayservice) |
| `exportCsv(options?)` | 见 [CsvExporter](#csvexporter) | `Promise<{ files, rows, dir }>` |
| `registerProfile(sensorType, profile)` | 见 [profile 字段](#profile-字段) | 归一化后的 profile |
| `registerLineOrder(name, handler)` | `handler(data, context)` | `handler` |
| `listLineOrders()` | — | `string[]`，已排序 |
| `applyLineOrder(name, data, context?)` | — | 处理后的数组；未注册时抛错 |
| `close()` | — | `undefined` |

`close()` **只关存储**，不关串口。串口要单独 `await session.close()`，顺序不限。

#### listPorts

`onlyLikelySensorPorts: true` 时只返回 `isLikelySensorPort` 为真的端口。该标记按厂商特征串匹配 `WCH` / `CH34` / `USB-SERIAL` / `USB-ENHANCED-SERIAL` / `1A86`，是宽匹配，会带进同芯片的非传感器设备。

每个端口的字段：`path`、`manufacturer`、`serialNumber`、`pnpId`、`vendorId`、`productId`、`friendlyName`、`locationId`、`isLikelySensorPort`。

#### open

```js
const session = await sdk.open({
  sensorType: 'hand0205',
  channels: { sit: 'COM3', back: 'COM4' },
  profile: { baudRate: 921600 },
});
```

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `sensorType` | `string` | `'default'` | profile 键名 |
| `channels` | `object` | `{}` | `{ 通道名: 串口路径 }`，值为空的项会跳过；全空时抛错 |
| `profile` | `object` | `{}` | 覆盖该次会话的 profile 字段 |

通道名可以是任意字符串，`sit` / `back` / `head` 只是约定；它会原样出现在 frame 的 `channel` 字段和采集记录里。

多通道是**串行**打开的；中途失败会先关掉已打开的端口再抛错，不会留下占着设备又无法通过 session 关闭的孤儿端口。

::: warning 当前限制
serialport 的 `dataBits` / `stopBits` / `parity` / `rtscts` / `highWaterMark` 目前无法透传，只有 `baudRate` 生效。
:::

## SensorSession

由 `sdk.open()` 返回，继承 `EventEmitter`。类本身未从根入口导出。

### 事件

| 事件 | 载荷 | 时机 |
| :--- | :--- | :--- |
| `channelOpen` | `{ channel, portPath }` | 单个通道打开成功 |
| `open` | `{ sensorType, channels }` | 全部通道打开成功 |
| `rawFrame` | `{ sensorType, channel, rawFrame }` | 分帧完成、解析之前；`rawFrame` 是 Buffer 副本 |
| `frame` | `Frame` | 解析并清零之后 |
| `captureStart` / `captureStop` | 采集记录 | 采集开关 |
| `channelClose` | `{ channel, portPath }` | 单个通道关闭 |
| `close` | — | `close()` 执行完毕 |
| `error` | `{ channel, error, phase? }` | 串口报错，或帧处理各阶段出错 |

### 错误处理

**一帧脏数据不会终止进程。** `handleRawFrame` 的四个阶段各自独立捕获，`error` 事件的 `phase` 指明出错位置：

| `phase` | 含义 | 后果 |
| :--- | :--- | :--- |
| 无 | 串口自身报错 | 由 serialport 决定 |
| `rawFrame` | `rawFrame` 监听器抛错 | 继续解析 |
| `parse` | 协议解析或 `frameProcessor` 抛错 | **丢这一帧**，下一帧照常处理 |
| `frame` | `frame` 监听器抛错 | 不影响入库 |
| `capture` | 入库失败 | 继续接收后续帧 |

解析失败时 `rawFrame` 事件**仍然会发**——它是这种情况下唯一的排障线索。

::: tip error 没有监听者时不会崩
`error` 是 `EventEmitter` 的保留事件名，通常没有监听者就直接抛出。本 SDK 在发之前先查监听者数量，没有时降级为一条 `console.error` 提示，不会终止进程，也不会静默吞掉。

即便如此仍**建议挂上** `session.on('error', ...)`：控制台提示只够定位，不够处理。
:::

### 方法

| 方法 | 参数 | 说明 |
| :--- | :--- | :--- |
| `open()` | — | 已由 `sdk.open()` 调用，不必重复调 |
| `startCapture({ store, name?, hz?, metadata? })` | `store` 必填 | 直接调用时要自己传 store；走 `sdk.startCapture` 会自动注入 |
| `stopCapture()` | — | 未在采集中时返回 `null` |
| `close()` | — | `Promise`，逐个关闭通道并触发 `close` |

### Frame 结构

`frame` 事件的载荷：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `sensorType` | `string` | profile 的 `sensorType` |
| `channel` | `string` | 来源通道 |
| `timestamp` | `number` | 解析时刻的 `Date.now()`，不是设备时间 |
| `rawLength` | `number` | 原始帧字节数 |
| `data` | `number[]` | 压力矩阵，已过线序 |
| `pressureData` | `number[]` | 与 `data` 同一个数组，历史别名 |
| `rotate` | `number[]` | 姿态段，profile 未声明时为 `[]` |
| `matrix` | `{ width, height }` | 取 profile 的 `matrixWidth/Height`；未声明时数据长度为完全平方数则推方阵，否则两者为 `null` |
| `stats` | object | `{ max, min, total, mean, point, length }`；`point` 是大于 `pressureThreshold` 的点数 |
| `extra` | `object` | 仅 `handGloveFullPacket` 填 `{ packetType, packetLengthMatched }` |
| `rawValues` | `number[]` | 按 `valueType` 读出的完整帧，未截断未过线序 |
| `zeroFrame` | `number[]` | **仅在清零基线存在时出现**，值为该基线 |

清零生效时 `stats` 会按清零后的数据重算。注意此时重算**不带** `pressureThreshold`，所以 `stats.point` 的判定阈值会变成 0。

## ProtocolRegistry

```js
const registry = new ProtocolRegistry(profiles, { lineOrders, extraLineOrders });
```

| 方法 | 参数 | 说明 |
| :--- | :--- | :--- |
| `registerProfile(sensorType, profile?)` | — | 归一化并存入；`sensorType` 为空时抛错 |
| `getProfile(sensorType, override?)` | — | 已注册的与 `override` 合并；未注册则以 `default` 为底 |
| `parse(sensorType, buffer, context?)` | `context: { channel?, profile?, lineOrders?, lineOrderOptions? }` | 返回 `Frame` |

### profile 字段

| 字段 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `sensorType` | `string` | 键名 | 始终被键名覆盖 |
| `baudRate` | `number` | `getDefaultBaudRate(sensorType)` | 波特率 |
| `delimiter` | `Buffer` | `STANDARD_FRAME_DELIMITER` | 分帧标记，`DelimiterParser` 用 |
| `valueType` | `'uint8' \| 'uint16le' \| 'int16le'` | `'uint8'` | 读数宽度与字节序 |
| `pressureLength` | `number` | 全帧长度 | 压力段取前多少个读数 |
| `rotateOffset` | `number` | — | 姿态段起点（按读数下标，不是字节） |
| `rotateLength` | `number` | — | 姿态段长度；两者缺一则 `rotate` 为 `[]` |
| `matrixWidth` / `matrixHeight` | `number` | — | 显式矩阵尺寸；缺省时尝试推方阵 |
| `lineOrder` | `string \| function` | — | 线序处理，见下节 |
| `lineOrderOptions` | `object` | — | 透传给线序函数的额外参数 |
| `pressureThreshold` | `number` | `0` | `stats.point` 的计数阈值 |
| `parser` | `'handGloveFullPacket'` | — | 切到手套整包解析器 |
| `packetLength` | `number` | — | 整包长度，仅用于 `extra.packetLengthMatched` |
| `parseFrame` | `function` | — | 自定义解析器，签名 `(buffer, profile, context)`，优先级最高 |
| `channels` | `string[]` | — | 建议通道名，仅作元数据，不参与打开 |

### 内置 profiles

| sensorType | 波特率 | valueType | 压力长度 | 矩阵 | lineOrder |
| :--- | ---: | :--- | ---: | :--- | :--- |
| `default` | 1000000 | uint8 | 全帧 | 推方阵 | — |
| `hand0205` | 921600 | uint8 | 256 | 16×16 | — |
| `hand0205Double` | 921600 | uint8 | 256 | 16×16 | — |
| `handGlove115200` | 115200 | uint8 | 256 | 16×16 | — |
| `handGloveFullPacket` | 921600 | uint8 | 256 | 16×16 | — |
| `hand` | 1000000 | uint8 | 1024 | 32×32 | `jqbed` |
| `handSinglePoint` | 1000000 | uint8 | 1024 | 32×32 | `handSinglePoint` |
| `fast1024` | 1000000 | uint8 | 1024 | 32×32 | — |
| `smallBed12B` | 1500000 | uint16le | 1024 | 32×32 | `jqbed` |
| `bed4096` | 3000000 | uint8 | 4096 | 64×64 | — |
| `bed4096num` | 3000000 | uint8 | 4096 | 64×64 | — |

### 线序

线序是"设备物理走线顺序 → 显示顺序"的重排函数。`profile.lineOrder` 可以是：

- **函数** —— 直接调用，签名 `(data, context) => number[]`，`context` 含 `profile`、`channel` 与合并后的 `lineOrderOptions`。
- **字符串** —— 去线序注册表里查；查不到**抛错**。

### 内置线序

`PROJECT_LINE_ORDER_NAMES` 为 `['handSinglePoint', 'jqbed']`，两个都随包提供，无需额外配置。

| 名字 | 用在哪 | 做什么 |
| :--- | :--- | :--- |
| `jqbed` | `hand`、`smallBed12B` | 前 15 行上下翻转，再整体挪到末尾。写死 32 列 |
| `handSinglePoint` | `handSinglePoint` | 按「中段正序 + 前段倒序 + 尾段」三段重排 1024 点 |

两者都是纯重排：保长度、不增删值、不修改入参。

要覆盖内置实现（设备批次差异导致走线不同）时同名注入即可，**使用方的实现优先**：

```js
const sdk = new ShroomSensorSDK({
  extraLineOrders: {
    jqbed: (data, context) => myReorder(data),
  },
});
```

也可以在 profile 里直接给函数，绕开注册表：

```js
sdk.registerProfile('hand', { lineOrder: (data) => data });
```

::: tip 加 profile 时别忘了线序实现
`tests/backend-line-orders.test.mjs` 有一条断言会检查「声明了线序名的 profile，那个名字必须真的注册过」。写了名字没写实现会在测试阶段被拦下，而不是等到客户接上设备的第一帧。
:::

## LineOrderRegistry

| 方法 | 说明 |
| :--- | :--- |
| `register(name, handler)` | `name` 为空或 `handler` 非函数时抛错 |
| `has(name)` / `get(name)` | 查询 |
| `list()` | 已排序的名字数组 |
| `apply(name, data, context?)` | 传入数组的**副本**给 handler；未注册时抛错 |

## ZeroCalibrator

无构造参数。基线按 `sensorType:channel` 分键存放。

| 方法 | 参数 | 说明 |
| :--- | :--- | :--- |
| `captureBaseline(frame)` | `Frame` | 用该帧的读数做基线 |
| `setBaseline(sensorType, channel, data)` | — | 直接设基线 |
| `clearBaseline(sensorType?, channel?)` | — | 两个都给清一条；只给 `sensorType` 清该类型全部；都不给清空 |
| `apply(frame)` | `Frame` | 无基线时原样返回；有基线时逐点相减并把负值钳到 0 |
| `getKey(sensorType, channel?)` | — | 基线键，缺省 `default:sit` |

减除是不可配的：负值恒钳 0，`stats` 重算时不带 `pressureThreshold`。

## CaptureStore

```js
const store = new CaptureStore({ dbDir: './db' });
```

| 参数 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `dbDir` | `<cwd>/db` | 目录，自动创建 |
| `dbPath` | `<dbDir>/sdk_capture.db` | 库文件，优先于 `dbDir` |

建库时设 `journal_mode = WAL`、`synchronous = NORMAL`，并建 `captures` / `frames` 两张表。

| 方法 | 参数 | 返回 |
| :--- | :--- | :--- |
| `createCapture({ name?, sensorType, hz?, metadata? })` | `name` 缺省为 `<sensorType>_<时间戳>` | `{ id, name, sensorType, hz, metadata }` |
| `finishCapture(captureId)` | — | 写 `ended_at` |
| `insertFrame({ captureId, sensorType?, channel?, rawFrame?, frame })` | `captureId` 必填 | 无返回 |
| `listCaptures(filter?)` | `{ sensorType? }` | 行数组，按 `created_at` 倒序 |
| `getCapture({ captureId?, captureName?, sensorType? })` | 三者可组合 | 单行或 `null` |
| `queryFrames({ captureId?, captureName?, sensorType? })` | 同上 | 帧行数组，按 `timestamp, id` 升序 |
| `close()` | — | 关库 |

数据行的字段是下划线风格（`sensor_type`、`data_json`、`raw_frame_hex`、`stats_json`、`extra_json`）。`data_json` / `stats_json` / `extra_json` 是 JSON 字符串，`extra_json` 形如 `{ rotate, matrix, extra }`。原始帧以 hex 字符串存。

::: warning 当前限制
- **没有删除接口。** 采集记录与帧只能增，清理要自己操作库文件。
- `queryFrames` 没有 `limit` / `offset` / 时间区间 / 通道过滤，长采集会整段读进内存。
- `listCaptures` 只有 `sensorType` 一个过滤条件，没有分页。
- `insertFrame` 每帧重新 `prepare()` 编译 SQL 且逐帧同步写，高频采集时是主要瓶颈。
:::

## MemoryCaptureStore

无构造参数，方法与 `CaptureStore` 同名同签名（`close()` 是空实现），返回行也用同样的下划线字段，可直接换给 `CsvExporter` 和 `ReplayService`。适合 demo、测试和不落盘的场景。

与 SQLite 版的差异：采集记录行额外带一个驼峰的 `sensorType` 字段（SQLite 版只有 `sensor_type`）；进程退出即丢；帧全部驻留内存，长采集会一直涨。

## CsvExporter

```js
const exporter = new CsvExporter({ store, exportDir: './data' });
await exporter.exportCapture({ captureName: 'demo', language: 'en' });
```

构造参数：`store`（必填，缺失时抛错）、`exportDir`（默认 `<cwd>/data`，自动创建）。

`exportCapture(options)` 的参数：

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `captureId` | `number` | — | 与下面两项一起透传给 `store.queryFrames` |
| `captureName` | `string` | — | 采集名 |
| `sensorType` | `string` | — | 传感器类型 |
| `language` / `locale` | `string` | `'zh'` | 以 `en` 开头走英文表头，否则中文 |
| `outputPath` | `string` | — | 完整文件路径，给了就忽略 `exportDir` |
| `exportDir` | `string` | 构造时的值 | 本次导出的目录 |

返回 `{ files: string[], rows: number, dir: string }`。查不到帧时抛 `no capture frames found`。

导出列固定 13 个：序号、秒数、时间戳、通道、最大值、最小值、平均值、总和、点数、矩阵数据、姿态数据、原始帧HEX、附加信息。`矩阵数据` 与 `姿态数据` 是 JSON 字符串。

::: warning 当前限制
列集合不可裁剪（`矩阵数据` 一列往往占整个文件的绝大部分），也没有 BOM 选项 —— 中文表头在 Excel 里默认按 GBK 解会乱码，用 Excel 的"从文本导入"指定 UTF-8 可绕过。
:::

## ReplayService

```js
const replay = new ReplayService({ store });
```

`store` 必填。三个方法都把 options 原样透传给 store：

| 方法 | 参数 | 返回 |
| :--- | :--- | :--- |
| `listCaptures(filter?)` | `{ sensorType? }` | 采集记录数组 |
| `getFrames(options?)` | `{ captureId?, captureName?, sensorType? }` | 已解 JSON 的帧数组 |
| `buildTimeline(options?)` | 同上 | 时间轴 |

`getFrames` 返回的每帧是驼峰字段：`{ id, captureId, captureName, sensorType, channel, timestamp, data, stats, extra }`。

`buildTimeline` 返回：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `length` | `number` | 帧数 |
| `time` | `number[]` | 各帧时间戳 |
| `seconds` | `string[]` | 相对首帧的秒数，保留 3 位小数；**空结果时该字段不存在** |
| `frames` | `object[]` | 同 `getFrames` |

## BackendSdkClient

```js
const client = new BackendSdkClient({
  httpBaseUrl: 'http://127.0.0.1:19245',
  wsUrl: 'ws://127.0.0.1:19999',
});
```

### 构造参数

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `httpBaseUrl` | `string` | `http://127.0.0.1:19245` | 尾部斜杠会被去掉 |
| `wsUrl` | `string` | `ws://127.0.0.1:19999` | WebSocket 地址 |
| `fetchImpl` | `function` | `globalThis.fetch` | 缺失时调用 `request` 抛错 |
| `WebSocketImpl` | class | 全局 `WebSocket`，否则 `ws` | 都取不到时 `connectRealtime` 抛错 |
| `contract` | `object` | `null` | 预置契约，可省掉一次 `getContract()` |
| `routes` | `object` | `{}` | 覆盖路由表，优先级最高 |

路由优先级：`routes` 参数 > `contract.http.routes` > 内置默认。

### 默认路由表

| 路由名 | 路径 |
| :--- | :--- |
| `channels` | `/api/channels` |
| `wsStatus` | `/api/ws/status` |
| `sdkContract` | `/api/sdk/contract` |
| `displaySystems` | `/api/display-systems` |
| `displaySystemById` | `/api/display-systems/:id` |
| `serialPorts` | `/api/serial/ports` |
| `serialStatus` | `/api/serial/status` |
| `serialOpen` | `/api/serial/open` |
| `serialClose` | `/api/serial/close` |
| `sensorCurrent` | `/api/sensor/current` |
| `sensorType` | `/api/sensor/type` |
| `collectionStart` | `/api/collection/start` |
| `collectionStop` | `/api/collection/stop` |

### request

```js
await client.request('serialOpen', { method: 'POST', body: { role: 'sit', port: 'COM3' } });
await client.request('/api/custom', { query: { role: 'sit' } });
```

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `routeOrName` | `string` | — | 以 `/` 开头视为路径，否则查路由表 |
| `method` | `string` | `'GET'` | HTTP 方法 |
| `body` | `object` | — | 非空时自动 JSON 序列化并带 `content-type` |
| `query` | `object` | — | `null` / `undefined` 的键会被跳过 |
| `raw` | `boolean` | `false` | 见下方拆包规则 |
| `routeParams` | `object` | — | 填充路径里的 `:name` 占位符，值会 URL 编码 |

拆包规则：`raw: false` 时，若响应体有 `code` 字段则 `code !== 0` 抛错、否则返回 `payload.data`；没有 `code` 字段就原样返回。`raw: true` 完全跳过这一步。HTTP 状态非 2xx 时按 `message` / `error` / `HTTP <状态码>` 抛错。

### 方法

| 方法 | 参数 | raw | 说明 |
| :--- | :--- | :--- | :--- |
| `getContract({ refresh? })` | — | 是 | 有缓存直接返回；读到后刷新路由表 |
| `getChannels()` | — | 是 | 通道列表 |
| `getWsStatus()` | — | 是 | WebSocket 状态 |
| `listDisplaySystems()` | — | 是 | Display System 列表 |
| `getDisplaySystem(id)` | — | 是 | 单个 Display System |
| `listSerialPorts()` | — | 否 | 串口列表 |
| `getSerialStatus(role)` | `role` 进 query | 否 | 串口状态 |
| `getCurrentSensor()` | — | 否 | 当前传感器类型 |
| `setSensorType(type)` | POST `{ type }` | 否 | 切换传感器类型 |
| `openSerial({ role?, port?, path?, portPath? })` | `role` 默认 `'sit'`；三个端口别名取第一个非空 | 否 | 打开串口 |
| `closeSerial({ role? })` | `role` 默认 `'sit'` | 否 | 关闭串口 |
| `startCollection(options?)` | options 整体作为 body | 否 | 开始采集 |
| `stopCollection()` | POST `{}` | 否 | 停止采集 |

`role` 的常用值：`sit`、`back`、`head`、`sensor`。

### 实时通道

| 方法 | 参数 | 说明 |
| :--- | :--- | :--- |
| `connectRealtime({ channels? })` | `channels` 非空则连上后自动订阅 | 已有连接（`readyState <= 1`）时直接返回现有连接 |
| `disconnectRealtime()` | — | 关闭并清空 |
| `subscribe(channels)` | 字符串或数组 | 消息类型取 `contract.websocket.messageTypes.SUBSCRIBE`，缺省 `'subscribe'` |
| `unsubscribe(channels)` | 同上 | 缺省 `'unsubscribe'` |
| `sendRealtime(message)` | 任意对象 | 未连接时抛错 |

事件：

| 事件 | 载荷 | 时机 |
| :--- | :--- | :--- |
| `open` | — | 连接建立 |
| `close` | 原生事件 | 连接关闭 |
| `error` | 原生事件 | 连接报错 |
| `message` | 已解析对象 | 每条消息 |
| `frame` | 单帧 | 消息含 `frames` 数组时逐个发；否则消息带 `channelId` / `portId` / `value` 之一时整条发 |
| `raw` | 原始字符串 | JSON 解析失败 |

::: warning 当前限制
没有请求超时、`AbortSignal`、自定义请求头（含鉴权）；WebSocket 没有自动重连、心跳和退避。长时间运行的场景需要自己在外层包一层。
:::

## BackendCommandRouter

把后端下发的扁平命令对象翻译成事件。`route(message)` 接受 Buffer、字符串或对象，返回解析后的命令对象。

| 命令字段 | 触发事件 | 载荷 |
| :--- | :--- | :--- |
| `date` | `license:setKey` | 字段值 |
| `file` | `system:switch` | 字段值 |
| `baudRate` | `system:setBaudRate` | `Number(值)` |
| `serialReset` | `serial:list` | — |
| `sitPort` / `backPort` / `headPort` | `serial:open` | `{ channel, portPath }` |
| `sitClose` / `backClose` / `headClose`（`=== true`） | `serial:close` | `{ channel }` |
| `resetZero === true` / `=== false` | `zero:capture` / `zero:clear` | — |
| `colName`、`time` | `capture:setName` | 字段值 |
| `colHZ` | `capture:setHz` | `Number(值)` |
| `flag === true` / `=== false` | `capture:start` / `capture:stop` | 整个命令对象 |
| `getTime` | `replay:load` | 字段值 |
| `local` / `play` | `replay:setLocal` / `replay:setPlay` | `Boolean(值)` |
| `value` / `speed` | `replay:setIndex` / `replay:setSpeed` | `Number(值)` |
| `download` | `export:csv` | `{ captureName, options }` |

一条消息可以同时命中多个字段，事件会按上表顺序全部发出。`colName` 和 `time` 都映射到 `capture:setName`，同时出现时后者覆盖前者。

## LicenseService

```js
const service = new LicenseService({ decrypt: (key) => myDecrypt(key) });
```

`decrypt` 由外部注入，SDK 不含任何加解密实现。

| 方法 | 参数 | 返回 |
| :--- | :--- | :--- |
| `parseKey(encryptedKey)` | — | 成功 `{ ok: true, payload, expiresAt, file, moduleConfig }`；失败 `{ ok: false, error }` |
| `getSelectFlag(licenseFile)` | — | 数组原样返回；`'all'` 返回 `'all'`；否则值或 `null` |
| `getDefaultFile(licenseFile, fallback?)` | `fallback` 默认 `'hand0205'` | 数组取首项；非 `'all'` 的值原样；否则 `fallback` |
| `isExpired(expiresAt, now?)` | `now` 默认 `Date.now()` | `boolean` |

`parseKey` 期望解密结果是 JSON，`expiresAt` 取 `payload.date`。密钥为空或未注入 `decrypt` 时返回 `{ ok: false }` 而不抛错。

::: danger isExpired 会把无法识别的到期时间判为未过期
`expiresAt` 为 `undefined` / 非数字时，`Number(x) <= now` 的结果是 `NaN <= now`，即 `false`。调用方需要自己先确认 `parseKey` 返回了 `ok: true` 且 `expiresAt` 是有限数。
:::

## PathService

```js
const paths = new PathService({ dbDir, exportDir, imageDir, reportDir });
```

四个目录参数分别默认 `<cwd>/db`、`<cwd>/data`、`<cwd>/img`、`<cwd>/pdf`。

| 方法 | 参数 | 返回 |
| :--- | :--- | :--- |
| `ensureRuntimeDirs()` | — | `{ dbDir, exportDir, imageDir, reportDir }`，四个目录都已创建 |
| `validateWritableDirectory(targetDir)` | — | `{ ok: true, dir }` 或 `{ ok: false, error }`；靠实际写一个临时文件判定 |
| `getExportPath(filename, dir?)` | `dir` 默认 `exportDir` | 拼好的路径，文件名已净化 |

`sanitizeFilename`（深路径导出）会去掉路径分隔符、控制字符、`<>:"|?*` 和结尾的点与空白。

## ReportService

```js
const service = new ReportService({ store, pythonClient });
```

算法全部由 `pythonClient.call(name, payload, { timeoutMs })` 承担，SDK 只负责取数和拼参数。

| 方法 | 参数 | 说明 |
| :--- | :--- | :--- |
| `setPythonClient(client)` | — | 事后注入 |
| `getDbHeatmap(options)` | `{ captureId?, captureName?, sensorType?, timeoutMs? }` | 读帧后调 `get_peak_frame`；`timeoutMs` 默认 60000；无数据时返回 `{ ok: false, error: 'no data' }` |
| `generateFootPressureReport(options)` | 见下表 | 调 `generate_foot_pressure_report1`；`timeoutMs` 默认 120000 |

`generateFootPressureReport` 的参数：`sensorData`（默认 `[]`）、`pdfName`、`heatmapPngPath`、`userName`、`userAge`、`userGender`、`userId`（默认 `9527`）。返回 `{ ok, data, pdfFilePath }`，`pdfFilePath` 仅在给了 `pdfName` 时存在。

缺 `store` 或 `pythonClient.call` 时抛错。

## 后端能力对照

`listBackendOperations()` 返回九个命令域与 SDK 能力的对应关系，每项含 `domain`、`commands`、`sdk`、`description`。域名：`license`、`system`、`serial`、`realtime`、`zero`、`capture`、`replay`、`export`、`report`。用于核对"主项目的某个命令走 SDK 该调什么"。

## 前端组件参数

矩阵渲染器和 UI 组件的参数不在本页，每个组件有独立页面：[UI 组件总览](./UI_COMPONENTS.md)。
