# Shroom SDK 总览

Shroom SDK 是一个面向压力传感器项目的 Node.js 后端 SDK。它可以连接正在运行的主项目后端，也可以在实验室环境中直接读取本地串口，用于验证采集、解析、存储、回放和导出链路。

## 两种使用方式

| 方式 | 入口 | 适合场景 |
| --- | --- | --- |
| 连接主项目后端 | `BackendSdkClient` | 主项目已经运行，需要通过 HTTP/WebSocket 控制串口、订阅实时帧、启动采集 |
| 本地直接读串口 | `ShroomSensorSDK` | 不启动主项目，只验证硬件、协议、线序、采集和导出 |

## 当前能力

- 串口枚举、打开、关闭和多通道绑定。
- Delimiter 协议分帧和 profile 化解析。
- 内置常见传感器 profile：手套、1024 点矩阵、小床垫、4096 点床垫等。
- 自定义 profile 和自定义线序函数。
- 清零基线、实时 frame 统计、SQLite/内存采集存储。
- 历史回放 timeline 和 CSV 导出。
- 连接主项目 HTTP/WebSocket 的 `BackendSdkClient`。
- 后端命令兼容路由、授权、路径、报告服务适配。

## 推荐阅读顺序

1. [快速开始](/getting-started)
2. [核心概念](/concepts)
3. [连接主项目后端](/guides/backend-client)
4. [本地串口链路](/guides/local-serial)
5. [API Reference](/api/backend-sdk-client)

## 包入口

```js
const {
  BackendSdkClient,
  ShroomSensorSDK,
  MemoryCaptureStore,
  CaptureStore,
  CsvExporter,
  ReplayService,
  LineOrderRegistry,
} = require('shroom-backend-sdk');
```
