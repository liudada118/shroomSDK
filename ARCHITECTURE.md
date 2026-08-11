# Shroom SDK Architecture

Last updated: 2026-07-21

## Overview

This repository contains a CommonJS Node.js SDK for Shroom sensor workflows. It supports two main integration paths: connecting to a running backend through `BackendSdkClient`, or reading local serial ports directly through `ShroomSensorSDK`.

## Tech Stack

| Area | Tooling |
| --- | --- |
| Runtime | Node.js, CommonJS |
| Package manager | pnpm / npm compatible |
| Serial | `serialport`, `@serialport/parser-delimiter` |
| Storage | `better-sqlite3`, in-memory fallback class |
| Export | `csv-writer` |
| Docs | VitePress |

## Core Modules

| Module | Purpose |
| --- | --- |
| `src/backend/BackendSdkClient.js` | HTTP/WebSocket client for a running Shroom backend |
| `src/ShroomSensorSDK.js` | Local SDK facade for profiles, serial sessions, capture, replay and export |
| `src/serial/SensorSession.js` | SerialPort lifecycle, delimiter parser and frame events |
| `src/protocol/*` | Profile registry and frame parsers |
| `src/line/*` | Line-order registry and project line-order injection |
| `src/storage/*` | SQLite and memory capture stores |
| `src/replay/ReplayService.js` | Historical frame timeline builder |
| `src/export/CsvExporter.js` | CSV export |
| `docs/` | VitePress documentation |

## Data Flow

```text
SerialPort -> DelimiterParser -> ProtocolRegistry -> lineOrder -> ZeroCalibrator -> frame event -> CaptureStore -> ReplayService / CsvExporter
```

## Update Log

| Date | Type | Summary |
| --- | --- | --- |
| 2026-07-08 | Documentation | Expanded VitePress documentation from a minimal page set into a multi-section SDK manual with guides, API reference and troubleshooting. |
| 2026-07-21 | Documentation | Completed the standalone documentation web workflow, including local development, static build and preview commands. |

## Project Progress

| Date | Completed work | Notes |
| --- | --- | --- |
| 2026-07-08 | SDK web docs expansion | Added detailed user-facing pages for backend connection, local serial workflow, profiles, line order, capture/replay/export, API reference and troubleshooting. |
| 2026-07-21 | Standalone documentation site | Verified the VitePress site builds independently and documented the full development, build and preview workflow. |
