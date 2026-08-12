---
aside: false
---

# BlobHeatmapRenderer

使用 Canvas 2D 阴影圆点和调色板生成柔和斑点热力图，适合在不创建 Three.js 场景时展示连续压力分布。

## 实时示例

示例默认输入 32×32 的 `[1, 2, ..., 1024]`，可直接编辑 `params` JSON；拖动色阶上限会重新绘制当前帧。

<UiComponentDemo name="BlobHeatmapRenderer" />

## 最小用法

```jsx
import { useEffect, useRef } from 'react'
import BlobHeatmapRenderer from 'shroom-backend-sdk/UI/frontend/renderers/blobHeatmap/react/BlobHeatmapRenderer.jsx'

export function BlobPressure({ matrix }) {
  const rendererRef = useRef(null)

  useEffect(() => {
    rendererRef.current?.sitData({ wsPointData: matrix }, false)
  }, [matrix])

  return (
    <BlobHeatmapRenderer
      ref={rendererRef}
      params={{ dataWidth: 32, dataHeight: 32, canvasScale: 0.55, radius: 24, max: 255 }}
    />
  )
}
```

## 输入数据

- `dataWidth × dataHeight` 必须与一维数组长度匹配，数据按行展开。
- 建议输入 0 到固定上限之间的 normalized matrix；无效项应在数据层转成 0。
- 实时与回放共享同一输入结构，Canvas 调色不会修改原数组。

## 关键参数

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `dataWidth` / `dataHeight` | `number` | `32` | 输入矩阵列数和行数 |
| `radius` | `number` | `50` | 阴影圆点半径 |
| `max` | `number` | `600` | 色阶上限 |
| `min` | `number` | `0` | 色阶下限 |
| `canvasScale` | `number` | `0.6` | 画布边长相对宿主容器短边的倍率 |
| `gradient` | 色标对象 | 内置色标 | 自定义颜色停止点 |

## 公开命令

| ref 方法 | 参数 | 作用 |
| :--- | :--- | :--- |
| `sitData` | `{ wsPointData }` | 提交并绘制一帧矩阵 |
| `sitValue` | `{ valuej?, ... }` | 更新色阶上限；其他旧参数仅保留兼容性 |
| `bthClickHandle` | `number[]` | 同步绘制并返回 Canvas，供下载或报告使用 |

## 依赖

需要 React、React DOM 和浏览器 Canvas 2D，不需要 Three.js。组件会监听宿主尺寸变化并重绘当前帧。
