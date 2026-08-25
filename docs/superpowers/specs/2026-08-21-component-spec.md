# Shroom SDK 组件规约

版本：2026-08-21 ｜ 状态：**待审阅** ｜ 方法：从已建成的 22 个组件反向提取

这份规约**不是新发明的**。SDK 里已经有 22 个组件按三种（实际是四种）形态建成，本文把散在文件头注释、`shroomui/README.md`、结构测试里的隐含约定提炼成一份显式、可检查的文档。

读法：第一节是"新组件该用哪种形态"的判定表；第二到五节是每种形态的规约；第六节是**现状核对**——22 个组件对着规约校一遍，标出实测到的偏差。凡标 ⚠️ 的都是当前代码的真实状态，不是假设。

---

## 一、形态判定表

先回答"这个组件属于哪一类"，再去看对应章节。按顺序判，第一个命中即止。

| # | 判断 | 形态 | 目录 |
| :--- | :--- | :--- | :--- |
| 1 | 有可独立测试的**帧算法 / 布局算法 / 着色器**，且需要 WebGL / Canvas / Three.js | **A. core + react 分层** | `UI/frontend/renderers/<id>/` |
| 2 | 同上，但用 TypeScript 写 | **A′. TS 分层** | `UI/render/` |
| 3 | 承接**业务流程**（报告、回放、对比），需要 `observer` 订阅业务状态 | **C. 业务展示** | `UI/qxui/<Group>/` |
| 4 | 其余：纯展示，状态全走 props | **B. 基础组件** | `UI/shroomui/<Group>/` |

判定的分界线，用一句话说清：

- **A / A′ 的门槛是"有没有算法可以脱离 DOM 测"**。只要有，就必须拆 `core/`——这是 SDK 唯一能在裸 Node 里回归的部分，466 个测试里绝大多数来自这一层。没有算法的组件拆 core 只会得到一个空壳。
- **B / C 的分界线是"要不要 observer"**。B 不允许订阅任何外部状态；C 允许 `observer()` 包一层，但**仍然不许自己读 Store**——业务状态由 props 传入，`observer` 只负责让传进来的 observable 生效。

---

## 二、形态 A — core + react 分层

适用：矩阵渲染器。现有 5 个（`numMatrix`、`pointGrid`、`handPoints`、`webglHeatmap`、`blobHeatmap`）。

### 目录

```text
UI/frontend/renderers/<id>/
├─ core/
│  ├─ index.js          纯算法层总出口
│  ├─ params.js         normalize<Id>Params + PARAM_RANGES + LEGACY_PRESETS
│  ├─ pipeline.js       帧运算（纯函数）
│  ├─ shaders.js        着色器源码（如需要）
│  └─ *.test.js         与被测文件同目录
└─ react/
   ├─ <Name>Renderer.jsx
   └─ backends/         同一渲染器的多种画法（可选）
```

### core/ 的硬规矩

1. **没有 React、没有 three。** 这条线决定谁能消费：Node 脚本、Vue、Svelte 都能用这一层。
2. **红线是"能在裸 Node 里 import"，不是"永不碰 DOM"。** 措辞要精确，因为已有一个**刻意的例外**：

   `blobHeatmap/core/intensity.js` 确实调 `document.createElement('canvas')`——调色板必须靠浏览器的 `addColorStop` 插值，自己算就要复现含 premultiplied alpha 的插值规则。它的处理方式是**把画布注入进来**：`createIntensity({ createCanvas })`，默认实现用 `document`，裸 Node 里传个假的就能测。

   所以规矩是：**import 本文件不得碰 DOM、不得有副作用；运行时确实需要宿主能力时做成可注入。** 顶层直接 `document.xxx` 仍然禁止。
3. **相对 import 一律写全 `.js` 扩展名。** Node 的 ESM 解析不补扩展名，打包器补——少写一个字符的代价是"在本仓跑得好，装到新项目就崩"。
4. **模块顶层不读 `localStorage`**（用 `globalThis.localStorage?.`）。
5. **不持有模块级可变状态。** 否则同一渲染器无法多实例挂载。

::: tip 别把参数名当违规
`webglHeatmap/core/pipeline.js` 里的 `pushWindow(window, value, size)` 有 `window.length` / `window.shift()`——那个 `window` 是**函数参数**（一个 `number[]`），不是 DOM 全局。写检查脚本时要排除这类遮蔽命名，否则会误报。
:::

### params.js 必须导出三样

| 导出 | 作用 |
| :--- | :--- |
| `normalize<Id>Params(params)` | 归一化。**任何非法输入退回默认值而非抛错**——手写配置不全时应降级渲染，不是让整个模块加载失败 |
| `PARAM_RANGES` | 每个数值参数的 `{min, max}`。上界防的是误填导致顶点数/实例数爆炸 |
| `LEGACY_PRESETS` | 与迁移来源逐帧一致的基准参数组 |

归一化的两条细则（现有 5 个都这么写，容易写错）：

```js
// null / undefined / 空串一律视为「未提供」而非 0。
// Number(null) 和 Number('') 都等于 0 且是有限数，不先拦掉的话
// 缺省字段会被夹到 range.min，而不是回落默认值。
if (value === null || value === undefined || value === '') return fallback;
```

```js
// 守卫用 !== undefined 而不是 if (value)，否则 0 会被当成「没传」忽略掉。
if (valuej !== undefined) t.valuej1 = valuej;
```

### react/ 的硬规矩

1. **两条帧入口都要有**：声明式 `frame` prop（`pointGrid` 另有 `backFrame`）+ 命令式 ref 方法。两条共存，不是二选一。
2. **声明式帧走 `useDeclarativeFrame`**，resetKey 传 `paramsKey`。会整场重建的渲染器不传 resetKey，参数改完到下一帧到达之间画面是空的。
3. **运行期可变状态集中在一个 `stateRef`**，不进 `useState`——这些值以 30–100Hz 变化。
4. **命令式接口走 `state.api` 中转，不用直接闭包。** 参数变化重建场景后，外部持有的 ref 仍要指向新场景，不能调到已释放的 Three.js 对象。
5. **按参数内容而非引用记忆化**：`const paramsKey = JSON.stringify(normalize<Id>Params(props.params))`。调用方常传内联字面量，依赖引用会让父组件每次渲染都重建整个 WebGL 场景。
6. **以宿主容器为尺寸边界**，用 `ResizeObserver`；**不许出现 `100vw` / `100vh`**（已有断言）。
7. **必须释放 GPU 资源**：`geometry` / `material` / `texture` / `renderer` / `controls` 逐个 `dispose()`。浏览器对同时存活的 WebGL 上下文有硬上限。
8. **新 prop 必须登记进 `core/contract.js` 的 `RENDERER_PROPS`**；新命令式方法登记进 `RENDERER_METHODS`——`validateRendererDescriptor` 对契约外方法名是**静默拒绝注册**，不登记的后果是一块白屏而不是报错。

### 注册

在 `renderers/builtins.js` 加一条**动态 import 描述符**，不是静态 import：

```js
{ id: '<id>', label: '…', capabilities: [...], methods: [...],
  load: () => import('./<id>/react/<Name>Renderer.jsx'),
  normalizeParams: normalize<Id>Params }
```

静态 import 会把 React / Three / WebGL 拖进纯 core 的依赖图。

---

## 三、形态 A′ — TypeScript 分层

适用：`UI/render`。现有 1 个（`TerrainMap`）。

```text
UI/render/
├─ TerrainMap.tsx        组件
├─ terrainWireGrid.mjs   可独立测试的算法
├─ terrainWireGrid.d.mts 算法类型
├─ index.js / index.d.ts 公开入口与类型
├─ terrain-map.css
└─ prototypes/           迁移参考件，用 .npmignore 排除
```

规矩与 A 相同，另加两条：

1. **必须有 `index.d.ts` 公开类型入口**，并在根 `package.json` 的 `exports` 里接成 `types` 条件。这是全仓唯一带类型的入口。
2. **算法拆成独立 `.mjs` + `.d.mts`**，与组件分开，便于在 Node 里直接测（`tests/terrain-wire-grid.test.mjs`）。

::: warning A′ 只有一个成员
只有一个成员的"形态"称不上规约。**新组件不建议再进 A′**——要么用 A（JS 分层，与其余 5 个一致），要么把 A 整体迁到 TS。这条留给你决定，见第七节。
:::

---

## 四、形态 B — 基础组件

适用：`UI/shroomui`。现有 12 个。

### 目录

```text
UI/shroomui/<Group>/
├─ <Name>.jsx       组件（一个 Group 可放多个同族组件）
└─ index.scss       样式（同族共用一份）
```

`Group` 通常等于 `Name`，同族多个组件时用族名：`ExportDialog/` 放 `ExportDialog` + `ExportProgressDialog`，`Playback/` 放两个回放控件。

### 依赖边界（来自 `shroomui/README.md`，已是现行约定）

- ✅ 可依赖：React、Ant Design、图标、i18n、纯展示工具
- ❌ 不可：请求业务接口
- ❌ 不可：读取设备 Store
- ❌ 不可：在组件内部持有采集、回放、导出等业务流程
- 带业务状态的组合组件属于形态 C 或业务项目，不进这里

### 编码约定

| 项 | 约定 | 现状 |
| :--- | :--- | :--- |
| 导出 | `export default function <Name>(...)` | ✅ 12/12 |
| 样式引入 | `import './index.scss'` | ✅ |
| 缩进 | **4 空格** | ⚠️ 10/12，`Select` 与 `ToolbarAction` 是 2 空格 |
| props | **在函数签名里解构**，带默认值 | ⚠️ 10/12，`Select` 与 `ToolbarAction` 在函数体内解构 |
| `className` | 必须接收并拼到根节点，默认 `''` | ✅ |
| CSS 类名 | **`ui-` 前缀 + BEM**：`ui-metric-value__label`、`ui-async-state--loading` | ⚠️ 5/9 合规，见下 |
| 单位 | **px**，不用 rem | ⚠️ 0/9 合规，见下 |
| PropTypes / JSDoc | 当前一律没有 | — 需要你定，见第七节 |

### ⚠️ B 类实测到的三处偏差

这三条是**当前代码的真实状态**，装到外部项目会出问题：

**1. 五个组件的 CSS 类名没有命名空间，会和宿主样式相撞**

| 组件 | 顶层选择器 | 状态 |
| :--- | :--- | :--- |
| AsyncState | `.ui-async-state` | ✅ |
| ExportDialog | `.ui-export-dialog` | ✅ |
| MetricValue | `.ui-metric-value` | ✅ |
| SettingControlRow | `.ui-setting-control` | ✅ |
| ChartPanel | `.ui-chart-panel` + **`.chartAndDataContent`** | ⚠️ 第二个顶层选择器无前缀 |
| DraggablePanel | `.draggable-panel` | ⚠️ 无前缀 |
| Drawer | `.drawerContent` | ⚠️ 原项目遗留名 |
| Select | `.systemSelect` | ⚠️ 原项目遗留名 |
| ToolbarAction | `.iconContent` `.disable` `.onclickContent` | ⚠️ `.disable` 这种通名撞车概率极高 |

`ChartPanel` 这条是断言跑出来的：只看每个文件的**第一个**选择器会漏掉它——写检查脚本时要遍历全部顶层选择器。

**2. 四个组件引用了 SDK 里根本没有定义的宿主全局类**

| 组件 | 未定义的类 |
| :--- | :--- |
| Drawer | `.closeDrawer` `.cursor` |
| Playback | `.playOrStop` `.cursor` |
| Select | `.cursor` `.fs16` |
| ToolbarAction | `.fs14` |

七个类名**在整个 `UI/` 目录里都搜不到定义**——它们是原项目的全局样式。`.cursor` 被三个组件引用（应是 `cursor: pointer`），`.fs14` / `.fs16` 是字号工具类。装到别的项目里：光标不是手型、字号不对、抽屉关闭按钮没有样式。

**`Playback/` 还是 10 个目录里唯一没有 `index.scss` 的**——两个回放控件的样式完全依赖宿主。

**3. 九个 SCSS 全部使用 rem，依赖宿主根字号**

`ToolbarAction` 的 `width: 5.2rem`、`margin-top: 0.4rem` 等。ARCHITECTURE 更新日志记录过给 `qxui` 修"原项目根字号依赖"问题（2026-08-11），`shroomui` 这一轮没修。形态 C 已经全部改用 px，B 没有跟上。

**遗留 prop 别名**：`ToolbarAction` 接受四对别名（`text`/`label`、`show`/`expanded`、`disable`/`disabled`、`onClickStatus`/`active`），其余 11 个组件都没有。这是迁移期的兼容层，需要你决定保留还是收敛（见第七节）。

---

## 五、形态 C — 业务展示组件

适用：`UI/qxui`。现有 4 个（`ComparePlay`、`DynamicReportCard`、`PlaybackControls`、`ReportMetrics`）。

### 目录

```text
UI/qxui/<Group>/
├─ <Name>.jsx           组件
├─ <Name>.styles.jsx    styled-components，导出具名样式组件
└─ index.js             族出口
```

### 编码约定

| 项 | 约定 | 现状 |
| :--- | :--- | :--- |
| 导出 | `export default function` 或 `export default observer(<Name>)` | ✅ 4/4 |
| 样式 | 同名 `.styles.jsx`，`import { styled } from 'styled-components'`，导出具名 | ✅ 4/4 |
| 单位 | **px** | ✅ 4/4（这是 B 应当跟上的样板） |
| 缩进 | **2 空格** | ✅ 8/8 文件 |
| 分号 | 用 | ✅ |
| 状态订阅 | 可以 `observer()` 包一层，**但不许自己读 Store** | ✅ 实测 2 处 `observer`，0 处 store 读取 |

一个组件文件可以额外具名导出同族小组件（`ComparePlay.jsx` 同时导出 `NoRender`），由族 `index.js` 转出。

::: tip C 类的样式写法是全仓最干净的
`ReportMetrics.styles.jsx` 22 行、px 单位、无全局类名、无宿主依赖。B 类要收敛的话，这就是目标形态。
:::

---

## 六、共通硬规矩（四种形态都适用）

1. **不许把"每实例状态"提到模块作用域。** 同页挂两个实例必须互不干扰。原项目 `canvas.jsx` 把 `data` / `options` / 四个阈值全声明在模块顶层，结果挂过一次之后 `options.max` 永久变成 300，下一个实例跟着串味——这是这条规矩的由来。

   注意措辞：禁止的不是"一切模块级状态"。语义**确实是全局**的可以留在模块作用域，但要在注释里写明理由。现有两个正当例外：`DraggablePanel` 的 `globalMaxZIndex` 和 `Drawer` 的 `topDrawerZIndex`——"点击置顶"必须知道当前最高的 z-index，这是跨实例的层叠顺序，每实例状态实现不了。
2. **不用 `document.getElementById` / `querySelector` 取自己的节点**，一律 `useRef`。写死 id 的组件同页第二个必然抢同一个元素。
3. **相对 import 写全扩展名**（`.js` / `.jsx`）。
4. **不引入项目别名**（`@/` 之类）。SDK 是独立包，别名在宿主项目里不存在。
5. **不依赖宿主全局 CSS 类**。自己需要的样式自己定义。
6. **发布边界**：新增运行文件必须落在根 `package.json` 的 `files` 白名单内，且 `*.test.js` 不进包。
7. **文档**：每个公开组件一个 `docs/components/<族>/<name>.md`，含最小用法、props 表、行为说明。参数表**必须覆盖全部公开参数**——numMatrix 曾掉到 29% 覆盖率，因为没有断言看着。

---

## 七、需要你定的六个决策

反向提取只能得出"现在是怎样"，下面这些是"应该怎样"，我不替你定：

| # | 决策 | 影响面 | 我的建议 |
| :--- | :--- | :--- | :--- |
| 1 | B 类无前缀 CSS 类名要不要改成 `ui-` 前缀？ | 5 个组件 | **改**。撞车是静默的，排查成本极高。但改类名可能影响仍在用旧类名的宿主，需要先确认没有外部依赖 |
| 2 | B 类的 rem 要不要统一改 px？ | 9 个 SCSS 全部 | **改**。C 类已经改完，B 没跟上；rem 让组件外观取决于宿主根字号 |
| 3 | 7 个未定义的宿主全局类怎么办？ | 4 个组件 | **在自己的 SCSS 里定义**，并给 `Playback/` 补一份 `index.scss`。这是纯 bug，不是风格问题——**建议优先做这条** |
| 4 | `ToolbarAction` 的 4 对遗留 prop 别名保留还是收敛？ | 1 个组件 | **保留但标注 deprecated**，新文档只写新名 |
| 5 | 缩进统一成几空格？ | 2 个文件 | **B 用 4、C 用 2**（各自内部已经基本一致），只修 `Select` 和 `ToolbarAction` 两个异类。或者全仓统一——那要动 20 个文件 |
| 6 | 要不要引入 PropTypes 或 TS？ | 22 个组件 | **先不引入**。全部组件现在都无类型，半数引入比全无更难维护。要做就整体做，属于独立决策 |
| 7 | 形态 A′ 只有一个成员，怎么收敛？ | 1 个组件 | **暂不动**。要么 `TerrainMap` 迁到 A，要么 A 整体迁 TS，两者都是大动作 |

决策 3 与决策 1、2 有重叠（都动 SCSS），一起做比分三次做省事。

---

## 八、可断言 vs 只能人工

规约不落成断言就会漂。这份规约里能机器检查的部分：

| 规约条目 | 可断言 | 断言方式 |
| :--- | :--- | :--- |
| A 类目录结构完整 | ✅ | 已有 `renderers/structure.test.js` |
| A 类 core 不含 React/three | ✅ | 源码扫 `import .* from 'react\|three'` |
| A 类 core 顶层无 DOM 访问 | ⚠️ 部分 | 能扫顶层语句；函数体内的 DOM（注入式）需白名单，且要排除 `window` 这类遮蔽参数名 |
| A 类不出现 `100vw/100vh` | ✅ | 已有 `release-readiness.test.mjs` |
| A 类两条帧入口都在 | ✅ | 已有 `declarativeFrame.test.js` |
| 新 prop / 方法已登记契约 | ✅ | 比对 `contract.js` 与组件源码 |
| B/C 类目录与文件命名 | ✅ | 遍历目录结构 |
| B 类 CSS 带 `ui-` 前缀 | ✅ | 扫 SCSS 顶层选择器 |
| B/C 类不用 rem | ✅ | 扫 SCSS / styles.jsx |
| 不依赖未定义的全局类 | ✅ | 提取 `className` 字面量与 SCSS 定义比对 |
| 无模块级可变状态 | ⚠️ 部分 | 可扫顶层 `let` / `var`，`const` 持有的可变对象扫不出来 |
| 不读 Store / 不请求接口 | ✅ | 扫 import 与 `fetch` / `axios` |
| 缩进 / props 解构风格 | ✅ | 源码扫 |
| 文档参数覆盖率 | ✅ | 已有 `matrix-renderer-docs.test.mjs` |
| "算法能不能脱离 DOM 测" | ❌ | 判定题，只能人工 |

我会把 ✅ 的部分写成 `tests/component-spec.test.mjs`，允许一份**豁免清单**列出已知偏差——这样新组件立刻受约束，老偏差按你第七节的决策逐个清掉，而不是一次性阻塞。
