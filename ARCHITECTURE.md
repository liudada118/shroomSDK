# Shroom SDK 架构

最后更新于：2026-11-17

## 1. 项目概述

本仓库维护独立的 `shroom-sdk`：读取传感器数据、按需创建 WebSocket 服务、采集到 SQLite、停止采集并导出 CSV / JSONL。快速入口只导出五个函数，产品协议和点位映射由内部适配器管理。Node.js、浏览器和 Python 共享版本号，使用同一套产品协议、WS 数据格式和录制数据库；浏览器专属能力（Web Serial、Canvas 展示）只在 JavaScript 中，各语言的具体接口按各自文档定义。

当前源码与发布准备版本为 **0.7.1**：修正触觉足底 `footVideo / foot` 的顶层数据为左右脚各自线序的 **60 点原始 ADC，6 列×10 行**（rows=10、cols=6），不是 256 个扫描通道。完整通道与 IMU 仍保存在两份 `rawPackets`；类型 3=左脚、4=右脚，手动与自动发现保持原协议。Node 与网页依赖使用同一版本，安装命令为 `npm install --save-exact shroom-sdk@0.7.1`；正式发布与注册表独立安装结果另行记录。0.7.0 已正式发布，旧版本数据契约见历史记录。Python 版本元数据按全仓规则同步，产品运行实现未扩展，本次不发布 PyPI。合成帧和安装验证不代替实物验收。

扫描逐口读取所选产品固定的 921600 波特率分包数据：手套从 0.5.0 起按类型 1/2 确认左/右手，触觉足底从 0.7.0 起按类型 3/4 确认左/右脚；明确 path+side 且无 scan 保持手动直连。只读探测样本与正式取数隔离，全部探测连接释放后才正式连接；重连保持原路径，不跨口迁移。

官网与文档展示位于独立的 `shroomSDKWEB` 仓库，通过 `sdk/` Git 子模块固定本仓库的具体提交。SDK 的安装、测试、构建和发布均不依赖官网。官网构建使用固定提交中的文档、示例生成函数及下载包，不自动跟随 SDK 主分支。

仓库原来的 `shroom-backend-sdk@0.2.0` 已由当前五步 SDK 替换，旧实现保留在 `legacy-backend-sdk-0.2.0` 标签及 Git 历史。旧接口、组件、数据库不能被视作当前包的兼容能力；具体差异见 [MIGRATION.md](MIGRATION.md)。本文末尾保留旧项目进度与更新记录，作为历史记录。

## 2. 技术栈

| 分类 | 技术与边界 |
| --- | --- |
| JavaScript | ES Module；Node.js 运行时要求见根 `package.json`；浏览器使用 Web Serial 或 WebSocket |
| Python | Python 3.10+；产品协议与自动发现、五步流程、WS/HTTP 服务与 SQLite 录制只用标准库（`socket` / `http.server` / `sqlite3` / `threading`），同步调用加可选回调线程 |
| 串口 | Node `serialport`、浏览器 Web Serial、Python `pyserial` |
| 采集 | `better-sqlite3`，`sessions / frames` 表，批量事务与分页导出 |
| 通信 | `ws`，同端口 HTTP 下载；应用后端通过独立 `BackendSdkClient` 访问 |
| 依赖与类型 | npm 锁文件、Python 测试锁文件、TypeScript 声明与类型测试 |
| 验证与发布 | Node 内置测试、Python unittest、esbuild 运行包压缩、ZIP / npm TGZ、SHA256；GitHub Actions |
| 维护环境 | Node.js 22.22.0 / npm 10.9.4；Python 测试 3.11+，CI 3.12 |

## 3. 目录结构

```text
shroomSDK/
├─ src/                  SDK 运行实现与类型
│  ├─ quick-flow.js      五个函数的统一导出
│  ├─ flow/              快速调用编排
│  ├─ core/              协议、产品适配、数据结构与授权
│  │  └─ products/       registry、glove-segmented/glove/pad/body/insole 适配器及物理线序
│  ├─ node/              Node 串口、自动发现与重连、WS 与 SQLite 采集
│  │  ├─ serial-scan.js  有界逐口采样、取消与资源释放；协议身份由产品适配器提供
│  │  └─ serial-path.js  扫描与托管连接共用的路径预约，覆盖重连与迟到清理
│  ├─ web/               浏览器串口、WS 与二维显示
│  └─ backend/           已有后端的 HTTP / WS 客户端
├─ examples/
│  ├─ products/          手套左右手与手垫的 HTML / MJS 示例
│  ├─ node/              命令行演示与示例授权配置
│  ├─ web/               网页测试台、模板与生成的 bundle
│  └─ product-*.js       官网和调用示例共用的生成器
├─ docs/                 接入、API、AI 上下文和发布说明
├─ scripts/              启动、构建、版本、打包与发布检查
├─ tests/                JavaScript 与类型测试
├─ python/               独立 Python 包、文档、示例和测试
│  ├─ src/shroom_sdk/    flow（五函数）、product_device（产品连接与重连）、serial_scan / _serial_path（发现与串口预约）、
│  │                     quick_server / stream_client / _ws（服务与客户端）、recording（SQLite）、stream_codec、layout、glove、
│  │                     colormap、backend_client 及原有 device / frame / framer / license
│  │  └─ products/       与 src/core/products 一一对应的适配器：glove_segmented / glove / pad / body / insole
│  ├─ examples/          product_demo、quick_demo、stream_client 及原有 read_frames、heatmap
│  └─ tests/             单元测试，以及调用 JS 实现的对照（js_reference.mjs）和互通（js_interop.mjs）辅助脚本
├─ .github/              跨平台检查与 Release 草稿工作流
├─ package.json          公开包入口与开发命令
├─ package-lock.json     JavaScript 依赖锁
├─ tsconfig.json         类型检查配置
├─ README.md             使用说明与源码导航
├─ ARCHITECTURE.md       架构与累积工作记录
├─ CHANGELOG.md          版本变更
└─ MIGRATION.md          原有 SDK 的迁移边界
```

实现和类型集中在 `src/`，产品/Node/浏览器示例分别位于 `examples/products|node|web/`，启动器归入 `scripts/`。AI 上下文、后端说明和发布指南归入 `docs/`。根目录保留包配置、README、架构、变更与迁移说明。

兼容 ZIP 使用显式交付映射，将仓库源码映射回旧 `quick-flow.js`、`core|node|web|flow|backend/`、根示例与启动器；同时转换相对导入和文档链接。白名单仍排除测试、开发工具、依赖缓存和采集记录，不在源码仓库保留重复兼容文件。

JavaScript 集成优先使用 `npm install shroom-sdk` 从 npm 注册表安装，下载 `.tgz` 与历史官网 URL 继续可用。发布制品由 `scripts/pack-npm.mjs` 根据公开入口收集实际运行模块，在独立临时目录压缩并保留类型，再交给 npm 打包；客户从 `shroom-sdk/quick-flow` 导入五个函数。Node.js 保留相对模块结构，避免复制授权会话与模拟设备身份；浏览器通过条件导出选择独立入口，并用共享代码块保持同一环境内的模块状态。包中不含开发工具、测试、Python 或 source map。根目录直接 `npm pack` / `npm publish` 会由 `prepack` 阻止，提示使用受控打包命令。

`examples/product-call.js` 与 `product-flow.js` 接受 `importStyle: 'package'`，官网由此生成 `shroom-sdk/quick-flow` 和 `shroom-sdk/node|web` 的公开包名导入；默认 `relative` 保持 ZIP 示例可运行。客户安装文档纳入 `docs/catalog.json` 的 `npm` 页面，快速接入与 AI 上下文默认使用包入口，源码 ZIP 的路径转换单独说明。

## 4. 核心模块与数据流

```mermaid
flowchart LR
  A[产品适配器与注册表] --> B[Node 串口解析]
  B --> C[readProduct 产品数据]
  C --> D[createWS]
  D --> E[浏览器 readProduct]
  E --> F[startRecording / stopRecording]
  F --> G[SQLite sessions / frames]
  G --> H[downloadRecording CSV / JSONL]
  L[SDK 授权] --> B
  L --> D
  L --> F
```

五函数复用基础 API：`readProduct` 调用 Node `connectProduct` 或浏览器 `connectStream`；`createWS` 调用 `serveDevice`；采集和下载委托已有连接或服务方法。返回对象与 `stream` 保存当前会话，成功开始新采集时清除旧下载 ID。

`listPorts()` 仍只枚举系统串口，不打开设备、不识别型号或左右侧，也不要求授权。需要手动选择时将列表交给应用。Node 基础 API `scanProductPorts()` 由 `src/node/serial-scan.js` 在有效 serial 授权下逐口只读采样，通过 `adapter.discovery.createParser / identify` 识别协议身份；只有注册了 discovery 钩子的产品才支持扫描，目前为分包手套与触觉足底。默认每口读取 1200 ms，允许 50–10000 ms，支持 paths 限定及 AbortSignal 取消，只按产品固定 921600 波特率探测。

扫描至少观察 3 个同侧完整配对，未知/混合侧别不作为有效设备；返回 devices 与逐口 ports 报告，side 只筛选 devices。样本不进入业务 onData 或采集；确认所有临时端口释放后才正式连接。无法确认关闭时停止扫描并保持路径占用保护，防止晚到打开与下一次连接重叠。

`src/node/serial-path.js` 由 serial-scan 与 serial-reconnect 共用，统一预约串口路径；托管连接在重连等待期间仍保留预约。扫描跳过当前 SDK 已有的活跃、重连或清理未完成连接，以逐口 PORT_BUSY 结果报告，不抢占原设备。逻辑连接终止且所有物理连接确认释放后才解锁，迟到的 open/close 仍需完成清理；其他进程的端口互斥由驱动处理。

Node `connectProduct()` 在分包手套或触觉足底缺少 path、side 省略/auto 或显式 scan 时内部调用公开 `scanProductPorts()`；唯一匹配才连接，零/多匹配分别报 PORT_NOT_FOUND/PORT_AMBIGUOUS，details.scan 保留完整报告。显式 path+left/right 且无 scan 保持手动直连。`readProduct()` 继续复用 connectProduct，快速入口仍只导出五函数。Web Serial、WS 客户端、整包手套和其他产品没有本次自动扫描入口。

Node 串口通过 `src/node/serial-reconnect.js` 管理恢复生命周期，产品连接默认启用，通用 `connectSerial` 默认关闭。意外断线后先清理旧端口，再按原 `path` 每 3 秒尝试、最多 3 次；只有收到有效帧才重置尝试次数。首次打开失败、主动关闭、授权或解析错误、端口清理失败不进入重试。恢复保持设备对象和数据订阅，通过 `onStateChange` 暴露 `open / reconnecting / error / closed`；诊断保留累计计数，同时按本次连接判断是否真正收到数据。Web Serial 与浏览器 WS 没有自动重连；Python 的产品连接采用相同的重连规则（见 4.1）。

产品代码集中在 `src/core/products/`。增加产品通过适配器与注册表扩展协议、映射和 WS 字段校验，不改五个函数签名。产品扩展测试会在临时副本注册测试产品，验证串口、五步调用、录制、导出和浏览器 bundle 的一致性。

0.4.0 注册表包含分包手套 `handGloveSegmented`（`glove`）、兼容整包手套 `handGloveFullPacket`、手垫 `hand`（`pad`）、人体 `humanBody`（`body`）及鞋垫 `jqInsole`（`insole`）。别名只用于连接，帧和 WS 始终使用规范 ID。`prepareProductConnection` 先执行产品专属参数校验，再调用可选的 `adapter.resolveProfile(options)`；未实现该方法的适配器使用静态 profile。鞋垫以此选择显式 protocol 和支持的 baudRate；本次扫描通过可选 discovery 钩子扩展识别，不把各产品字节判断塞进公共连接层，也不自动探测波特率。

| 适配器 / 线序文件 | 配置与输出边界 |
| --- | --- |
| `glove-segmented.js` / `glove.js` / `../glove.js` | 默认分包在单连接内按相同原始包类型配对 130/146 字节包，最大间隔 1 秒；重置/非法包清缓存，孤立尾包不交付。一只手一个串口；手动 side 决定线序，自动模式识别 packetType 1=左/2=右，未知/混合类型不作设备匹配；不路由单串口双手，不构造假序号。整包适配器保留 274 字节与原 sequence |
| `body.js` / `body-layout.js` | 无 side；1000000 baud，1024 字节 uint8 载荷与尾分隔。保留 1024 原扫描 ADC，十个 `regions` 映射 400 唯一通道，索引用 Uint16；没有模型 UV、翻转、显示重复行或插值 |
| `insole.js` / `insole-layout.js` | 必须明确脚侧；默认 12bit、921600 baud，可选 8bit 及限定速率。12bit 的 raw 是 512 个原始 ADC 字节、pressure 是 256 个 Uint16 ADC（0–4095）；8bit 分别为 256 字节与 256 个 Uint8 ADC。`sensors` 是 A 版 112 真实点，不含显示插值点 |
| `tactile-foot.js` / `tactile-foot-layout.js` | `footVideo` / `foot`，921600 baud；130+146 分包，类型 3=左脚、4=右脚且必须同类型配对。按左右脚各自60点表取 ADC 原值，6列×10行；16字节IMU与完整256扫描通道保存在 `rawPackets`。不插值、归零、镜像、滤波或标定 |

人体的 32×32 与鞋垫的 16×16 顶层矩阵都是扫描存储形状，不能当人体/鞋形平面或物理重心。鞋垫保留 IMU 原始字节和 w/x/y/z 四元数，12bit 另提供陀螺仪/加速度的三个原始分量；不猜测单位、不融合姿态、不换算物理压力。来源和协议细节分别见 [HUMAN-BODY.md](docs/HUMAN-BODY.md)、[INSOLE.md](docs/INSOLE.md)。`profile.sensorPoints` 表示产品交付的pressure点数：触觉足底为60个有效点，其他产品可仍为完整扫描通道。可选 `mappedSensorPoints` 表示物理表覆盖的点数。

`src/index.d.ts` 的 `DeviceProductTypes` 登记所有产品，派生 Node/Web 选项与帧类型；分包与整包手套由 product 区分，只有整包帧有 sequence；鞋垫帧按 `protocol` 区分 12bit/8bit、ADC 类型和可用 IMU 字段。`stream-codec.js` 仍只处理基础帧，扩展字段由各适配器验证并复制；人体核对十块固定线序和 ADC 一致性，鞋垫核对精度、原始字节、真实点位及 IMU，避免 Uint8 截断或丢失负数 IMU。`createProductView` 支持分包/整包手套和手垫；人体/鞋垫仍由应用消费 `onData` 展示。

手套分包的 profile.payloadLength 与解析器 frameLength 都表示两包载荷合计 276 字节，不含各自 `AA 55 03 99` 帧尾；包含帧尾的首包/尾包为 134/150 字节。byte[0] 的 1/2 是首包/尾包，byte[1] 的 packetType 在当前固件中 1=左、2=右，两者都不是采样序号；packetType 也不是唯一设备 SN，同侧多设备仍靠 path 区分。自动连接会固定已发现类型，正式读取或重连后出现另一侧有效帧时以 PARSE_FAILED 停止；手动明确 path+side 时仍保留原映射行为。协议没有 CRC、连续帧标识和转义，配对与超时保护不能保证检测所有同类型丢包错配；载荷出现完整尾标记可能丢帧。说明与迁移入口见 [GLOVE.md](docs/GLOVE.md)。

触觉足底复用相同的分包布局，但原始包类型严格规定 3=左脚、4=右脚，手动参数不能覆盖类型中的身份。`rawPackets` 保存两份独立 Uint8Array，分别包括段号、类型、ADC、可选 IMU 与帧尾；WS 校验包头、长度、帧尾及压力/IMU 的逐字节一致性，SQLite、JSONL 与 CSV 完整帧列保留这些字段。从0.7.1起，`raw/pressure/pressureMatrix` 为对应脚线序的60点原始ADC，rows=10、cols=6。独立 `tactile-foot-layout.js` 保存来源于既有上位机 `FOOT_L_ADC_ORDER / FOOT_R_ADC_ORDER` 的点位表，不使用 `jqInsole` 的112点表。WS从原包重算对应脚60点以校验一致性，完整256扫描通道只保留在原包中。浏览器只提供解码与显式选侧的直连，不新增专用展示；原始 JSONL 例程见 `examples/node/tactile-foot-raw.js`，协议来源与限制见 [TACTILE-FOOT.md](docs/TACTILE-FOOT.md)。

公开类型新增 ProductPortScanSettings/Options、DetectedProductPort、ProductPortScanEntry/Result；NodeGloveOptions 可省略 side 或传 auto，并接收 scan。整包 Node 选项仍要求 left/right 且禁止 scan，浏览器手侧仍必填，WS 五步参数禁止 scan。连接 info 可提供识别出的 packetType。类型验证由 tests/serial-scan-types.mts 和原五步/产品类型测试覆盖。

录制使用 SQLite 事务批量写入；停止与关闭等待待写队列落库，导出按页读取。记录目录有独占所有权；异常退出记录可恢复为中断状态。兼容读取旧 JSONL 文件，不兼容原 `shroom-backend-sdk` 的 `captures / frames` 数据库。

设备断线时快速服务保留 WS 服务与设备引用，将当前采集以 `error` 收尾并保存已收到的数据。串口重连只恢复实时数据，不自动续录；应用确认恢复后显式再次调用 `startRecording` 创建新记录。

授权区分 SDK 与上位机产品密钥，检查有效期、电脑名额和功能权限，不按传感器型号限制。JS/Python 均提供结构化错误；连接阶段的拒绝由调用方捕获，连接后的运行错误通过订阅反馈。模拟数据源用于无硬件验证。

### 4.1 Python 实现

2026-11-17 新增的触觉足底仅接入 Node/Web 共享协议层，Python 注册表仍保留原五种产品；跨语言协议对照只比较共同支持的产品，并明确断言 Node 新增 `footVideo`。Python 运行实现和既有产品协议没有随此次改动扩展。

Python 包在 `python/src/shroom_sdk/` 内按 JavaScript 的模块划分实现同一套能力，JavaScript 是协议与数据格式的基准；两边不共享运行代码。

| Python 模块 | 对应的 JavaScript 模块 | 说明 |
| --- | --- | --- |
| `products/`、`product.py`、`glove.py` | `src/core/products/`、`core/product.js`、`core/glove*.js` | 适配器注册表、参数校验、流解析器、发现钩子与 WS 字段校验；解析结果和丢弃计数与 JS 逐块一致 |
| `product_frames.py` | `src/index.d.ts` 的产品帧类型 | 冻结数据类，属性为 snake_case；`to_dict()` 输出 JS 字段名，作为 WS 与录制的格式 |
| `product_device.py` | `node/serial.js`、`node/serial-reconnect.js`、`core/mock.js` | 产品连接（手动 / 自动）、有限重连、产品模拟 |
| `serial_scan.py`、`_serial_path.py` | `node/serial-scan.js`、`node/serial-path.js` | 分包手套逐口发现；连接与扫描共用的进程内串口预约 |
| `stream_codec.py` | `core/stream-codec.js` | `shroom.frame.v1` 校验与还原 |
| `quick_server.py`、`_ws.py` | `node/quick-server.js` + `ws` | 同端口 WS / HTTP、来源与 Host 校验、慢客户端断开 |
| `recording.py` | `node/recording.js`、`node/recording-sqlite.js` | 同一 v1 表结构、目录独占锁、批量事务、恢复与导出 |
| `stream_client.py` | `web/stream.js` | ready 握手、请求关联、录制控制；下载直接保存文件 |
| `flow.py` | `flow/runtime.js` | 五个快速函数及本次记录 ID 管理 |
| `layout.py`、`colormap.py` | `core/layout.js`、`core/colormap.js` | 30 种排列与产品菜单、调色板 |
| `backend_client.py` | `backend/client.js` | 已有后端的 HTTP / WS 客户端 |

与 JavaScript 的设计差异：

- **线程模型**：核心读取仍是同步的 `read_frame()`。订阅 `on_data / on_frame` 时由一个后台线程调用它并分发，重连状态机运行在读取调用内，不另起定时器；数据服务为每个 WS 连接使用独立的写线程和有界队列，慢客户端不阻塞设备读取线程。录制由一个写线程批量提交。扫描是同步调用，用 `threading.Event` 取消。
- **命名与单位**：对外为 snake_case、时间单位为秒；线上 JSON、SQLite 行和导出文件保持 JavaScript 的字段名，使两种语言的服务、客户端和录制目录可以互通。
- **串口预约**：受管理的连接与扫描按路径预约，重连间隙也保留；端口关闭失败且仍被驱动持有时预约不释放，再次 `close()` 重试。原有的同步 `Shroom.connect()` 设备只做弱引用登记：自身行为不变，但不会被扫描或受管理的连接再次打开。`loop://` 等 pySerial URL 不参与预约。
- **授权**：新入口调用既有的 `license.py`（未改动）：产品连接与扫描要求 `serial`，通用入口要求 `serial.raw`，数据服务要求 `stream`，采集要求 `recording`。只有 SDK 自带的模拟设备类型免授权，自定义数据源按真实数据处理；源码交付下这不是防篡改机制。
- **HTTP 与连接处理**：数据服务每个连接只处理一个 HTTP 请求并立即关闭，请求正文从不读取，也不会被当作后续请求解析（否则网页可以借请求正文绕过来源与 Host 校验）。发出 WS 关闭帧后先读完对端在途的数据再断开，保证关闭码送达；录制目录可以位于网络路径。
- **不移植**：Web Serial、Canvas 热力图与 `createProductView` 属于浏览器。`layout` 对未知名称报错而不是回退 raw，这是 Python 包原有的行为。
- **验证方式**：`python/tests/js_reference.mjs` 让测试直接调用 JS 实现，对照线序表、解码、产品解析（含自动手侧以及噪声、截断与重排的语料）和调色板；`js_interop.mjs` 用 JS 的 `connectStream` 连接 Python 服务、用 Python 客户端连接 Node `serveDevice`，并互读对方写入的 SQLite 目录。这些测试在缺少 Node 或 npm 依赖时自动跳过。全部数据为合成数据，未连接真实硬件。

## 5. 快速服务端点

`createWS` 默认在 `127.0.0.1:19999` 创建本机服务，浏览器经同一服务获取数据和下载。跨主机使用必须显式指定允许的网页来源。

| 协议 | 路径或消息 | 用途 |
| --- | --- | --- |
| HTTP GET | `/health` | 服务、产品与采集状态 |
| HTTP GET | `/recordings/<id>.csv` | 导出已停止的采集记录 |
| HTTP GET | `/recordings/<id>.jsonl` | 导出完整帧记录 |
| WebSocket | `/` 或 `/ws` | 实时帧、状态与控制响应 |
| WS JSON | `recording.start / stop / status / list` | 带 `requestId` 的采集控制 |

Python 的 `create_ws / serve_device` 提供相同的端点与消息。这些端点属于快速本机服务；`BackendSdkClient` 访问的主项目 HTTP/WS 协议另见 [BACKEND.md](docs/BACKEND.md)。

## 6. 版本、发布与官网集成

根 `package.json.version` 同步到 `src/core/version.js`、Python 包元数据和 `_version.py`。发布检查包含原生依赖加载、JS/发布工具/Python 测试、类型检查及客户 ZIP 和 npm TGZ 独立安装验证。npm 消费测试从真实安装后的包名入口调用五步流程，并验证浏览器打包与类型解析。SDK 不运行官网的页面或服务测试。

构建输出 `dist/shroom-sdk.zip`、`dist/shroom-sdk-node.zip`、`dist/shroom-sdk-python.zip` 和 `dist/shroom-sdk-<版本>.tgz`。正式版本目录有七个文件：三个带版本 ZIP、一个 npm TGZ、`manifest.json`、`SHA256SUMS`、`RELEASE-NOTES.md`。清单记录真实 Git 提交与脏状态；相同版本不允许被不同内容或不同来源覆盖。

源码根包保留 `private: true` 与直接打包保护；受控生成的 npm TGZ 设为 `private: false`，`publishConfig` 指定公开访问与官方注册表。完整门禁通过后，维护者手动将已验证 TGZ 发布到 `https://registry.npmjs.org`，再执行 `npm run test:npm:registry`：从官方注册表安装当前版本，比对安装锁文件 SHA-512 与本地 TGZ，并复验五函数、WS / SQLite / CSV / JSONL、浏览器入口与类型。制品验证器默认兼容历史 `private: true` 安装包，`requirePublishable` 模式严格拒绝此类旧包作为发布制品；本地构建成功不等于远端发布成功。

2026-11-04 完整 SDK 发布门禁已通过：261 项 JavaScript、25 项发布工具、69 项 Python 测试，TypeScript、原生依赖加载、兼容 ZIP 独立安装、64 文件 npm TGZ 安装及 NodeNext/Bundler 类型解析均通过。覆盖人体 8 项与鞋垫 15 项专用测试、新产品经典浏览器脚本三种协议场景，以及 `tests/new-products-flow.test.mjs` 的合成串口字节 → 实际 WS/SQLite/HTTP 五步闭环；人体、左脚 12bit 与右脚 8bit 保留 ADC 精度、区域/点位与 IMU。官网整合门禁仍待更新子模块后执行；没有连接真实硬件，没有发布 npm，SDK 门禁通过不能替代这两项确认。

同日复核修正 `ProductDevice / NodeProductDevice` 默认帧类型为注册产品联合，`ProductFrame` 的 ADC 泛型支持 Uint8/Uint16；常规显式设备注解与协议收窄通过类型检查。增强的安装包验收从独立 `node_modules` 使用公开入口解析人体及鞋垫双协议，再跨 Node/浏览器 WS 编解码，确认 400 个唯一通道、112 个真实点、4095 与负 IMU 不丢失；NodeNext/Bundler 均通过。人体仍沿用来源的尾分隔规则，载荷内同值标记可能使该帧被丢弃，限制已写入 `HUMAN-BODY.md`。

客户使用 `npm install shroom-sdk` 安装到业务项目 `node_modules`，无需解压或登记；真实设备密钥另行申请。下载 `.tgz` 后手动安装及历史官网 URL 仍可用，本地文件依赖需要随项目保存安装包与锁文件。压缩并隐藏内部导入路径用于交付管理，不能作为防篡改或授权不可绕过的保证。

Python 包由维护者手动发布到 PyPI：在干净的发布提交上用锁定的构建工具离线构建 wheel 与 sdist，`twine check` 后先上传 TestPyPI 并在全新环境验证，再把同一批文件上传 PyPI。PyPI 的版本不可覆盖，问题只能通过新版本修正；步骤见 [SDK-RELEASING.md](docs/SDK-RELEASING.md)。包元数据声明 `LicenseRef-Proprietary`，与 npm 包的 `UNLICENSED` 一致。

GitHub Actions 使用锁定工具版本与固定 Action 提交。普通提交运行检查；`sdk-vX.Y.Z` 标签触发 Windows/macOS/Linux 检查，Linux 打包并保存附件，具有写权限的后续任务重新验证附件再创建 Release 草稿。同名 Release 不覆盖。工作流不自动发布 npm、PyPI 或部署官网。

官网只在明确更新子模块指针后采用新的 SDK 提交；文档、产品示例、版本展示及兼容 ZIP 下载都来自该固定来源。SDK 发布和官网部署分别执行。

## 7. 环境变量

以下授权变量由源码 ZIP 的示例启动器显式调用 `activateLicenseFromEnv()` 时读取。精简 npm 包不交付该 helper；应用自行读取配置，再从 `shroom-sdk/node` 调用 `Shroom.activateLicense(key, { deviceId })`，保存稳定的安装标识。仅导入 SDK 不会自动激活。

| 变量 | 用途 |
| --- | --- |
| `SHROOM_LICENSE_KEY` | SDK 密钥字符串，优先于文件 |
| `SHROOM_LICENSE_FILE` | SDK 密钥文件路径 |
| `SHROOM_DEVICE_ID` | 覆盖本机稳定安装标识 |
| `SHROOM_LICENSE_MODE` | `online` 或 `offline` |
| `SHROOM_LICENSE_SERVER` | 授权服务地址 |
| `SHROOM_LICENSE_PUBLIC_KEY_FILE` | 离线验证公钥文件 |
| `SDK_PYTHON` | 维护测试使用的 Python 解释器 |
| `GITHUB_REF / GITHUB_SHA` | CI 发布的标签和提交校验来源 |

## 8. 项目进度

旧实现的累积完成记录保留在下方历史区，不代表当前包仍包含那些接口。

| 完成日期 | 完成的功能/工作 | 说明 |
| --- | --- | --- |
| 2026-10-30 | 独立五步 SDK 仓库 | 当前 Node/Web/Python SDK、适配器、授权、SQLite、文档与测试迁入根目录；官网固定提交引用 |
| 2026-10-30 | 独立构建与发布 | 版本、依赖锁、类型校验、客户 ZIP 验证、跨平台 CI 与 Release 草稿均在 SDK 仓库完成 |
| 2026-10-30 | npm 依赖安装交付 | 生成压缩运行代码与类型组成的 TGZ，保持五函数入口；增加客户安装、浏览器构建与类型验证，保留 ZIP 源码交付 |
| 2026-10-30 | 官网一步安装接入说明 | 客户从官网复制安装命令；示例支持包名与 ZIP 两种导入，快速文档及 AI 上下文采用公开包入口和授权 API |
| 2026-11-03 | SDK 源码目录归类 | 实现归入 src，演示归入 examples，维护与 AI 文档归入 docs，启动器归入 scripts；公开 npm 入口和旧 ZIP 路径保持兼容 |
| 2026-11-03 | npm 注册表交付流程 | 精简 TGZ 支持手动公开发布，根源码保持误发布保护；新增官方注册表安装与 SHA-512 比对验证，统一 npm 安装文档并保留历史制品安装 |
| 2026-11-03 | Node 产品串口重连与搜索准备 | 保留五函数；接入前由 listPorts 查询并选择串口，Node 产品默认同端口有限重试，状态订阅贯通快速流程；断线结束录制，恢复后显式新建记录 |
| 2026-11-03 | 发布 CLI 测试隔离 | CLI 与依赖在测试临时仓库内运行，避免升级维护仓库版本影响固定版本 fixture；保留版本不一致拒绝校验 |
| 2026-11-04 | 0.3.0 人体与鞋垫产品适配 | 独立协议/物理线序、动态 profile、类型与 WS 验证接入原五函数；合成数据通过真实 WS/SQLite/HTTP 闭环，保留 12bit 精度与原始 IMU；版本仅本地构建，尚未发布或真机验收 |
| 2026-11-04 | 0.3.0 完整 SDK 发布门禁 | 261 JS、25 发布工具、69 Python 测试及类型/原生依赖/客户 ZIP/npm TGZ 安装全部通过；经典脚本新增三种协议验证，官网门禁、远端发布与真机验收仍独立 |
| 2026-11-04 | 0.3.0 发布准备 | 按用户指令准备推送与npm发布；安装指南和示例转为0.3.0最低版本要求，保留双方同版本与真机未验证边界，发布结果另行验证 |
| 2026-11-04 | 分包手套接入说明与迁移 | 0.4.0 本地修订以 130+146 分包为默认，整包显式保留；补充字段、组帧限制、五函数/基础 API/AI 文档及迁移说明，测试结果待最终汇总 |
| 2026-11-04 | 单手单串口协议边界对齐 | 根据实物接入方式明确 side 决定线序，packetType 只作同连接配对键；同步协议、API、AI 与文档导航，不移植自动双手路由 |
| 2026-11-04 | 0.4.0 分包修订验证 | 281 项 JS、25 项发布工具、TypeScript 检查通过；65 文件 npm TGZ 在独立安装后验证分包、浏览器与 Node WS 及采集导出和 NodeNext/Bundler 类型，未发布 npm 或做真机验收 |
| 2026-11-04 | 共享版本回归 | Python 0.4.0 元数据与锁定依赖检查通过，69 项 Python 回归测试通过；Python 产品能力范围保持原样 |
| 2026-11-04 | 0.4.0 发布文档准备 | 客户安装命令固定到 0.4.0，移除当前版本的本地修订提示，保留整包手套显式入口、双端同版本与实物验收边界；最终打包与注册表发布结果另行记录 |
| 2026-11-04 | 0.4.0 正式发布与消费验证 | 源码提交 `50d0956c192c892f7bd701cbdde8e22bb0ae0b4b` 与 `sdk-v0.4.0` 标签已推送；npm 0.4.0 / latest 可用。完整本地发布门禁通过，公开注册表独立安装及 SHA-512 比对通过；最终 TGZ 为 118542 字节，SHA-256 为 `7adbe50638e965ab86b27263211f7aee752cecd82b44bcdb56bd88461ad8f024` |
| 2026-11-13 | 分包手套串口自动发现与两种连接方式 | 新增 Node scanProductPorts 基础 API，识别 packetType 1=左/2=右；readProduct 内部复用扫描，保留手动 path+side 和原五函数。补充逐口报告、取消与清理、歧义处理、类型及接入文档；源码新增尚未发布 npm 或完成真机验收 |
| 2026-11-13 | Python 版产品与五步能力 | Python 包实现五种产品协议与分区、分包手套自动发现与手动直连、回调与有限重连、五个快速函数、同端口 WS/HTTP 服务、SQLite 录制与导出、流客户端、后端客户端、全部线序与调色板；仅用标准库，授权模块未改动。与 JS 的解析对照、双向 WS 互通和录制目录互读均通过；未发布、未做真机验收 |
| 2026-11-13 | Python 审查修复与 0.6.0 PyPI 发布准备 | 修复审查发现的 1 项高危、4 项中等和 10 项低风险问题并补回归测试；版本升至 0.6.0，完成 PyPI 元数据、安装文档与发布流程。上传 TestPyPI / PyPI 由维护者手动执行，结果另行记录；仍未做真机验收 |
| 2026-11-17 | Node 触觉足底原始数据接入 | `footVideo/foot` 支持左右脚 3/4 识别、手动与自动取数、原始 ADC/IMU/完整分包保留及 WS/SQLite/导出；新增原始 JSONL 示例与类型回归，Python 产品实现不变，尚未发布或真机验收 |
| 2026-11-17 | 触觉足底本地验证与交付 | 326 项 JS（含 19 项足底）、228 项 Python 回归、25 项发布工具测试及 TypeScript 通过；68 文件 npm 本地构建在独立项目验证左右脚原包、WS/SQLite/CSV/JSONL 与 NodeNext/Bundler 类型。未连接真实硬件，未发布 npm |
| 2026-11-17 | SDK 0.7.0 发布准备 | 统一版本元数据、npm 安装说明、足底协议与 API 文档，并登记官网文档目录；准备生成和验证新版本制品。Python 只同步元数据，不新增足底或发布 PyPI；npm 远端结果另行记录 |
| 2026-11-17 | SDK 0.7.0 完整门禁 | 330项JavaScript、25项发布工具、228项Python回归、TypeScript以及ZIP/npm独立客户安装验证通过；制品仍为本地待发布版本，npm发布和官方注册表消费结果另行记录，尚未连接真实硬件 |

## 9. 更新日志

| 日期 | 变更类型 | 描述 |
| --- | --- | --- |
| 2026-11-17 | 新增功能 | Node 新增触觉足底 `footVideo/foot`、便捷连接与发现类型；保留原 ADC、IMU、完整分包，经 WS 与录制导出不改原值，补原始 JSONL 示例与协议文档。未发布或真机验收 |
| 2026-11-17 | 配置变更 | npm 浏览器条件入口为新增 Node 便捷函数保留运行环境拒绝；客户安装验证按实际导出检测足底能力，兼容既有注册表版本并覆盖完整原包及安装后的类型推导 |
| 2026-11-17 | 文档更新 | 准备0.7.0 npm版本，当前安装指引统一至0.7.0，补足底Node/Web API参考与独立目录页；保留0.4/0.5/0.6历史事实和原未发布记录，Python仅同步版本元数据，尚无本次远端发布结果 |
| 2026-11-17 | 文档更新 | 完整门禁通过后补齐串口、Node及基础文档的足底自动发现说明和Python能力边界；记录330/25/228项回归及ZIP/npm消费验证结果，文档变动后重新生成交付ZIP，不将本地通过记作远端发布 |
| 2026-10-30 | 优化重构 | 按决定直接替换原主线 SDK，保留旧标签与历史；建立五步 SDK 和官网的独立仓库边界 |
| 2026-10-30 | 文档更新 | 更新根目录安装与发布说明，明确包身份、旧接口和数据库的迁移边界 |
| 2026-10-30 | 优化重构 | 增加 npm 精简安装包、受控打包与发布附件；文档区分客户安装和源码维护，说明注册表尚未发布及压缩的保护边界 |
| 2026-10-30 | 文档更新 | 新增安装 SDK 导航，统一官网命令安装、免登记下载与密钥另行申请；保留源码 ZIP 示例的相对路径兼容 |
| 2026-11-03 | 优化重构 | 整理源码、示例、文档和启动器，更新构建、交付映射及官网读取路径；五个函数及授权、采集语义不变 |
| 2026-11-03 | 配置变更 | 分离源码与发布包权限，增加发布后注册表消费检查；README、快速接入、基础 API 和 AI 说明采用 npm install shroom-sdk，发布指南补充登录、2FA、预览及制品发布步骤 |
| 2026-11-03 | 新增功能 | 0.2.0 移植 Node 串口有限重连，新增可配置重试与状态订阅；更新搜索串口、五步接入、基础 API 和 AI 文档，明确首次失败、手动关闭、授权、解析及录制恢复边界 |
| 2026-11-03 | 修复缺陷 | 发布制品 CLI 测试使用独立临时源码根目录，并验证版本不匹配仍被拒绝；发布校验规则保持不变 |
| 2026-11-04 | 新增功能 | 增加 humanBody/body 与 jqInsole/insole 适配器和来源文档；人体保留 1024 扫描/400 映射点，鞋垫保留双协议 ADC、112 真实点和 IMU；resolveProfile 与类型扩展不改变五函数，明确 0.3.0 未发布及真机验证边界 |
| 2026-11-04 | 验证完成 | 0.3.0 完整 SDK 门禁通过，含合成新产品的经典脚本和五步 WS/SQLite/HTTP 链路、客户 ZIP/TGZ 安装与 NodeNext/Bundler 类型解析；未执行远端发布或实机验收 |
| 2026-11-04 | 文档更新 | 准备正式0.3.0交付说明，更新npm固定版本命令并移除示例中的开发版限制提示；未改变协议、五函数或产品运行逻辑 |
| 2026-11-04 | 新增功能 | 补充分包手套适配器与明确的分包/整包类型边界，默认 glove/connectGlove 改分包；原五函数不变，整包需显式产品 ID，0.4.0 尚未发布与真机验收 |
| 2026-11-04 | 文档更新 | 修正分包类型字节与实物手侧的关系，明确单手单串口、显式左右手线序和无自动双手路由，并在文档目录登记手套协议页 |
| 2026-11-04 | 验证完成 | 0.4.0 分包解析、整包兼容、默认入口、模拟源、五步 WS/SQLite/HTTP 链路和独立 npm 安装通过；原五函数导出不变 |
| 2026-11-04 | 文档更新 | 准备 0.4.0 客户交付说明，统一 npm 固定版本与 TGZ 安装示例，保留协议迁移提示，并修正点位表元数据与分包适配器的关系；未改变运行代码或五函数 |
| 2026-11-04 | 版本发布 | 推送 SDK 0.4.0 源码与标签，发布已验证的精简 TGZ；从官方注册表重新安装并核对完整性，确认分包手套、五步流程、WS/SQLite/导出与 NodeNext/Bundler 类型可用 |
| 2026-11-13 | 新增功能 | 补充分包手套左右手类型语义和 Node 串口自动发现，以产品 discovery 钩子扩展；公开扫描与五步取数共用，保持手动直连、原路径有限重连和整包兼容边界。更新架构、协议、串口、五步与 AI 文档，不覆盖已发布 0.4.0 制品 |
| 2026-11-13 | 新增功能 | 在 `python/` 内移植 JavaScript SDK 的非浏览器能力：产品适配器与自动发现、产品连接与重连、串口预约、WS 服务与客户端、SQLite 录制、五函数、后端客户端、线序与调色板；新增对照与互通测试、三个示例，重写 Python 文档并修正各文档中关于 Python 能力的说明。JavaScript 运行代码、版本号与发布脚本未改动 |
| 2026-11-13 | 修复缺陷 | 按独立代码审查修正 Python 数据服务与连接层的 15 项问题：未读取的请求正文可被当作后续请求（可绕过来源与 Host 校验）、网络路径上的录制无法导出、下载中断与建连失败的错误类型、授权失效时关闭卡顿、关闭码丢失及若干并发与资源边界；每项都有回归测试 |
| 2026-11-13 | 配置变更 | 升版至 0.6.0；Python 包补充 PyPI 元数据（许可、链接、分类）与 pip 安装说明，发布指南新增 TestPyPI → PyPI 的手动流程。未新增 CI 发布步骤，npm 包未重新发布 |
| 2026-11-16 | 修复缺陷 | 修正三处只存在于 Python 测试中的时序问题，SDK 运行代码与 0.6.0 安装包内容不变：互通测试的 Node 辅助脚本在 macOS / Linux 上未等输出写完就退出，超过管道缓冲区的 JSON 被截断；“异常退出后恢复录制”测试绕过数据库锁关闭了写入线程仍在使用的连接，偶发断言失败或解释器崩溃，现改为持锁切断并在切断后统计已提交帧数；“标签校验”测试假定先后两段录制的开始时间不在同一毫秒，在落盘快的机器上偶发失败，现等时钟前进后再开始第二段。录制器自身的关闭路径始终持锁并先排空队列，不受影响；历史列表在开始时间相同时保持插入顺序，与 JavaScript SDK 一致 |

## 10. 原 SDK 历史记录

以下记录原样保留自替换前的架构文档，对应 `shroom-backend-sdk` 与旧 `src/`、`UI/` 布局。当前代码以本文第 1–9 节及当前 API 文档为准。

## 更新日志

| 日期 | 变更类型 | 说明 |
| :--- | :--- | :--- |
| 2026-08-11 | 新增功能 | 接入 `UI/qxui` React 组件，移除组件中的项目别名依赖，并新增 UI 文档展示页 |
| 2026-08-11 | 新增功能 | 接入 `UI/shroomui` 基础组件库，补全入口导出、SCSS 依赖说明和组件文档 |
| 2026-08-11 | 文档更新 | 将 VitePress 侧边栏拆为开始、后端与串口、UI 组件、API Reference 四个二级分组，并扩展 UI 组件展示页 |
| 2026-08-11 | 文档更新 | 将 17 个 UI 组件拆为独立页面，新增 Vue-to-React 实时示例桥接，并提供播放、滑块、抽屉、弹窗等可交互演示 |
| 2026-08-11 | 修复缺陷 | 修复 `qxui` 独立构建时的 React runtime、styled-components v6 导入和原项目根字号依赖问题，替换遗留 iconfont 图标 |
| 2026-08-11 | 新增功能 | 将 `TerrainMapPage` 提取为 `UI/render` 矩阵渲染 SDK，新增 Three.js 地形、矩阵预览、插值、平滑、配色和视角控制 |
| 2026-08-11 | 修复缺陷 | `TerrainMap` 网格恢复源项目的基础矩阵横纵线逻辑，只在有效压力区域生成线段，移除插值三角面产生的密集对角线 |
| 2026-08-11 | 发布优化 | 排除 `UI` 子项目中的 `node_modules`、`dist` 和 Vite 缓存，避免本地安装包递归包含开发依赖和文档构建产物 |
| 2026-08-11 | 类型与健壮性 | 为 `UI/render` 增加公开类型入口，并为网格算法的无效数值输入提供有限默认值 |
| 2026-08-11 | 新增功能 | 将 `numMatrix`、`pointGrid`、`handPoints`、`webglHeatmap`、`blobHeatmap` 整合到 `UI/frontend/renderers`，提供注册表和兼容导出 |
| 2026-08-11 | 文档更新 | 为五套矩阵渲染器新增独立中文页面、真实动态矩阵示例、控制项和二级导航 |
| 2026-08-11 | 修复缺陷 | 将点阵和手部渲染器迁移到 Three.js 当前 `outputColorSpace` API，消除旧颜色编码接口警告 |
| 2026-08-11 | 发布优化 | 矩阵渲染器改为跟随宿主容器尺寸，手模改为显式可选资源，并将 Three.js 最低版本收紧到 r152 |
| 2026-08-11 | 发布优化 | 根 npm 包仅发布运行源文件、示例和入口文档，不再包含 VitePress 站点与实施计划 |
| 2026-08-12 | 文档交互 | 五个矩阵渲染示例新增 `params` JSON 编辑器，输入帧统一为从 1 开始的连续递增数组 |
| 2026-08-12 | 文档交互 | `TerrainMap` 接入共享参数编辑器，六个矩阵组件示例补全常用公开参数并同步参数与演示输入 |
| 2026-08-14 | 修复缺陷 | 缩短矩阵示例参数区和渲染舞台，修复数字矩阵浮层、固定画布裁切及移动端非正方形问题 |
| 2026-08-14 | 文档交互 | 矩阵参数编辑器默认折叠，PointGrid 新增点高度和色阶上限参数及实时调节控件 |
| 2026-08-14 | 修复缺陷 | 统一 NumMatrix 与 PointGrid 的常规矩阵 row-major 方向，移除默认旋转和行列转置，并提供 `filterMin: 0` 原值展示配置 |
| 2026-08-20 | 新增功能 | 五套矩阵渲染器新增声明式 `frame` / `backFrame` prop，命令式 ref 通路保持不变 |
| 2026-08-20 | 文档更新 | `API_REFERENCE` 重写为参数级参考，补齐构造 options、方法签名、返回结构和已知限制 |
| 2026-08-20 | 发布优化 | 根包新增 `exports` 映射，前端短路径由 7 段降为 2 段，旧深路径全量保留兼容 |
| 2026-08-20 | 文档更新 | 补打包器配置（Vite / webpack）、peer deps 分组安装、五个渲染器参数表与静默钳制规则 |
| 2026-08-21 | 新增功能 | `PointGridRenderer` 支持按空间位置渲染：稀疏实测坐标表自动插值，Z 作为点的基础高度 |
| 2026-08-25 | 修复缺陷 | 补回 `jqbed` / `handSinglePoint` 内置线序，11 个 profile 全部可解析（此前 3 个首帧必崩） |
| 2026-08-25 | 修复缺陷 | `handleRawFrame` 分阶段捕获异常，`error` 无监听者时降级提示，多通道打开失败回滚已开端口 |
| 2026-08-25 | 测试补齐 | `src/` 从零测试到 69 项，覆盖解析、线序、清零、存储、回放与会话容错 |
| 2026-08-25 | 手套 SDK | 明确四个产品 Profile，补齐分包/整包组帧、压力与 IMU 语义、左右手 Mapping 和 `connectGlove()` |
| 2026-08-25 | 手套校验 | 新增生产协议形态 fixture，覆盖左右交错组帧、缺首包、长度校验、IMU float32LE 和 256→147/195→1024 Mapping |
| 2026-08-25 | 手套点位表 | 录入左右手结构化 Mapping，扁平线序改为自动生成并增加范围、重复点和布局校验 |
| 2026-08-27 | 采集 SDK | 参考 `E:\shroom1` 抽取按通道限频、全帧模式、批量事务、停止 flush、磁盘保护和采集错误状态 |
| 2026-08-27 | 串口 SDK | 参考 `E:\shroom` 补齐 `SerialManager`、自动波特率、稳定重试、连接锁、断流状态、重扫、写串口和统一错误码 |
| 2026-08-28 | 后端能力闭环 | 补齐存储分页/筛选/删除、可控回放、CSV 算法列和简单算法通道，六项能力使用统一标准帧 |
| 2026-08-28 | 文档更新 | 新增 `Backend Capabilities` 页面和串口、采集、存储、回放、CSV、算法通道二级导航 |

## 项目进度

| 日期 | 完成项 | 说明 |
| :--- | :--- | :--- |
| 2026-07-08 | 后端 SDK 根入口 | 提供 `BackendSdkClient`、`ShroomSensorSDK`、协议、采集、回放、导出等能力 |
| 2026-07-08 | 本地串口 demo | 提供真实串口和 mock 模式验证链路 |
| 2026-07-08 | VitePress 文档 | 提供使用文档、API Reference、后端链路和串口链路 |
| 2026-08-11 | 动态报告 UI 组件 | 新增动态报告、回放控制、指标展示和热力图占位展示组件 |
| 2026-08-11 | 基础 UI 组件库 | 新增 `AsyncState`、`ChartPanel`、`Drawer`、`ExportDialog`、`MetricValue`、`Select`、`SettingControlRow`、`ToolbarAction` 等组件入口 |
| 2026-08-11 | UI 文档分组展示 | UI 文档按 `qxui` 和 `shroomui` 展示全部组件，并在侧边栏提供组件级锚点导航 |
| 2026-08-11 | UI 独立组件页 | 为全部 17 个 UI 组件提供独立中文页面、实时交互示例、最小用法和 Props/行为说明 |
| 2026-08-11 | 矩阵渲染 SDK | 新增 `TerrainMap`、矩阵归一化、高斯平滑、双三次插值和配色算法导出，并提供独立交互文档页 |
| 2026-08-11 | 地形网格一致性 | 新增可测试的 `buildTerrainWireSegments`，网格密度、连接方向和有效值阈值与原 `TerrainMapPage` 保持一致 |
| 2026-08-11 | 五套矩阵渲染器 SDK | 完成前端子包边界、core/react 分层、按需注册、旧路径兼容和 pnpm 发布文件约束 |
| 2026-08-11 | 矩阵渲染器交互文档 | 在矩阵渲染分栏下新增五个组件级页面，可直接查看动态效果并操作后端、视角和色阶 |
| 2026-08-11 | 外部宿主适配 | 五套矩阵渲染器完成宿主尺寸约束、可选模型加载和发布依赖边界核对 |
| 2026-08-12 | 渲染参数在线调试 | 文档页支持修改、应用和重置组件 `params`，并根据矩阵尺寸重建递增演示帧 |
| 2026-08-12 | TerrainMap 在线调参 | 文档页支持在线修改组件 props 和 `TerrainMapOptions`，输入数组随 `rows * columns` 自动重建 |
| 2026-08-14 | 渲染文档响应式适配 | 六个矩阵渲染页在桌面和移动视口中完整展示，数字矩阵保持正方形且不再裁切 |
| 2026-08-14 | PointGrid 显示调参 | `heightScale` 和 `colorMax` 可通过 SDK 参数或文档滑块控制，并兼容旧项目默认值 |
| 2026-08-14 | 矩阵方向一致性 | 常规矩阵输入按 `data[row * cols + col]` 原位置展示，NumMatrix 与 PointGrid 不再隐式改变方向 |
| 2026-08-14 | 全渲染方向与热图色阶 | 修正 PointGrid 上下方向和 BlobHeatmap 非方阵转置，关闭 WebglHeatmap 默认镜像，并按 1..1024 示例范围校准两种热力图色阶与点半径 |
| 2026-08-20 | 声明式帧入口 | 五个渲染器接入 `frame` prop，接入代码从「建 ref + useEffect + `sitData({ wsPointData })`」降为一个 prop |
| 2026-08-20 | 后端参数参考 | `API_REFERENCE` 覆盖全部根导出、构造 options、方法参数与返回结构，并标注存储、导出、实时通道的已知限制 |
| 2026-08-20 | 前端接入面收口 | 根包 `exports` 打通短路径与类型入口，`tests/package-exports.test.mjs` 锁死全部已文档化旧路径 |
| 2026-08-20 | 渲染参数文档补齐 | numMatrix 由 6 项补到 60 余项（含 `canvas2d` / `webgl` 嵌套对象），handPoints 由 4 项补到 19 项，五页均写明取值范围钳制 |
| 2026-08-21 | 空间位置点阵 | `core/coordinateGrid.js` 提供稀疏坐标表的插值与补边，点阵渲染器新增 `sparsePoints`，曲面传感器可按实测点位与自身起伏成形 |
| 2026-08-25 | 数据链路可用性 | 内置线序补回、帧处理全程容错、端口回滚；客户第一步「数据联通」不再因单帧异常终止进程 |
| 2026-08-25 | 手套最小链路 | `connectGlove()` 完成查口/连接/组帧/解析/左右手 Mapping，帧可直接送入 32×32 渲染器或采集链路 |
| 2026-08-25 | 左右手 Mapping | 五指、指腹、手掌点位进入 SDK 单一数据源，外部项目可通过 `GLOVE_HAND_MAPPING` 读取原始分组 |
| 2026-08-27 | 稳定采集链路 | `CaptureController` 统一管理采集频率、批次和统计，SQLite/内存 Store 对齐 `insertFrames`，会话关闭不再遗留未落库帧 |
| 2026-08-27 | 串口管理闭环 | 同时支持手动与一键连接，聚合所有串口的最新数据、在线/断流状态，并打通写入、重连、重扫和错误处理 |
| 2026-08-28 | 后端六项能力 | 串口、采集、存储、回放、CSV 和简单算法通道均提供根入口、统一数据流、测试与本地网页文档 |

### 0.5.0 发布准备

| 日期 | 变更类型 | 说明 |
| --- | --- | --- |
| 2026-11-13 | 配置变更 | 升版至 0.5.0，同步运行时、包元数据和安装/AI 文档；保留历史版本及手动兼容，准备执行完整发布门禁。 |

| 完成日期 | 完成的功能/工作 | 简要说明 |
| --- | --- | --- |
| 2026-11-13 | 0.5.0 发布准备 | 手动/自动串口接入说明与版本已同步，正式发布和消费验证另行记录。 |

### 0.5.0 正式发布与验收

| 完成日期 | 完成的功能/工作 | 简要说明 |
| --- | --- | --- |
| 2026-11-13 | SDK 0.5.0 正式发布 | 源码 `f11527924c7324f3d595e66cb2548faef87069d8` 与 sdk-v0.5.0 标签已推送；后续 `9f8427f` 补充扫描 API 中文目录。npm 0.5.0 与 latest 已可安装。 |
| 2026-11-13 | 发布消费验证 | 307 项 JS、25 项发布工具、69 项 Python 回归及 TypeScript 通过；客户 ZIP/npm 安装、WS/SQLite/CSV/JSONL 与官方注册表 SHA-512 比对通过。新自动扫描尚未真机验收。 |

| 日期 | 变更类型 | 说明 |
| --- | --- | --- |
| 2026-11-13 | 版本发布 | 发布 67 文件、123503 字节的精简 npm 包；SHA-256 为 `21b2c330dcf1957b7b7093d4828c63b633c9adb62555503b4daf22dc14ef0f44`。官网使用同字节制品，五个快速函数保持不变。 |

### 0.7.1 触觉足底原始测点修正

| 完成日期 | 完成的功能/工作 | 简要说明 |
| --- | --- | --- |
| 2026-11-17 | 触觉足底60点原始ADC | 按既有左右脚各自点位表输出60点，6列×10行；完整原包和IMU仍保留，类型与自动识别不变，准备发布0.7.1 |

| 日期 | 变更类型 | 说明 |
| --- | --- | --- |
| 2026-11-17 | 修复缺陷 | 修正足底顶层raw/pressure/pressureMatrix从扫描256通道到60个有效测点原值，同步WS验证、类型、例程与文档 |

| 2026-11-17 | 0.7.1 本地发布门禁 | 332项JS、25项发布工具、228项Python回归、类型、ZIP解压安装、真实npm客户安装、左右脚60点golden映射和WS/SQLite/导出通过；仍未连接真实硬件 |
