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
import NumMatrixRenderer from 'shroom-backend-sdk/renderers/numMatrix'

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

### 通用

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `backend` | `'sprite3d' \| 'canvas2d' \| 'webgl'` | `'sprite3d'` | 选择渲染后端；填未知值退回 `sprite3d` |
| `gridWidth` | `number` | `0` | 矩阵列数；`0` 表示由 `size` 推导为 `64 / size` |
| `gridHeight` | `number` | `0` | 矩阵行数；同上 |
| `size` | `number` | `2` | 格子放大倍率，仅在 `gridWidth/Height` 为 `0` 时参与推导 |
| `filterMin` | `number` | 未设置 | 显式下限过滤；传 `0` 时保留原始矩阵数值 |
| `decimalScale` | `number` | `1` | 定点小数倍率；`10` 表示数据放大过 10 倍，显示时除回并保留一位 |
| `textureValueMax` | `number` | `0` | 精灵图覆盖的最大数值；`0` 为自动推导。数据量程已知时锁死可省掉重烘纹理 |
| `canvasHeightRatio` | `{ compact, normal }` | `{ 0.6, 0.8 }` | 画布边长占视口高度的比例，`compact` 用于宽度 <750px 的小屏 |
| `cameraControls` | `boolean` | `true` | 是否装滚轮缩放与拖拽平移 |
| `retintOnThresholdChange` | `boolean` | `true` | 阈值（`valuej`）变化时是否重烘精灵图 |
| `totalMetric` | `'sum' \| 'max'` | `'sum'` | 侧栏「合力」取和还是取最大值 |
| `manageSidebar` | `boolean` | `true` | 是否由本渲染器回写侧栏统计；`false` 时交给外层 |
| `sharedTuningKey` | `string` | `null` | 共享阈值对象的键。非空时多个实例共用一份调参，切换展示形式不重置 |
| `statsBeforeFilter` | `boolean` | `false` | 侧栏统计取过滤前还是过滤后的帧。两者「合力」差 `filterMin × 受压点数` |

### 侧栏曲线

仅在 `manageSidebar: true` 时生效。

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `chartWindow` | `number` | `20` | 滚动曲线窗口长度 |
| `chartPadding` | `number` | `1000` | 总压曲线 Y 轴留白 |
| `pointChartPadding` | `number` | `100` | 受压点数曲线 Y 轴留白 |
| `totalChartOffset` | `number` | `0` | 画总压曲线前每点减去的常数（减完不小于 0），**只影响曲线不影响画面** |

### 分压重分配

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `pressureRedistribution.enabled` | `boolean` | `false` | 是否启用分压重分配 |
| `pressureRedistribution.rows` | `number` | `23` | 重分配行数 |
| `pressureRedistribution.cols` | `number` | `23` | 重分配列数 |
| `pressureRedistribution.axis` | `'col' \| 'row'` | `'col'` | 重分配方向 |

### `canvas2d` 后端专属

走其他后端时忽略。

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `canvas2d.cellWidth` | `number` | `32` | 单格宽（px） |
| `canvas2d.cellHeight` | `number` | `24` | 单格高（px） |
| `canvas2d.extraTop` | `number` | `200` | 画布顶部留白，给"升起来"的数字用 |
| `canvas2d.fontScale` | `number` | `20` | 字号基准；实际字号 = `max(8, round(视口宽 / 1920 × 本值))` |
| `canvas2d.textHeight` | `number` | `3` | 每 1 单位数值往上抬几像素 |
| `canvas2d.textColorMax` | `number` | `30` | 文字 jet 色标上限 |
| `canvas2d.colorValueScale` | `number` | `5` | 取色前先把数值放大几倍 |
| `canvas2d.blurSigma` | `number` | `0` | 高斯平滑强度；`0` 为原值展示 |
| `canvas2d.baseTiltDeg` | `number` | `20` | `rotateX` 初始倾角（度） |
| `canvas2d.rotationPresets` | `number[]` | `[0, π/6, π/3]` | 旋转命令的可选角度（弧度） |

::: warning 格尺寸决定能显示多大的矩阵
`cellWidth × cellHeight` 和矩阵尺寸相乘就是画布尺寸——32×24 的格子铺 64×64 会得到 2048×1736 的画布，超出多数屏幕。换大矩阵时这两个值必须一起调小。
:::

### `webgl` 后端专属

走其他后端时忽略。`variant` 是下面这批开关的**预设选择器**，选完之后每一项都可以单独覆盖。

| 参数 | 类型 | `plain` 默认 | `original` 默认 | 作用 |
| :--- | :--- | :--- | :--- | :--- |
| `webgl.variant` | `'plain' \| 'original'` | `'plain'` | — | 选择下面这组开关的预设 |
| `webgl.useMask` | `boolean` | `false` | `true` | 是否发送掩码纹理（分区布局靠它涂白空隙） |
| `webgl.whiteOnZero` | `boolean` | `false` | `true` | 0 值输出白色还是走配色 |
| `webgl.potTexture` | `boolean` | `false` | `true` | 纹理是否补到 2 的幂尺寸 |
| `webgl.maxFromThreshold` | `boolean` | `false` | `true` | 色标上限取阈值还是本帧最大值 |
| `webgl.retintOnTuning` | `boolean` | `false` | `true` | 拖阈值时是否重画最后一帧 |
| `webgl.rawTranspose` | `boolean` | `false` | `false` | 裸数据是否转置，**仅在宽高相等时生效** |
| `webgl.gridColor` | `string` | `rgba(0,0,40,0.6)` | `rgba(200,200,220,0.8)` | 网格线颜色 |
| `webgl.zeroTextColor` | `string \| null` | `null` | `'#999'` | 0 值格子字色；`null` 表示与 `textColor` 相同 |
| `webgl.indexRow` | `boolean` | `false` | `true` | 底部是否画列号带 |
| `webgl.overlayPad` | `number` | `0` | `30` | 叠加层比热场大出来的边（px），列号带和分区标题画在这里 |
| `webgl.refitOnSizeChange` | `boolean` | `false` | `true` | 纹理换尺寸时是否重算格子边长 |

两个变体共用的项：

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `webgl.widthRatio` | `number` | `0.4` | 矩阵占视口宽度的比例 |
| `webgl.cellPadding` | `number` | `40` | 格子边距 |
| `webgl.fixedCellSize` | `number` | `0` | 格子边长写死值；`0` 表示按视口算 |
| `webgl.textColor` | `string` | `'#fff'` | 数字颜色 |
| `webgl.titleColor` | `string` | `'#ccc'` | 分区标题颜色 |
| `webgl.indexRowColor` | `string` | `rgba(30,60,200,0.85)` | 列号带颜色 |
| `webgl.showNumbers` | `boolean` | `true` | 是否画数字 |
| `webgl.showBorder` | `boolean` | `true` | 是否画边框 |
| `webgl.glovePrimeOnMount` | `boolean` | `false` | 挂载时先推一帧全 0，避免上电到首帧之间整片纯白 |

三条专用布局通路，优先级为 **glove > foot > robot**：

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `webgl.glove.enabled` | `boolean` | `false` | 走手套通路 |
| `webgl.glove.mode` | `'scatter32' \| 'rows15'` | 随 variant | 147 点手套的铺法，**两者点位表完全不同** |
| `webgl.glove.width` / `.height` | `number` | 随 variant | 手套初始纹理尺寸（格） |
| `webgl.foot.enabled` | `boolean` | `false` | 走足底通路 |
| `webgl.foot.mode` | `'interp' \| 'raw'` | 随 variant | `interp` 为 60 点散布后插值，`raw` 为 6×10 原样上屏 |
| `webgl.foot.width` / `.height` | `number` | 随 variant | 足底纹理尺寸（格） |
| `webgl.foot.ttlMs` | `number` | `1200` | 单/双脚布局探测窗口。太短会在丢包时抖成单脚，太长则拔掉一只脚后半天不收版面 |
| `webgl.robot.enabled` | `boolean` | `false` | 走分区布局 |
| `webgl.robot.name` | `string` | `''` | 内置分区表键名；`parts` 非空时忽略 |
| `webgl.robot.gap` | `number` | `2` | 分区间距（格） |
| `webgl.robot.widthRatio` | `number` | `0.6` | 分区布局的视口占比 |
| `webgl.robot.parts` | `Array` | `null` | 自定义分区表 `{key, text, w, h, posArr}`，**加一款新设备不用改渲染器** |

### 取值范围

超出范围会被**静默钳制**到边界，不报错也不警告。主要上限：`size` 64、`gridWidth`/`gridHeight` 256、`textureValueMax` 4095、`decimalScale` 100、`filterMin` 65535、`chartWindow` 600、`cellWidth`/`cellHeight` 256、`fontScale` 200、`blurSigma` 20、`baseTiltDeg` ±180、`widthRatio` 0.1~1。

## 公开命令

| ref 方法 | 参数 | 作用 |
| :--- | :--- | :--- |
| `sitData` | `({ wsPointData }, local?)` | 提交一帧 normalized matrix |
| `sitValue` | `{ valuej?, valuef?, ... }` | 更新色阶和过滤阈值 |
| `changeWsData` | `number[]` | 直接提交矩阵数组 |
| `reset` | 无 | 重置支持该命令的后端视角 |

## 依赖

需要 React、React DOM 和 Three.js。组件容器必须具有明确高度；仅使用纯逻辑时可导入 `UI/frontend/renderers/numMatrix/core`，无需加载 React。
