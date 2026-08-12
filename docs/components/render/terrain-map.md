---
aside: false
---

# TerrainMap

将协议解析和线序归一化后的二维数值矩阵渲染为可旋转、缩放和切换视角的 Three.js 三维地形。组件只负责矩阵渲染，不直接连接串口。

## 参数示例

示例输入是从 `1` 到 `rows * columns` 的连续数组。直接编辑 `params` JSON 可以调节矩阵尺寸、归一化上限、高度、标题、预览开关，以及视角、配色、插值、平滑、增益、网格和自动旋转；应用参数后会按新的行列数重建输入数组。

<UiComponentDemo name="TerrainMap" />

## 安装

```powershell
pnpm add shroom-backend-sdk react react-dom three @react-three/fiber @react-three/drei
```

本地 SDK：

```powershell
pnpm add file:E:\ShroomSDK
pnpm add react react-dom three @react-three/fiber @react-three/drei
```

## 最小用法

```tsx
import { TerrainMap } from 'shroom-backend-sdk/UI/render'

export function PressureTerrain({ matrix }: { matrix: number[] }) {
  return (
    <TerrainMap
      data={matrix}
      rows={32}
      columns={32}
      maxValue={255}
    />
  )
}
```

## 接入 SerialManager

串口协议、线序和清零继续由 `SerialManager` 或数据层统一处理。渲染组件只接收最终矩阵，避免实时、回放和下载各自重复转换。

```tsx
function TerrainView({ serialManager }) {
  const [matrix, setMatrix] = useState(() => new Array(1024).fill(0))

  useEffect(() => {
    return serialManager.onData((frame) => {
      // normalizedMatrix 已完成协议解析和线序处理
      setMatrix(frame.normalizedMatrix)
    })
  }, [serialManager])

  return <TerrainMap data={matrix} rows={32} columns={32} maxValue={255} />
}
```

## Props

| prop | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `data` | `readonly number[]` | 必填 | 按行展开的一维矩阵 |
| `rows` | `number` | `32` | 矩阵行数 |
| `columns` | `number` | `32` | 矩阵列数 |
| `maxValue` | `number` | 当前帧最大值 | 归一化上限；实时数据建议固定传入 |
| `heightScale` | `number` | `4.8` | 地形最大高度 |
| `height` | `number \| string` | `620` | 组件整体高度 |
| `showControls` | `boolean` | `true` | 是否显示交互工具栏 |
| `showMatrixPreview` | `boolean` | `true` | 是否显示原始矩阵缩略图 |
| `options` | `Partial<TerrainMapOptions>` | - | 受控渲染配置 |
| `defaultOptions` | `Partial<TerrainMapOptions>` | - | 非受控初始配置 |
| `onOptionsChange` | `(options) => void` | - | 配置变化回调 |

## TerrainMapOptions

```ts
type TerrainMapOptions = {
  viewMode: '3d' | 'top' | 'side'
  interpolation: number
  smoothing: number
  wireframe: boolean
  autoRotate: boolean
  colorScheme: 'terrain' | 'ocean' | 'magma' | 'viridis' | 'thermal'
  gain: number
}
```

### 网格规则

- `wireframe: true` 显示原始 `rows × columns` 矩阵的横向和纵向连接线，不绘制三角形对角线。
- 网格只连接归一化值不低于 `0.01` 的相邻点，零值和无效区域不会铺满线框。
- `interpolation` 只提高彩色地形曲面的采样密度，不改变网格密度和拓扑形状。

## 数据约定

- `data.length` 最好严格等于 `rows * columns`。
- 长度不足会自动补零，超出部分会忽略，`NaN` 和 `Infinity` 会转换为 `0`。
- 右侧矩阵预览和峰值、有效点、平均值始终使用原始输入矩阵。
- 插值、高斯平滑和增益只作用于三维地形，不会修改输入数据。

## 算法导出

矩阵处理函数可以单独使用：

```ts
import {
  normalizeMatrix,
  gaussianBlurMatrix,
  bicubicInterpolateMatrix,
  getTerrainColor,
  buildTerrainWireSegments,
} from 'shroom-backend-sdk/UI/render'
```

`buildTerrainWireSegments(input)` 返回按两个端点依次排列的 `number[]`，每 6 个数字表示一条线段的 `[x0, y0, z0, x1, y1, z1]`：

```ts
type TerrainWireGridInput = {
  data: readonly number[]
  dataRows: number
  dataColumns: number
  gridRows: number
  gridColumns: number
  maxValue: number
  gain: number
  heightScale: number
  width?: number       // 默认 10
  depth?: number       // 默认 10
  threshold?: number   // 默认 0.01
  elevation?: number   // 默认 0.03，避免网格与曲面重叠闪烁
}
```
