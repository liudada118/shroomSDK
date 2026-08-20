# Matrix Renderers Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将五套新增矩阵渲染器整理到 `UI/frontend` 包边界，提供可按需导入的 SDK 入口，并在 VitePress“矩阵渲染”分组中为每套渲染器提供真实交互页面。

**Architecture:** `UI/frontend/core` 保留公共契约、注册表和帧工具，五套渲染器迁入同级 `UI/frontend/renderers`，每套继续按 `core` 与 `react` 分层。`UI/frontend/renderers/index.js` 只静态导出纯逻辑和注册函数，React/Three/WebGL 组件通过深路径或 registry 的动态 `import()` 按需加载；文档桥接组件直接挂载真实 React 渲染器并用统一模拟矩阵驱动。

**Tech Stack:** pnpm, Node.js 22, React 18, Three.js 0.170, Canvas 2D, WebGL, Vitest 2, VitePress 1.6

## Global Constraints

- 五套渲染器归入现有“矩阵渲染 render”分类，与 `TerrainMap` 并列。
- 渲染器只接收协议解析、线序处理和清零后的 normalized matrix；不连接串口，不负责采集、回放或下载。
- 保留 `UI/render/TerrainMap`，不合并或重写为新 registry 模式。
- React 渲染组件保持按需加载；纯逻辑入口不得静态导入 React、Three 或 JSX。
- 实时和回放使用相同矩阵输入结构；展示插值、阈值和配色不得写回采集数据。
- 文档标题使用英文组件名，说明文字使用中文。
- 不改动工作区中与本功能无关的现有修改。

---

### Task 1: Establish The Frontend Package Boundary

**Files:**
- Move: `UI/renderers/` -> `UI/frontend/renderers/`
- Create: `UI/frontend/index.js`
- Create: `UI/frontend/package.json`
- Create: `UI/frontend/styles/canvas.css`
- Create: `tests/frontend-renderers-structure.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: existing `UI/frontend/core/*.js` public contracts and frame utilities.
- Produces: `UI/frontend/index.js`, `@shroom/frontend` package metadata, and a stable `UI/frontend/renderers` directory used by every later task.

- [ ] **Step 1: Write the failing structure test**

Create `tests/frontend-renderers-structure.test.mjs`:

```js
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const rendererNames = ['numMatrix', 'pointGrid', 'handPoints', 'webglHeatmap', 'blobHeatmap']

test('renderer families live beside frontend core', () => {
  assert.equal(existsSync(new URL('../UI/renderers', import.meta.url)), false)
  for (const name of rendererNames) {
    assert.equal(existsSync(new URL(`../UI/frontend/renderers/${name}/core/index.js`, import.meta.url)), true)
    assert.equal(existsSync(new URL(`../UI/frontend/renderers/${name}/react`, import.meta.url)), true)
  }
})

test('frontend package exposes core and renderer entry points', () => {
  const pkg = JSON.parse(readFileSync(new URL('../UI/frontend/package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./core'], './core/index.js')
  assert.equal(pkg.exports['./renderers'], './renderers/index.js')
  assert.equal(pkg.exports['./renderers/*'], './renderers/*')
  assert.ok(pkg.files.includes('renderers'))
  assert.ok(pkg.files.includes('!renderers/**/*.test.js'))
})
```

- [ ] **Step 2: Run the structure test and verify it fails**

Run: `node --test tests/frontend-renderers-structure.test.mjs`

Expected: FAIL because `UI/frontend/renderers` and `UI/frontend/package.json` do not exist.

- [ ] **Step 3: Verify and move the directory without deleting unrelated files**

Run this PowerShell after confirming both resolved paths remain under `E:\ShroomSDK\UI`:

```powershell
$ui = (Resolve-Path 'E:\ShroomSDK\UI').Path
$source = (Resolve-Path 'E:\ShroomSDK\UI\renderers').Path
$targetParent = (Resolve-Path 'E:\ShroomSDK\UI\frontend').Path
$target = Join-Path $targetParent 'renderers'
if (-not $source.StartsWith($ui) -or -not $target.StartsWith($ui)) { throw 'renderer path escaped UI root' }
if (Test-Path -LiteralPath $target) { throw 'UI/frontend/renderers already exists' }
Move-Item -LiteralPath $source -Destination $target
```

- [ ] **Step 4: Add the frontend entry and package metadata**

Create `UI/frontend/index.js`:

```js
export * from './core/index.js'
export * as renderers from './renderers/index.js'
```

Create `UI/frontend/package.json` with these exact public boundaries:

```json
{
  "name": "@shroom/frontend",
  "version": "0.2.0",
  "type": "module",
  "main": "./index.js",
  "files": [
    "index.js",
    "core",
    "renderers",
    "styles",
    "!**/*.test.js",
    "!docs",
    "!**/node_modules",
    "!**/dist",
    "!**/.vite"
  ],
  "exports": {
    ".": "./index.js",
    "./core": "./core/index.js",
    "./core/*": "./core/*",
    "./renderers": "./renderers/index.js",
    "./renderers/*": "./renderers/*",
    "./renderers/numMatrix/core": "./renderers/numMatrix/core/index.js",
    "./renderers/pointGrid/core": "./renderers/pointGrid/core/index.js",
    "./renderers/handPoints/core": "./renderers/handPoints/core/index.js",
    "./renderers/webglHeatmap/core": "./renderers/webglHeatmap/core/index.js",
    "./renderers/blobHeatmap/core": "./renderers/blobHeatmap/core/index.js",
    "./react/three/*": "./renderers/shared/three/*",
    "./react/webgl/*": "./renderers/shared/webgl/*"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "three": ">=0.150.0"
  }
}
```

- [ ] **Step 5: Add the renderer host CSS boundary**

Create `UI/frontend/styles/canvas.css` with a scoped, stable host size:

```css
.canvasNum {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  background: #071018;
}

.canvasNum canvas {
  display: block;
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 6: Add Vitest and renderer scripts with pnpm**

Run: `pnpm add -D vitest@^2.1.9`

Modify root `package.json` scripts to include:

```json
"test:renderers": "vitest run UI/frontend/core UI/frontend/renderers",
"test": "node --test tests/*.test.mjs && pnpm test:types && pnpm test:renderers && node -e \"require('./index'); console.log('SDK loaded')\""
```

Add root publish exclusions:

```json
"!UI/**/*.test.js",
"!UI/frontend/docs"
```

- [ ] **Step 7: Run the structure test and renderer test discovery**

Run: `node --test tests/frontend-renderers-structure.test.mjs`

Expected: PASS.

Run: `pnpm test:renderers -- --passWithNoTests`

Expected: tests are discovered; failures caused by duplicate old renderer core paths are handled in Task 2, while module-not-found errors for `frontend/core` are not acceptable.

- [ ] **Step 8: Commit the package boundary**

```powershell
git add UI/frontend package.json pnpm-lock.yaml tests/frontend-renderers-structure.test.mjs
git commit -m "refactor: place matrix renderers in frontend package"
```

---

### Task 2: Make Renderer Core Modules Canonical

**Files:**
- Modify: `UI/frontend/core/index.js`
- Modify: `UI/frontend/core/matrixDisplayModes.js`
- Modify: `UI/frontend/renderers/structure.test.js`
- Modify: `UI/frontend/package.json`
- Remove after byte/semantic comparison: `UI/frontend/core/numMatrix/`
- Remove after byte/semantic comparison: `UI/frontend/core/pointGrid/`
- Remove after byte/semantic comparison: `UI/frontend/core/handPoints/`
- Remove after byte/semantic comparison: `UI/frontend/core/webglHeatmap/`
- Remove after byte/semantic comparison: `UI/frontend/core/blobHeatmap/`

**Interfaces:**
- Consumes: `UI/frontend/renderers/<id>/core/index.js` and each core module's named exports.
- Produces: one canonical implementation per renderer, while `UI/frontend/core/index.js` continues exposing prefixed compatibility aliases.

- [ ] **Step 1: Run the moved structure test and capture the duplicate-path failure**

Run: `pnpm exec vitest run UI/frontend/renderers/structure.test.js`

Expected: FAIL on assertions that `../core/numMatrix`, `../core/pointGrid`, `../core/handPoints`, `../core/webglHeatmap`, and `../core/blobHeatmap` have been removed.

- [ ] **Step 2: Compare old and new renderer core trees before removal**

For every renderer id, run:

```powershell
git diff --no-index -- UI/frontend/core/numMatrix UI/frontend/renderers/numMatrix/core
git diff --no-index -- UI/frontend/core/pointGrid UI/frontend/renderers/pointGrid/core
git diff --no-index -- UI/frontend/core/handPoints UI/frontend/renderers/handPoints/core
git diff --no-index -- UI/frontend/core/webglHeatmap UI/frontend/renderers/webglHeatmap/core
git diff --no-index -- UI/frontend/core/blobHeatmap UI/frontend/renderers/blobHeatmap/core
```

Expected: differences are limited to comments or the migrated renderer versions. Treat `UI/frontend/renderers/<id>/core` as authoritative; do not remove a unique exported behavior until its equivalent is confirmed in that tree.

- [ ] **Step 3: Redirect frontend core exports to canonical renderer modules**

In `UI/frontend/core/index.js`, replace the five `./<id>/...` export paths with `../renderers/<id>/core/...`. Preserve all current public names, including:

```js
export * as numMatrix from '../renderers/numMatrix/core/index.js'
export { LEGACY_PRESETS as NUM_MATRIX_PRESETS, normalizeNumMatrixParams } from '../renderers/numMatrix/core/params.js'
export * as pointGrid from '../renderers/pointGrid/core/index.js'
export { LEGACY_PRESETS as POINT_GRID_PRESETS, normalizePointGridParams } from '../renderers/pointGrid/core/params.js'
export * as handPoints from '../renderers/handPoints/core/index.js'
export { LEGACY_PRESETS as HAND_POINTS_PRESETS, normalizeHandPointsParams } from '../renderers/handPoints/core/params.js'
export * as webglHeatmap from '../renderers/webglHeatmap/core/index.js'
export { LEGACY_PRESETS as WEBGL_HEATMAP_PRESETS, normalizeWebglHeatmapParams } from '../renderers/webglHeatmap/core/params.js'
export * as blobHeatmap from '../renderers/blobHeatmap/core/index.js'
export { LEGACY_PRESETS as BLOB_HEATMAP_PRESETS, normalizeBlobHeatmapParams } from '../renderers/blobHeatmap/core/params.js'
```

Update `UI/frontend/core/matrixDisplayModes.js` imports to the same canonical `../renderers/<id>/core/params.js` paths.

- [ ] **Step 4: Add old package-path compatibility exports**

Add these exact entries to `UI/frontend/package.json#exports`:

```json
"./core/numMatrix": "./renderers/numMatrix/core/index.js",
"./core/numMatrix/*": "./renderers/numMatrix/core/*",
"./core/pointGrid": "./renderers/pointGrid/core/index.js",
"./core/pointGrid/*": "./renderers/pointGrid/core/*",
"./core/handPoints": "./renderers/handPoints/core/index.js",
"./core/handPoints/*": "./renderers/handPoints/core/*",
"./core/webglHeatmap": "./renderers/webglHeatmap/core/index.js",
"./core/webglHeatmap/*": "./renderers/webglHeatmap/core/*",
"./core/blobHeatmap": "./renderers/blobHeatmap/core/index.js",
"./core/blobHeatmap/*": "./renderers/blobHeatmap/core/*",
"./react/numMatrix/*": "./renderers/numMatrix/react/*",
"./react/pointGrid/*": "./renderers/pointGrid/react/*",
"./react/handPoints/*": "./renderers/handPoints/react/*",
"./react/webglHeatmap/*": "./renderers/webglHeatmap/react/*",
"./react/blobHeatmap/*": "./renderers/blobHeatmap/react/*"
```

- [ ] **Step 5: Remove only the verified duplicate renderer-core directories**

Resolve each target, verify it starts with `E:\ShroomSDK\UI\frontend\core\`, then remove those five directories using `Remove-Item -LiteralPath <verified-path> -Recurse`. Do not remove the shared files directly under `UI/frontend/core`.

- [ ] **Step 6: Run canonical-core tests**

Run: `pnpm exec vitest run UI/frontend/renderers UI/frontend/core`

Expected: PASS, including structure assertions and legacy parameter/pipeline tests.

- [ ] **Step 7: Commit canonical core integration**

```powershell
git add UI/frontend/core UI/frontend/renderers UI/frontend/package.json
git commit -m "refactor: make renderer core modules canonical"
```

---

### Task 3: Expose And Verify Renderer Registration

**Files:**
- Modify: `UI/index.js`
- Create: `tests/frontend-renderers-public-api.test.mjs`
- Modify: `UI/frontend/renderers/builtins.test.js`

**Interfaces:**
- Consumes: `registerBuiltinRenderers()`, `listRenderers()`, `loadRenderer(id)`, `resetRendererRegistry()`.
- Produces: `MatrixRenderers` namespace from `shroom-backend-sdk/UI` and five valid lazy renderer descriptors.

- [ ] **Step 1: Write the failing public API test**

Create `tests/frontend-renderers-public-api.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import { listRenderers, resetRendererRegistry } from '../UI/frontend/core/registry.js'
import { registerBuiltinRenderers } from '../UI/frontend/renderers/index.js'

test('registers five matrix renderers idempotently', () => {
  resetRendererRegistry()
  assert.equal(registerBuiltinRenderers(), 5)
  assert.deepEqual(listRenderers().map(({ id }) => id).sort(), [
    'blobHeatmap', 'handPoints', 'numMatrix', 'pointGrid', 'webglHeatmap',
  ])
  assert.equal(registerBuiltinRenderers(), 5)
  assert.equal(listRenderers().length, 5)
})
```

- [ ] **Step 2: Run the public API test and verify the current failure**

Run: `node --test tests/frontend-renderers-public-api.test.mjs`

Expected: FAIL if any moved import, descriptor, capability, or method name is invalid.

- [ ] **Step 3: Export the renderer namespace from the UI SDK**

Append to `UI/index.js`:

```js
export * as Frontend from './frontend/index.js'
export * as MatrixRenderers from './frontend/renderers/index.js'
```

Do not export React renderer components statically from this file.

- [ ] **Step 4: Fix only descriptor/import failures reported by tests**

Keep the five ids and lazy imports exactly:

```js
load: () => import('./numMatrix/react/NumMatrixRenderer.jsx')
load: () => import('./pointGrid/react/PointGridRenderer.jsx')
load: () => import('./handPoints/react/HandPointsRenderer.jsx')
load: () => import('./webglHeatmap/react/WebglHeatmapRenderer.jsx')
load: () => import('./blobHeatmap/react/BlobHeatmapRenderer.jsx')
```

Do not replace them with static imports.

- [ ] **Step 5: Run registry and public API tests**

Run: `node --test tests/frontend-renderers-public-api.test.mjs`

Run: `pnpm exec vitest run UI/frontend/core/registry.test.js UI/frontend/renderers/builtins.test.js`

Expected: PASS.

- [ ] **Step 6: Commit SDK registration**

```powershell
git add UI/index.js UI/frontend/renderers/builtins.test.js tests/frontend-renderers-public-api.test.mjs
git commit -m "feat: expose matrix renderer registry"
```

---

### Task 4: Build Real Interactive Documentation Demos

**Files:**
- Create: `docs/.vitepress/theme/components/MatrixRendererDemos.jsx`
- Create: `docs/.vitepress/theme/components/matrix-renderer-demos.css`
- Modify: `docs/.vitepress/theme/components/ComponentDemo.jsx`
- Modify: `docs/.vitepress/theme/index.js`

**Interfaces:**
- Consumes: each renderer's default React component and imperative `sitData({ wsPointData }, local)` method.
- Produces: demo names `NumMatrixRenderer`, `PointGridRenderer`, `HandPointsRenderer`, `WebglHeatmapRenderer`, and `BlobHeatmapRenderer` for `<UiComponentDemo name="..." />`.

- [ ] **Step 1: Add a failing documentation-demo mapping test**

Create `tests/matrix-renderer-docs.test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../docs/.vitepress/theme/components/MatrixRendererDemos.jsx', import.meta.url), 'utf8')
const names = ['NumMatrixRenderer', 'PointGridRenderer', 'HandPointsRenderer', 'WebglHeatmapRenderer', 'BlobHeatmapRenderer']

test('exports every real matrix renderer demo', () => {
  for (const name of names) assert.match(source, new RegExp(`${name}:`))
  assert.match(source, /sitData\(\{ wsPointData: frame \}/)
})
```

- [ ] **Step 2: Run it and verify it fails because the demo module is missing**

Run: `node --test tests/matrix-renderer-docs.test.mjs`

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Create a shared live-frame hook and renderer shell**

In `MatrixRendererDemos.jsx`, import all five components by their exact deep paths. Add `createMatrixFrame(tick, width, height)` using four Gaussian peaks and `useRendererFrame(ref, frame)` that invokes:

```jsx
useEffect(() => {
  rendererRef.current?.sitData({ wsPointData: frame }, false)
}, [frame, rendererRef])
```

Add a `RendererDemoShell` with a stable `min-height`, a compact control bar, an error boundary/fallback text `渲染器初始化失败`, and no feature-description prose inside the live surface.

- [ ] **Step 4: Implement the five demo wrappers with exact presets**

Use these configurations:

```jsx
<NumMatrixRenderer ref={ref} params={{ backend: 'canvas2d', gridWidth: 16, gridHeight: 16, manageSidebar: false }} />
<PointGridRenderer ref={ref} params={{ sit: { num1: 16, num2: 16, interp: 2, order: 4 }, back: { num1: 2, num2: 2, interp: 1, order: 2 }, separation: 0 }} />
<HandPointsRenderer ref={ref} params={{ sit: { num1: 32, num2: 32, interp: 2, order: 4 }, pointTable: 'gloves', maskMode: 'gloves' }} />
<WebglHeatmapRenderer ref={ref} params={{ dataWidth: 32, dataHeight: 32, canvasWidth: 512, canvasHeight: 512, displaySize: 'min(100%, 540px)', minFrameLength: 1, edgeClear: null, mirrorX: false }} />
<BlobHeatmapRenderer ref={ref} params={{ dataWidth: 32, dataHeight: 32, canvasScale: 0.55, radius: 24, max: 255 }} />
```

For `NumMatrixRenderer`, feed a 16×16 frame. Feed 32×32 frames to the remaining heatmap/hand demos; for `PointGridRenderer`, pass a 16×16 sit frame and ensure the configured back grid receives zero padding through its existing pipeline.

- [ ] **Step 5: Add real controls without changing renderer internals**

Add controls that call existing refs:

- `NumMatrixRenderer`: backend select for `canvas2d` and `webgl` by changing `params.backend`.
- `PointGridRenderer`: reset button calling `ref.current?.reset()`.
- `HandPointsRenderer`: reset button calling `ref.current?.resetHand()`.
- `WebglHeatmapRenderer`: range input calling `ref.current?.sitValue({ valuej: max })`.
- `BlobHeatmapRenderer`: range input calling `ref.current?.sitValue({ valuej: max })`.

Use native `select`, `input[type=range]`, and icon buttons already available in the docs theme. Keep controls in one horizontally scrollable toolbar on narrow screens.

- [ ] **Step 6: Wire demos into the existing bridge**

In `ComponentDemo.jsx`:

```jsx
import { matrixRendererDemos } from './MatrixRendererDemos.jsx'
```

Merge the mapping:

```js
const demos = {
  TerrainMap: TerrainMapDemo,
  ...matrixRendererDemos,
  // existing qxui and shroomui mappings remain unchanged
}
```

Import `matrix-renderer-demos.css` from `docs/.vitepress/theme/index.js`.

- [ ] **Step 7: Run demo mapping and docs build tests**

Run: `node --test tests/matrix-renderer-docs.test.mjs`

Run: `pnpm docs:build`

Expected: PASS. Existing Ant Design `use client` and Sass legacy warnings may remain; new missing-import or JSX errors are failures.

- [ ] **Step 8: Commit interactive demos**

```powershell
git add docs/.vitepress/theme/components/MatrixRendererDemos.jsx docs/.vitepress/theme/components/matrix-renderer-demos.css docs/.vitepress/theme/components/ComponentDemo.jsx docs/.vitepress/theme/index.js tests/matrix-renderer-docs.test.mjs
git commit -m "feat: add interactive matrix renderer demos"
```

---

### Task 5: Add Five Chinese Component Pages And Navigation

**Files:**
- Create: `docs/components/render/num-matrix-renderer.md`
- Create: `docs/components/render/point-grid-renderer.md`
- Create: `docs/components/render/hand-points-renderer.md`
- Create: `docs/components/render/webgl-heatmap-renderer.md`
- Create: `docs/components/render/blob-heatmap-renderer.md`
- Modify: `docs/.vitepress/config.mjs`
- Modify: `docs/UI_COMPONENTS.md`
- Modify: `docs/SDK_GUIDE.md`

**Interfaces:**
- Consumes: demo names from Task 4 and public deep imports from Tasks 1-3.
- Produces: six entries under the existing matrix-rendering sidebar group, including `TerrainMap`.

- [ ] **Step 1: Extend the docs test with page and sidebar assertions**

Add to `tests/matrix-renderer-docs.test.mjs`:

```js
const pages = [
  ['num-matrix-renderer.md', 'NumMatrixRenderer'],
  ['point-grid-renderer.md', 'PointGridRenderer'],
  ['hand-points-renderer.md', 'HandPointsRenderer'],
  ['webgl-heatmap-renderer.md', 'WebglHeatmapRenderer'],
  ['blob-heatmap-renderer.md', 'BlobHeatmapRenderer'],
]

test('publishes one interactive page per renderer', () => {
  for (const [file, name] of pages) {
    const markdown = readFileSync(new URL(`../docs/components/render/${file}`, import.meta.url), 'utf8')
    assert.match(markdown, new RegExp(`# ${name}`))
    assert.match(markdown, new RegExp(`<UiComponentDemo name="${name}" />`))
    assert.match(markdown, /## 最小用法/)
    assert.match(markdown, /## 输入数据/)
  }
})
```

- [ ] **Step 2: Run the docs test and verify missing-page failures**

Run: `node --test tests/matrix-renderer-docs.test.mjs`

Expected: FAIL with `ENOENT` for the first missing page.

- [ ] **Step 3: Create each page with a fixed section structure**

Each page must use:

```markdown
---
aside: false
---

# ComponentName

用中文说明该组件适合的矩阵尺寸、渲染方式和典型使用场景；不得使用通用占位介绍。

## 实时示例

<UiComponentDemo name="ComponentName" />

## 最小用法

```jsx
// 使用本页对应的公开深路径导入组件，创建 ref，并在 useEffect 中调用
// ref.current?.sitData({ wsPointData: frame }, false)
```

## 输入数据

明确列出输入矩阵的行列数、按行展开顺序、数值范围，以及实时数据与回放数据使用同一 normalized matrix 结构的约束。

## 关键参数

逐项列出本页演示实际使用的参数名、类型、默认值和作用。

## 公开命令

逐项列出该组件 ref 暴露的方法名、参数、返回值和作用，并至少包含 `sitData` 与本页交互控件调用的方法。

## 依赖

明确标注 React peer dependency；使用 Three.js 或 WebGL 的页面还要列出对应依赖和浏览器 WebGL 要求，Canvas 2D 页面注明无需 Three.js。
```

Use these deep imports respectively:

```js
shroom-backend-sdk/UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx
shroom-backend-sdk/UI/frontend/renderers/pointGrid/react/PointGridRenderer.jsx
shroom-backend-sdk/UI/frontend/renderers/handPoints/react/HandPointsRenderer.jsx
shroom-backend-sdk/UI/frontend/renderers/webglHeatmap/react/WebglHeatmapRenderer.jsx
shroom-backend-sdk/UI/frontend/renderers/blobHeatmap/react/BlobHeatmapRenderer.jsx
```

- [ ] **Step 4: Add all five sidebar entries**

Under `矩阵渲染 render` in `docs/.vitepress/config.mjs`, keep `TerrainMap` first and append:

```js
{ text: 'NumMatrixRenderer', link: '/components/render/num-matrix-renderer' },
{ text: 'PointGridRenderer', link: '/components/render/point-grid-renderer' },
{ text: 'HandPointsRenderer', link: '/components/render/hand-points-renderer' },
{ text: 'WebglHeatmapRenderer', link: '/components/render/webgl-heatmap-renderer' },
{ text: 'BlobHeatmapRenderer', link: '/components/render/blob-heatmap-renderer' },
```

- [ ] **Step 5: Update the UI overview and SDK guide**

In `docs/UI_COMPONENTS.md`, expand the matrix rendering table from one row to six rows with each page link and one-sentence Chinese purpose. In `docs/SDK_GUIDE.md`, add a “矩阵渲染器” subsection showing `MatrixRenderers.registerBuiltinRenderers()` plus one direct component import; explicitly state that protocol parsing and line order happen before rendering.

- [ ] **Step 6: Run docs tests and build**

Run: `node --test tests/matrix-renderer-docs.test.mjs`

Run: `pnpm docs:build`

Expected: PASS.

- [ ] **Step 7: Commit renderer documentation**

```powershell
git add docs/components/render docs/.vitepress/config.mjs docs/UI_COMPONENTS.md docs/SDK_GUIDE.md tests/matrix-renderer-docs.test.mjs
git commit -m "docs: document matrix renderer SDK"
```

---

### Task 6: Architecture, Browser Verification, And Package Audit

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify if audit requires: `package.json`
- Test: all files from Tasks 1-5

**Interfaces:**
- Consumes: complete renderer package and docs pages.
- Produces: verified desktop/mobile documentation, nonblank visual output, clean release contents, and updated architecture history.

- [ ] **Step 1: Update architecture documentation incrementally**

Update the UI directory tree with `frontend/core`, `frontend/renderers`, and `frontend/styles`. Extend the UI Mermaid graph with five renderer ids. Add a data-flow note that renderer core pipelines consume normalized matrices while collection/replay/download retain the original normalized frame. Append dated update-log and project-progress rows; do not modify prior rows.

- [ ] **Step 2: Run the complete automated suite**

Run:

```powershell
pnpm test
pnpm docs:build
git diff --check
```

Expected: all commands exit 0; six terrain-wire tests, frontend structure/public API/docs tests, type checks, renderer Vitest suites, and SDK load smoke test pass.

- [ ] **Step 3: Start or reuse the local docs server**

Run: `pnpm docs:dev`

Use the first free localhost port and record the actual URL. Open all five new pages in the in-app browser.

- [ ] **Step 4: Verify desktop rendering and interaction**

At a desktop viewport near 1440×1000, for each page:

- capture a screenshot with the live renderer fully visible;
- invoke one real control and confirm the canvas/scene changes or remains responsive;
- inspect browser logs and require zero new error-level entries;
- assert the renderer host and canvas have positive dimensions.

- [ ] **Step 5: Verify mobile layout and pixels**

At a viewport near 390×844, capture each live renderer. Confirm toolbar controls scroll rather than overlap, headings fit, and renderer content remains inside its host. For Canvas/WebGL/Three screenshots, sample the renderer crop and require a meaningful count of non-background/colorful pixels; a uniformly dark crop fails verification.

- [ ] **Step 6: Audit pnpm package contents**

Run `pnpm pack --dry-run`, capture output, and assert it contains:

```text
UI/frontend/index.js
UI/frontend/package.json
UI/frontend/renderers/index.js
UI/frontend/renderers/builtins.js
UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx
UI/frontend/renderers/pointGrid/react/PointGridRenderer.jsx
UI/frontend/renderers/handPoints/react/HandPointsRenderer.jsx
UI/frontend/renderers/webglHeatmap/react/WebglHeatmapRenderer.jsx
UI/frontend/renderers/blobHeatmap/react/BlobHeatmapRenderer.jsx
UI/frontend/renderers/shared/three/circle.png
```

Assert zero packaged paths containing `/node_modules/`, `/dist/`, `/.vite/`, `.test.js`, or `UI/frontend/docs/`.

- [ ] **Step 7: Commit architecture and release-audit changes**

```powershell
git add ARCHITECTURE.md package.json pnpm-lock.yaml
git commit -m "docs: record matrix renderer architecture"
```

- [ ] **Step 8: Run final verification after the last commit**

Run:

```powershell
pnpm test
pnpm docs:build
git status --short
```

Expected: tests and build exit 0. `git status` may still show pre-existing user changes, but no required matrix-renderer integration file remains uncommitted.
