# Shroom SDK

Standalone SDK package for Shroom sensor experiments.

This folder is intended to be installed by lab/demo projects without importing `E:\shroom1` internals.

## Install In A Lab Project

```powershell
npm install file:E:\shroomSDK
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
cd E:\shroomSDK
npm run sdk:demo
```

The default backend demo:

- reads `GET /api/sdk/contract`
- reads serial status
- reads Display Systems metadata
- connects to WebSocket
- subscribes to realtime frames

Examples:

```powershell
npm run sdk:demo -- --channels sit,back --duration 15000
npm run sdk:demo -- --sensor hand0205
npm run sdk:demo -- --open sit=COM3
npm run sdk:demo -- --start-collection sdk_demo
```

## Local Serial Chain Demo

Use this when the SDK itself should read a physical serial port.

```powershell
cd E:\shroomSDK
npm run sdk:serial-demo -- --list-ports
npm run sdk:serial-demo -- --sensor hand0205 --channel sit --port COM3
```

The chain is:

```text
SerialPort -> DelimiterParser -> ProtocolRegistry.parse -> ZeroCalibrator -> frame event -> MemoryCaptureStore
```

No hardware smoke test:

```powershell
npm run sdk:serial-demo -- --mock
```

## Main Exports

- `BackendSdkClient`: connect to running backend HTTP/WS APIs.
- `ShroomSensorSDK`: local serial read, parse, capture, replay, export.
- `MemoryCaptureStore`: in-memory capture store for demos and tests.
- `CaptureStore`: SQLite-backed capture store.
- `ProtocolRegistry`: sensor profile and parser registry.
- `ZeroCalibrator`: baseline capture and zero subtraction helper.

## Version

Current version: `0.2.0`

See `CHANGELOG.md` for update history.

## Documentation Web

Run the local documentation site:

```powershell
cd E:\shroomSDK
npm run docs:dev
```

Build static docs:

```powershell
npm run docs:build
```

Preview the generated static site:

```powershell
npm run docs:preview
```
