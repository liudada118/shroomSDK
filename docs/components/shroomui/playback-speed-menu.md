# PlaybackSpeedMenu

提供固定的回放倍速选项，并高亮当前值。

## 实时示例

<UiComponentDemo name="PlaybackSpeedMenu" />

## 用法

```jsx
import {
  PlaybackSpeedMenu,
  PLAYBACK_SPEEDS,
} from 'shroom-backend-sdk/UI/shroomui'

<PlaybackSpeedMenu value={speed} onChange={setSpeed} />
```

内置倍速为 `0.5`、`1.0`、`2.0` 和 `4.0`，回调值是字符串。
