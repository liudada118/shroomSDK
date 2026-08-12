# UI Components

Shroom SDK 的 UI 文档按组件独立成页。每个页面都会加载 SDK 中的真实 React 组件，并提供可点击、可拖动或可编辑的实时示例。

## 安装

```powershell
pnpm add file:E:\ShroomSDK
pnpm add react react-dom antd @ant-design/icons mobx mobx-react i18next react-i18next styled-components sass
pnpm add three @react-three/fiber @react-three/drei
```

仅使用后端串口 SDK 时，不需要安装上面的 UI peer dependencies。

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

## 导入边界

```jsx
import { ComparePlay } from 'shroom-backend-sdk/UI/qxui'
import { ChartPanel } from 'shroom-backend-sdk/UI/shroomui'
import { TerrainMap } from 'shroom-backend-sdk/UI/render'
import NumMatrixRenderer from 'shroom-backend-sdk/UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx'
```

UI 组件通过深路径导入，不会进入后端 CommonJS 根入口，也不会让纯后端项目加载 React。
