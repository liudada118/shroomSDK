# Select

轻量下拉选择器。可把下拉层通过 Portal 放到指定容器，避免在抽屉或复杂布局中被裁切。

## 实时示例

<UiComponentDemo name="Select" />

## 用法

```jsx
import { Select } from 'shroom-backend-sdk/UI/shroomui'

<Select
  defaultValue="COM36"
  options={[
    { label: 'COM3', value: 'COM3' },
    { label: 'COM36', value: 'COM36' },
  ]}
  onChange={setPort}
  getPopupContainer={() => document.body}
/>
```

`defaultValue` 变化时会同步显示值；`onChange` 返回选项的 `value`。
