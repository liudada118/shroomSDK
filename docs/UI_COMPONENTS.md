# UI Components

Shroom SDK 的 UI 文档按组件独立成页。每个页面都会加载 SDK 中的真实 React 组件，并提供可点击、可拖动或可编辑的实时示例。

## 安装

```powershell
pnpm add file:<你的 SDK 路径>
```

peer dependencies **按你实际要用的那一块装即可**，不必全装：

| 你要用的 | 需要装 |
| :--- | :--- |
| 仅后端串口 / HTTP 链路 | 无 |
| 矩阵渲染器（`renderers/*`） | `react` `react-dom` `three` |
| TerrainMap（`render`） | 上面三个 + `@react-three/fiber` `@react-three/drei` |
| qxui / shroomui 组件 | `react` `react-dom` `antd` `@ant-design/icons` `mobx` `mobx-react` `i18next` `react-i18next` `styled-components` `sass` |

```powershell
# 只要矩阵渲染器（最常见）
pnpm add react react-dom three

# 完整 UI
pnpm add react react-dom antd @ant-design/icons mobx mobx-react i18next react-i18next styled-components sass
pnpm add three @react-three/fiber @react-three/drei
```

## 打包器配置

SDK **发布的是未编译的 `.jsx` / `.scss` 源文件**（配合 peer dependencies 由宿主统一编译，避免 React 版本被锁死）。多数打包器默认不处理 `node_modules` 里的 JSX，需要显式放开。

### Vite

```js
// vite.config.js
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // 预打包阶段按 JSX 解析 SDK 里的 .js/.jsx
    esbuildOptions: { loader: { '.js': 'jsx' } },
  },
  build: {
    commonjsOptions: { transformMixedEsModules: true },
  },
})
```

用 `file:` 或 `link:` 安装时 SDK 不会被预打包，需要额外让插件接管它：

```js
react({ include: [/\.jsx?$/, /shroom-backend-sdk[\\/].*\.jsx?$/] })
```

用到 `qxui` / `shroomui` 时装 `sass` 即可，Vite 内置识别 `.scss`。

### webpack

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        // 默认的 exclude: /node_modules/ 会跳过 SDK，必须显式包含
        include: [/src/, /node_modules[\\/]shroom-backend-sdk/],
        use: 'babel-loader',
      },
      { test: /\.scss$/, use: ['style-loader', 'css-loader', 'sass-loader'] },
      { test: /\.png$/, type: 'asset/resource' },
    ],
  },
  resolve: { extensions: ['.js', '.jsx'] },
}
```

::: tip 报错长什么样
配置缺失时的典型报错是 `Failed to parse source ... Unexpected token '<'`，且堆栈指向 `node_modules/shroom-backend-sdk/UI/...`。看到它就是这一节没配。
:::

## render 矩阵渲染

| 组件 | 用途 |
| :--- | :--- |
| [TerrainMap](/components/render/terrain-map) | 把规范化矩阵渲染为可交互的 Three.js 三维压力地形 |
| [NumMatrixRenderer](/components/render/num-matrix-renderer) | 以 Canvas、WebGL 或 Three.js 数值网格核对矩阵读数和线序 |
| [PointGridRenderer](/components/render/point-grid-renderer) | 以可旋转三维点阵展示压力高度和颜色分布 |
| [HandPointsRenderer](/components/render/hand-points-renderer) | 将手套压力矩阵、点位和手部姿态组合到三维手模 |
| [WebglHeatmapRenderer](/components/render/webgl-heatmap-renderer) | 使用 WebGL 绘制高密度连续斑点热力图 |
| [BlobHeatmapRenderer](/components/render/blob-heatmap-renderer) | 使用 Canvas 2D 绘制柔和斑点热力图 |

## qxui 动态报告

| 组件 | 用途 |
| :--- | :--- |
| [DynamicReportCard](/components/qxui/dynamic-report-card) | 带标题、热力图、指标和播放控制的完整报告卡片 |
| [ComparePlay](/components/qxui/compare-play) | 组合热力图、指标和回放控制的核心区域 |
| [PlaybackControls](/components/qxui/playback-controls) | 播放、暂停、进度和倍速控制 |
| [ReportMetrics](/components/qxui/report-metrics) | 报告指标列表 |
| [NoRender](/components/qxui/no-render) | 按数据引用控制昂贵子组件重绘 |

## shroomui 基础组件

| 组件 | 用途 |
| :--- | :--- |
| [AsyncState](/components/shroomui/async-state) | 加载、空数据和错误状态 |
| [ChartPanel](/components/shroomui/chart-panel) | 图表标题、操作区、内容和页脚容器 |
| [DraggablePanel](/components/shroomui/draggable-panel) | 可拖动、缩放和置顶的浮动面板 |
| [Drawer](/components/shroomui/drawer) | 左右侧 Portal 抽屉 |
| [ExportDialog](/components/shroomui/export-dialog) | 导出路径、格式和字段配置弹窗 |
| [ExportProgressDialog](/components/shroomui/export-progress-dialog) | 导出进度与结果文件弹窗 |
| [MetricValue](/components/shroomui/metric-value) | 数值、单位、标签和状态点 |
| [PlaybackPlayToggle](/components/shroomui/playback-play-toggle) | 轻量播放/暂停按钮 |
| [PlaybackSpeedMenu](/components/shroomui/playback-speed-menu) | 回放倍速菜单 |
| [Select](/components/shroomui/select) | 支持 Portal 的轻量选择器 |
| [SettingControlRow](/components/shroomui/setting-control-row) | 滑块、数字输入和开关组合行 |
| [ToolbarAction](/components/shroomui/toolbar-action) | 工具栏命令、激活态和禁用态 |

## 导入路径

```jsx
import NumMatrixRenderer from 'shroom-backend-sdk/renderers/numMatrix'
import PointGridRenderer from 'shroom-backend-sdk/renderers/pointGrid'
import HandPointsRenderer from 'shroom-backend-sdk/renderers/handPoints'
import WebglHeatmapRenderer from 'shroom-backend-sdk/renderers/webglHeatmap'
import BlobHeatmapRenderer from 'shroom-backend-sdk/renderers/blobHeatmap'

import { ComparePlay } from 'shroom-backend-sdk/qxui'
import { ChartPanel } from 'shroom-backend-sdk/shroomui'
import { TerrainMap } from 'shroom-backend-sdk/render'
```

需要不带 React 的纯算法层（参数归一化、帧运算、配色，可在 Node 里直接跑）：

```js
import { normalizeNumMatrixParams } from 'shroom-backend-sdk/renderers/numMatrix/core'
import { COLORMAPS, toFramePayload } from 'shroom-backend-sdk/core'
```

### 完整入口表

| 短路径 | 内容 |
| :--- | :--- |
| `shroom-backend-sdk` | 后端 CommonJS 根入口，**不含任何 React** |
| `shroom-backend-sdk/renderers` | 渲染器注册表与 `registerBuiltinRenderers()` |
| `shroom-backend-sdk/renderers/<id>` | 五个矩阵渲染器的 React 组件 |
| `shroom-backend-sdk/renderers/<id>/core` | 对应的纯算法层，无 React / Three / DOM |
| `shroom-backend-sdk/core` | 前端公共层：契约、注册表、配色、阈值、帧数学 |
| `shroom-backend-sdk/frontend` | `core` + `renderers` 的聚合出口 |
| `shroom-backend-sdk/qxui` | 动态报告与回放组件 |
| `shroom-backend-sdk/shroomui` | 基础 UI 组件 |
| `shroom-backend-sdk/render` | TerrainMap 与矩阵算法（**唯一带 TS 类型的入口**） |

`<id>` 取 `numMatrix` / `pointGrid` / `handPoints` / `webglHeatmap` / `blobHeatmap`。

UI 组件全部走独立子路径，不会进入后端 CommonJS 根入口，纯后端项目 `require('shroom-backend-sdk')` 不会加载 React。

::: tip 旧的深路径仍然可用
`shroom-backend-sdk/UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx` 这类完整路径没有被移除，现有代码不需要改。新代码建议用上面的短路径。
:::
