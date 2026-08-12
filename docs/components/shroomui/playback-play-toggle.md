# PlaybackPlayToggle

轻量播放/暂停切换按钮，由父级保存播放状态。

## 实时示例

<UiComponentDemo name="PlaybackPlayToggle" />

## 用法

```jsx
import { PlaybackPlayToggle } from 'shroom-backend-sdk/UI/shroomui'

<PlaybackPlayToggle
  isPaused={paused}
  onPlay={() => setPaused(false)}
  onStop={() => setPaused(true)}
/>
```

`isPaused=true` 时显示播放图标，否则显示暂停图标。
