---
aside: false
---

# HandPointsRenderer

将手套压力矩阵映射到手部点位和三维手模，用于同时查看压力分布、手部姿态和手指校准结果。

## 实时示例

示例默认输入 32×32 的 `[1, 2, ..., 1024]`，可直接编辑 `params` JSON；重新校准按钮会清除当前四元数基准。

<UiComponentDemo name="HandPointsRenderer" />

## 最小用法

传 `frame` 即可，不需要 ref：

```jsx
import HandPointsRenderer from 'shroom-backend-sdk/renderers/handPoints'

export function GlovePoints({ matrix }) {
  return (
    <div style={{ height: 520 }}>
      <HandPointsRenderer
        frame={matrix}
        params={{ sit: { num1: 32, num2: 32, interp: 2, order: 4 }, pointTable: 'gloves', maskMode: 'gloves', modelUrl: '' }}
      />
    </div>
  )
}
```

IMU 标定、关节清零这些命令仍走 ref，两条通路可以同时用：

```jsx
const rendererRef = useRef(null)
return <HandPointsRenderer ref={rendererRef} frame={matrix} />
```

## 声明式 props

| prop | 类型 | 说明 |
| :--- | :--- | :--- |
| `frame` | `number[]` / `TypedArray` / `{ wsPointData }` | 手部矩阵帧，变化时自动推给 `sitData` |
| `params` | `object` | 渲染参数，见下方[关键参数](#关键参数) |
| `local` | `boolean` | 回放模式，为真时不驱动宿主侧栏曲线 |
| `data` | `ref` | 宿主回调容器，需挂 `changeData` / `handleCharts` / `handleChartsArea` |
| `changeSelect` | `function` | 框选结果回调 |
| `colormap` | `{ id, reverse }` | 配色方案，变化会整场重建 |

`frame` 按引用比较：**原地修改同一个数组不会触发重画**，高频通路请每帧给新数组，或改用 ref 上的 `sitData`。参数变化会整场重建场景，重建后当前 `frame` 会自动重推一次。

## 输入数据

- 压力帧通过 `sitData({ wsPointData })` 输入，32×32 矩阵需要 1024 项并按行展开。
- 手套 256 点数据应先经过 `handLeft256To1024` 或 `handRight256To1024`，再交给渲染器。
- 姿态四元数通过 `changeHandAngle([x, y, z, w])` 独立输入，不应混入压力数组。

## 关键参数

### 几何

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `sit.num1` | `number` | `32` | 矩阵行数 |
| `sit.num2` | `number` | `32` | 矩阵列数 |
| `sit.interp` | `number` | `2` | 插值倍率 |
| `sit.order` | `number` | `4` | 边缘补边阶数 |
| `separation` | `number` | `100` | 点间距 |
| `fps` | `number` | `10` | 统计上报节流频率（不是 rAF 的节流） |

顶点数为 `(num1 × interp + order × 2) × (num2 × interp + order × 2)`。默认预设是 72×72 = 5184，`hand0205_147` 预设是 140×140 = 19600——**调大 `interp` 时顶点数按平方增长**。

### 点表与管线选路

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `pointTable` | `'gloves' \| 'glovesAlt' \| 'hand147'` | `'gloves'` | 选择点位表 |
| `maskMode` | `'gloves' \| 'hand147'` | `'gloves'` | 选择矩阵掩码规则 |
| `interpMode` | `'centered' \| 'ramp'` | `'centered'` | 插值实现 |
| `maskSource` | `'mask' \| 'value'` | `'mask'` | 判定"这个点是不是手"依据掩码还是压力 |

::: warning maskSource 是真实的行为差异
`'mask'` 用**掩码**模糊后的值判定，`'value'` 用**压力**模糊后的值判定。走 `'value'` 时掩码会算一整套（插值 + 补边 + 高斯）却完全不参与判定，只有压力低于 `maskThreshold` 的点被藏起来。两种都是原实现的既有行为，没有统一——统一就是可见的画面变化。
:::

### 观感

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `pointSize` | `number` | `0.3125`（5/16） | 点精灵大小 |
| `particleScale` | `[x, y, z]` 或 `number` | `[0.0011, 0.0011, 0.0011]` | 点云整体缩放；传单个数字等价于三轴相同 |
| `particlePosition` | `[x, y, z]` 或 `number` | `[1.5, 1.1, 3]` | 点云整体位移 |
| `rotationX` | `number` | `Math.PI` | 点云绕 X 轴旋转（弧度） |
| `rotationZ` | `number` | `Math.PI` | 点云绕 Z 轴旋转（弧度） |
| `pointSprite` | `string` | 包内圆点图 | 点精灵贴图 URL |

### 掩码

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `maskBlur` | `number` | `1.2` | 掩码高斯模糊半径 |
| `maskThreshold` | `number` | `50` | 判定阈值，低于此值的点会被藏起来 |
| `hiddenY` | `number` | `-100000` | 被藏起来的点挪到的 Y 坐标（负值，移出视野） |

### 手模与关节

手模是**可选**的运行期资源，SDK 不内置 GLB。不传 `modelUrl` 时只渲染点云。

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `modelUrl` | `string` | `''` | GLB 手模地址；留空只渲染点云 |
| `fingerBones` | `string[][]` | 见下 | 五指骨骼名，外层是手指、内层是该指从根到尖的骨节 |
| `fingerRotationScale` | `number` | `-Math.PI / 2` | 关节旋转系数：`bone.rotation.z = 本值 × value` |

`fingerBones` 默认对应 `hand1.glb` 的骨骼命名：

```js
[
  ['Finger_01', 'Finger_02'],                  // 拇指只有两节
  ['Finger_10', 'Finger_11', 'Finger_12'],
  ['Finger_20', 'Finger_21', 'Finger_22'],
  ['Finger_30', 'Finger_31', 'Finger_32'],
  ['Finger_40', 'Finger_41', 'Finger_42'],
]
```

取不到的骨骼在旋转时被**静默跳过**——换手模时若关节不动，先核对这张表的命名。

### 内置预设

`LEGACY_PRESETS` 提供三组经过逐帧一致性验证的参数，可从 core 层取用：

```js
import { LEGACY_PRESETS } from 'shroom-backend-sdk/renderers/handPoints/core'

<HandPointsRenderer frame={matrix} params={LEGACY_PRESETS.hand0205_147} />
```

| 预设 | 点表 | 差异 |
| :--- | :--- | :--- |
| `hand0205` | `gloves` | 默认组合 |
| `hand0205Alt` | `glovesAlt` | 仅换点位表，其余与 `hand0205` 相同 |
| `hand0205_147` | `hand147` | `interp: 4`、`order: 6`、`pointSize: 0.125`、`maskSource: 'value'`、`maskBlur: 1.5`、`hiddenY: -1000` |

### 取值范围

超出范围会被**静默钳制**到边界，不报错也不警告：`num1`/`num2` 1~128、`interp` 1~8、`order` 0~16、`fps` 1~120、`separation` 1~1000、`pointSize` 0.001~100、`maskBlur` 0~20、`maskThreshold` 0~1e6、`hiddenY` -1e9~0。

## 公开命令

| ref 方法 | 参数 | 作用 |
| :--- | :--- | :--- |
| `sitData` | `{ wsPointData }` | 提交压力矩阵 |
| `sitValue` | 阈值对象 | 更新色阶和过滤参数 |
| `changeHandAngle` | `[x, y, z, w]` | 更新手部四元数姿态 |
| `calibration` | 手指角度数组 | 校准手指骨骼 |
| `resetHand` | 无 | 清除姿态基准并等待下一帧重新取零位 |
| `handZero` | 无 | 恢复手部零位 |

## 依赖

需要 React、React DOM、Three.js 和浏览器 WebGL。使用手模时还需把 GLB 资源部署到 `modelUrl` 指定的同源地址。
