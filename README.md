# Shroom SDK

**一步拿到产品数据。** 在自己项目的终端安装 SDK，无需查找仓库、解压或复制源码：

```bash
npm install shroom-sdk
```

```js
import { readProduct, createWS, startRecording, stopRecording, downloadRecording }
  from 'shroom-sdk/quick-flow';
```

SDK 从 npm 注册表安装到 `node_modules/shroom-sdk`，免登记下载，真实设备密钥单独申请。[官网 SDK 下载区](https://sdk.jq-industries.com/#downloads)继续提供 `.tgz` 下载；历史安装包 URL 仍可使用。安装包只含压缩运行代码、类型与说明；保存项目依赖和锁文件，以便重复安装。入口、升级和本地包安装见[npm 安装说明](docs/NPM.md)。压缩不等于加密，也不能防止有意修改代码。

当前源码为 `shroom-sdk@0.3.0`，新增鞋垫双协议和人体全身物理线序，五个函数保持不变。0.3.0 尚未发布到 npm；普通 `npm install shroom-sdk` 目前安装的 0.2.0 不包含这两类新产品，试用新能力请安装本次构建的 `shroom-sdk-0.3.0.tgz`。仓库原有的 `shroom-backend-sdk@0.2.0` 是另一套接口，已由本 SDK 替换；旧代码保留在 `legacy-backend-sdk-0.2.0` 标签与 Git 历史。旧项目升级前先读[迁移说明](MIGRATION.md)。

**取数 → 创建 WS → 开始采集 → 停止采集 → 下载**：五个函数保持不变。Node.js 连接设备并创建服务，网页连接一次后复用同一 `stream`。直接查看[五步 API 调用](docs/QUICK-START.md#quick-call)，使用上面的包名导入，接入自己的程序与按钮；源码 ZIP 的相对路径示例作为另一种交付方式保留。

五个函数复用[基础文档里的公开 API](docs/CUSTOM.md#quick-to-base)，需要定制参数或生命周期时按对应关系查阅。

**先装驱动，再连接设备。** 使用 CH34x USB 串口的设备缺少可用驱动时，SDK 读取不到串口：[Windows 驱动 CH341SER.EXE](https://shroom.jq-industries.com/drive/CH341SER.EXE) · [macOS 驱动 CH34xVCPDriver.zip](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)。安装后重插设备、重启采集应用并查询端口，见[驱动安装与排查](docs/DRIVERS.md)。

真实设备需先激活独立 **Shroom SDK** 产品密钥；SDK 授权不限制传感器型号，产品接口与通用串口均可使用。SDK 与上位机共用管理后台，两个产品的密钥互不通用；有效期和电脑名额仍需校验。连接前调用 `await Shroom.activateLicense(key, { deviceId })`，配置见[SDK 授权](docs/LICENSE.md)。模拟数据可直接使用，设备数据仍需匹配已适配的通信协议。

驱动、SDK 依赖和 Node.js 授权是运行前提，简要配置见[接入准备](docs/QUICK-START.md#product-guide)。本流程使用 `serial / stream / recording` 功能；只需要产品数据时，可在取数后结束。新设备使用基础串口与自定义协议，已有主项目后端可使用 `BackendSdkClient` 客户端。

Node.js 通过 `readProduct({ product, path, onData })` 读取已注册产品。手套 `glove`、鞋垫 `insole` 需要按实物填写 `side`；检测垫 `pad`、人体全身 `body` 不传 side。鞋垫显式选择 `protocol: '12bit' | '8bit'`，默认12bit，保留原始ADC精度。浏览器使用 `readProduct({ url, onData })` 读取 WS；Web Serial 直接连接使用基础 `connectProduct()`。参见[鞋垫协议与数据](docs/INSOLE.md)、[人体全身协议与线序](docs/HUMAN-BODY.md)。

Node.js 产品连接默认在意外断线后重连原串口，每 3 秒尝试一次、最多 3 次。设备对象和数据订阅继续复用，可用 `onStateChange` 显示状态，或设置 `reconnect: false` 关闭。首次连接失败仍由调用方处理；手动关闭、授权失效和解析错误不触发重连。断线会结束当前录制，恢复数据后需重新开始采集。Web Serial、浏览器 WS 和 Python 没有新增自动重连，详见[重连参数与边界](docs/BACKEND-GUIDE.md#node-reconnect)。

提供 **浏览器 / Node.js / Python** 三种入口。以上产品封装仅在 Node.js / 浏览器提供；Python 仍使用通用串口与矩阵接口，不包含整包手套、鞋垫或人体区域解析。Python 3.10+ 可独立安装，不需要 Node；详见 [Python SDK](python/README.md)。

官网下载时可选择 **Python** 或 **Node.js（含浏览器）**，下载文件名包含 SDK 版本。`shroom-sdk-python.zip` / `shroom-sdk-node.zip` 的兼容 URL 仍指向当前构建；需要固定版本时保留对应版本包或使用 GitHub Release 附件。Node.js 包不含 Python 源码；Python 包内的 `python/README.md` 和 `python/AI-CONTEXT.md` 提供专用说明。旧链接 `shroom-sdk.zip` 仍保留完整包，兼容已有使用方式。

升级前查看包内 [CHANGELOG.md](CHANGELOG.md)。Node.js / 浏览器用 `Shroom.version` 查询当前运行版本；Python 用 `shroom_sdk.__version__`。同一发行版本中的不同语言能力以各自文档为准。

Node.js 快速服务内置带标签会话录制与 **SQLite 持久化**，停止后从数据库导出 CSV / JSONL。新记录位于录制目录的 `recordings.sqlite`，使用 `sessions / frames` 表；旧版 JSONL 记录仍可读取下载。曲线、回放、报表、算法及业务数据库由应用实现。Python 不提供产品级连接、WS 服务或本次快速录制接口。源码 ZIP 包含 `package-lock.json`，在解压后的 SDK 根目录执行 `npm ci`；`.tgz` 则作为业务项目的依赖安装，由业务项目锁文件管理。两种方式都需要正确安装 `serialport / ws / better-sqlite3` 等运行依赖，详见[数据存储](docs/STORAGE.md)。

已有主项目后端时，可读取状态、订阅实时帧，并显式调用后端的串口／采集控制接口，见 [后端连接指南](docs/BACKEND.md)。这是客户端，不包含后端服务，也不等于 Shroom Monitor；Python 本次未增加后端客户端。

> **不想自己写代码？** 看 [怎么用AI开发.md](docs/怎么用AI开发.md)——把 [AI-CONTEXT.md](docs/AI-CONTEXT.md)
> 丢给 AI，然后说人话描述你要什么就行。

**Windows / macOS / Linux 都支持**，SDK 是同一份，不分平台版本。
串口驱动、权限与实际 `path` 随系统不同，五步调用接口一致；Python 使用 pip 安装。
本流程的网页通过 WebSocket 连接 Node.js，不直接申请串口；单独使用浏览器 Web Serial 直连设备时，需要支持它的 Chrome 或 Edge。

---

## 选择接入方式 {#routes}

- **[npm 安装](docs/NPM.md)**：已有 Node.js 或前端构建项目，将 SDK 作为依赖使用。
- **[五步 API 调用](docs/QUICK-START.md#quick-call)**：产品取数、创建 WS、开始采集、停止采集、下载，主路径只展示需要调用的接口。
- **[接入准备](docs/QUICK-START.md#product-guide)**：确认驱动、产品、串口、依赖和 SDK 授权。
- **[基础与自定义](docs/CUSTOM.md)**：适配新硬件与协议；参数和错误码查[后端 API](docs/BACKEND-GUIDE.md)、[前端通讯](docs/FRONTEND-COMMUNICATION.md)，文件字段查[数据存储](docs/STORAGE.md)。

## 维护 SDK {#maintain}

这是 SDK 的独立源码仓库：[liudada118/shroomSDK](https://github.com/liudada118/shroomSDK)。维护者修改协议、适配器或 SDK 本身时使用源码；官网与文档站在 [shroomSDKWEB](https://github.com/liudada118/shroomSDKWEB)。

```bash
git clone https://github.com/liudada118/shroomSDK.git
cd shroomSDK
npm ci
npm run pack:npm
```

`pack:npm` 生成 `dist/shroom-sdk-<版本>.tgz`，`test:npm` 验证实际安装结果。正式交付前运行 `npm run sdk:verify`，发布候选使用 `npm run sdk:release`；Python 测试环境及发布步骤见[发布指南](docs/SDK-RELEASING.md)。官网通过固定提交引用 SDK，打包不会自动发布或部署。

## 中文源码导航 {#source-map}

维护源码从 `src/quick-flow.js` 的五个导出开始；类型在 `src/quick-flow.d.ts`。实现集中在 `src/`，示例、文档和构建工具各有目录，不需要逐个浏览根目录文件。

| 目录 | 负责什么 | 建议先看 |
| --- | --- | --- |
| `src/quick-flow.js` | 五个快速函数的统一入口 | `readProduct()` → `createWS()` → 三个采集函数 |
| `src/flow/` | 五函数编排、当前记录 ID 与资源释放 | `runtime.js` |
| `src/node/` | 串口取数与重连、WS 服务、SQLite 采集与导出 | `serial.js`、`serial-reconnect.js` → `quick-server.js` → `recording.js` |
| `src/web/` | 浏览器串口、WS 控制与二维显示 | `stream.js`；浏览器直连看 `serial.js` |
| `src/core/` | 分帧、协议、点位映射、数据结构与授权 | `product.js`、`glove.js`、`license.js` |
| `src/core/products/` | 各产品适配器、注册表与协议复用 | [扩展指南](src/core/products/README.md) |
| `src/backend/` | 连接已经运行的主项目后端 | `client.js`；与快速 WS 服务使用不同协议 |
| `examples/` | 产品例程、Node 演示、网页测试台和调用生成器 | `products/`、`node/`、`web/` |
| `docs/` | 接入、基础 API、AI 上下文与发布说明 | `QUICK-START.md`、`AI-CONTEXT.md` |
| `python/src/shroom_sdk/` | Python 通用串口、矩阵处理、模拟与授权 | `__init__.py` → `device.py` → `frame.py` |

维护者在仓库根目录运行 `npm start -- --no-open` 打开网页示例，`npm run demo:quick:mock` 运行模拟快速服务。直接启动脚本位于 `scripts/start.mjs`、`scripts/start.sh` 和 `scripts/start-demo.bat`。`examples/web/index.html` 与 `shroom.bundle.js` 是构建产物，应修改模块或 `examples/web/index.template.html` 后重新生成。

客户 npm 导入仍为 `shroom-sdk/quick-flow`、`shroom-sdk/node` 等公开入口。兼容源码 ZIP 由打包器映射为原来的 `quick-flow.js`、`node/`、`web/` 与根目录示例、启动脚本；后文的 `./node/`、`./web/` 相对调用示例均以解压后的 ZIP 为准。Git 仓库中的自定义文件若放在根目录，则使用 `./src/quick-flow.js` 等源码路径。

## 五步调用概览 {#s1}

**接入前先搜索串口**：从 `shroom-sdk/node` 导入 `listPorts`，执行 `await listPorts()` 获取列表，让用户选定 `path` 再取数。不要默认连接列表中的第一个串口；没有端口时检查驱动与 USB 连接。搜索是接入准备，不增加第六个快速函数，复制代码见[搜索并选择串口](docs/QUICK-START.md#flow-ports)。

| 步骤 | 运行位置 | API |
| --- | --- | --- |
| 取数 | Node.js | `readProduct({ product: 'glove', path, side, onData, onError })` |
| 创建 WS | Node.js → 浏览器 | `createWS(device, { port: 19999 })`；网页 `readProduct({ url: 'ws://127.0.0.1:19999', onData })` |
| 开始采集 | 浏览器开始按钮 | `startRecording(stream, { label })` |
| 停止采集 | 浏览器停止按钮 | `await stopRecording(stream)` |
| 下载 | 浏览器下载按钮 | `downloadRecording(stream, { format: 'csv' })` |

五个函数在 npm 项目统一从 `shroom-sdk/quick-flow` 具名导入；源码 ZIP 使用 `./quick-flow.js`。后三步共享同一 `stream`，分别由按钮触发；SDK 记住停止结果的记录 ID，再次成功开始后清除旧 ID。下载函数同步触发浏览器下载并返回 URL；需要完整帧结构时选择 JSONL。

结束采集要明确停止，网页关闭不会自动停止后台录制。浏览器调用 `await stream.close()`；Node.js 调用 `await server.close()`，由 `createWS` 一并释放设备。三个采集函数也可传 Node.js 的 `server`，下载返回 HTTP URL。服务默认仅本机使用，准备和调用见[快速接入](docs/QUICK-START.md)。

---
## 浏览器直连：独立取数 {#s2}

以下相对路径适用于源码 ZIP；npm 构建项目将 `./web/index.js` 换成 `shroom-sdk/web`。

```js
import { Shroom } from './web/index.js';

const heatmap = Shroom.createHeatmap('#view');   // #view 是一个 <canvas>

document.querySelector('#btn').onclick = async () => {
  const device = await Shroom.connectHandPad({
    onData: (data) => heatmap.render(data),
    onError: (error) => console.error(error.code, error.suggestion),
  });
  window.addEventListener('pagehide', () => { void device.close().catch(console.error); }, { once: true });
};
```

`connectHandPad()` 内置手部检测垫 `hand` 的 1000000 波特率、1024 点与 `mat32` 映射。所有浏览器连接入口**必须写在点击回调里**；连接前失败仍需在点击函数中用 `try / catch` 处理。

整包手套改用下面的入口，`side` 必须由应用明确选择：

```js
document.querySelector('#glove').onclick = async () => {
  const device = await Shroom.connectGlove({
    side: 'left', // 或 'right'，不能根据包类型猜左右手
    onData: (data) => {
      console.log(data.fingers.thumb.raw);          // 大拇指主体的 12 个 ADC
      console.log(data.fingers.index.pulp.raw[0]);  // 食指独立指腹点
      console.log(data.palm.matrix);               // 手掌按实际行长排列的 ADC
    },
    onError: (error) => console.error(error.code, error.suggestion),
  });
  window.addEventListener('pagehide', () => { void device.close().catch(console.error); }, { once: true });
};
```

没有硬件时用 `Shroom.mock()` 验证通用矩阵显示；它不模拟手套包序号、包类型或 IMU：

```js
const device = Shroom.mock({ rows: 32, cols: 32, fps: 30 });
```

JS / Python Mock 的 `fps` 必须是有限数值，范围为 `1000 / 2147483647` 至 `1000`（含边界，约 `4.657e-7` 至 `1000`）。

**浏览器要求**：Chrome 或 Edge（Safari / Firefox 没有 Web Serial），页面是 https 或 localhost。
用 `Shroom.isSupported()` 提前判断。

---

## Node / Electron 里用 {#s3}

以下相对路径适用于源码 ZIP；npm 项目将 `./node/index.js` 换成 `shroom-sdk/node`。

```bash
npm i serialport
```

```js
import { Shroom } from './node/index.js';

const device = await Shroom.connectHandPad({
  path: 'COM3',
  onData: (data) => console.log(Shroom.renderAscii(data)),
  onError: (error) => console.error(error.code, error.suggestion),
});
process.once('SIGINT', () => { void device.close().catch(console.error); });
```

手套使用 `Shroom.connectGlove({ path: 'COM3', side: 'left', onData: console.log })`。Node.js 产品入口省略 `path` 时，恰好一个端口才自动选择；零个端口报 `PORT_NOT_FOUND`，多个报 `PORT_AMBIGUOUS`。这不会自动识别硬件型号。产品入口不接受 `baudRate / delimiter / layout` 等协议覆盖，进阶配置使用原 `Shroom.connect()`。完整参数见[产品接入 API](docs/BACKEND-GUIDE.md#node-connect-product)。

---

## Python 里用 {#s4}

在本仓库或解压后的 SDK 根目录执行：

```bash
python -m pip install "./python[serial]"
python -m shroom_sdk --frames 3   # 无硬件，先跑模拟数据
python -m shroom_sdk --list       # 列出串口
python -m shroom_sdk COM3         # 真实设备
```

```python
from shroom_sdk import Shroom

with Shroom.connect("COM3", rows=32, cols=32) as device:
    for frame in device:
        print(frame.max, frame.area, frame.center.x, frame.center.y)
```

没有硬件时用 `Shroom.mock(rows=32, cols=32)` 替换 `Shroom.connect(...)`。
`with` 自动关闭连接；需要超时判断时用 `device.read_frame(timeout=2)`，无完整帧返回 `None`。
Python 使用同步迭代和 snake_case 参数；字段语义、float32 数值和点位排列与 JS 一致。
提供终端文字热力图、可选 Matplotlib 示例；完整 API、安装和排错见 [Python SDK](python/README.md)。

---

## 通用 Frame 与产品分区数据 {#s5}

本节先列通用串口、Mock 与检测垫使用的基础 `Frame` 字段，再说明产品数据。整包手套通过 `fingers / palm` 命名分区访问，不将整只手套当成规则矩阵。`BackendSdkClient` 的 `frame` 事件保留后端原始结构，不能直接当成这里的 `Frame` 使用。

以下是通用矩阵的 JavaScript `onFrame` 基础字段；Python 使用 `Frame` 数据类，`raw` 为 bytes、`values` 为 array('f')：

```js
{
  raw,        // Uint8Array    原始 ADC 值 0~255，一个点一个字节
  values,     // Float32Array  归一化到 0~1，长度 = rows * cols
  rows, cols, // 矩阵尺寸
  min, max, avg,  // 归一化后的极值和均值
  area,       // 受力点数（超过阈值的点）
  center,     // { x, y } 压力重心，都是 0~1
  timestamp,  // 毫秒时间戳
}
```

| 产品入口 | 推荐产品数据 |
| --- | --- |
| `connectHandPad()` | `raw / pressure` 为原扫描顺序的 1024 个 ADC；`pressureMatrix` 为映射后的 1024 个 ADC，`values` 为映射并归一化的 32×32 矩阵 |
| `connectGlove({ side })` | `raw / pressure` 为 256 个原始压力 ADC；`fingers.*.raw` 为五指主体，`fingers.*.pulp.raw` 为独立指腹，`palm.matrix` 为 72 点手掌；另有 `side / sequence / packetType / imu.raw` |

整包手套使用 921600 波特率，274 字节 payload 为序号 1 字节、包类型 1 字节、压力 256 字节、IMU 16 字节，尾标记为 `AA 55 03 99`。`imu.raw` 仅保留 16 个原始字节，不承诺单位或姿态解算。手套按命名分区读取与展示；检测垫使用已映射的 `pressureMatrix / values`。产品解析和映射已完成，无需再次套用 `layout`。Python 不提供这些产品字段和入口。

手套分区按最新左右手点位表直接从 256 个扫描 ADC 提取：`fingers.thumb / index / middle / ring / little` 分别为大拇指、食指、中指、无名指、小拇指，每指主体为 4×3、12 点；各指 `.pulp` 是独立 1×1 指腹点，不混入主体。`palm` 为 5 行、声明列宽 15，但首行只有 12 点，其余各 15 点，共 72 点，`rowLengths` 为 `[12, 15, 15, 15, 15]`，matrix 不补零。

每个分区有 `name / rows / cols / rowLengths / sourceIndices / raw / values / matrix`：`sourceIndices` 为 `Uint16Array`，是用户表 1-based 点号减 1 后的扫描索引；raw 为 ADC，values 按父帧相同 fullScale 归一化，matrix 是按实际行长排列的 ADC 二维数组。五指、指腹和手掌合计 137 个映射位置，无需覆盖全部 256 通道。各分区直接按左右手点位表从原始扫描数据提取，统计由应用根据对应分区计算，不把基础 Frame 的矩阵统计当作五指和手掌的汇总。

这些分区值不是力、物理压力或弯曲角度。点位表中的 `btPacketSize: 128` 只是元数据，不表示 SDK 新增蓝牙或双包传输；当前仍为上述整包串口协议。

检测垫和通用矩阵的 `values`、手套各分区的 `values` 都是**相对值**，不是物理单位。默认满量程下为 0~1；要换算成 kPa 需要每台设备的标定数据，
不在这个 SDK 里。

检测垫或通用矩阵按行列取点；手套则使用上面的命名分区：

```js
const v = frame.values[y * frame.cols + x];
```

---

## 点位排列（线序） {#s6}

串口里那一串字节是**采集板的扫描顺序**，不等于垫子上的位置。不做转换直接铺成方阵，
按垫子最上面一行，画面上亮的可能是中间那一行——数值没问题，位置是错的。

`connectGlove()` / `connectHandPad()` 已按产品处理线序。下面是通用 `connect()` / `decodeFrame()` 的进阶配置；其他产品的走线不同，需要按产品选择：

```js
await Shroom.connect({ layout: 'carSeat' });   // 连接时选
Shroom.decodeFrame(payload, { layout: 'carSeat' });  // 自己接数据源时选
```

选了排列就**不用再传 `rows` / `cols`**，排列自己知道这块垫子是几行几列。

| layout | 产品 | 输出 |
| --- | --- | --- |
| `raw` | 不转换，按扫描顺序原样铺 | 按方阵推断 |
| `mat32` | 32×32 压力垫（床垫 / 手部垫 / 眠枕 / 宠物垫） | 32×32 |
| `sit` | 坐垫 | 32×32 |
| `bed1` | 床垫（另一版走线） | 32×32 |
| `carSeat` | 汽车坐垫 / 脚垫 | 32×32 |
| `carBack` | 汽车靠背 | 32×32 |
| `car10` | 汽车坐垫 10×10 | 10×10 |
| `car10Back` | 汽车靠背 10×10 | 10×10 |
| `sit10` | 坐垫 10×10 | 10×10 |
| `yanfeng10` | 延锋坐垫 | 10×10 |
| `yanfeng10Back` | 延锋靠背 | 10×10 |
| `volvo` | volvo 坐垫 | 32×32 |
| `volvoBack` | volvo 靠背 | 32×32 |
| `volvoHead` | volvo 头枕 | 10×10 |
| `smallM` | 长条垫 | 32×10 |
| `rect` | 方垫 | 16×10 |
| `short` | 短垫 | 32×32 |
| `matCol` | 列式垫 | 16×10 |
| `sitCol` | 列式坐垫 | 32×32 |
| `xiyue` | 喜悦 | 32×32 |
| `carCol` | 列式汽车垫 | 9×10 |
| `sit100` | sit100 坐垫 | 12×6 |
| `endiSit` | 恩迪坐垫 | 23×23 |
| `sofa` | 沙发 | 16×16 |
| `handSinglePoint` | 手部单点垫 | 32×32 |
| `wholeChair` | 整椅坐垫 | 16×16 |
| `wholeChairBack` | 整椅靠背 | 16×16 |
| `wholeChairHead` | 整椅头枕 | 10×10 |
| `tempFullBed` | 温度全床，只取压力那块 | 12×15 |
| `smallSample` | 小样垫（一帧 256 点） | 10×10 |
| `footInsole` | 触觉足底（一帧 256 点） | 10×6 |

这张表在代码里也能拿到：

```js
Shroom.listLayouts();  // [{ name: 'mat32', label: '32×32 压力垫', rows: 32, cols: 32 }, ...]
```

**但界面下拉框别用它**——上面这张表是按**走线**列的，用户手里拿的是**产品**。
好几款产品共用一条走线（手部检测、小床监测、宠物看护走的都是 `mat32`），
下拉框里写「32×32 压力垫」，用户对不上自己那台设备。通用矩阵产品的旧下拉框用 `listProducts()`；高层可直连产品清单用 `Shroom.listDeviceProducts()`，目前为 `handGloveFullPacket / hand`，不要把两份清单混为一谈：

```js
Shroom.listProducts();
// [{ name: 'hand', label: '手部检测', layout: 'mat32', rows: 32, cols: 32 }, ...]

const p = Shroom.getProduct('petCare');
await Shroom.connect({ layout: p.layout });   // 下拉里的 value 是产品名，解码要的是线序名
```

| 产品 | 走线 | 输出 |
| --- | --- | --- |
| 手部检测 | `mat32` | 32×32 |
| 10*10小样 | `smallSample` | 10×10 |
| 触觉足底 | `footInsole` | 10×6 |
| 小床监测 | `mat32` | 32×32 |
| 小床检测(数据) | `mat32` | 32×32 |
| 温度全床系统 | `tempFullBed` | 12×15 |
| 宠物看护 | `mat32` | 32×32 |
| mini看护 | `mat32` | 32×32 |
| 16*16高速 | `raw` | 16×16 |
| 32*32高速 | `raw` | 32×32 |
| 32*32(检测点) | `handSinglePoint` | 32×32 |
| 正常测试 | `raw` | 32×32 |
| 人体全身 | `raw` | 32×32 |

名字和顺序都照抄公司桌面端的「请选择传感器」菜单，用户在两边看到的是同一串字，
下拉里也只写产品名，不写几乘几。
走线为 `raw` 的那几款，桌面端也不做线序转换，按扫描顺序原样铺就是对的。
桌面端的「整椅展示」是一项、三块板子接三个串口拼成一把椅子，这里一次只连一个口，
拼不出来，所以**整个不收**；小床褥监测则是桌面端菜单里本来就没有的一项，也没收。
这两个的走线（`wholeChair` / `wholeChairBack` / `wholeChairHead` / `matCol`）都还在上面那张走线表里，
真要单个垫子，自己传 `layout` 即可。

产品表里没有的设备，直接传 `layout` 用上面那张走线表，或者自己传 `rows` / `cols`。

三件要知道的事：

- **只搬位置，不改数值。** 个别产品的正式上位机还会做坏点插值、空行填补、压力换算，
  那些属于数值处理，不在这个 SDK 里。所以同一帧数据，这里的数字和正式上位机可能对不上，
  位置是对的。
- 有的产品有**没装传感器的空位**（比如 `carCol` 中间那一列），这些位置固定是 0。
- 大多数产品一帧是 1024 个点，`smallSample` 和 `footInsole` 是 256 个。排列自己知道要几个点，
  不用你操心；但**排列选错了帧长，画面会大片是空的**——这是选错型号最明显的症状。
- `tempFullBed` 只给压力矩阵，那三个温度点不在排列里，需要温度得自己从原始帧取。
- **整包手套 `handGloveFullPacket` 已通过 Node.js / 浏览器的 `connectGlove({ side })` 封装**；它不是这张通用线序表中的 layout。其他手套型号与 Python 手套接入仍需另行适配。

拿不准手里是哪一款？打开网页测试台，挨个换着看，按下去的地方和画面上亮的地方对上了就是它。

---

## API {#s7}

### 浏览器（`web/index.js`） {#s8}

| 方法 | 说明 |
| --- | --- |
| `Shroom.connectGlove(options)` | 整包手套入口，必填 `side`，可传 `onData / onError` |
| `Shroom.connectHandPad(options?)` | 手部检测垫入口，内置协议和映射 |
| `Shroom.connectProduct(options)` | 通过 `product: 'handGloveFullPacket' \| 'hand'` 选择上述产品 |
| `Shroom.listDeviceProducts()` | 列出已封装的可直连产品，不查询硬件 |
| `Shroom.connect(options?)` | 连接串口，返回 `Promise<Device>`。必须在用户点击里调用 |
| `Shroom.mock(options?)` | 模拟设备，接口与 `connect()` 完全一致 |
| `Shroom.createHeatmap(canvas, options?)` | 在 canvas 上创建热力图 |
| `Shroom.isSupported()` | 当前浏览器是否支持串口 |

### Node（`node/index.js`） {#s9}

| 方法 | 说明 |
| --- | --- |
| `Shroom.connectGlove(options)` / `connectHandPad(options?)` | 产品入口；省略 path 时仅单个端口可自动选择 |
| `Shroom.connectProduct(options)` / `listDeviceProducts()` | 统一产品连接与产品清单 |
| `Shroom.connect(options?)` | 连接串口，`options.path` 不填就自动挑第一个 |
| `Shroom.listPorts()` | 列出可用串口 |
| `Shroom.mock(options?)` | 模拟设备 |
| `Shroom.renderAscii(frame, options?)` | 把一帧画成终端里的彩色方块 |

### Device {#s10}

```js
device.info                    // { source, rows, cols, baudRate | path | fps }
const off = device.onFrame(fn) // 订阅，返回取消订阅的函数
// 产品设备也有 device.onData(fn)，与 onFrame 是别名
const offError = device.onError((error) => console.error(error.code, error.suggestion))
device.state                   // 'open' | 'closed' | 'error'；Node 串口另有 'reconnecting'
device.getDiagnostics()        // 当前观测快照，见下方排错说明
device.bytesReceived           // 串口收到的原始字节数；Mock 为生成的模拟字节数
device.frameCount              // 串口成功切出的 payload 数；Mock 为生成的帧数
device.droppedCount            // 丢掉的无效长度帧数，增长时结合设备协议排查
device.frameLength             // 串口锁定帧长；Mock 首帧前 0、首帧后为模拟点数
await device.close()           // 主动断开并取消待执行的重连，可重复调用
```

`onError(handler)` 的参数是 `ShroomError`，返回取消订阅函数；查询与连接失败则用 `try / catch` 捕获。可从 JS 入口具名导入 `ShroomError`、`asShroomError`、`ERROR_CODES`，通过 `code / stage / message / suggestion / details / cause` 展示或记录错误。Python 同步调用抛出 `ShroomError`，使用 `device.get_diagnostics()` 和 snake_case 字段，没有错误回调。详见[错误与诊断接口](docs/BACKEND-GUIDE.md#diagnostics)。

Mock 的字节数与帧数反映模拟数据生成量，不是串口吞吐；其丢帧数为 0。浏览器取消选择使用 `error.code === ERROR_CODES.USER_CANCELLED` 判断。帧回调自身抛错会报告 `CALLBACK_FAILED`，不应据此认定设备断线。

### Heatmap {#s11}

```js
const heatmap = Shroom.createHeatmap('#view', { mode: 'dots' })
heatmap.render(frame)
heatmap.setOptions({ colormap: 'jetWhite', gain: 2, dotSize: 1.4 })
heatmap.clear()
```

**三种画法**：

| mode | 长什么样 | 适合 |
| --- | --- | --- |
| `'dots'`（默认） | 带透视的点阵，没受力的地方是一片蓝色底噪，受力的地方顶起来并变绿变黄变红 | 和 Shroom 桌面端一样的观感 |
| `'heat'` | 每个传感点一个圆斑，边缘淡出，叠加成一片 | 看整体压力分布 |
| `'grid'` | 一个点一个方格 | 看原始矩阵、调试尺寸 |

点阵那条链路和桌面端是同一套：把每个传感点甩到一个更密的格子上 → 高斯摊开 →
逐点做时间柔化 → 按值定高度、按值取颜色。**每个格点都画**，包括没受力的，
它们落在 jet 的最低档正好是纯蓝，那片蓝底就是点阵的底子。整个过程只用 canvas，
不依赖 Three.js。

其他参数：`colormap` 可选 `'jet'`（彩虹）、`'jetWhite'`（白底）、`'grey'`（灰度），
也可以直接传自己的函数 `(t) => [r, g, b]`，`t` 是 0~1；
`gain` 是显示增益，信号弱时调大；`dotSize` 是点 / 圆斑的大小倍数；
`relief` 是点阵起伏高度倍数（给 `0` 就是平的俯视点阵）；
`tilt` 是俯视角（度，默认 70）——**嫌点阵看着太扁就调它**，越大越像正俯视、
方阵看过去越方，示例页面上有个「视角」滑块可以直接拖；
`flipY` 决定数据第一行画在近处还是远处（默认 `true` = 近处）——**按下面却是上面鼓起来
就把它设成 `false`**，示例页面上是「前后翻转」那个勾。

`render()` 只是记下这一帧，实际绘制放在下一个屏幕刷新周期。所以数据来得再快
（串口 1000000 波特下一秒上百帧）也不会多画一次，画面不会闪，CPU 也不会白烧。

---

## 连接参数 {#s12}

下面配置针对通用 `Shroom.connect()`。手套与手部检测垫优先使用产品入口，协议参数由 SDK 固定，不需要逐项填写或覆盖。

```js
await Shroom.connect({
  baudRate: 1000000,                       // 默认 1000000
  delimiter: [0xAA, 0x55, 0x03, 0x99],    // 帧分隔符，默认就是这个
  layout: 'mat32',                        // 点位排列，见上面那张表；不填就是 'raw' 不转换
  rows: 32, cols: 32,                     // 不填按方阵推断：1024 个点 → 32×32；给了 layout 就不用填
  fullScale: 255,                         // 满量程
  threshold: 0.02,                        // 算 area / center 时的有效点阈值
  lockLength: true,                       // 锁定帧长，默认开，见下
});
```

串口、拆帧与解码选项会在打开端口前校验。波特率和矩阵尺寸必须有效，`rows / cols` 成对提供；分隔符不能为空，长度范围、`fullScale`、`threshold` 与 `layout` 也需符合约束。SDK 不会根据端口或数据自动识别产品、波特率和线序。

**关于 `lockLength`。** 分隔符只有 4 个字节，数据里迟早会撞出一模一样的一串
`AA 55 03 99`，于是切出一个长度不对的短帧。这种长度多半不是完全平方数，
解码时会退化成 `1×N`——画面就在方阵和一条横线之间来回闪。
所以切帧器默认会：连着 3 帧长度一致就把这个长度锁死，之后长度对不上的一律当脏帧丢掉；
万一锁错了（比如开头第一帧本身就是残的），另一个长度连着来 12 次就改锁它，能自己纠回来。
`device.frameLength` 能看到锁在了多少字节。真要收变长帧就传 `lockLength: false`。

**点「连接设备」没反应？** 对照下面这张表：

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 「连接设备」是灰的，页面顶上有黄条 | 你是双击 `web/index.html` 打开的，`file://` 下没有串口 | 改用 `start-demo.bat` |
| 页面一片空白 / 样式全乱 | 浏览器太老 | 换新版 Chrome 或 Edge |
| `localhost:5178` 打不开 | 服务器没起来 | 见下面「服务器起不来」 |
| 提示「不是安全上下文」 | 页面地址不是 https 或 localhost | 换成 localhost，或给站点配 https |
| 提示「没有 Web Serial API」 | 浏览器不支持（Safari / Firefox / 部分国产壳浏览器） | 换 Chrome 或 Edge |
| 弹了框但列表是空的 | 设备没插好，或缺 USB 串口驱动 | 见下面「按系统看驱动与权限」 |
| 点了「连接设备」直接说「你取消了选择」 | 弹框被你关掉了 | 重新点，在列表里选中设备再确认 |

**按系统看驱动与权限**（列表是空的、或 Node 端 `listPorts()` 返回空时看这里）：

| 系统 | 要做的事 |
| --- | --- |
| Windows | 安装 [CH341SER.EXE 驱动](https://shroom.jq-industries.com/drive/CH341SER.EXE)，重插设备，在**设备管理器 → 端口 (COM 和 LPT)** 中确认 COM 口 |
| macOS | 下载 [CH34xVCPDriver.zip 驱动](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)，解压并按指引安装；重插设备，用 `ls /dev/cu.*` 检查新增串口 |
| Linux | 驱动通常在内核里，但**默认用户没有串口权限**：打开设备会报 `Permission denied`。执行 `sudo usermod -aG dialout $USER` 后**重新登录**（`newgrp dialout` 可临时生效）。设备名一般是 `/dev/ttyUSB0` 或 `/dev/ttyACM0` |

> Linux 上还有一个坑：某些发行版的 `brltty` 服务会把 CH340 抢走当盲文设备。
> 插上后 `/dev/ttyUSB0` 一闪就消失的话，`sudo systemctl stop brltty` 试一下。

**服务器起不来 / `localhost:5178` 打不开？** 先看运行 `node start.mjs` 的那个窗口打印了什么：

| 窗口里的提示 | 意思 | 怎么办 |
| --- | --- | --- |
| `这个目录下没有 web/index.html` | 你在外层文件夹里跑的 | 解压出来常常是 `shroom-sdk\shroom-sdk\`，要 cd 到**里面**那层 |
| `'node' 不是内部或外部命令` | 没装 Node 或没进 PATH | 装 Node.js 18+，装完**重开**一个终端窗口 |
| `端口 5178 被占用，换 5179 试试` | 端口冲突 | 按它最后打印的那个地址开 |
| 窗口一闪就没了 | 双击了 `start.mjs` | 双击 `start-demo.bat`，或在终端里跑 |
| 什么都没打印 | 命令没真正执行 | 确认你按了回车、且当前目录下有 `start.mjs`（`dir` 看一下） |

服务器起来的标志是窗口里出现 `Shroom SDK 示例已启动：http://localhost:xxxx`，**并且这个窗口不能关**。关掉窗口服务器就停了，页面自然打不开。

**连上了但没画面 / 画面是花的？** 示例页面右下角有一行诊断数字，照着它判断：

| 诊断 | 说明 | 怎么办 |
| --- | --- | --- |
| 字节 = 0 | 当前尚未收到字节 | 确认选对了 COM 口；设备是否需要先发启动指令；换根数据线 |
| 字节在涨，帧 = 0 | 当前尚未切出完整帧 | 核对设备资料中的波特率、分隔符和长度限制；可用波特率包括 `1000000`（默认）、`921600`、`1500000`、`3000000`、`115200`，应按设备选择 |
| 帧在涨，画面花 | 可切帧，仍需核对矩阵与协议 | 显式指定 `rows` / `cols`，别靠方阵推断 |
| 帧在涨，按下去的位置不对 | 没选点位排列，画的是采集板的扫描顺序 | 按产品选 `layout`，见上面那张表 |
| 画面变成一条横线 | 帧长不是完全平方数，推不出方阵 | 显式指定 `rows` / `cols`；`device.frameLength` 就是实际帧长 |
| 帧在涨，丢弃也在涨 | 有无效长度或与锁定长度不匹配的 payload | 结合设备协议核对分隔符、长度范围、波特率；不能只凭计数认定根因 |

代码里对应的是这三个计数：

```js
device.bytesReceived   // 串口收到的原始字节数
device.frameCount      // 成功切出的帧数
device.droppedCount    // 长度不合法被丢掉的帧数
device.frameLength     // 锁定下来的帧长（字节）
console.log(device.getDiagnostics()); // 包含 state、status、hint 和 lastError
```

诊断快照的 `status` 为 `waiting-data / waiting-frame / streaming / closed / error`，Node 串口另有 `reconnecting`；`hint` 提供下一步检查建议。字节与帧数保留累计值，但 Node 重连后的收数状态按本次连接判断；`streaming` 不证明设备仍在持续发送，也不代表尺寸、产品或线序选择正确。Node 产品连接在可重试断线后自动重连，通用 `Shroom.connect()` 需显式开启；应用调用 `close()` 会取消重连。解析错误、授权失效或关闭失败会终止恢复，`CALLBACK_FAILED` 不会停止设备。Web Serial 与 Python 仍由应用决定重新连接；Python 同步采集使用 `with` 或 `try / finally` 关闭设备。

---

## 目录 {#s13}

```text
shroomSDK/
├─ src/                  SDK 运行实现与类型
│  ├─ quick-flow.js      五个函数的统一导出
│  ├─ flow/              快速调用编排
│  ├─ core/              协议、产品适配、数据结构与授权
│  ├─ node/              Node 串口、WS 与 SQLite 采集
│  ├─ web/               浏览器串口、WS 与二维显示
│  └─ backend/           已有后端的 HTTP / WS 客户端
├─ examples/
│  ├─ products/          手套左右手与手垫的 HTML / MJS 示例
│  ├─ node/              命令行演示与示例授权配置
│  ├─ web/               网页测试台、模板与生成的 bundle
│  └─ product-*.js       官网和调用示例共用的生成器
├─ docs/                 接入、API、AI 上下文和发布说明
├─ scripts/              启动、构建、版本、打包与发布检查
├─ tests/                JavaScript 与类型测试
├─ python/               独立 Python 包、文档、示例和测试
├─ .github/              跨平台检查与 Release 草稿工作流
├─ package.json          公开包入口与开发命令
├─ package-lock.json     JavaScript 依赖锁
├─ tsconfig.json         类型检查配置
├─ README.md             使用说明与源码导航
├─ ARCHITECTURE.md       架构与累积工作记录
├─ CHANGELOG.md          版本变更
└─ MIGRATION.md          原有 SDK 的迁移边界
```

JavaScript 串口实现分别在 `src/web/serial.js` 和 `src/node/serial.js`。通用入口使用 `src/core/framer.js` 与 `src/core/frame.js`，产品入口委托 `src/core/products/` 的适配器。Python 串口实现位于 `python/src/shroom_sdk/device.py`，通过跨语言测试对齐解析结果。

上述是 Git 源码仓库结构。客户 npm 包只有运行代码、类型和交付说明；源码 ZIP 保留既有的扁平路径，便于已接入项目继续使用。

---

## 拿去问 AI {#s14}

SDK 里有一份专门写给 AI 读的说明：**[AI-CONTEXT.md](docs/AI-CONTEXT.md)**。
把它整个丢给 AI（拖进对话框，或者复制粘贴），然后描述你想做的东西：

> 帮我做一个页面：用重心控制一个小球移动，压力超过 0.5 就变色。

它里面写全了 API、Frame 结构、几条硬性约束（用户手势、安全上下文、
数据是 0~1 相对值而不是 kPa）和可以直接抄的例子，AI 照着就能写出跑得起来的代码。

完整流程见 **[怎么用AI开发.md](docs/怎么用AI开发.md)** ——包括怎么描述需求、
AI 写出来的东西怎么跑起来、报错了怎么跟它说。

SDK 负责把数据稳定地给到你手上，剩下的想怎么玩都行。
