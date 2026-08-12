# DynamicReportCard

用于展示单个传感器报告的完整卡片，内部组合 `ComparePlay`、默认热力图、指标和回放控制。

## 实时示例

点击播放按钮、拖动进度条或切换倍速，热力图和指标会随模拟帧变化。

<UiComponentDemo name="DynamicReportCard" />

## 用法

```jsx
import { DynamicReportCard } from 'shroom-backend-sdk/UI/qxui'

<DynamicReportCard
  chair={chair}
  heatmapWidth={420}
  HeatmapComponent={PressureHeatmap}
/>
```

## Props

| prop | 类型 | 说明 |
| :--- | :--- | :--- |
| `chair` | `ChairLike` | 当前报告、帧数据和回放控制对象 |
| `heatmapWidth` | `number` | 传给热力图的业务宽度 |
| `HeatmapComponent` | `React.ComponentType` | 可选；不传时使用内置矩阵热力图 |

`chair.name` 用作标题；完整数据约定见 [ComparePlay](/components/qxui/compare-play)。
