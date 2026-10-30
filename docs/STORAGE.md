# 数据存储

Node.js 快速服务使用 **SQLite 保存采集记录**，提供会话标签、停止收尾及 CSV / JSONL 导出；浏览器提供录制控制和文件下载。业务数据库、跨设备同步和历史回放仍由应用实现。完整跑通方式见[快速接入](QUICK-START.md)。Python 当前只有基础文件输出，不具备这里的快速录制接口。

五步流程的开始、停止和下载调用的就是本页基础 API。快速入口额外保存本次记录 ID，基础接口由调用方明确指定 ID，见[两层对应表](CUSTOM.md#quick-to-base)。

## 带标签会话录制 {#recording}

先在 Node.js 端用 `Shroom.serveDevice(device, { port: 19999, recordingsDir: './recordings' })` 提供数据服务；浏览器连接后控制录制：

```js
const stream = await Shroom.connectStream({ port: 19999 });
await stream.startRecording({ label: '握拳' });

// 动作完成后停止；等待服务端已接收的数据写完。
const recording = await stream.stopRecording();
stream.downloadRecording(recording.id, { format: 'csv' });
```

一次会话一个标签。需要新动作标签时先停止，再新建录制；标签不会自动识别动作，也不会自动赋予数据物理单位。SDK 在 Node.js 端持续写入帧记录，不靠浏览器缓存全部数据。页面断开或不渲染不会自动停止后台录制，操作结束时需要明确停止。

新记录保存在录制目录的 `recordings.sqlite`：`sessions` 表保存会话标识、标签、起止时间、已提交帧数和状态；`frames` 表保存对应会话的帧数据。每帧保留时间信息、产品字段与原始 ADC，手套保留左右手和分区数据，检测垫保留矩阵。`source` 标明数据来源，模拟样本为 `mock`，不可混作真实设备采集。

帧先进入有界队列，再以每批最多 200 帧的事务写入；未满批的数据约每 250ms 刷入数据库。`frameCount` 只在事务提交成功后增加。停止采集先停止接收新记录帧，再等待队列排空和会话状态保存；实时取数与 WS 不因此关闭。写入失败必须展示错误，不能把有错误的会话提示为完整成功；停止后为零帧也不代表采集成功。

在 SDK 根目录执行 `npm install`，安装快速服务所需的 `ws` 与 SQLite 驱动 `better-sqlite3`；实机取数还需要 `serialport`。`better-sqlite3` 是按功能使用的可选依赖，仅使用解析或一步取数时不需要初始化采集数据库。

## 采集基础 API {#recording-api}

`server` 来自 Node `serveDevice()`，`stream` 来自网页 `connectStream()`；两端控制同一个服务的录制状态。

| 基础方法 | 参数与返回值 |
| --- | --- |
| `server.startRecording({ label })` / `stream.startRecording({ label })` | label 必填，去除首尾空白后为 1–200 字符且不含控制字符；Promise 返回新 `RecordingSession` |
| `server.stopRecording()` / `stream.stopRecording()` | Promise 等待入库队列排空和会话状态保存后返回记录；设备与 WS 继续取数 |
| `server.getRecordingStatus()` | 同步返回当前/最近记录快照，尚未开始时为 null |
| `stream.getRecordingStatus()` | Promise 查询同一状态，尚未开始时为 null |
| `server.listRecordings()` / `stream.listRecordings()` | Promise 返回持久化记录列表，按开始时间倒序排列 |

一台服务同时只录制一条记录；已有活动记录时再次开始会报 `RECORDING_ACTIVE`。从未开始时停止会报 `RECORDING_NOT_ACTIVE`，重复停止返回最近一次记录。开始录制需要 `recording` 功能授权，串口与数据服务也需各自的有效授权。

返回记录含 `id / label / startedAt / endedAt / frameCount / status` 及可选产品信息、错误。`id` 是服务分配的 UUID；`status` 为 `recording / stopped / error`，新记录的 `frameCount` 统计已成功提交到 SQLite 的帧数。停止完成后仍应检查错误与帧数，不能只凭 Promise 完成就判定采集有效。

基础接口不会替页面管理重复点击。请求失败时展示错误；网络超时后先查询状态，不直接重复发送开始命令。`stream.close()` 只断开网页；基础 `server.close()` 会停止服务并等待入库队列排空，但不关闭调用方的设备。

## 记录查询与文件下载 {#export}

本页基础下载接口的第一个参数是必填的**采集记录 ID**。从开始/停止录制的返回值或历史列表取得目标记录的 `id`，然后显式传入；基础接口不会默认下载最近一次记录，也不会把同标签的多场采集合并。

```js
const recordings = await stream.listRecordings();
const status = await stream.getRecordingStatus();
console.log(recordings, status);

// 页面选中目标记录后调用，传该条记录的 id。
function downloadById(recordingId) {
  stream.downloadRecording(recordingId, { format: 'jsonl' });
}
```

`recordingId` 不是产品 ID、标签或 WS 端口。客户端拒绝缺少/无效 ID，服务端拒绝不存在的记录（404）和仍在录制、尚未完成写盘的记录（409）；记录 ID 本身不代替权限校验。

### 下载与 URL 基础方法 {#recording-url}

| 方法 | 同步返回值与行为 |
| --- | --- |
| `server.getRecordingUrl(id, { format })` | Node 返回本服务的 HTTP 下载 URL；不访问文件、网络或 DOM，也不自动保存 |
| `stream.getRecordingUrl(id, { format })` | 返回对应服务的 HTTP/HTTPS 下载 URL；WS 对应 HTTP，WSS 对应 HTTPS |
| `stream.downloadRecording(id, { format })` | 通过临时链接触发浏览器下载，并返回相同 URL；需要可用的 `document.body` |

三者 `id` 都必须是有效 UUID，`format` 仅支持 `csv / jsonl`，默认 `csv`。参数无效报 `INVALID_CONFIG`；`getRecordingUrl()` 不检查记录是否存在或已完成写入，404/409 由实际下载请求返回。

例：Node 中 `const url = server.getRecordingUrl(recording.id, { format: 'jsonl' })`，由调用方决定如何取回文件。网页下载只表示已发起请求，不代表文件已保存完成。

- CSV：每个数据帧一行，列为 `sessionId / label / index / timestamp / source / product / side / sequence / raw / pressure / pressureMatrix / fingers / palm / frame`。数组、分区和完整帧保留为 JSON 单元格，不是每通道独立一列；文本按 CSV 规则转义，并防止标签被表格软件当作公式执行。
- JSONL：每行一条完整帧记录，更适合保留手套五指、指腹、手掌和附加字段。
- 下载通过 HTTP 附件响应交付文件；服务端记录不会因为下载而被删除。`downloadRecording()` 同步触发浏览器下载并返回 URL，不确认浏览器已保存完毕，下载结果由浏览器管理。

默认数据库位置为相对 Node.js 当前工作目录的 `.shroom-recordings/recordings.sqlite`；显式传入 `recordingsDir` 可指定保存目录。下载时按记录 ID 从 SQLite 分页读取并流式生成 CSV / JSONL；这两种格式是导出文件，不是新记录的底层存储格式。下载接口不直接提供 `.sqlite` 数据库文件。

同目录已有的旧版 `.meta.json` / `.jsonl` 记录仍可查询和下载，不自动重写或迁移。SQLite 持久化不等于备份或无限存储；长期运行仍要为磁盘容量、目录权限、访问控制和记录保留制定策略。

开始、停止、导出都是可能失败的操作。界面应在控制请求中禁用重复点击，成功后刷新记录列表，失败时展示 `code / message`。触发下载后不能立即提示“下载完成”，也不要仅凭返回一个路径就认为浏览器已下载成功。

## 独立服务与已有后端 {#services}

快速方案的 `serveDevice()` 是独立 SDK 数据与录制服务，使用自己的 SQLite 数据库，不依赖 Electron 或上位机运行环境。它参考上位机的会话标签、事务批写、停止排空及按记录导出逻辑；SDK 的 `sessions / frames` 表与上位机的 `matrix` 等表不同，不直接读写上位机数据库。

`BackendSdkClient.startCollection()` 仍是请求已经运行的主项目后端启动采集；是否保存文件、文件路径及数据库结构由该后端决定，不会自动变成快速方案的录制会话。已有接口见[后端通讯](../BACKEND.md)。

## 选择保存内容 {#s1}

- 后续重新解析：保存 `raw`，同时记录协议、产品、点位配置与时间戳。
- 数据分析与图表：保存 `values`、矩阵尺寸、时间戳和所需统计字段。
- 已有后端的数据：遵循后端帧的实际字段与单位，先确定持久化格式。

JavaScript 串口帧的原始字节视图可能被后续读取复用。长期保存时立即复制字节或转成普通数组；不要把帧对象直接堆进一个无限增长的列表。

## Node.js 保存 JSONL {#s2}

以下是应用自行保存有限帧的基础示例，不是快速采集服务的 SQLite 实现。样例放在 SDK 根目录，收集最多 100 帧模拟数据，结束后一次写入 `frames.jsonl`。每行是一个独立 JSON 对象：

```js
import { writeFile } from 'node:fs/promises';
import { Shroom } from './node/index.js';

const snapshots = [];
const device = Shroom.mock({ rows: 32, cols: 32, fps: 20 });
const unsubscribe = device.onFrame((frame) => {
  if (snapshots.length >= 100) return;
  snapshots.push({
    timestamp: frame.timestamp,
    rows: frame.rows,
    cols: frame.cols,
    raw: Array.from(frame.raw),
    values: Array.from(frame.values),
  });
});

try {
  await new Promise((resolve) => setTimeout(resolve, 2500));
} finally {
  unsubscribe();
  await device.close();
}
await writeFile('frames.jsonl', snapshots.map((frame) => JSON.stringify(frame)).join('\n') + '\n', 'utf8');
console.log(`已保存 ${snapshots.length} 帧`);
```

真实设备只需替换设备创建语句，见[串口接入](SERIAL.md)。持续采集优先使用上面的服务端录制，而不是让这个数组无限增长；本例仅用于基础帧的短时间验证。

## Python 保存 JSONL {#s3}

安装 Python 包后，可用现有 CLI 输出有限数量的数据帧，再由 shell 写入文件：

```bash
python -m shroom_sdk --frames 100 --json > frames.jsonl
```

省略端口使用模拟设备。真实设备示例为 `python -m shroom_sdk COM3 --rows 32 --cols 32 --frames 100 --json > frames.jsonl`。字段与超时参数见[Python SDK](../python/README.md)。

## 数据库与后端采集 {#s4}

SDK 已内置用于本地采集的 SQLite 存储及 `sessions / frames` 表。快速方案的会话列表用于查询本地录制记录，不是通用 SQL 查询接口。应用自己的业务数据库、PostgreSQL 服务、云端存储和跨设备同步需另外集成。

`BackendSdkClient.startCollection()` 是请求已经运行的后端启动采集。保存路径及数据库结构取决于该后端，与独立快速服务的 SQLite 记录分开。已有接口见[后端通讯](../BACKEND.md)。

## 前端职责 {#s5}

前端订阅数据并渲染，通过快速服务请求录制、查询和下载；真实写入在 Node.js 服务端。浏览器会话缓存不能代替可靠的采集存储。根据当前应用的数据规模与部署方式决定保存位置。
