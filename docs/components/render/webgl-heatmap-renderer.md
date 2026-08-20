---
aside: false
---

# WebglHeatmapRenderer

使用 WebGL 生成高密度斑点热力图，再合成到 Canvas，适合 32×32、64×64 等连续压力场的实时展示。

## 实时示例

示例默认输入 32×32 的 `[1, 2, ..., 1024]`，因此色阶上限默认为 `1024`；可直接编辑 `params` JSON，色阶上限滑块直接调用组件的 `sitValue` 命令。

<UiComponentDemo name="WebglHeatmapRenderer" />

## 最小用法

传 `frame` 即可，不需要 ref：

```jsx
import WebglHeatmapRenderer from 'shroom-backend-sdk/UI/frontend/renderers/webglHeatmap/react/WebglHeatmapRenderer.jsx'

export function PressureHeatmap({ matrix }) {
  return (
    <WebglHeatmapRenderer
      frame={matrix}
      params={{ dataWidth: 32, dataHeight: 32, minFrameLength: 1024, displaySize: '480px' }}
    />
  )
}
```

导出画布（`bthClickHandle`）和调色命令仍走 ref，两条通路可以同时用：

```jsx
const rendererRef = useRef(null)
const canvas = rendererRef.current?.bthClickHandle(peakFrame)
return <WebglHeatmapRenderer ref={rendererRef} frame={matrix} />
```

## 声明式 props

| prop | 类型 | 说明 |
| :--- | :--- | :--- |
| `frame` | `number[]` / `TypedArray` / `{ wsPointData }` | 矩阵帧，变化时自动推给 `sitData` |
| `params` | `object` | 渲染参数，见下方[关键参数](#关键参数) |
| `local` | `boolean` | 回放模式，为真时不驱动宿主侧栏曲线 |
| `data` | `ref` | 宿主回调容器，需挂 `changeData` / `handleCharts` / `handleChartsArea` |

短于 `minFrameLength` 的帧会被整帧丢弃，声明式通路同样如此 —— 画面空白时先核对帧长。

`frame` 按引用比较：**原地修改同一个数组不会触发重画**，高频通路请每帧给新数组，或改用 ref 上的 `sitData`。

## 输入数据

- `dataWidth × dataHeight` 决定矩阵长度；32×32 对应 1024 项，按行展开。
- 默认保持第 0 行在上、每行从左到右；只有显式设置 `mirrorX: true` 才水平镜像。
- `minFrameLength` 会拒绝长度不足的帧，建议与完整矩阵长度一致。
- 输入应是协议解析、线序转换和清零后的 normalized matrix；实时和回放使用同一数组结构。

## 关键参数

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `dataWidth` / `dataHeight` | `number` | `64` | 输入矩阵列数和行数 |
| `canvasWidth` / `canvasHeight` | `number` | `1024` | 内部绘制分辨率 |
| `radius` | `number` | `24` | 热点半径 |
| `max` | `number` | 预设值 | 色阶上限 |
| `edgeClear` | `{ keepFrom, keepTo } \| null` | 预设值 | 边缘清零窗口 |
| `mirrorX` | `boolean` | `false` | 是否水平镜像每一行；默认保持输入顺序 |
| `displaySize` | `string` | `'80vh'` | 页面显示尺寸 |

## 公开命令

| ref 方法 | 参数 | 作用 |
| :--- | :--- | :--- |
| `sitData` | `{ wsPointData, local? }` | 提交一帧矩阵 |
| `sitValue` | `{ valuej?, valuef? }` | 更新最大值和过滤阈值 |
| `changeColor` | `{ max?, filter?, size? }` | 更新色阶、过滤和半径 |
| `bthClickHandle` | `number[]` | 同步绘制并返回 Canvas，供导出使用 |

## 依赖

需要 React 和 React DOM，浏览器必须支持 WebGL 与 Canvas 2D。该组件不依赖 Three.js 场景。
