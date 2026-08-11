# Renderer Params Editor Design

## Goal

为五个矩阵渲染器文档示例增加可编辑的 `params` JSON 代码区。使用者可以在页面内修改组件参数并重新运行真实 SDK 组件；演示数据统一改为从 1 开始、按数组长度连续递增的确定性数组。

## Scope

- 覆盖 `NumMatrixRenderer`、`PointGridRenderer`、`HandPointsRenderer`、`WebglHeatmapRenderer` 和 `BlobHeatmapRenderer`。
- 只编辑传给组件的 `params` 对象，不执行任意 JavaScript，也不编辑完整 JSX。
- 保留现有后端切换、视角重置、重新校准和色阶调节等组件命令。
- 不修改串口协议、采集数据、回放数据或渲染器公开 API。

## Interaction

每个示例由参数代码区、操作栏和画布组成。代码区显示格式化 JSON，提供“应用参数”命令和重置图标按钮；`Ctrl+Enter` 与“应用参数”等价。

应用成功时，解析后的对象替换当前组件 `params`。应用失败时显示简短的 JSON 错误，继续使用上一次有效参数，画布不卸载。重置恢复该组件的文档默认参数并立即应用。

## Data Flow

演示帧由纯函数生成：

```js
Array.from({ length }, (_, index) => index + 1)
```

数组长度来自当前已应用参数：

- `NumMatrixRenderer`: `gridWidth * gridHeight`
- `PointGridRenderer`: `sit.num1 * sit.num2`
- `HandPointsRenderer`: `sit.num1 * sit.num2`
- `WebglHeatmapRenderer`: `dataWidth * dataHeight`
- `BlobHeatmapRenderer`: `dataWidth * dataHeight`

参数代码仍在编辑但尚未应用时，不改变组件和数据。应用后同时重建参数和对应长度的递增数组，再通过既有 `sitData({ wsPointData })` 命令提交。

## Component Boundaries

新增共享 `ParamsEditor`，负责 JSON 文本、解析错误、应用、重置和快捷键。各演示组件只负责提供默认参数、计算帧长度并挂载真实渲染器。JSON 解析和序列帧生成保持为可单测的导出函数。

## Layout

参数编辑区是画布上方的全宽工具带，不放入嵌套卡片。桌面端显示约 8 行代码；移动端保持全宽、允许纵向滚动，应用和重置命令固定在编辑区下方，不与代码重叠。

## Error Handling

- JSON 根值必须是普通对象，数组、字符串、数字和 `null` 均拒绝。
- 解析或对象校验失败时保留最后一次有效参数。
- 渲染器自身仍由现有错误边界保护。
- 参数归一化继续由每个 SDK 渲染器内部完成。

## Verification

- Node 测试覆盖递增数组、参数 JSON 校验、五个示例均挂载参数编辑器及尺寸来源。
- 运行完整 `pnpm test` 和 `pnpm docs:build`。
- 浏览器验证至少修改一个二维渲染器和一个 Three/WebGL 渲染器参数，确认画布重建、错误 JSON 不会清空旧画面。
- 在桌面和 390px 移动端截图，检查代码区、命令和画布无横向溢出。
