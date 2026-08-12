# NoRender

用于保护热力图等重绘成本较高的子树。只有 `data` 引用发生变化时才重新渲染子组件。

## 实时示例

先点“修改同一引用”，再点“创建新引用”，比较子组件渲染次数。

<UiComponentDemo name="NoRender" />

## 用法

```jsx
import { NoRender } from 'shroom-backend-sdk/UI/qxui'

<NoRender data={frameData}>
  <PressureHeatmap data={frameData} />
</NoRender>
```

数据生产方需要用新数组表示新帧。如果原地修改数组，`NoRender` 会按设计阻止更新。
