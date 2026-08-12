# ToolbarAction

工具栏命令组件，支持图标、文本、激活、禁用、折叠文本和键盘触发。

## 实时示例

<UiComponentDemo name="ToolbarAction" />

## 用法

```jsx
import { ToolbarAction } from 'shroom-backend-sdk/UI/shroomui'
import { DatabaseOutlined } from '@ant-design/icons'

<ToolbarAction
  icon={<DatabaseOutlined />}
  label="采集"
  active={capturing}
  disabled={!connected}
  onClick={toggleCapture}
/>
```

可交互时自动提供 button role、键盘 Enter/Space 触发和 `aria-pressed` 状态。
