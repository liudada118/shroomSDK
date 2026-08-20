---
aside: false
---

# BlobHeatmapRenderer

使用 Canvas 2D 阴影圆点和调色板生成柔和斑点热力图，适合在不创建 Three.js 场景时展示连续压力分布。

## 实时示例

示例默认输入 32×32 的 `[1, 2, ..., 1024]`，因此色阶上限默认为 `1024`；可直接编辑 `params` JSON，拖动色阶上限会重新绘制当前帧。

<UiComponentDemo name="BlobHeatmapRenderer" />

## 最小用法

传 `frame` 即可，不需要 ref：

```jsx
import BlobHeatmapRenderer from 'shroom-backend-sdk/UI/frontend/renderers/blobHeatmap/react/BlobHeatmapRenderer.jsx'

export function BlobPressure({ matrix }) {
  return (
    <BlobHeatmapRenderer
      frame={matrix}
      params={{ dataWidth: 32, dataHeight: 32, canvasScale: 0.55, radius: 24, max: 255 }}
    />
  )
}
```

导出画布（`bthClickHandle` 返回 canvas）仍走 ref，两条通路可以同时用：

```jsx
const rendererRef = useRef(null)
const canvas = rendererRef.current?.bthClickHandle(peakFrame)
return <BlobHeatmapRenderer ref={rendererRef} frame={matrix} />
```

## 声明式 props

| prop | 类型 | 说明 |
| :--- | :--- | :--- |
| `frame` | `number[]` / `TypedArray` / `{ wsPointData }` | 矩阵帧，变化时自动推给 `sitData` |
| `params` | `object` | 渲染参数，见下方[关键参数](#关键参数) |
| `data` | `ref` | 宿主回调容器，只用到 `changeData`；不传则不推统计 |

空数组会被丢弃（不清屏），声明式通路同样如此。改 `params` 时当前 `frame` 会用新参数重画一次 —— 这一点与命令式通路不同，后者要等下一帧。

`frame` 按引用比较：**原地修改同一个数组不会触发重画**，高频通路请每帧给新数组，或改用 ref 上的 `sitData`。

## 输入数据

- `dataWidth × dataHeight` 必须与一维数组长度匹配，数据按行展开。
- 第 0 行显示在上方，每行从左到右，不做旋转、镜像或转置。
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
