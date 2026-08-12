# SettingControlRow

把标签、说明、滑块、数字输入和可选开关组织成一行，适合阈值和显示参数设置。

## 实时示例

<UiComponentDemo name="SettingControlRow" />

## 用法

```jsx
import { SettingControlRow } from 'shroom-backend-sdk/UI/shroomui'

<SettingControlRow
  label="压力阈值"
  value={threshold}
  min={0}
  max={100}
  step={1}
  onChange={setThreshold}
  switchLabel="启用"
  switchChecked={enabled}
  onSwitchChange={setEnabled}
/>
```

可用 `sliderMin`、`sliderMax` 和 `sliderStep` 单独设置滑块范围；数字输入仍使用 `min`、`max` 和 `step`。
