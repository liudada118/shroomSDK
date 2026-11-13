# Node.js 接入

**0.5.0 新增：** Node 分包手套支持手动选口与自动识别。手动传 `path + side`；自动调用 `readProduct({ product: 'glove', onData, onError })`，内部复用基础 `connectProduct()` → `scanProductPorts()`。五个快速函数保持不变；0.4.0 仍需手动配置，自动识别要求升级到 0.5.0。

0.3.0 新增鞋垫和人体全身，仍使用 `readProduct()` 或基础 `connectProduct()`。鞋垫传 `product:'insole', side:'left'/'right', protocol:'12bit'/'8bit'`；人体传 `product:'body'`。详见[鞋垫字段](INSOLE.md)、[人体线序](HUMAN-BODY.md)。使用新产品需安装0.3.0或更高版本，Node与网页使用相同版本。

连接实机前先[安装串口驱动](DRIVERS.md)并确认端口，再[激活 SDK 产品密钥](LICENSE.md)。SDK 授权不限制设备型号，产品接口和通用串口均可使用；驱动缺失与授权失败需要分别排查。

适合 Node.js 服务、命令行采集和 Electron 应用。通过串口直接读取设备，或通过 HTTP / WebSocket 连接已经运行的后端。

分包手套优先按 **选产品 → 自动识别串口与手侧 → onData 接收数据** 接入；手部检测垫仍由应用选择实际端口。波特率、协议和线序由产品入口内置。通用 `connect()` 保留为进阶配置，每个阶段都应处理结构化错误。

连接前从 `shroom-sdk/node` 导入 `listPorts()`，将返回的 `path` 展示给用户选择；不要直接取第一项。查询不打开串口，也不需要先激活授权；完整片段见[快速接入准备](QUICK-START.md#flow-ports)。

需要识别分包手套时改用 `scanProductPorts()`：它在有效 `serial` 授权下读取实际数据，返回已确认设备和逐口报告。只要一步取数时可直接 `readProduct({ product: 'glove', onData })`，内部复用同一基础扫描 API，无需业务代码先扫描一次。

## 安装与入口

使用 Node.js 18+，在自己的项目中安装：

```bash
npm install shroom-sdk
```

业务项目从 `shroom-sdk/node` 导入基础 API，快速流程从 `shroom-sdk/quick-flow` 导入。以下基础示例保留源码 ZIP 的 `./node/index.js` 写法；npm 用户将该导入改为 `shroom-sdk/node`，保存为 `.mjs` 文件运行即可。使用 ZIP 时，在含有 `package.json`、`node/` 和 `web/` 的解压目录执行 `npm ci`，再放入示例。其他安装方式见[npm 安装说明](NPM.md)。

`serialport` 用于真实串口，`ws` 用于没有原生 WebSocket 的 Node 环境。模拟设备无需这两项依赖。

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

`mock()` 同步返回设备，通用 `connect()` 异步返回设备。两者使用相同的 `onFrame() / onError() / state / getDiagnostics()` 与关闭接口；Mock 计数反映模拟生成量，不是串口吞吐。Mock 不提供产品 onData、手套序号或 IMU，不能直接作为手套分包/整包替身。

## 改为串口采集

手动选口与自动识别任选其一。0.5.0 的自动方式：

```js
import { connectGlove } from 'shroom-sdk/node';

// 完成授权后，发现唯一分包手套并识别左右手；双手都在时可加 side: 'left' 筛选。
const device = await connectGlove({
  onData: data => console.log(data.side, data.fingers, data.palm),
  onError: error => console.error(error.code, error.message),
});
```

已知串口或使用已发布 0.4.0 时，采用下面的手动方式；应用不必逐项填写协议配置：

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

手部检测垫换为 `Shroom.connectHandPad({ path: 'COM3', onData: console.log, onError: console.error })`。`connectGlove()` 从 0.4.0 起固定分包协议 `handGloveSegmented`；上述 path+side 写法保持手动直连，0.5.0允许省略它们自动发现。整包设备使用 `connectProduct({ product: 'handGloveFullPacket', side: 'left', ...options })`，仍需显式手侧且不接受 scan。`connectHandPad()` 固定 `hand`。也可使用 `Shroom.connectProduct({ product, ...options })`，清单来自 `Shroom.listDeviceProducts()`。这些方法同样具名导出。

0.5.0的分包手套省略 path、side 省略/为 auto 或显式传 scan 时，会验证实际分包；同侧至少 3 个完整配对才匹配。零匹配为 `PORT_NOT_FOUND`、多匹配为 `PORT_AMBIGUOUS`，详情见 `error.details.scan`；全部探测端口释放后才正式连接。传 side=left/right 可筛选，`scan: { paths: ['COM3'], timeoutMs: 1200, signal }` 可限制探测。其他产品仍保持单个串口自动选择、多个串口报歧义的原行为。扫描参数与返回值见[串口扫描](SERIAL.md#node-scan)。

`onData / onError` 在正式打开前注册，避免漏首帧；探测样本不进入这些业务回调。连接前失败仍拒绝 Promise。产品入口不接受 delimiter、layout 等底层覆盖；只有鞋垫明确支持 protocol 和来源列出的 baudRate，其他产品固定波特率。

从 0.2.0 起，Node 产品入口和快速 `readProduct()` 默认开启自动重连：意外断开后按原 `path` 每 3 秒尝试一次、最多 3 次。`reconnect: false` 可关闭，`reconnect: { intervalMs, maxAttempts }` 可调整。使用 `onStateChange: status => console.log(status.state, status.attempt)` 或返回设备的 `onStateChange(handler)` 显示状态；恢复后同一 `device` 和 `onData` 继续交付数据，不需要重新创建 WS。

首次打开失败不会后台重试；主动关闭、授权失效、配置或解析错误会停止。重连不重新枚举或猜测原设备，COM 号变化后需重新选择。断线会使当前录制以 `error` 收尾，重连不会自动续录；恢复后由用户开始新记录。

包内也提供现成命令：

```bash
node node/product-demo.js glove left COM3
node node/product-demo.js glove right COM4
node node/product-demo.js hand-pad COM5
```

默认手套按 921600 波特率解析 130 字节首包 + 146 字节尾包，每包尾为 `AA 55 03 99`，合并出 256 个压力 ADC 和 16 字节 IMU；分包帧没有 `sequence`。`packetType` 在两包中必须一致，当前固件 1=左手、2=右手，不是唯一设备编号；自动扫描据此识别手侧，未知/混合侧别不作为有效设备。显式 `handGloveFullPacket` 仍保留 274 字节整包与序号，详见[手套协议](GLOVE.md)。`raw / pressure` 保留 256 个 ADC，`pressureMatrix` 为映射后 195 个 ADC，`values` 是归一化 13×15；一只手一个串口，手动连接仍按显式 side 选择线序，IMU 只保留原字节。检测垫内置 1000000、1024 点、32×32 与 mat32；pressure 是原扫描值，pressureMatrix 和 values 已映射。Python 提供相同的产品字段与入口（snake_case），见 [Python SDK](../python/README.md)。

两种手套协议均按同一份点位表直接给出 `fingers.thumb / index / middle / ring / little` 五指，每指主体 4×3、12 点，各指 `.pulp` 是独立 1×1 指腹点；`palm` 为手掌，rows=5、cols=15，但 rowLengths=`[12, 15, 15, 15, 15]`，共 72 点，不补零。区域含中文 name、rows、cols、rowLengths、0-based 扫描索引 sourceIndices（Uint16Array）、raw（ADC）、values（按父帧 fullScale 归一化）、matrix（按实际行长排列的 ADC 二维数组），完整字段见[产品帧 API](BACKEND-GUIDE.md#node-product-data)。

这 137 个分区映射位置独立于保留兼容的旧 195 点展示矩阵，不能通过切片 pressureMatrix 获取，也不要求覆盖全部 256 通道。顶层 max/area/center 等仍按旧矩阵计算，未新增分区统计。分区值不是力学单位或弯曲角度；表中的 btPacketSize=128 仅为元数据，不决定传输协议，也不提供蓝牙连接能力。分包与整包分别由对应的产品适配器解析。

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

串口断线或读取错误会报告并释放本次物理连接；启用重连时，保留逻辑设备与订阅后重试。解析或授权错误终止连接，不重试。应用可 `await device.close()` 取消后续重连并确认清理结果；`CALLBACK_FAILED` 不会停止采集或触发重连。Mock 的帧长在首帧前为 0、首帧后为模拟 payload 点数。

`device.getDiagnostics()` 无参数，同步返回来源、状态、计数、最近错误与 `status / hint`。`status` 包括 `reconnecting / waiting-data / waiting-frame / streaming / closed / error`；恢复后需新连接实际收到字节或有效帧才更新当前接收状态，累计计数仍保留。`close()` 幂等并取消后续重试。通用 `Shroom.connect()` / `connectSerial()` 默认不重连，可传 `reconnect: true` 启用；完整接口见[后端 SDK API](BACKEND-GUIDE.md#node-reconnect)。

## 连接已有后端

已有后端负责连接设备时，使用 `BackendSdkClient`，无需让当前程序再次打开串口。HTTP 与 WebSocket 地址分别设置，示例与完整接口见[后端通讯](BACKEND.md)。

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
