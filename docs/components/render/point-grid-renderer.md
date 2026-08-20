---
aside: false
---

# PointGridRenderer

将二维压力矩阵渲染为可旋转的 Three.js 三维点阵，通过点高度和颜色展示压力分布，适合观察整体受力形状和峰值区域。

常规矩阵按 row-major 原顺序映射：`data[row * cols + col]` 的第 0 行显示在上方，每行从左到右，不做旋转、镜像或转置。

## 实时示例

示例默认输入 16×16 的 `[1, 2, ..., 256]`，可直接编辑 `params` JSON；工具栏按钮可重置相机视角。

<UiComponentDemo name="PointGridRenderer" />

## 最小用法

传 `frame` 即可，不需要 ref：

```jsx
import PointGridRenderer from 'shroom-backend-sdk/UI/frontend/renderers/pointGrid/react/PointGridRenderer.jsx'

export function PressurePoints({ matrix }) {
  return (
    <div style={{ height: 480 }}>
      <PointGridRenderer
        frame={matrix}
        params={{
          sit: { num1: 16, num2: 16, interp: 2, order: 4 },
          heightScale: 0.5,
          colorMax: 2560,
          filterMin: 0,
        }}
      />
    </div>
  )
}
```

需要调用 `sitValue`、`reset` 这些命令时再取 ref，两条通路可以同时用：

```jsx
const rendererRef = useRef(null)

useEffect(() => {
  rendererRef.current?.reset()
}, [])

return <PointGridRenderer ref={rendererRef} frame={matrix} backFrame={backMatrix} />
```

## 声明式 props

| prop | 类型 | 说明 |
| :--- | :--- | :--- |
| `frame` | `number[]` / `TypedArray` / `{ wsPointData }` | 主矩阵帧，变化时自动推给 `sitData` |
| `backFrame` | 同上 | 第二通道帧，自动推给 `backData` |
| `params` | `object` | 渲染参数，见下方[关键参数](#关键参数) |
| `local` | `boolean` | 回放模式，为真时不驱动宿主侧栏曲线 |
| `data` | `ref` | 宿主回调容器，需挂 `changeData` / `handleCharts` / `handleChartsArea` |
| `colormap` | `{ id, reverse }` | 配色方案，变化会整场重建 |
| `coordinateMap` | `object` | 物理坐标表，有则按实际点位布局 |

`frame` 按引用比较：**原地修改同一个数组不会触发重画**，高频通路请每帧给新数组，或改用 ref 上的 `sitData`。参数变化会整场重建场景，重建后当前 `frame` 会自动重推一次。

## 输入数据

- `sit.num1` 是行数，`sit.num2` 是列数；位置公式为 `data[row * sit.num2 + col]`，规则矩阵不会旋转、镜像或转置。
- `frame`（或 ref 上的 `sitData`）接收主矩阵，`backFrame`（或 `backData`）接收第二通道矩阵，两者应在协议层完成归一化。
- 实时与回放必须复用相同的行列、展开顺序和线序结果。

## 关键参数

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `sit` | `{ num1, num2, interp, order }` | 预设值 | 主矩阵尺寸和插值配置 |
| `back` | `{ num1, num2, interp, order }` | 预设值 | 第二通道尺寸和插值配置 |
| `separation` | `number` | `100` | 两个点阵区域的间距 |
| `fps` | `number` | 预设值 | 渲染和统计频率 |
| `heightScale` | `number` | 未设置 | 点阵高度倍率；越大峰值越高，设置 `0` 可显示为平面 |
| `colorMax` | `number` | 未设置 | 色阶归一化上限；越小越快进入红色，越大越容易保留完整渐变 |
| `filterMin` | `number` | 未设置 | 显式下限过滤；传 `0` 时保留原始矩阵数值 |
| `points` | `Array<[x, y]>` | `null` | 物理点位表；给了就按实际点位布局，非法项被丢弃，全非法时退回规则矩阵 |
| `pointSprite` | `string` | 包内圆点图 | 点精灵贴图 URL；更换会整场重建 |

取值范围会被静默钳制（`num1` / `num2` 上限 128，`interp` 上限 8，`order` 上限 16，`fps` 上限 120，`separation` 上限 1000，`heightScale` 上限 10，`colorMax` / `filterMin` 上限 65535）。超出范围不报错，按边界值渲染。

## 公开命令

| ref 方法 | 参数 | 作用 |
| :--- | :--- | :--- |
| `sitData` | `{ wsPointData }` | 提交主矩阵帧 |
| `backData` | `{ wsPointData }` | 提交第二通道帧 |
| `sitValue` | 阈值对象 | 更新主矩阵色阶和过滤参数 |
| `reset` | 无 | 重置相机和点阵姿态 |
| `changeGroupRotate` | `{ x?, z? }` | 调整点阵旋转 |

## 依赖

需要 React、React DOM 和 Three.js，并要求浏览器支持 WebGL。宿主容器应提供至少 320px 的稳定高度。
