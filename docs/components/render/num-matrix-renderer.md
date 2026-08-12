---
aside: false
---

# NumMatrixRenderer

将规范化矩阵渲染为带数值的彩色网格，适合调试传感器读数和核对线序。通过 `backend` 可切换 Canvas 2D、WebGL 或 Three.js 精灵矩阵。

## 实时示例

示例默认输入 16×16 的 `[1, 2, ..., 256]`，可直接编辑 `params` JSON；应用后会按新的行列数重新生成递增数组。仍可切换 Canvas 2D 和 WebGL 后端。

<UiComponentDemo name="NumMatrixRenderer" />

## 最小用法

```jsx
import { useEffect, useRef } from 'react'
import NumMatrixRenderer from 'shroom-backend-sdk/UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx'

export function MatrixValues({ matrix }) {
  const rendererRef = useRef(null)

  useEffect(() => {
    rendererRef.current?.sitData({ wsPointData: matrix }, false)
  }, [matrix])

  return (
    <div style={{ height: 480 }}>
      <NumMatrixRenderer
        ref={rendererRef}
        params={{ backend: 'canvas2d', gridWidth: 16, gridHeight: 16, manageSidebar: false }}
      />
    </div>
  )
}
```

## 输入数据

- `wsPointData` 是按行展开的一维数值数组，16×16 对应 256 项，32×32 对应 1024 项。
- 协议解析、线序转换和清零应在传入组件前完成，组件接收 normalized matrix。
- 实时数据和回放数据使用同一结构；渲染阈值不会写回采集帧。

## 关键参数

| 参数 | 类型 | 默认值 | 作用 |
| :--- | :--- | :--- | :--- |
| `backend` | `'canvas2d' \| 'webgl' \| 'sprite3d'` | `'sprite3d'` | 选择渲染后端 |
| `gridWidth` | `number` | 由预设决定 | 矩阵列数 |
| `gridHeight` | `number` | 由预设决定 | 矩阵行数 |
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
