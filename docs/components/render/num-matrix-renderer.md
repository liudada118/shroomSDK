---
aside: false
---

# NumMatrixRenderer

将规范化矩阵渲染为带数值的彩色网格，适合调试传感器读数和核对线序。通过 `backend` 可切换 Canvas 2D、WebGL 或 Three.js 精灵矩阵。

## 实时示例

示例默认输入 16×16 的 `[1, 2, ..., 256]`，可直接编辑 `params` JSON；应用后会按新的行列数重新生成递增数组。仍可切换 Canvas 2D 和 WebGL 后端。

<UiComponentDemo name="NumMatrixRenderer" />

## 最小用法

传 `frame` 即可，不需要 ref：

```jsx
import NumMatrixRenderer from 'shroom-backend-sdk/UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx'

export function MatrixValues({ matrix }) {
  return (
    <div style={{ height: 480 }}>
      <NumMatrixRenderer
        frame={matrix}
        params={{
          backend: 'canvas2d',
          gridWidth: 16,
          gridHeight: 16,
          filterMin: 0,
          manageSidebar: false,
        }}
      />
    </div>
  )
}
```

需要调用 `sitValue`、`reset` 这些命令时再取 ref，两条通路可以同时用：

```jsx
const rendererRef = useRef(null)
return <NumMatrixRenderer ref={rendererRef} frame={matrix} />
```

## 声明式 props

| prop | 类型 | 说明 |
| :--- | :--- | :--- |
| `frame` | `number[]` / `TypedArray` / `{ wsPointData }` | 矩阵帧，变化时自动推给 `sitData` |
| `params` | `object` | 渲染参数，见下方[关键参数](#关键参数) |
| `local` | `boolean` | 回放模式，为真时不驱动宿主侧栏曲线 |
| `data` | `ref` | 宿主回调容器，需挂 `changeData` / `handleCharts` / `handleChartsArea`；`manageSidebar: false` 时不使用 |
| `colormap` | `{ id, reverse }` | 配色方案，变化会整场重建 |
| `coordinateMap` | `object` | 物理坐标表，有则按实际点位布局 |

`frame` 按引用比较：**原地修改同一个数组不会触发重画**，高频通路请每帧给新数组，或改用 ref 上的 `sitData`。参数变化会整场重建场景，重建后当前 `frame` 会自动重推一次。

## 输入数据

- `wsPointData` 是按行展开的一维数值数组，位置公式为 `data[row * gridWidth + col]`；组件不会旋转、镜像或转置常规矩阵。
- 16×16 对应 256 项，32×32 对应 1024 项。
- 协议解析、线序转换和清零应在传入组件前完成，组件接收 normalized matrix。
- 实时数据和回放数据使用同一结构；渲染阈值不会写回采集帧。

## 关键参数

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `backend` | `'canvas2d' \| 'webgl' \| 'sprite3d'` | `'sprite3d'` | 选择渲染后端 |
| `gridWidth` | `number` | 由预设决定 | 矩阵列数 |
| `gridHeight` | `number` | 由预设决定 | 矩阵行数 |
| `filterMin` | `number` | 未设置 | 显式下限过滤；传 `0` 时保留原始矩阵数值 |
| `manageSidebar` | `boolean` | `true` | 是否向宿主统计侧栏写入数据 |
| `decimalScale` | `number` | `1` | 数值显示缩放 |

## 公开命令

| ref 方法 | 参数 | 作用 |
| :--- | :--- | :--- |
| `sitData` | `({ wsPointData }, local?)` | 提交一帧 normalized matrix |
| `sitValue` | `{ valuej?, valuef?, ... }` | 更新色阶和过滤阈值 |
| `changeWsData` | `number[]` | 直接提交矩阵数组 |
| `reset` | 无 | 重置支持该命令的后端视角 |

## 依赖

需要 React、React DOM 和 Three.js。组件容器必须具有明确高度；仅使用纯逻辑时可导入 `UI/frontend/renderers/numMatrix/core`，无需加载 React。
