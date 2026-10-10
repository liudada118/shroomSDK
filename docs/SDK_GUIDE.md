# Shroom SDK 使用文档

这份文档说明 `E:\ShroomSDK` 这个独立 SDK 怎么在产品实验室、最小 demo 或第三方项目里使用。

## 1. 安装

在你的实验项目里执行：

```powershell
pnpm add file:<你的 SDK 路径>
```

使用：

```js
const {
  BackendSdkClient,
  ShroomSensorSDK,
  MemoryCaptureStore,
} = require('shroom-backend-sdk');
```

前端 UI 组件在 React 项目中使用：

```jsx
import { DynamicReportCard } from 'shroom-backend-sdk/UI/qxui';
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
SerialManager -> SensorSession -> SerialPort -> DelimiterParser -> ProtocolRegistry.parse -> ZeroCalibrator -> frame event -> CaptureStore
```

### 通用串口连接

手动选口：

```js
const result = await sdk.connectSerial({
  sensorType: 'fast1024',
  channels: { pressure: 'COM3' },
});

result.session.on('frame', (frame) => console.log(frame.data));
```

一键查口、识别波特率并连接：

```js
const result = await sdk.connectSerial({ sensorType: 'fast1024' });
```

`sdk.serialManager` 保存所有当前串口的会话状态和最新帧，并提供 `rescan()`、`write()` 和 `disconnectAll()`。打开默认重试 3 次，单次超时 2 秒；端口仍打开但 5 秒无数据时标记为 `stale`。

### 手套一站式连接

手动指定串口：

```js
const { connectGlove } = require('shroom-backend-sdk');

const glove = await connectGlove({
  profileId: 'hand0205Double',
  leftPort: 'COM3',
  rightPort: 'COM4',
  onFrame(frame) {
    console.log(frame.handSide, frame.pressureData, frame.imu.quaternion, frame.matrixData);
  },
  onError({ error, phase }) {
    console.error(phase, error);
  },
});

await glove.close();
```

一键查找并连接 WCH / CH34 类传感器串口：

```js
const glove = await connectGlove({ profileId: 'hand0205' });
```

也可以复用已有实例：`await sdk.connectGlove(options)`。手套帧同时提供原始 256 点、147/195 点手部 Mapping、32×32 展示矩阵和四元数 IMU；前端直接把 `frame.matrixData` 交给矩阵渲染器。分包手套的左右手点位由根导出 `GLOVE_HAND_MAPPING` 统一维护，索引从 1 开始，并保留五指、指腹和手掌分组。

### 本地采集

采集行为参考 `E:\shroom1`：自定义频率按通道独立取样，数据批量事务入库，停止采集或关闭串口会先写完剩余帧。

```js
const capture = sdk.startCapture(glove, {
  name: 'glove_test',
  frequencyMode: 'custom', // serial 表示每个有效串口帧都保存
  frequencyHz: 60,
  dataField: 'matrixData', // 也可保存 data / pressureData / mappedData
  batchSize: 200,
  flushIntervalMs: 250,
});

glove.on('captureFlush', ({ count }) => {
  console.log('已写入', count, '帧');
});

glove.on('captureError', ({ error }) => {
  console.error(error.code, error.message);
});

const result = sdk.stopCapture(glove);
console.log(result.stats);
```

### 存储、回放、CSV 和算法

```js
sdk.registerAlgorithm('sum', (data) => (
  data.reduce((total, value) => total + value, 0)
));

const captures = sdk.listCaptures({ sensorType: 'hand0205', limit: 20 });
const player = sdk.createReplay({
  captureId: captures[0].id,
  speed: 2,
  applyAlgorithms: true,
});

player.on('frame', (frame) => {
  console.log(frame.data, frame.algorithmResults.sum);
});
player.play();

await sdk.exportCsv({
  captureId: captures[0].id,
  outputPath: 'D:/sensor-data/glove.csv',
});
```

六项后端能力的完整接口和数据流见 [Backend Capabilities](./BACKEND_CAPABILITIES.md)。

## 3. Demo 命令

### 后端连接 demo

```powershell
cd E:\ShroomSDK
pnpm sdk:demo
```

可选：

```powershell
pnpm sdk:demo -- --channels sit,back --duration 15000
pnpm sdk:demo -- --sensor hand0205
pnpm sdk:demo -- --open sit=COM3
pnpm sdk:demo -- --start-collection sdk_demo
```

### 本地串口链路 demo

```powershell
cd E:\ShroomSDK
pnpm sdk:serial-demo -- --list-ports
pnpm sdk:serial-demo -- --sensor hand0205 --channel sit --port COM3
```

没有硬件时先跑：

```powershell
pnpm sdk:serial-demo -- --mock
```

### 前端 UI 组件

```powershell
pnpm add file:<你的 SDK 路径>
pnpm add react react-dom antd @ant-design/icons mobx mobx-react react-i18next styled-components sass
pnpm add three @react-three/fiber @react-three/drei
```

```jsx
import { DynamicReportCard } from 'shroom-backend-sdk/UI/qxui';
import { ChartPanel, MetricValue } from 'shroom-backend-sdk/UI/shroomui';
import { TerrainMap } from 'shroom-backend-sdk/UI/render';
```

更多组件和 props 见 [UI Components](./UI_COMPONENTS.md)。

#### 矩阵渲染器

内置矩阵渲染器可以通过注册表按需发现，也可以直接深路径导入组件：

```jsx
import { MatrixRenderers } from 'shroom-backend-sdk/UI'
import NumMatrixRenderer from 'shroom-backend-sdk/renderers/numMatrix'

MatrixRenderers.registerBuiltinRenderers()
```

渲染器只接收 normalized matrix。串口协议解析、线序转换和清零必须先在 `SerialManager` 或数据处理层完成；实时显示与回放应把相同结构传给渲染器。

## 4. 推荐实验室目录结构

```text
E:\shroom1       主项目
E:\ShroomSDK     独立 SDK
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
cd E:\ShroomSDK
pnpm test
pnpm sdk:serial-demo -- --mock
pnpm pack --dry-run
```
