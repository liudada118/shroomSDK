# Shroom SDK

Standalone SDK package for Shroom sensor experiments.

This folder is intended to be installed by lab/demo projects without importing `E:\shroom1` internals.

## Install In A Lab Project

```powershell
pnpm add file:E:\ShroomSDK
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

## Frontend UI Components

React UI source components are exported from `UI/qxui`:

```jsx
import { DynamicReportCard, ComparePlay } from 'shroom-backend-sdk/UI/qxui';
import { ChartPanel, MetricValue } from 'shroom-backend-sdk/UI/shroomui';
import { TerrainMap } from 'shroom-backend-sdk/UI/render';
```

Install UI peer dependencies in the frontend project when using these components:

```powershell
pnpm add react react-dom antd @ant-design/icons mobx mobx-react react-i18next styled-components sass
pnpm add three @react-three/fiber @react-three/drei
```

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
