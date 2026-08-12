# ComparePlay

动态报告的核心展示区，负责把当前帧热力图、压力指标和回放控制组合在一起。

## 实时示例

<UiComponentDemo name="ComparePlay" />

## 用法

```jsx
import { ComparePlay } from 'shroom-backend-sdk/UI/qxui'

<ComparePlay chair={chair} HeatmapComponent={PressureHeatmap} width={420} />
```

## ChairLike

```ts
type ChairLike = {
  frameData?: number[]
  frameQueue?: {
    meanPressureStr?: string
    meanAreaStr?: string
    meanContactPressureStr?: string
  }
  dataLength?: number
  durationTime?: string
  progressTime?: string
  progress?: number
  playSpeed?: number
  playing?: boolean
  paused?: boolean
  startPlay?: () => void
  pausePlay?: () => void
  setPlaySpeed?: (speed: number) => void
  setOffset?: (offset: number) => void
}
```

拖动百分比进度时，组件会调用 `setOffset(dataLength * percent / 100)`。
