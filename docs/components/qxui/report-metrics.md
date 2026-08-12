# ReportMetrics

以稳定的两列结构展示报告指标，适合平均压力、接触面积和单位面积压力等数值。

## 实时示例

点击“模拟下一帧”可观察受控数据更新。

<UiComponentDemo name="ReportMetrics" />

## 用法

```jsx
import { ReportMetrics } from 'shroom-backend-sdk/UI/qxui'

<ReportMetrics items={[
  { key: 'pressure', label: '平均压力', value: 128.5, unit: 'PA' },
  { key: 'area', label: '接触面积', value: 34.2, unit: 'CM2' },
]} />
```

`items` 默认为空数组；每项支持 `key`、`label`、`value` 和 `unit`。
