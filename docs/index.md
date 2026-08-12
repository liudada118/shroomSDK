---
layout: home

hero:
  name: Shroom SDK
  text: 独立传感器 SDK 文档
  tagline: 用于产品实验室、最小 demo、后端 HTTP/WS 集成和本地串口读取实验。
  actions:
    - theme: brand
      text: 快速开始
      link: /SDK_GUIDE
    - theme: alt
      text: API Reference
      link: /API_REFERENCE

features:
  - title: 连接主项目后端
    details: 通过 BackendSdkClient 读取 /api/sdk/contract、打开串口、订阅实时数据、启动采集和读取 Display Systems metadata。
  - title: 本地直连串口
    details: 通过 ShroomSensorSDK 直接读取物理串口，走 SerialPort、DelimiterParser、ProtocolRegistry、ZeroCalibrator 和 CaptureStore。
  - title: 前端 UI 组件
    details: 通过 UI/render 提供 Three.js 矩阵地形渲染，通过 UI/qxui 提供动态报告和回放，通过 UI/shroomui 提供面板、抽屉、导出弹窗和工具栏等基础组件。
  - title: 产品实验室友好
    details: 实验项目可以 pnpm add file:E:\ShroomSDK，不需要 import E:\shroom1 内部模块。
  - title: 可运行 Demo
    details: 提供 sdk:demo 和 sdk:serial-demo，分别验证后端链路和本地串口链路。
---

## 功能入口

| 想验证什么 | 入口 |
| :--- | :--- |
| 连接后端、打开串口、订阅实时数据 | [后端连接链路](./BACKEND_CLIENT.md) |
| SDK 自己直接读取串口 | [本地串口链路](./SERIAL_CHAIN.md) |
| 前端展示采集报告 | [UI Components](./UI_COMPONENTS.md) |
| 所有 API 方法 | [API Reference](./API_REFERENCE.md) |
| 安装和实验室目录建议 | [使用文档](./SDK_GUIDE.md) |

## 常用命令

```powershell
cd E:\ShroomSDK
pnpm docs:dev
pnpm sdk:demo
pnpm sdk:serial-demo -- --mock
```

文档开发服务默认可在命令行输出的本地地址访问。
