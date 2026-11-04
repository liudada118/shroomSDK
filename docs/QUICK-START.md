# 快速接入：取数 → 创建 WS → 开始采集 → 停止采集 → 下载

同一台电脑上，Node.js 连接设备、创建 WS 并保存记录；浏览器连接一次，后面三步复用同一个 `stream`。下面只列 API 调用，放进自己的 Node.js 程序和网页，不需要复制完整 HTML。

**运行前提**：设备驱动可用，业务项目已执行 `npm install --save-exact shroom-sdk@0.4.0`，Node.js 已按 [SDK 授权](LICENSE.md)激活有效 SDK 产品密钥，功能包括 `serial / stream / recording`。安装和授权要点见文末[接入准备](#product-guide)。

**业务流程仍是五个函数**：`readProduct`、`createWS`、`startRecording`、`stopRecording`、`downloadRecording`，统一从 `shroom-sdk/quick-flow` 导入。连接前用 Node 基础 API 搜索串口并让用户选择，不增加第六个快速函数。

它们调用的就是[基础文档中的公开 API](CUSTOM.md#quick-to-base)；参数与生命周期的详细说明统一从该对应表进入。

## 5 步调用 {#quick-call}

### 按产品替换取数参数 {#product-options}

| 产品 | product | 必要配置 | 主要数据 |
| --- | --- | --- | --- |
| 分包手套（0.4.0 起） | `glove` | `side: 'left' / 'right'` | `fingers / palm / imu.raw` |
| 手部检测垫 | `pad` | 无侧别 | `pressureMatrix / values` |
| 人体全身（0.3.0） | `body` | 无侧别 | `regions` 十块物理矩阵、400个唯一通道；`raw` 保留1024扫描值 |
| A版鞋垫（0.3.0） | `insole` | `side` 必填；`protocol: '12bit' / '8bit'` | `pressure` 保留256通道ADC，`sensors` 为112真实点，`imu` 保留线上数值 |

人体和鞋垫要求 0.3.0 或更高版本；分包手套要求 **0.4.0 或更高版本**，0.3.0 不支持。Node 和网页依赖需使用相同版本，并重新构建前端；整包设备需显式使用 `handGloveFullPacket`，手套格式及迁移见[手套协议](GLOVE.md)。下面两个取数片段与原流程任选其一，后续四步继续复用 `device` 和 `stream`：

```js
// 人体：SDK按上位机物理点位表输出分区，不用应用再次映射。
const device = await readProduct({
  product: 'body', path: 'COM3',
  onData: data => console.log(data.regions.back.matrix, data.raw),
  onError: error => console.error(error.code, error.message),
});
```

```js
// 鞋垫：按实物确认脚侧和固件格式；12位ADC保留0..4095，不缩成8位。
const device = await readProduct({
  product: 'insole', path: 'COM3', side: 'left', protocol: '12bit',
  onData: data => console.log(data.sensors.raw, data.imu.quaternion),
  onError: error => console.error(error.code, error.message),
});
```

两脚分别建立各自的连接；不猜测脚侧或自动合并设备。所有首次调用仍需捕获异常。完整格式、线序来源与限制见[鞋垫](INSOLE.md)和[人体全身](HUMAN-BODY.md)。

示例放在自己的项目中，统一导入 `shroom-sdk/quick-flow`。`COM3` 替换为实际端口，手套 `side` 按实物选择。网页需使用 Vite 等构建工具；普通 HTML 使用源码 ZIP 并将导入改为 SDK 根目录的 `./quick-flow.js`，见[安装方式](NPM.md)。

### 接入前：搜索并选择串口 {#flow-ports}

**运行在 Node.js。** 安装驱动并连接设备后查询；不需要打开端口或先激活密钥。

```js
import { listPorts } from 'shroom-sdk/node';

try {
  const ports = await listPorts();
  console.table(ports); // 把 path 和厂商信息展示在串口选择框中。
  if (ports.length === 0) console.log('未发现串口，请检查驱动、USB 数据线和权限。');
} catch (error) {
  console.error(error.code, error.message); // 查询失败与“列表为空”分别提示。
}
```

让用户选择列表中的 `path`，再填入第 1 步。不要默认取 `ports[0]`，串口列表不能识别产品型号或左右手；用户插拔设备后可以重新调用 `listPorts()` 刷新列表。

## 1. 取数 {#flow-read}

**Node.js**

```js
import { readProduct } from 'shroom-sdk/quick-flow';

// SDK 授权完成后调用；path 使用上方列表中用户选择的串口。
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

从 0.2.0 起，Node 产品连接默认自动重连原串口：意外断开后每 3 秒尝试一次，最多 3 次；恢复后继续使用同一个 `device` 和 `onData`。首次打开失败仍由调用的 `catch` 处理，不会后台重试。需要关闭重连时传 `reconnect: false`，需要显示状态时增加 `onStateChange: status => console.log(status.state, status.attempt)`；详细配置见[自动重连](BACKEND-GUIDE.md#node-reconnect)。

手部检测垫使用 `product: 'pad'`，不传 `side`，回调读取 `data.pressureMatrix / data.values`。手套读取 `data.fingers / data.palm / data.imu.raw`。数据已完成产品解析与点位映射。

## 2. 创建 WS {#flow-ws}

**Node.js**

```js
import { createWS } from 'shroom-sdk/quick-flow';

const server = await createWS(device, { port: 19999 });
console.log(server.url); // ws://127.0.0.1:19999
```

**浏览器**

```js
import {
  readProduct, startRecording, stopRecording, downloadRecording,
} from 'shroom-sdk/quick-flow';

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

串口断线会将当次采集以 `error` 收尾并保存已经接收的数据。自动重连只恢复实时取数，不自动续录或补齐缺失数据；恢复后由用户重新开始一条记录。

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
- 主动关闭设备会取消重连；授权或解析错误也不会触发重试。重连只使用原 `path`，COM 号改变时需要重新搜索、选择并连接。浏览器 WS 和直接 Web Serial 连接不自动重连。
- 三个采集函数也接受 Node.js 的 `server`；`downloadRecording(server, { format: 'csv' })` 返回 HTTP URL，由调用方下载文件。
- 历史记录保留原始 API：`stream.listRecordings()` 选记录，再用 `stream.downloadRecording(id, { format })`；五函数入口只下载本次停止的记录。
- 新记录保存在 Node.js 的 `.shroom-recordings/recordings.sqlite`，可在 `createWS()` 的 `recordingsDir` 中指定目录。SDK 批量写入 SQLite，停止时等待队列排空；CSV / JSONL 是从数据库生成的导出格式。CSV 数组/分区是 JSON 单元格；完整帧可用 JSONL，详见[数据存储](STORAGE.md)。
- ADC 与相对归一化值不是 kPa 或牛顿；IMU 原始字节不是姿态结果。产品协议、字段与错误码见[Node.js API](BACKEND-GUIDE.md#node-connect-product)和[前端通讯 API](FRONTEND-COMMUNICATION.md)。

## 接入准备 {#product-guide}

### 安装驱动与运行环境 {#guide-prepare}

准备可传数据的 USB 线与 Node.js 18+。CH34x 设备安装 [Windows 驱动 CH341SER.EXE](https://shroom.jq-industries.com/drive/CH341SER.EXE)或 [macOS 驱动 CH34xVCPDriver.zip](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)，重新插拔后确认系统端口；Linux 检查驱动与串口权限。详见[驱动排查](DRIVERS.md)。本流程浏览器使用 WebSocket，不直接申请串口。

### 确认产品与串口 {#guide-config}

分包手套使用 `product: 'glove'`（规范 ID `handGloveSegmented`），明确 `side: 'left' | 'right'`；手部检测垫使用 `product: 'pad'`（`hand`），不传 `side`。整包设备改用显式 `product: 'handGloveFullPacket'`，不要使用默认分包入口。先按[搜索并选择串口](#flow-ports)查询实际 `path`；多端口不猜测产品。产品适配器内置波特率、拆帧和映射。

手套是一只手一个串口；`side` 按实物决定该连接的左右手线序，`packetType` 不决定手侧。两只手各选自己的 `path`、各调用一次 `readProduct()`，后续服务与采集也使用各自的设备对象，不在单串口自动拆分双手。

### 安装 SDK {#guide-run}

在自己的项目终端执行：

```bash
npm install shroom-sdk
```

npm 安装 SDK 及其声明的依赖，无需手动解压。真实串口、WS 与 SQLite 分别需要 `serialport / ws / better-sqlite3` 可用。SDK 免登记下载，真实设备密钥另行申请。SQLite 由 SDK 管理，无需安装独立数据库服务。固定版本、下载 `.tgz` 和源码 ZIP 用法见[安装说明](NPM.md)。

### 激活 SDK 授权 {#guide-connect}

Node.js 打开设备前按 [SDK 授权](LICENSE.md)完成激活，并复用稳定安装标识；SDK 核心不会自动读取环境变量。上位机密钥不能启用 SDK。只取数需要 `serial`，本流程创建服务与采集还需要 `stream / recording`；在线授权按说明持续续验。

```js
import { Shroom } from 'shroom-sdk/node';

// 由应用读取密钥，并保留稳定的 64 位小写 hex 安装标识；不要每次启动重新生成。
await Shroom.activateLicense(process.env.SHROOM_LICENSE_KEY, {
  deviceId: process.env.SHROOM_DEVICE_ID,
});
```

标识的保存与配置见[授权说明](LICENSE.md)。精简 npm 包不包含源码示例专用的 `node/license-env.js`。

### 验证取数与采集 {#guide-verify}

先确认真实触按使 `onData` 持续更新，再开始并停止一段采集，查看最终状态、错误和帧数，按该记录 ID 下载并核对内容。只打开串口、收到模拟数据或触发下载，都不等于实机数据已经通过验收。

### 接入自己的页面 {#guide-code}

在页面初始化或连接操作中执行一次 `readProduct({ url, onData, onError })`，共享返回的 `stream`，把第 3、4、5 步分别放入开始、停止与下载按钮回调。只需直接取数时停在第 1 步即可；适配新产品见[产品扩展指南](../src/core/products/README.md)，通用协议见[基础与自定义](CUSTOM.md)。

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
| 断线后未恢复 | 查看 Node 的 `onStateChange`；重试耗尽、主动关闭或端口号变化后需用户重新连接，不能靠刷新网页替代串口重连 |
| 已连接但没有帧 | 实际产品与手侧、设备供数；查看 `device.getDiagnostics()` |
| WS 连接失败 | Node 服务是否运行；数据端口是否为 `19999`；网页是否来自本机 HTTP 来源 |
| 开始或停止失败 | 当前会话、授权功能、磁盘权限；展示返回错误，先查状态再重试 |
| 下载失败 | 记录是否停止写入、ID 是否正确、服务是否仍运行 |

默认服务只监听本机并检查网页来源。跨机连接需另配 `host / allowedOrigins` 和前端地址；HTTPS 页面需 WSS，部署边界见[前端通讯](FRONTEND-COMMUNICATION.md)。

Python 当前提供基础串口、模拟与矩阵解析，不提供本篇的产品连接、WS 服务或浏览器采集控制，见 [Python SDK](../python/README.md)。
