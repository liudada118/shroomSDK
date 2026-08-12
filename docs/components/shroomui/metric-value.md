# MetricValue

稳定展示标签、数值、单位和可选状态色点，支持精度和空值格式化。

## 实时示例

拖动滑块观察受控数值和精度格式化。

<UiComponentDemo name="MetricValue" />

## 用法

```jsx
import { MetricValue } from 'shroom-backend-sdk/UI/shroomui'

<MetricValue
  label="平均压力"
  value={128.45}
  precision={1}
  unit="PA"
  indicatorColor="#0072ef"
/>
```

`layout` 和 `align` 会生成对应修饰类；`emptyValue` 默认为 `-`。
