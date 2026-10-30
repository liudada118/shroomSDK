# 快速接入：取数 → 创建 WS → 开始采集 → 停止采集 → 下载

同一台电脑上，Node.js 连接设备、创建 WS 并保存记录；浏览器连接一次，后面三步复用同一个 `stream`。下面只列 API 调用，放进自己的 Node.js 程序和网页，不需要复制完整 HTML。

**运行前提**：设备驱动可用，SDK 根目录已安装依赖，Node.js 已按 [SDK 授权](LICENSE.md)激活有效 SDK 产品密钥，功能包括 `serial / stream / recording`。安装和授权要点见文末[接入准备](#product-guide)。

**只用五个函数**：`readProduct`、`createWS`、`startRecording`、`stopRecording`、`downloadRecording`，统一从 SDK 根目录的 `quick-flow.js` 导入。该文件依赖同目录下的 SDK 模块；Node.js 与浏览器分别调用各自的片段。

它们调用的就是[基础文档中的公开 API](CUSTOM.md#quick-to-base)；参数与生命周期的详细说明统一从该对应表进入。

## 5 步调用 {#quick-call}

示例文件放在 SDK 根目录，统一导入 `./quick-flow.js`。`COM3` 替换为实际端口，手套 `side` 按实物选择。

## 1. 取数 {#flow-read}

**Node.js**

```js
import { readProduct } from './quick-flow.js';

// SDK 授权完成后调用；path 替换为系统中的实际串口。
const device = await readProduct({
  product: 'glove', // 手部检测垫改为 'pad'，并删除 side
  path: 'COM3',
  side: 'left', // 按实际左手或右手设置
  onData(data) {
    // 每次收到一帧已解析的产品数据，在这里接入你的业务。
    console.log(data.fingers, data.palm, data.imu);
  },
  onError: error => console.error(error.code, error.message),
});

// 释放串口时：await device.close();
```

onData 持续返回产品帧；这一步已开始读取设备，还没有保存采集记录。

手部检测垫使用 `product: 'pad'`，不传 `side`，回调读取 `data.pressureMatrix / data.values`。手套读取 `data.fingers / data.palm / data.imu.raw`。数据已完成产品解析与点位映射。

## 2. 创建 WS {#flow-ws}

**Node.js**

```js
import { createWS } from './quick-flow.js';

const server = await createWS(device, { port: 19999 });
console.log(server.url); // ws://127.0.0.1:19999
```

**浏览器**

```js
import {
  readProduct, startRecording, stopRecording, downloadRecording,
} from './quick-flow.js';

// 浏览器连接一次，后面三步复用同一个 stream。
const stream = await readProduct({
  url: 'ws://127.0.0.1:19999',
  onData: data => console.log(data.fingers, data.palm, data.imu),
  onError: error => console.error(error.code, error.message),
});
```

先在 Node 创建服务，再从同一台电脑的 localhost 网页连接。`19999` 是 WS 数据端口，与网页 HTTP 端口不同；HTTPS 页面需配置 WSS。浏览器按 `url` 读取，不再传 `product / path / side`。

## 3. 开始采集 {#flow-start}

**浏览器**

```js
// 放在“开始采集”按钮的点击处理中。
const session = await startRecording(stream, { label: '本次采集' });
console.log(session.id); // 本次采集的唯一记录 ID
```

从此刻开始将收到的帧保存到 Node 端。不要在页面初始化时立即连续执行开始和停止。

## 4. 停止采集 {#flow-stop}

**浏览器**

```js
// 放在“停止采集”按钮的点击处理中。
const recording = await stopRecording(stream);
console.log(recording?.id); // 等待本次记录写入完成
```

停止保存这次记录；设备取数和 WS 仍保持连接。SDK 记住本次记录 ID，供下一步下载。

界面可查看 `recording.status / recording.error / recording.frameCount`，说明本次结果；停止采集不等于关闭设备或服务。

## 5. 下载 {#flow-download}

**浏览器**

```js
// 放在“下载”按钮的点击处理中。
downloadRecording(stream, { format: 'csv' });
// 保留完整帧结构时，将 format 改为 'jsonl'。
```

下载同一 `stream` 刚停止的记录；再次成功开始采集后，需等新记录停止才能下载。函数同步触发浏览器下载并返回 URL，不代表文件已保存完成。

## 结束使用与接口边界 {#cleanup}

三个采集操作分别由按钮触发，连接、开始与停止的 Promise 失败都要交给页面错误提示；请求进行时避免重复点击。关闭网页或调用 `stream.close()` 不会自动停止服务端录制，结束本次采集要明确调用 `stopRecording()`。

- 浏览器结束订阅：`await stream.close()`。
- Node.js 退出：`await server.close()` 一并释放 WS 服务与设备。`createWS()` 创建失败也释放设备；只执行第 1 步时自行 `await device.close()`。
- 三个采集函数也接受 Node.js 的 `server`；`downloadRecording(server, { format: 'csv' })` 返回 HTTP URL，由调用方下载文件。
- 历史记录保留原始 API：`stream.listRecordings()` 选记录，再用 `stream.downloadRecording(id, { format })`；五函数入口只下载本次停止的记录。
- 新记录保存在 Node.js 的 `.shroom-recordings/recordings.sqlite`，可在 `createWS()` 的 `recordingsDir` 中指定目录。SDK 批量写入 SQLite，停止时等待队列排空；CSV / JSONL 是从数据库生成的导出格式。CSV 数组/分区是 JSON 单元格；完整帧可用 JSONL，详见[数据存储](STORAGE.md)。
- ADC 与相对归一化值不是 kPa 或牛顿；IMU 原始字节不是姿态结果。产品协议、字段与错误码见[Node.js API](BACKEND-GUIDE.md#node-connect-product)和[前端通讯 API](FRONTEND-COMMUNICATION.md)。

## 接入准备 {#product-guide}

### 安装驱动与运行环境 {#guide-prepare}

准备可传数据的 USB 线与 Node.js 18+。CH34x 设备安装 [Windows 驱动 CH341SER.EXE](https://shroom.jq-industries.com/drive/CH341SER.EXE)或 [macOS 驱动 CH34xVCPDriver.zip](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)，重新插拔后确认系统端口；Linux 检查驱动与串口权限。详见[驱动排查](DRIVERS.md)。本流程浏览器使用 WebSocket，不直接申请串口。

### 确认产品与串口 {#guide-config}

整包手套使用 `product: 'glove'`，明确 `side: 'left' | 'right'`；手部检测垫使用 `product: 'pad'`，不传 `side`。也接受正式产品 ID `handGloveFullPacket / hand`。Node.js 可从 `node/index.js` 导入 `listPorts()` 查询实际 `path`；多端口不猜测产品。产品适配器内置波特率、拆帧和映射。

### 安装 SDK 依赖 {#guide-run}

下载 [Node.js（含浏览器）SDK ZIP](/shroom-sdk-node.zip)，在包含 `node/`、`web/` 和 `package.json` 的 SDK 根目录执行 `npm install`，安装 `serialport / ws / better-sqlite3` 等依赖。SQLite 采集库由 SDK 管理，无需安装独立数据库服务。尚未发布公共 npm 包，不使用 `npm install shroom-sdk`。

### 激活 SDK 授权 {#guide-connect}

Node.js 打开设备前按 [SDK 授权](LICENSE.md)完成激活，并复用稳定安装标识；SDK 核心不会自动读取环境变量。上位机密钥不能启用 SDK。只取数需要 `serial`，本流程创建服务与采集还需要 `stream / recording`；在线授权按说明持续续验。

### 验证取数与采集 {#guide-verify}

先确认真实触按使 `onData` 持续更新，再开始并停止一段采集，查看最终状态、错误和帧数，按该记录 ID 下载并核对内容。只打开串口、收到模拟数据或触发下载，都不等于实机数据已经通过验收。

### 接入自己的页面 {#guide-code}

在页面初始化或连接操作中执行一次 `readProduct({ url, onData, onError })`，共享返回的 `stream`，把第 3、4、5 步分别放入开始、停止与下载按钮回调。只需直接取数时停在第 1 步即可；适配新产品见[产品扩展指南](../core/products/README.md)，通用协议见[基础与自定义](CUSTOM.md)。

## 相关接口与旧链接 {#extensions}

以下旧入口保留为同一流程的定位链接，不另开一套示例。

### 设备接入 {#device}

见[第 1 步：取数](#flow-read)与[第 2 步：创建 WS](#flow-ws)。

### 接入流程 {#demo}

见上方[5 步调用](#quick-call)，按自己的 Node.js 程序与网页调用 API。

### 前端连接与展示 {#view}

前端连接见[第 2 步](#flow-ws)。需要二维展示时使用 `createProductView()`，详见[渲染 API](RENDERING.md)；绘图不影响采集起停。

### 采集接口 {#record}

同一条 `stream` 管理本次采集，完整存储说明见[数据存储](STORAGE.md)。

#### 开始录制 {#start-recording}

见[第 3 步：开始采集](#flow-start)。

#### 开始接口 {#record-start}

使用 `startRecording(stream, { label })`，见[第 3 步](#flow-start)。

#### 停止录制 {#stop-recording}

见[第 4 步：停止采集](#flow-stop)。

#### 停止接口 {#record-stop}

使用 `stopRecording(stream)`，见[第 4 步](#flow-stop)。

### 按记录 ID 下载 {#download}

五函数入口自动使用本次停止结果，见[第 5 步：下载](#flow-download)。需选择历史记录时使用原始 `stream.downloadRecording(id, options)`；ID 不是产品 ID、标签或 WS 端口。

## 连接与采集排查 {#troubleshooting}

| 现象 | 优先检查 |
| --- | --- |
| 找不到串口 | 系统驱动、USB 数据线、权限与实际端口，见[驱动排查](DRIVERS.md) |
| 已连接但没有帧 | 实际产品与手侧、设备供数；查看 `device.getDiagnostics()` |
| WS 连接失败 | Node 服务是否运行；数据端口是否为 `19999`；网页是否来自本机 HTTP 来源 |
| 开始或停止失败 | 当前会话、授权功能、磁盘权限；展示返回错误，先查状态再重试 |
| 下载失败 | 记录是否停止写入、ID 是否正确、服务是否仍运行 |

默认服务只监听本机并检查网页来源。跨机连接需另配 `host / allowedOrigins` 和前端地址；HTTPS 页面需 WSS，部署边界见[前端通讯](FRONTEND-COMMUNICATION.md)。

Python 当前提供基础串口、模拟与矩阵解析，不提供本篇的产品连接、WS 服务或浏览器采集控制，见 [Python SDK](../python/README.md)。
