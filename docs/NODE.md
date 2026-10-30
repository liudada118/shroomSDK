# Node.js 接入

连接实机前先[安装串口驱动](DRIVERS.md)并确认端口，再[激活 SDK 产品密钥](LICENSE.md)。SDK 授权不限制设备型号，产品接口和通用串口均可使用；驱动缺失与授权失败需要分别排查。

适合 Node.js 服务、命令行采集和 Electron 应用。通过串口直接读取设备，或通过 HTTP / WebSocket 连接已经运行的后端。

整包手套与手部检测垫优先按 **选产品 → 选端口与手侧 → onData 接收数据 → 错误诊断** 接入，波特率、协议和线序由产品入口内置。通用 `connect()` 保留为进阶配置；串口查询只列端口，不识别硬件型号，每个阶段都应处理结构化错误。

## 安装与入口

从首页下载 Node.js SDK，解压进入含有 `package.json`、`node/` 和 `web/` 的目录。以下例子均放在这个目录，以 `.mjs` 文件运行。使用 Node.js 18+。

```bash
npm install
node node/demo.js --list
```

`serialport` 用于真实串口，`ws` 用于没有原生 WebSocket 的 Node 环境。模拟设备无需这两项依赖。SDK 当前通过下载包或本地依赖使用，尚未发布到公共 npm 仓库。

## 先用模拟数据

将下面的代码保存为 `example.mjs`，运行 `node example.mjs`：

```js
import { Shroom } from './node/index.js';

const device = Shroom.mock({ rows: 32, cols: 32, fps: 20 });
const unsubscribe = device.onFrame((frame) => {
  console.log(frame.timestamp, frame.max, frame.area);
});

try {
  await new Promise((resolve) => setTimeout(resolve, 1000));
} finally {
  unsubscribe();
  await device.close();
}
```

`mock()` 同步返回设备，通用 `connect()` 异步返回设备。两者使用相同的 `onFrame() / onError() / state / getDiagnostics()` 与关闭接口；Mock 计数反映模拟生成量，不是串口吞吐。Mock 不提供产品 onData、手套序号或 IMU，不能直接作为整包手套替身。

## 改为串口采集

已封装产品直接使用下面的入口；应用不必逐项填写协议配置：

```js
import { Shroom } from './node/index.js';

try {
  const device = await Shroom.connectGlove({
    path: 'COM3', side: 'left',
    onData: (data) => {
      console.log(data.fingers.thumb.raw);
      console.log(data.fingers.index.pulp.raw[0]);
      console.log(data.palm.matrix);
    },
    onError: (error) => console.error(error.code, error.suggestion),
  });
  process.once('SIGINT', () => { void device.close().catch(console.error); });
} catch (error) {
  console.error(error.code, error.message, error.suggestion);
}
```

手部检测垫换为 `Shroom.connectHandPad({ path: 'COM3', onData: console.log, onError: console.error })`。`connectGlove()` 固定整包协议 `handGloveFullPacket`，side 必填；`connectHandPad()` 固定 `hand`。也可使用 `Shroom.connectProduct({ product, ...options })`，清单来自 `Shroom.listDeviceProducts()`。这些方法同样具名导出。

产品入口省略 path 时，只在恰好一个端口时自动选择；零个为 `PORT_NOT_FOUND`、多个为 `PORT_AMBIGUOUS`。`onData / onError` 在打开前注册，避免漏首帧；连接前失败仍拒绝 Promise。产品入口不接受 baudRate、delimiter、layout 等底层覆盖。

包内也提供现成命令：

```bash
node node/product-demo.js glove left COM3
node node/product-demo.js glove right COM4
node node/product-demo.js hand-pad COM5
```

手套按 921600 波特率解析 274 字节 payload：1 字节序号、1 字节包类型、256 字节压力和 16 字节 IMU，包尾 `AA 55 03 99`。`raw / pressure` 保留 256 个 ADC，`pressureMatrix` 为映射后 195 个 ADC，`values` 是归一化 13×15；side 不从包类型猜测，IMU 只保留原字节。检测垫内置 1000000、1024 点、32×32 与 mat32；pressure 是原扫描值，pressureMatrix 和 values 已映射。产品字段仅 JS 提供，Python 未实现这些入口。

整包手套还按最新点位表直接给出 `fingers.thumb / index / middle / ring / little` 五指，每指主体 4×3、12 点，各指 `.pulp` 是独立 1×1 指腹点；`palm` 为手掌，rows=5、cols=15，但 rowLengths=`[12, 15, 15, 15, 15]`，共 72 点，不补零。区域含中文 name、rows、cols、rowLengths、0-based 扫描索引 sourceIndices（Uint16Array）、raw（ADC）、values（按父帧 fullScale 归一化）、matrix（按实际行长排列的 ADC 二维数组），完整字段见[产品帧 API](BACKEND-GUIDE.md#node-product-data)。

这 137 个分区映射位置独立于保留兼容的旧 195 点展示矩阵，不能通过切片 pressureMatrix 获取，也不要求覆盖全部 256 通道。顶层 max/area/center 等仍按旧矩阵计算，未新增分区统计。分区值不是力学单位或弯曲角度；表中的 btPacketSize=128 仅为元数据，不新增蓝牙或双包传输。

**通用串口进阶**：自定义协议时枚举端口，再按设备资料配置：

```js
import { Shroom, asShroomError } from './node/index.js';

try {
  console.log(await Shroom.listPorts());
  const device = await Shroom.connect({
    path: 'COM3', baudRate: 1000000,
    rows: 32, cols: 32, layout: 'raw',
  });
  device.onError((error) => {
    console.error(error.code, error.stage, error.suggestion);
    console.log(device.getDiagnostics());
  });
  device.onFrame((frame) => console.log(frame.max));
  process.once('SIGINT', async () => { await device.close(); });
} catch (error) {
  const failure = asShroomError(error);
  console.error(failure.code, failure.stage, failure.message, failure.suggestion);
}
```

`COM3` 是示例。macOS / Linux 使用枚举得到的设备路径。通用连接的波特率、尺寸与线序按实际设备设置，产品入口则由 SDK 内置；详见[串口接入](SERIAL.md)。

串口、拆帧与解码参数先校验再打开设备。查询与连接失败拒绝 Promise，运行期用 `onError(handler)` 接收 `ShroomError`，返回取消订阅函数。错误有 `code / stage / message / suggestion / details / cause`，JS 入口也导出 `ShroomError / ERROR_CODES`。

串口读取、解析或断开错误会自动停止并尝试清理，应用可 `await device.close()` 确认清理结果；`CALLBACK_FAILED` 不会停止采集。Mock 的帧长在首帧前为 0、首帧后为模拟 payload 点数。

`device.getDiagnostics()` 无参数，同步返回来源、状态、计数、最近错误与 `status / hint`。`status` 为 `waiting-data / waiting-frame / streaming / closed / error`；它描述累计观测，不能自动判定根因或证明设备仍在发送。`close()` 幂等，SDK 不自动重连；完整接口见[后端 SDK API](BACKEND-GUIDE.md#node-diagnostics)。

## 连接已有后端

已有后端负责连接设备时，使用 `BackendSdkClient`，无需让当前程序再次打开串口。HTTP 与 WebSocket 地址分别设置，示例与完整接口见[后端通讯](../BACKEND.md)。

```js
import { BackendSdkClient } from './node/index.js';

const client = new BackendSdkClient();
console.log(await client.getContract());
client.on('error', (error) => console.error(error.message));
client.on('frame', (frame) => console.log(frame));
client.connectRealtime({ channels: ['sit'] });
process.once('SIGINT', () => client.disconnectRealtime());
```

## 下一步

- [串口接入](SERIAL.md)：端口、参数、点位与连接排错。
- [数据存储](STORAGE.md)：在应用中保存数据快照。
- [SDK 说明与排错](../README.md)：完整 API 与诊断指标。

Electron 的真实串口通常放在主进程，通过应用的 IPC 发送可序列化数据给渲染进程。SDK 提供独立 WS 与 SQLite 采集服务，需在实际运行的 Node / Electron 环境中安装匹配的原生依赖；应用的 IPC 与业务数据库由调用方组织。
