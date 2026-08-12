---
aside: false
---

# PointGridRenderer

将二维压力矩阵渲染为可旋转的 Three.js 三维点阵，通过点高度和颜色展示压力分布，适合观察整体受力形状和峰值区域。

## 实时示例

示例默认输入 16×16 的 `[1, 2, ..., 256]`，可直接编辑 `params` JSON；工具栏按钮可重置相机视角。

<UiComponentDemo name="PointGridRenderer" />

## 最小用法

```jsx
import { useEffect, useRef } from 'react'
import PointGridRenderer from 'shroom-backend-sdk/UI/frontend/renderers/pointGrid/react/PointGridRenderer.jsx'

export function PressurePoints({ matrix }) {
  const rendererRef = useRef(null)

  useEffect(() => {
    rendererRef.current?.sitData({ wsPointData: matrix }, false)
  }, [matrix])

  return (
    <div style={{ height: 480 }}>
      <PointGridRenderer ref={rendererRef} params={{ sit: { num1: 16, num2: 16, interp: 2, order: 4 } }} />
    </div>
  )
}
```

## 输入数据

- `sit.num1 × sit.num2` 决定输入矩阵列数和行数；示例输入 256 项按行展开的数据。
- `sitData` 接收主矩阵，`backData` 可接收第二通道矩阵，两者应在协议层完成归一化。
- 实时与回放必须复用相同的行列、展开顺序和线序结果。

## 关键参数

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `sit` | `{ num1, num2, interp, order }` | 预设值 | 主矩阵尺寸和插值配置 |
| `back` | `{ num1, num2, interp, order }` | 预设值 | 第二通道尺寸和插值配置 |
| `separation` | `number` | `100` | 两个点阵区域的间距 |
| `fps` | `number` | 预设值 | 渲染和统计频率 |

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
