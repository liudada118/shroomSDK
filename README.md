# Shroom SDK

Standalone SDK package for Shroom sensor experiments. Despite the `-backend-` in the package name, this ships **both** halves:

- **Backend** — serial read, protocol parsing, zero calibration, capture, replay, CSV export, and a client for the main app's HTTP/WebSocket API.
- **Frontend** — 5 matrix renderers (`numMatrix`, `pointGrid`, `handPoints`, `webglHeatmap`, `blobHeatmap`), a Three.js terrain map, and 17 base UI components.

This folder is intended to be installed by lab/demo projects without importing `E:\shroom1` internals.

## Quick Start

No hardware needed — this runs the full serial chain against mock data:

```powershell
pnpm sdk:serial-demo -- --mock
```

## Install In A Lab Project

```powershell
pnpm add file:<path-to-this-folder>
```

Use it:

```js
const {
  BackendSdkClient,
  ShroomSensorSDK,
} = require('shroom-backend-sdk');
```

## Backend HTTP/WebSocket Demo

Use this when the main Shroom app/backend is running.

```powershell
cd E:\ShroomSDK
pnpm sdk:demo
```

The default backend demo:

- reads `GET /api/sdk/contract`
- reads serial status
- reads Display Systems metadata
- connects to WebSocket
- subscribes to realtime frames

Examples:

```powershell
pnpm sdk:demo -- --channels sit,back --duration 15000
pnpm sdk:demo -- --sensor hand0205
pnpm sdk:demo -- --open sit=COM3
pnpm sdk:demo -- --start-collection sdk_demo
```

## Local Serial Chain Demo

Use this when the SDK itself should read a physical serial port.

```powershell
cd E:\ShroomSDK
pnpm sdk:serial-demo -- --list-ports
pnpm sdk:serial-demo -- --sensor hand0205 --channel sit --port COM3
```

The chain is:

```text
SerialPort -> DelimiterParser -> ProtocolRegistry.parse -> ZeroCalibrator -> frame event -> MemoryCaptureStore
```

No hardware smoke test:

```powershell
pnpm sdk:serial-demo -- --mock
```

## Main Exports

- `BackendSdkClient`: connect to running backend HTTP/WS APIs.
- `ShroomSensorSDK`: local serial read, parse, capture, replay, export.
- `MemoryCaptureStore`: in-memory capture store for demos and tests.
- `CaptureStore`: SQLite-backed capture store.
- `ProtocolRegistry`: sensor profile and parser registry.
- `ZeroCalibrator`: baseline capture and zero subtraction helper.

## Frontend Components

### Matrix renderers

Five renderers consuming a normalized matrix. Pass the frame as a prop — no ref needed:

```jsx
import NumMatrixRenderer from 'shroom-backend-sdk/renderers/numMatrix';
import PointGridRenderer from 'shroom-backend-sdk/renderers/pointGrid';
import HandPointsRenderer from 'shroom-backend-sdk/renderers/handPoints';
import WebglHeatmapRenderer from 'shroom-backend-sdk/renderers/webglHeatmap';
import BlobHeatmapRenderer from 'shroom-backend-sdk/renderers/blobHeatmap';

<BlobHeatmapRenderer frame={matrix} params={{ dataWidth: 32, dataHeight: 32 }} />
```

| Renderer | Output |
| :--- | :--- |
| `numMatrix` | Numeric grid via Canvas 2D, WebGL, or Three.js sprites |
| `pointGrid` | Rotatable 3D point cloud, height + color by pressure |
| `handPoints` | Glove pressure on a 3D hand point cloud with IMU rotation |
| `webglHeatmap` | WebGL blob heatmap for dense matrices |
| `blobHeatmap` | Canvas 2D soft blob heatmap |

Each renderer splits into `core/` (pure functions, no React/Three/DOM — testable in plain Node) and `react/`. Import the core alone with `shroom-backend-sdk/renderers/<id>/core`.

### Other UI

```jsx
import { TerrainMap } from 'shroom-backend-sdk/render';       // Three.js pressure terrain
import { DynamicReportCard } from 'shroom-backend-sdk/qxui';  // report + playback
import { ChartPanel } from 'shroom-backend-sdk/shroomui';     // base components
```

### Peer dependencies

Install only what you use:

| Using | Install |
| :--- | :--- |
| Backend only | nothing |
| Matrix renderers | `react` `react-dom` `three` |
| TerrainMap | the above + `@react-three/fiber` `@react-three/drei` |
| qxui / shroomui | `react` `react-dom` `antd` `@ant-design/icons` `mobx` `mobx-react` `i18next` `react-i18next` `styled-components` `sass` |

The package ships **uncompiled `.jsx` / `.scss`** so the host controls the React version. Most bundlers skip `node_modules` JSX by default — see the bundler config section in the docs site (`UI Components` page) for Vite and webpack snippets.

## Version

Current version: `0.2.0`

See `CHANGELOG.md` for update history.

## Documentation Web

Run the local documentation site:

```powershell
cd E:\ShroomSDK
pnpm docs:dev
```

Build static docs:

```powershell
pnpm docs:build
```
