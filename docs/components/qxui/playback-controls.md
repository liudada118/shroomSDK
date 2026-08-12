# PlaybackControls

独立的回放控制条，包含播放/暂停、时间、进度滑块和倍速下拉菜单。

## 实时示例

<UiComponentDemo name="PlaybackControls" />

## 用法

```jsx
import { PlaybackControls } from 'shroom-backend-sdk/UI/qxui'

<PlaybackControls
  durationTime="01:40"
  progressTime="00:24"
  progress={24}
  isPlaying={playing}
  playSpeed={speed}
  onPlay={() => setPlaying(true)}
  onPause={() => setPlaying(false)}
  onChangeProgress={setProgress}
  onChangeSpeed={setSpeed}
/>
```

## Props

| prop | 说明 |
| :--- | :--- |
| `progress` | `0-100` 的受控进度值 |
| `isPlaying` | 当前是否播放 |
| `playSpeed` / `playSpeeds` | 当前倍速和可选倍速，默认 `[0.5, 1, 1.5, 2]` |
| `onPlay` / `onPause` | 播放状态回调 |
| `onChangeProgress` | 进度变化回调，参数为百分比 |
| `onChangeSpeed` | 倍速变化回调，参数为数字 |
