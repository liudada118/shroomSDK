# AsyncState

统一展示加载、空数据和错误状态，并为非加载状态提供可选操作按钮。

## 实时示例

<UiComponentDemo name="AsyncState" />

## 用法

```jsx
import { AsyncState } from 'shroom-backend-sdk/UI/shroomui'

<AsyncState
  status="empty"
  message="暂无采集记录"
  actionLabel="刷新"
  onAction={reload}
/>
```

`status="loading"` 显示 Spin，其余状态显示 Empty；仅同时传入 `actionLabel` 和 `onAction` 时显示按钮。
