---
aside: false
---

# HandPointsRenderer

将手套压力矩阵映射到手部点位和三维手模，用于同时查看压力分布、手部姿态和手指校准结果。

## 实时示例

示例默认输入 32×32 的 `[1, 2, ..., 1024]`，可直接编辑 `params` JSON；重新校准按钮会清除当前四元数基准。

<UiComponentDemo name="HandPointsRenderer" />

## 最小用法

```jsx
import { useEffect, useRef } from 'react'
import HandPointsRenderer from 'shroom-backend-sdk/UI/frontend/renderers/handPoints/react/HandPointsRenderer.jsx'

export function GlovePoints({ matrix }) {
  const rendererRef = useRef(null)

  useEffect(() => {
    rendererRef.current?.sitData({ wsPointData: matrix }, false)
  }, [matrix])

  return (
    <div style={{ height: 520 }}>
      <HandPointsRenderer
        ref={rendererRef}
        params={{ sit: { num1: 32, num2: 32, interp: 2, order: 4 }, pointTable: 'gloves', maskMode: 'gloves', modelUrl: '' }}
      />
    </div>
  )
}
```

## 输入数据

- 压力帧通过 `sitData({ wsPointData })` 输入，32×32 矩阵需要 1024 项并按行展开。
- 手套 256 点数据应先经过 `handLeft256To1024` 或 `handRight256To1024`，再交给渲染器。
- 姿态四元数通过 `changeHandAngle([x, y, z, w])` 独立输入，不应混入压力数组。

## 关键参数

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `sit` | `{ num1, num2, interp, order }` | 预设值 | 压力矩阵尺寸和插值 |
| `pointTable` | `'gloves'` 或点位数组 | `'gloves'` | 选择手套点位表 |
| `maskMode` | `'gloves' \| 'hand147'` | `'gloves'` | 选择矩阵掩码规则 |
| `modelUrl` | `string` | `''` | 可选 GLB 手模地址；留空时只渲染点云 |

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
