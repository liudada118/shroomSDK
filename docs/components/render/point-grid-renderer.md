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
import PointGridRenderer from 'shroom-backend-sdk/renderers/pointGrid'

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
| `points` | `Array<[x,y]>` / `Array<[x,y,z]>` | `null` | **已插值**的密集点位表，长度须等于渲染网格；`z` 作为该点基础高度 |
| `sparsePoints` | `Array<{X,Y,Z}>` | `null` | **稀疏**实测坐标表，长度为 `sit.num1 × sit.num2`，渲染器自动插值到网格 |
| `pointSprite` | `string` | 包内圆点图 | 点精灵贴图 URL；更换会整场重建 |

取值范围会被静默钳制（`num1` / `num2` 上限 128，`interp` 上限 8，`order` 上限 16，`fps` 上限 120，`separation` 上限 1000，`heightScale` 上限 10，`colorMax` / `filterMin` 上限 65535）。超出范围不报错，按边界值渲染。

## 按空间位置渲染

规则矩阵按 `separation` 等距铺点，表达不了弧面座垫、脚型鞋垫这类**物理点位不规则**的传感器。传一张实测坐标表即可按真实形状摆点。

```jsx
// 实测导出的坐标表：一个传感点一条记录，行优先
const seatCoordinates = [
  { X: 3520.99, Y: -2410.32, Z: 0 },
  { X: 3542.31, Y: -2419.34, Z: 0 },
  // ... 共 sit.num1 × sit.num2 条
]

<PointGridRenderer
  frame={matrix}
  params={{
    sit: { num1: 16, num2: 16, interp: 2, order: 4 },
    sparsePoints: seatCoordinates,
  }}
/>
```

### 两个参数的分工

| 参数 | 长度要求 | 谁来插值 |
| :--- | :--- | :--- |
| `sparsePoints` | `num1 × num2`（一个传感点一条） | 渲染器自动做 |
| `points` | `deriveGridSize().total`（与渲染网格等长） | 调用方自己做好 |

多数情况用 `sparsePoints`——实测表直接喂进去。两者都传时 `sparsePoints` 优先，因为它没被插值过、信息更完整。

### 字段说明

- **`X` / `Y`** 是平面位置。单位任意（mm、CAD 单位都可以），渲染器按整表的包围盒等比缩放到点阵范围，长边贴合、短边保持原始比例，所以长条形和异形传感器不会被拉成方形。
- **`Z` 是该点的基础高度**，压力值**叠加在它之上**。曲面传感器靠它表达自身形状：座垫的弧度、鞋垫的起伏在没有压力时就已经可见。Z 以整表均值为零点（实测坐标常带大偏置），并与 X/Y 共用同一个缩放系数，所以起伏比例不随点阵尺寸漂移。
- **字段可以是字符串**（`{ "X": "3528.398" }`）——实测导出常是这种格式，渲染器会转换。个别坏点归零而不是整表报废。

不需要基础高度就把 `Z` 填 `0`（或省略），行为与规则矩阵一致。

::: warning 长度必须精确匹配
`sparsePoints` 的长度不等于 `sit.num1 × sit.num2` 时会被**静默忽略**，退回规则矩阵。这是有意的：用尺寸不符的坐标表插值出来的是一团乱麻，而形状明显不对（退成等距网格）更容易发现问题。

改了 `num1` / `num2` 记得同步换坐标表。
:::

::: tip 插值顺序与压力管线对齐
坐标扩展走的是「先插值、再补边」，与压力管线的 `interpSmall → addSide` 一致，因此第 N 个坐标与第 N 个压力值指向同一个物理点位。参考实现 `carQXFbx.jsx` 的 `objdupli()` 是反过来的（先补边），点数不同（16×16/interp2/order4：2304 vs 1600），直接搬会让坐标和压力错位。
:::

### 纯算法层

坐标扩展是纯函数，可脱离 React 单独使用（比如在 Node 里预处理坐标表）：

```js
import {
  expandCoordinateGrid,
  toPointTable,
} from 'shroom-backend-sdk/core'

const dense = expandCoordinateGrid({
  table: seatCoordinates,
  rows: 16, cols: 16, interp: 2, order: 4,
})
const points = toPointTable(dense, { includeZ: true })   // 可直接作为 params.points
```

| 函数 | 作用 |
| :--- | :--- |
| `expandCoordinateGrid` | 插值 + 补边，输出与渲染网格等长的密集坐标表；输入不可用时返回 `null` |
| `interpolateCoordinateTable` | 单独做双线性插值（三轴独立） |
| `padCoordinateTable` | 单独做补边，越界处夹取最近边缘点而非补零 |
| `isCoordinateTable` | 校验坐标表是否可用，可带长度要求 |
| `toPointTable` | `{X,Y,Z}` 表转成 `[x,y]` / `[x,y,z]` 元组表 |

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
