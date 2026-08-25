# Shroom SDK 接入开发者旅程图

分析日期：2026-08-20 ｜ 分析对象：`shroom-backend-sdk@0.2.0` ｜ 方法：Customer Journey Map

聚焦两个问题：**呈现形式**（包怎么被看见、入口怎么组织、命名和文档结构）与**用法简易性**（从零到跑通、到接入、到排障的摩擦）。

结论先行：**前端渲染子包已达可交付水准，后端 `src/` 停在"能跑通的抽取结果"。整体最大的问题不是能力缺失，而是"做好的东西没有被接出来"**——`UI/frontend` 自带一套精心设计的 exports 映射，但根包没有 `exports` 字段，外部使用方享受不到；11 个内置 profile 里有 3 个首帧必崩，而这一点直到本次分析才被写进文档。

---

## 一、Persona

内部 SDK 没有公开市场，旅程的主角只有一类人，且高度具体：

**"接了个压力垫演示项目的前端/全栈开发"**

| 维度 | 描述 |
| :--- | :--- |
| 背景 | 熟悉 React + Node，**不熟悉** `E:\shroom1` 主项目内部结构 |
| 触发场景 | 接到一个实验室 demo 或客户 POC，需要"读传感器 → 显示热力图 → 导出数据" |
| JTBD | 当我要做一个压力传感演示时，我想直接复用已经验证过的读取和渲染能力，这样我就不用重新实现协议解析和 WebGL 热力图 |
| 成功标准 | 一天内出一个能给客户看的界面 |
| 关键约束 | 没有人可以问（原作者在忙主项目）；只能靠文档和代码自解释 |
| 技术栈 | Vite + React 18，多半开 TypeScript |

这个 persona 决定了后面所有判断的权重：**他不会读源码注释，只会读文档、跑 demo、看报错。** 凡是需要"进 SDK 源码才能发现"的信息，对他等于不存在。

---

## 二、旅程阶段总览

内部 SDK 没有 Awareness/购买环节，标准七段压缩为六段：

| # | 阶段 | 本项目对应 | 时长 |
| :--- | :--- | :--- | :--- |
| 1 | 发现与评估 | 被告知"用 ShroomSDK"，翻 README / 文档站 | 10 分钟 |
| 2 | 安装 | `pnpm add file:E:\ShroomSDK` | 5 分钟 |
| 3 | 首次跑通 ★ | `pnpm sdk:serial-demo -- --mock` | **2 分钟（最佳段）** |
| 4 | 接入自己的项目 | 三条支线：后端链路 / 串口链路 / 前端渲染器 | 半天～数天 |
| 5 | 调参与排障 | 改 params、查为什么不显示、查为什么崩 | 持续 |
| 6 | 复用与推荐 | 下一个项目还用不用 | — |

---

## 三、逐阶段旅程图

### 阶段 1 — 发现与评估

| 项 | 内容 |
| :--- | :--- |
| **触点** | `README.md`、文档站首页 [docs/index.md](../../index.md) |
| **动作** | 扫一眼包名和功能列表，判断"这东西能不能解决我的问题" |
| **心理** | "shroom-backend-sdk……backend，那前端热力图得自己写？" |
| **情绪** | 😐 中性偏低 |

**摩擦点**

1. **包名与实际内容严重不符。** 名字叫 `shroom-backend-sdk`，但 207 个跟踪文件里 `UI/` 占 131 个（63%），`src/` 只有 19 个文件 / 1934 行。包里有 6 个矩阵渲染器和 17 个 UI 组件，**名字完全没有透露**。一个只需要热力图组件的人，很可能看一眼名字就走了。
2. **README 的功能清单里"Frontend UI Components"排在最后**，且只列了 `UI/qxui` / `UI/shroomui` / `UI/render` 三个，**没提 `UI/frontend` 那五个矩阵渲染器**——恰恰是投入最大、质量最高的部分。
3. 文档站首页的 features 卡片同样漏掉了 `UI/frontend`。

**机会**

- 包名改为 `shroom-sdk`，或至少在 README 首屏一句话写明"含后端串口链路 + 6 个矩阵渲染器 + 17 个 UI 组件"。
- README 的组件清单补上五个矩阵渲染器，配一张截图或 GIF。视觉产物不放截图，等于让人靠文字想象热力图长什么样。

---

### 阶段 2 — 安装

| 项 | 内容 |
| :--- | :--- |
| **触点** | [SDK_GUIDE.md](../../SDK_GUIDE.md) 第 1 节、[UI_COMPONENTS.md](../../UI_COMPONENTS.md) 安装节 |
| **动作** | 复制 `pnpm add file:E:\ShroomSDK` |
| **心理** | "这是个写死的绝对路径？我机器上不在 E 盘。" |
| **情绪** | 😕 轻度困惑 |

**摩擦点**

1. **安装命令是硬编码的 Windows 绝对路径** `file:E:\ShroomSDK`，出现在 README、SDK_GUIDE、UI_COMPONENTS、docs/index 四处。换台机器、换个盘符、换 macOS 都不成立。
2. **`package.json` 缺 5 个标准字段**：实测 `types`、`exports`、`license`、`repository`、`engines` 全缺。
   - 缺 `license` + `repository`：无法判断能不能用、去哪提 issue。
   - 缺 `engines`：不知道 Node 版本要求（`better-sqlite3` 有原生编译要求，这一点很关键）。
3. **UI peer deps 是一条 8 个包的长命令**，但文档没说清"我只用热力图，要不要装 antd/mobx/i18next"。实际上 `UI/frontend` 的五个渲染器只需要 `react` + `react-dom` + `three`，其余 5 个包是 `qxui`/`shroomui` 才用的。文档把它们混在一条命令里，等于强迫只要热力图的人装 8 个包。

**机会**

- 用相对路径或 npm registry / git URL；至少写成 `pnpm add file:<你的 SDK 路径>`。
- 补齐 `license` / `repository` / `engines`（含 `better-sqlite3` 的 Node ABI 说明）。
- peer deps 按"我要用哪一块"分成三组命令：仅后端（0 个）、仅矩阵渲染器（3 个）、完整 UI（8 个）。

---

### 阶段 3 — 首次跑通 ★ Aha Moment

| 项 | 内容 |
| :--- | :--- |
| **触点** | `pnpm sdk:serial-demo -- --mock` |
| **动作** | 无硬件情况下跑通整条链路 |
| **心理** | "居然真的出帧了，而且不用接设备。" |
| **情绪** | 😀 **全程最高点** |

**这是整个 SDK 设计得最好的一处。** 实测 2 秒内输出解析后的帧和采集记录，退出码 0。无硬件也能验证 `SerialPort → DelimiterParser → ProtocolRegistry → ZeroCalibrator → CaptureStore` 全链路——这是 aha moment，也是让人愿意继续投入的关键。

**摩擦点**

1. **首屏输出就带一个 `undefined`。** `examples/serial-chain-demo.js:115` 读 `frame.stats?.nonZeroCount`，但 `stats` 实际的键是 `max/min/total/mean/point/length`——**没有 `nonZeroCount`**。所以新人看到的第一屏是：

   ```
   [serial-demo] frame: { channel: 'sit', max: 63, nonZeroCount: undefined, ... }
   ```

   一行代码的 bug，但它出现在**第一印象的正中央**。看到 `undefined` 的人会开始怀疑整个包的成熟度。**这是全清单里修复成本最低、心理收益最高的一条。**

2. **后端链路 demo 失败时不给任何线索。** 主项目没跑时输出仅 `[sdk-demo] failed: fetch failed`，不提示"是否已启动主项目 / 默认端口 19245 对不对 / 用 `--http-base-url` 改地址"。

**机会**

- 修 `nonZeroCount` → `point`（或在 stats 里补一个别名）。
- 后端 demo 的 catch 里按错误类型给排查提示。
- 把 mock demo 提到 README 首屏第一条命令——它是这个包最好的自证，现在被埋在第三节。

---

### 阶段 4 — 接入自己的项目

三条支线，体验差异极大，分开评。

#### 支线 A — 前端矩阵渲染器 😀 → 😐

| 项 | 内容 |
| :--- | :--- |
| **触点** | 5 个组件文档页、`UiComponentDemo` 实时示例 |
| **情绪** | 😀 看文档时很高 → 😐 真接入时回落 |

**优势（这一段是全项目的标杆）**

- **23 个组件独立文档页 + 可交互实时示例 + 在线参数编辑器。** 能直接在文档站上改 JSON 看效果，这是很多商业 SDK 都没有的。
- **参数体系设计讲究**：`normalize*Params` 全带默认值、`PARAM_RANGES` 钳制、非法输入回落而不抛错。
- 本轮新增的声明式 `frame` prop 把接入代码从 6 行降到 1 行。

**摩擦点**

1. ~~**导入路径 7 段长，还要写 `.jsx` 扩展名**~~ ✅ **已修复（2026-08-20）**

   分析时的写法：

   ```js
   import NumMatrixRenderer from 'shroom-backend-sdk/UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx'
   ```

   讽刺的是 `UI/frontend/package.json` 里**已经写好了一套 27 条精心设计的 exports 映射**（`@shroom/frontend/renderers/numMatrix/core` 这种），但根 `package.json` **没有 `exports` 字段**，这套映射对外部使用方完全不可见。**好东西做了但没接出来——这是呈现形式上最大的一处浪费。**

   现已给根包补上 exports，短路径为 `shroom-backend-sdk/renderers/numMatrix`（7 段 → 2 段），旧深路径保留兼容，由 `tests/package-exports.test.mjs` 锁死。

2. ~~**包里直接发布 `.jsx` / `.scss` / `.png` 源文件，文档没有一行打包器配置示例。**~~ ✅ **已修复（2026-08-20）**

   实测发布内容含 `import '../../../styles/canvas.css'`、`import circleUrl from '../../shared/three/circle.png'`、10 处 `import './index.scss'`。Vite 默认不转译 `node_modules` 里的 JSX，`.scss` 也需要消费方装 `sass`。文档站里搜不到 `optimizeDeps` / `esbuild include` 的任何配置样例——**新使用方第一次 `import` 就可能卡住，且报错信息指向 node_modules 内部，很难自查。**

   现已在 `UI_COMPONENTS.md` 补「打包器配置」一节（Vite + webpack 两套），并写明典型报错长什么样。

3. **参数文档覆盖率约 40%**，缺的正是最难猜的：

   | 渲染器 | 实际顶层 params | 文档"关键参数"表 | 覆盖 |
   | :--- | ---: | ---: | ---: |
   | numMatrix | 21 | 6 | **29%** |
   | handPoints | 19 | 4 | **21%** |
   | webglHeatmap | 15 | 7 | 47% |
   | blobHeatmap | 10 | 6 | 60% |
   | pointGrid | 8 | 8 | 100%（本轮补齐） |

   numMatrix 漏掉的是 `canvas2d` / `webgl` 两个子对象（各带 15~20 个键）和 `cameraControls` / `pressureRedistribution` / `chartWindow` / `sharedTuningKey`。

4. **命令式方法名是原项目内部黑话**：`bthClickHandle`、`changeWsData147`、`sitData({ wsPointData })`。`bthClickHandle` 在 `UI/frontend/core/contract.js` 里记录有 62 个调用点，是全仓最密的方法——**但一个外部使用方完全无法从名字猜出它是"收峰值帧并返回 canvas 供导出"。**

#### 支线 B — 本地串口链路 😀 → 😱

| 项 | 内容 |
| :--- | :--- |
| **触点** | [SERIAL_CHAIN.md](../../SERIAL_CHAIN.md)、真实设备 |
| **情绪** | 😀 mock 跑通后信心很足 → 😱 换真实 profile 后进程直接退出 |

**这是整个旅程唯一的"灾难级"摩擦，也是最可能的流失点。**

**摩擦点**

1. ~~**11 个内置 profile 里有 3 个在第一帧到达时必崩。**~~ ✅ **已修复（2026-08-25）**

   分析时：`createProjectLineOrderRegistry()` 不注册任何内置线序（`PROJECT_LINE_ORDER_NAMES` 实测为 `[]`），而 `hand` / `handSinglePoint` / `smallBed12B` 三个 profile 都声明了 `lineOrder`：

   ```
   hand            → line order "jqbed" is not registered
   handSinglePoint → line order "handSinglePoint" is not registered
   smallBed12B     → line order "jqbed" is not registered
   ```

   更糟的是抛点在 `handleRawFrame` 里、串口 `data` 回调中，**没有 try/catch，会终止整个进程**。用户的体验是："我按文档从 profile 列表里选了 `hand`，程序没有报错提示，直接死了。"

   **根因**：上游版本（`shroom1/sdk/src/line/projectLineOrders.js`）从主项目根目录 `require('../../../openWeb')` 动态加载线序，抽成独立包时这条 require 指向包外被去掉了，profile 里的声明却留着。现已把 `jqbed` / `handSinglePoint` 逐字搬进 `src/line/builtinLineOrders.js`，11 个 profile 全部可解析，并有断言守着「声明了线序名就必须注册实现」。

2. ~~**`session.on('error')` 不挂就会崩进程**~~ ✅ **已修复（2026-08-25）**

   `error` 是 EventEmitter 保留事件名，没有监听者时 Node 直接抛。现在发之前先查监听者数量，没有时降级为 `console.error`，不崩进程也不静默吞掉。

3. **serialport 参数无法透传**：只有 `baudRate` 生效，`dataBits` / `stopBits` / `parity` / `rtscts` / `highWaterMark` 都传不进去。`bed4096` 跑 3,000,000 波特，这种速率上流控和缓冲是要调的——现在只能改 SDK 源码。**仍未修。**

4. ~~**多通道打开无回滚**~~ ✅ **已修复（2026-08-25）**：中途失败会先 `close()` 已打开的端口再抛。

#### 支线 C — 后端 HTTP/WS 链路 😐

| 项 | 内容 |
| :--- | :--- |
| **情绪** | 😐 能用，但不敢长跑 |

**摩擦点**

1. **无超时、无 `AbortSignal`、无自定义请求头**——后端不响应时请求永久挂住；需要鉴权时无处塞 token。
2. **WebSocket 无自动重连、无心跳、无退避**——断线即失联。实验室长时间采集必踩。

---

### 阶段 5 — 调参与排障

| 项 | 内容 |
| :--- | :--- |
| **触点** | 文档站参数表、控制台报错、SQLite 文件 |
| **心理** | "为什么没显示？是数据没到，还是参数不对，还是被过滤掉了？" |
| **情绪** | 😕 → 😠 |

**摩擦点**

1. ~~**静默钳制无提示**~~ ✅ **已修复（2026-08-20）**：五个渲染器页都写明了取值范围与钳制行为。
2. **静默丢帧**：`webglHeatmap` 丢弃短于 `minFrameLength`（默认 4096）的帧，`blobHeatmap` 丢弃空数组。已在两页写明并给出"画面全黑先查什么"，但**仍缺一页汇总的排障文档**——按现象组织才找得到。
3. **`src/` 里几乎没有 `console.*`**——纪律上是对的（库不该污染宿主输出）。唯一的例外是 `error` 事件无监听者时的降级提示。仍**没有可选的 debug 开关**，出问题时无从观察。
4. ~~**后端 `src/` 零测试**~~ ✅ **已修复（2026-08-25）**：新增 69 项覆盖协议解析、线序、清零、存储、回放、会话容错。SQLite 那 13 项在缺原生模块的环境按能力跳过并注明原因。
5. **CSV 中文表头无 BOM**，Excel 直接打开乱码；`矩阵数据` 一列占文件绝大部分且不可裁剪。
6. **采集只能增不能删**——`src/storage/` 全目录无任何 delete 接口，磁盘只涨不消。

---

### 阶段 6 — 复用与推荐

| 项 | 内容 |
| :--- | :--- |
| **心理** | "渲染器我肯定还用。串口那块……下次我可能自己写。" |
| **情绪** | 🙂 分裂 |

**摩擦点**

1. **版本号无法判断**：`package.json` 与 CHANGELOG 都停在 `0.2.0 / 2026-07-08`，而 ARCHITECTURE.md 的更新日志已排到 08-20 二十余条。**一个多月的功能推进版本号没动过**，使用方无法判断自己装到的是哪一版、要不要更新。
2. **两套变更记录已分叉**：CHANGELOG.md（9 行，停更）与 ARCHITECTURE.md 的更新日志表（占全文近半，持续更新）职责重叠且不同步。
3. **TS 项目零类型提示**：根包无 `types` 字段，`.d.ts` 全仓只有 2 个（都在 `UI/render`）。TS 使用方拿到的是 `any`。
4. **core 注释大量引用原项目内部**：`Home.jsx:2607-2609`、`page/home/util.js`、"55 个场景组件"、"959KB chunk"、方法调用次数统计表。作为迁移溯源有价值，但对"独立可复用包"的外部读者是纯噪音。

---

## 四、关键时刻

| 类型 | 位置 | 说明 |
| :--- | :--- | :--- |
| 🎯 **Aha Moment** | `pnpm sdk:serial-demo -- --mock` 出第一帧 | 2 秒、零硬件、全链路。设计得最好的一处 |
| ⚖️ **Moment of Truth 1** | 从 mock 切到真实设备、选 profile | 选中三个"毒 profile"之一 → 进程直接退出 |
| ⚖️ **Moment of Truth 2** | 第一次 `import` 渲染器 `.jsx` | 打包器未配置 → 报错指向 node_modules 内部 |
| 💀 **主流失点 A** | 串口链路选中 `hand` / `handSinglePoint` / `smallBed12B` | 无提示崩溃，且无测试可自证，多半判定"SDK 不可靠"转而自己写 |
| 💀 **主流失点 B** | TS 项目发现零类型 | 静默降级为 `any`，长期侵蚀信任 |
| 😀 **最高点** | 文档站参数编辑器实时调渲染效果 | 商业 SDK 水准 |

---

## 五、优先级改进建议

按 `影响 ÷ 成本` 排序。

### P0 — 阻断级（不修就会流失）

| # | 改进 | 成本 | 依据 |
| :--- | :--- | :--- | :--- |
| 1 | `handleRawFrame` 加 try/catch + `error` 事件兜底 | 极低 | 单点故障导致进程退出，主流失点 A |
| 2 | 补上 `jqbed` / `handSinglePoint` 线序实现（或从 profile 里摘掉这三个声明） | 中 | 11 个 profile 里 3 个不可用 |
| 3 | demo 的 `nonZeroCount` → `point` | **一行** | 第一印象正中央的 `undefined` |
| 4 | 给 `src/` 补最小测试（`parsers` / `stats` / `CaptureStore` / `ZeroCalibrator` 都是纯函数或本地 IO） | 中 | 无回归网＝无法自证修好了 |

### P1 — 高杠杆快赢（成本低、直接降低接入摩擦）

| # | 改进 | 成本 | 依据 |
| :--- | :--- | :--- | :--- |
| 5 | **根 `package.json` 加 `exports`**，把 `UI/frontend` 那套 27 条映射接出来 | 低 | 7 段导入路径 → 2 段；**已有资产未接出** |
| 6 | 文档补一段 Vite / webpack 配置示例（JSX + SCSS in node_modules） | 低 | Moment of Truth 2 |
| 7 | 补 `types` / `license` / `repository` / `engines` | 低 | 主流失点 B |
| 8 | 安装命令去掉硬编码 `E:\ShroomSDK` | 极低 | 四处文档全部不可移植 |
| 9 | peer deps 按"仅后端 / 仅渲染器 / 完整 UI"拆三组 | 极低 | 只要热力图的人现在要装 8 个包 |
| 10 | 版本号 + CHANGELOG 补上一个月的推进，与 ARCHITECTURE 日志合并为一处 | 低 | 使用方无法判断版本 |

### P2 — 结构性改善（成本较高、回报持久）

| # | 改进 | 成本 | 依据 |
| :--- | :--- | :--- | :--- |
| 11 | 补齐 numMatrix / handPoints 的参数文档（29% / 21% → 目标 90%） | 中 | 缺的正是最难猜的部分 |
| 12 | serialport 选项透传 + HTTP `timeout`/`headers` + WS 重连 | 中 | 支线 B/C 的共性缺口 |
| 13 | `queryFrames` 加分页/时间区间；补 `deleteCapture` | 中 | 长采集不可用、磁盘只增 |
| 14 | 命令式方法补语义化别名（`bthClickHandle` → `captureCanvas`），旧名保留 | 中 | 黑话方法名不可自解释 |
| 15 | README 补矩阵渲染器截图/GIF + 考虑改包名 | 低～中 | 视觉产物无视觉呈现；名字掩盖 63% 的内容 |
| 16 | 迁移溯源注释抽到 `MIGRATION.md`，core 注释只留设计理由 | 中 | 外部读者的纯噪音 |

---

## 六、一句话总结

**这个 SDK 的前端渲染层已经可以交付给外部团队，短板是"最后一公里的呈现"（`exports` 没接出来、打包器配置没写、参数文档缺 60%）；后端串口层的短板则是实打实的可靠性（3 个 profile 必崩、无 try/catch、零测试）。**

前者是把已有的好东西包装好，后者是把没做完的做完。按 `影响 ÷ 成本` 看，**P0-3（一行修 demo 的 `undefined`）、P1-5（加 `exports`）、P1-8（去掉硬编码路径）三条应当今天就做**——加起来不到一小时，却直接改善第一印象、接入成本和可移植性这三个最外层的触点。

---

### 建议的可视化

本文可作为 Miro / FigJam 泳道图的底稿：横轴六个阶段，纵轴四条泳道（触点 / 动作 / 情绪曲线 / 摩擦点），把「阶段 3 最高点 → 支线 B 断崖」这条情绪曲线画出来，比表格更有说服力。
