# DraggablePanel

可拖动、缩放并自动置顶的浮动面板，适合串口调试、参数调整和临时图表。

## 实时示例

<UiComponentDemo name="DraggablePanel" />

## 用法

```jsx
import { DraggablePanel } from 'shroom-backend-sdk/UI/shroomui'

<DraggablePanel
  title="串口调试面板"
  defaultPosition={{ right: 24, bottom: 24 }}
>
  <SerialDebugView />
</DraggablePanel>
```

`defaultPosition` 支持 `{ x, y }` 或 `{ right, bottom }`。缩放范围为 `50%-150%`，步长为 `10%`。
