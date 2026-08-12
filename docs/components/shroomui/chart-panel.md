# ChartPanel

图表内容容器，统一标题、操作区、图例、说明、主体和页脚的布局。

## 实时示例

<UiComponentDemo name="ChartPanel" />

## 用法

```jsx
import { ChartPanel } from 'shroom-backend-sdk/UI/shroomui'

<ChartPanel
  title="实时压力"
  actions={<button onClick={exportData}>导出</button>}
  legend={<PressureLegend />}
  description="最近 60 秒"
  footer="采集频率 12Hz"
>
  <PressureChart data={frames} />
</ChartPanel>
```

所有区域均可选，`children` 是实际图表或自定义内容。
