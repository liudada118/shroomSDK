# Shroom UI

`UI/shroomui` 是 SDK 的基础前端组件入口，面向 React 项目使用。这里放纯展示组件，不直接请求后端、不读取设备 Store，也不持有采集、筛选、报告等业务流程。

## 导入

```jsx
import {
  AsyncState,
  ChartPanel,
  DraggablePanel,
  Drawer,
  ExportDialog,
  ExportProgressDialog,
  MetricValue,
  PlaybackPlayToggle,
  PlaybackSpeedMenu,
  Select,
  SettingControlRow,
  ToolbarAction,
} from 'shroom-backend-sdk/UI/shroomui';
```

如果项目构建器不解析目录入口，可以使用：

```jsx
import { ChartPanel } from 'shroom-backend-sdk/UI/shroomui/index.js';
```

## 依赖边界

- 可以依赖 React、Ant Design、图标、国际化和纯展示工具。
- 不能直接请求业务接口。
- 不能直接读取设备 Store。
- 不能在组件内部持有采集、回放、导出等业务流程。
- 带业务状态的组合组件应放在业务项目里，由业务层通过 props 传入状态和事件函数。

## 当前组件

| 组件 | 用途 |
| :--- | :--- |
| `AsyncState` | 加载中、空结果等异步状态 |
| `ChartPanel` | 图表标题、操作、图例、说明、内容和底部布局 |
| `DraggablePanel` | 可拖动、可缩放浮动面板 |
| `Drawer` | 基于 Portal 的侧边抽屉 |
| `ExportDialog` | 导出路径、格式及可选字段选择 |
| `ExportProgressDialog` | 导出进度、结果文件和后续操作 |
| `MetricValue` | 数值、状态色点和单位的稳定排版 |
| `PlaybackPlayToggle` | 回放播放/暂停操作 |
| `PlaybackSpeedMenu` | 回放倍速选项 |
| `Select` | 支持 Portal 浮层的项目选择器 |
| `SettingControlRow` | 标签、滑块、数字输入、说明和可选开关 |
| `ToolbarAction` | 图标与文字组成的工具栏操作 |
