# Shroom SDK 使用文档

这份文档说明 `E:\shroomSDK` 这个独立 SDK 怎么在产品实验室、最小 demo 或第三方项目里使用。

## 1. 安装

在你的实验项目里执行：

```powershell
npm install file:E:\shroomSDK
```

使用：

```js
const {
  BackendSdkClient,
  ShroomSensorSDK,
  MemoryCaptureStore,
} = require('shroom-backend-sdk');
```

## 2. 两种使用方式

### 方式 A：连接正在运行的主项目后端

适合验证：

- 连接后端
- 打开串口
- 订阅实时数据
- 启动采集
- 读取展示系统 metadata

入口：

```js
const { BackendSdkClient } = require('shroom-backend-sdk');

const client = new BackendSdkClient({
  httpBaseUrl: 'http://127.0.0.1:19245',
  wsUrl: 'ws://127.0.0.1:19999',
});
```

主项目必须先运行，因为这条链路依赖后端 HTTP/WS。

### 方式 B：SDK 自己直接读取串口

适合产品实验室做最小硬件验证，不依赖主项目后端。

入口：

```js
const { ShroomSensorSDK, MemoryCaptureStore } = require('shroom-backend-sdk');

const sdk = new ShroomSensorSDK({
  store: new MemoryCaptureStore(),
});
```

数据链路：

```text
SerialPort -> DelimiterParser -> ProtocolRegistry.parse -> ZeroCalibrator -> frame event -> CaptureStore
```

## 3. Demo 命令

### 后端连接 demo

```powershell
cd E:\shroomSDK
npm run sdk:demo
```

可选：

```powershell
npm run sdk:demo -- --channels sit,back --duration 15000
npm run sdk:demo -- --sensor hand0205
npm run sdk:demo -- --open sit=COM3
npm run sdk:demo -- --start-collection sdk_demo
```

### 本地串口链路 demo

```powershell
cd E:\shroomSDK
npm run sdk:serial-demo -- --list-ports
npm run sdk:serial-demo -- --sensor hand0205 --channel sit --port COM3
```

没有硬件时先跑：

```powershell
npm run sdk:serial-demo -- --mock
```

## 4. 推荐实验室目录结构

```text
E:\shroom1       主项目
E:\shroomSDK     独立 SDK
E:\shroomLab     产品实验室项目
```

实验室项目只依赖 SDK，不直接 import 主项目内部文件。

## 5. 升级规则

以后 SDK 更新建议按版本管理：

- `0.2.1`：修 bug
- `0.3.0`：新增功能
- `1.0.0`：稳定对外版本
- `2.0.0`：破坏兼容的大版本

每次更新至少做：

```powershell
cd E:\shroomSDK
npm test
npm run sdk:serial-demo -- --mock
npm pack --dry-run
```
