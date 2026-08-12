# 前端渲染器模块

`renderers/` 是可以整体迁入其他总 SDK 的渲染实现目录。一个展示形式的纯数据处理和 React 画面实现放在同一个纵向模块中，不再散落到顶层 `core/` 与 `react/`。

## 目录

| 目录 | 展示形式 | 说明 |
| --- | --- | --- |
| `numMatrix/` | 2D 数字、3D 数字 | 同一数字矩阵渲染器，通过 backend 参数切换 Canvas、精灵 3D 或 WebGL |
| `pointGrid/` | 3D 点图 | 三维点阵、框选和旋转 |
| `handPoints/` | 手部 3D 点云 | 手模型、压力点云和 IMU 旋转；不是 UV 贴肤热力图 |
| `blobHeatmap/` | Canvas 热力图 | Canvas 2D 斑点热力 |
| `webglHeatmap/` | WebGL 热力图 | WebGL 斑点叠加热力 |
| `shared/` | 渲染专用共享工具 | Three 框选/点选和 WebGL 工具 |

每个渲染器包含：

- `core/`：参数归一化、点位布局、帧算法和着色器源码，可在无 DOM 环境中测试。
- `react/`：React 组件、Three/WebGL/Canvas 生命周期和命令方法。

## 搬到另一个总 SDK

整体复制 `renderers/` 后，需要由宿主提供以下同级模块：

- `core/contract.js`、`core/registry.js`：渲染器能力契约、注册和按需加载。
- `core/frameMath.js`、`core/colormaps.js`、`core/jetLadder.js`：通用帧算法与配色。
- `core/displayThresholds.js`、`core/coordinatePointLayout.js`：阈值和坐标布局。
- `core/bed4096numParams.js`：数字矩阵的共享 4096 点参数。
- `core/greyLadder.js`、`core/rainbowLadder.js`：点阵和手部点云使用的历史色阶。

推荐保持目录关系为：

```text
frontend/
├─ core/          # 总 SDK 提供的公共契约与帧工具
├─ react/         # RendererHost、useSceneFrame
└─ renderers/     # 本目录，可整体复制
```

新代码优先从 `@shroom/frontend/renderers` 或 `@shroom/frontend/renderers/<渲染器>/...` 导入。旧的 `core/<渲染器>`、`react/<渲染器>` 包路径由 `package.json#exports` 兼容映射，不需要保留重复文件。
