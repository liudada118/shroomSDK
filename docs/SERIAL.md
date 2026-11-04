# 串口接入

0.3.0 增加鞋垫 `insole` 和人体 `body`：使用 `connectProduct` / 快速 `readProduct`，解析规则分别见[鞋垫](INSOLE.md)、[人体全身](HUMAN-BODY.md)。鞋垫的 `AA 55 03 99` 是包头，不能套用通用尾分隔器；12位ADC也不能按单字节解码。

串口接入的工作是把设备字节转换成统一 `Frame`。Python 与 Node.js 可直接访问系统串口；网页直连方式见[前端通讯](FRONTEND-COMMUNICATION.md)。

Node.js / 浏览器接入分包手套或手部检测垫时，优先用 `Shroom.connectGlove({ side, onData, onError })` / `connectHandPad({ onData, onError })`；Node 可传 path，浏览器在用户手势中选择端口。SDK 内置产品波特率、帧解析和映射，应用直接读取数据。Python 本次没有这些产品入口或手套分包/整包协议，仍使用通用串口。

通用协议进阶按 **查询串口 → 配置并连接 → 自动拆帧与解码 → 错误处理和诊断** 接入。查询只列出操作系统可见端口，不识别硬件型号；自定义协议才需要按设备资料提供参数。错误可能发生在查询、参数校验、打开端口、读取、解析和关闭等阶段，应贯穿整条流程处理。

## 连接前确认

先按[驱动安装](DRIVERS.md)确认系统可见串口，再按[SDK 授权](LICENSE.md)激活 SDK 产品密钥。SDK 不限制传感器型号，产品入口与通用串口（包括 Python）均可使用；有效期与电脑名额仍需校验。

- 插入设备，确认操作系统识别到串口。
- CH34x 设备缺少驱动时无法提供串口：安装 [Windows EXE](https://shroom.jq-industries.com/drive/CH341SER.EXE) 或 [macOS ZIP](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)，重插设备并重启采集应用后再查询。
- 已封装产品选择正确入口，手套明确选择 left / right；使用通用接口时再确认波特率、矩阵尺寸、分隔符与点位排列。
- 关闭占用该端口的上位机或其他采集程序。
- 先用模拟设备运行代码，再换成真实端口。

通用 SDK 默认以 `AA 55 03 99` 分帧，每个采样点为一个字节。默认手套入口 `handGloveSegmented / glove` 使用 921600 波特率和 130 + 146 字节分包，每包以 `AA 55 03 99` 结尾；完整配对才输出 256 通道压力与 16 字节 IMU。显式 `handGloveFullPacket` 保留 274 字节整包，手部检测垫 `hand` 使用 1000000 波特率和 1024 点。各自适配器解析协议，不能把设备协议分包等同于串口 chunk 碎片。手套分包从 0.4.0 起提供，详见[手套协议](GLOVE.md)。

## Node.js 连接

以下代码保存到解压后 SDK 根目录的 `serial-example.mjs`，使用 `node serial-example.mjs` 运行：

```js
import { Shroom } from './node/index.js';

const device = await Shroom.connectGlove({
  path: 'COM3', side: 'left',
  onData: (data) => console.log(data.pressureMatrix, data.sequence, data.imu.raw),
  onError: (error) => console.error(error.code, error.suggestion),
});
process.once('SIGINT', () => { void device.close().catch(console.error); });
```

手部检测垫用 `Shroom.connectHandPad({ path: 'COM3', onData: console.log, onError: console.error })`。统一入口示例为 `Shroom.connectProduct({ product: 'hand', path: 'COM3', onData: console.log })`，默认分包手套选 product 为 `handGloveSegmented`（或 `glove`）并提供 side；整包设备显式选 `handGloveFullPacket`。`Shroom.listDeviceProducts()` 返回可直连产品清单。省略 Node path 时仅单个端口可自动选择；零口报 `PORT_NOT_FOUND`、多口报 `PORT_AMBIGUOUS`，不自动扫描产品型号。协议与线序参数不可覆盖。

产品 `onData / onError` 在打开前注册，连接前失败仍需 `try / catch`。可直接运行包内示例：`node node/product-demo.js glove left COM3` 或 `node node/product-demo.js hand-pad COM5`。

**通用串口进阶示例**：自定义设备继续使用原 `connect()`：

```js
import { Shroom, asShroomError } from './node/index.js';

try {
  console.log(await Shroom.listPorts());
  const device = await Shroom.connect({
    path: 'COM3', baudRate: 1000000,
    rows: 32, cols: 32, layout: 'raw',
  });
  device.onError((error) => {
    console.error(error.code, error.stage, error.message, error.suggestion);
    console.log(device.getDiagnostics());
  });
  device.onFrame((frame) => console.log(frame.max, frame.center));
  process.once('SIGINT', async () => { await device.close(); });
} catch (error) {
  const failure = asShroomError(error);
  console.error(failure.code, failure.stage, failure.message, failure.suggestion);
}
```

## Python 连接

安装 Python 包的串口依赖后运行；安装步骤见[Python SDK](../python/README.md)。

```python
from shroom_sdk import Shroom, ShroomError

try:
    print(Shroom.list_ports())
    with Shroom.connect("COM3", baud_rate=1_000_000, rows=32, cols=32) as device:
        frame = device.read_frame(timeout=5.0)
        if frame is None:
            print("等待完整帧超时", device.get_diagnostics())
        else:
            print(frame.max, frame.center)
except ShroomError as error:
    print(error.code, error.stage, str(error), error.suggestion)
```

Python 用 `with` 释放连接；Node.js 在结束时调用 `device.close()`。不要同时启动多个程序读取同一端口。

串口、分帧和解码参数在打开端口前校验。`rows / cols` 应成对提供正整数，波特率、长度范围、分隔符、满量程、阈值和线序也必须有效；具体限制见[后端 SDK API](BACKEND-GUIDE.md#serial)。成功连接后，SDK 自动缓存跨数据块的分隔符、切出 payload、按配置生成 `Frame`，无需在帧回调或读取循环里再次拆帧。

## 数据帧与点位

- `raw`：原始采样字节。
- `values`：默认归一化到 0～1 的相对 ADC 数值。
- `rows` / `cols`：矩阵形状。
- `max` / `avg` / `area` / `center`：帧统计。
- `timestamp`：毫秒时间戳。

Node.js / 浏览器产品入口已经映射：手垫 `raw / pressure` 是原扫描的 1024 个 ADC，`pressureMatrix` 是已映射 ADC，`values` 是 32×32 归一化值；两种手套的 `raw / pressure` 都是 256 个 ADC，`pressureMatrix / values` 是保留兼容用途的 195 点、13×15 映射，业务读取 `fingers / palm`。分包帧含 `protocol: segmented / side / packetType / imu.raw`，不含 `sequence`；整包帧保留原 sequence。IMU 保留 16 字节原始数据，不承诺单位或姿态解算；一只手一个串口，side 必须按实物明确指定；packetType 仅校验首尾包类型一致，不决定侧别。产品帧不要再次套 layout。

通用 Node.js 连接可指定 `layout`。Python 当前仅内置 `raw` / `mat32`，也可提供自定义排列，不能照搬 JS 产品入口或全部产品名称。点位配置与 API 对照见[SDK 说明与排错](../README.md)及[Python SDK](../python/README.md)。

## 排错顺序

JavaScript 查询或连接失败会拒绝 Promise；运行期错误用 `device.onError(handler)` 订阅，返回取消订阅函数。错误为 `ShroomError`，包含 `code / stage / suggestion / details / cause`，可用 `asShroomError(error)` 统一处理。Python 在同步查询、连接、读写和关闭调用处抛出结构化 `ShroomError`，包含 `code / stage / suggestion / details`；配置错误兼容 `ValueError`，I/O 错误兼容 `OSError`，无需后台线程或错误回调。

两种语言都有 `device.state`（`open / closed / error`），Node 串口启用重连时还会出现 `reconnecting`。JavaScript 用 `device.getDiagnostics()`，Python 用 `device.get_diagnostics()` 获取当前快照：来源、状态、收到字节、完整帧、丢帧、锁定帧长、最近错误，以及 `status / hint`。Python 键名使用 snake_case，例如 `bytes_received / last_error`。

Mock 也支持状态和诊断；其字节数与帧数累计模拟生成量，两种语言的帧长都在首帧前为 0、首帧后为模拟 payload 点数，丢帧为 0，不能当作串口吞吐。最近错误是可序列化快照，不含底层 `cause`；需要原始异常时读取捕获的错误对象。浏览器用户取消选择的错误码为 `USER_CANCELLED`，应用可单独处理。

| status | 当前观测 | 下一步 |
| --- | --- | --- |
| `waiting-data` | 已打开，尚未收到字节 | 检查设备供电、端口与发送条件 |
| `reconnecting` | Node 串口正在等待或执行有限重试 | 查看 `onStateChange` 的次数，不要同时创建重复连接 |
| `waiting-frame` | 已收到字节，尚未切出完整帧 | 核对波特率、分隔符及长度配置 |
| `streaming` | 曾产出帧 | 结合帧内容和持续计数检查尺寸与线序 |
| `closed` | 已关闭 | 需要继续采集时由应用显式连接 |
| `error` | 记录了设备错误 | 查看 `lastError / last_error` 的错误码、阶段、说明和建议 |

快照与提示用于缩小排查范围，不能自动判定硬件、协议或线序的根因；`streaming` 不证明设备仍在持续发送，也不代表配置一定正确。读取快照不会等待新数据。Python `read_frame()` 超时仍返回 `None`，不等于 I/O 错误或永久断线。

1. 没有端口：检查连接、驱动与系统权限。
2. 端口打不开：检查端口占用和权限。
3. 没有字节：确认设备在发送、选对端口和数据线。
4. 有字节没有帧：检查波特率、协议和分隔符。
5. 有帧但位置不对：检查矩阵尺寸与点位排列。

`close()` 可重复调用，并取消 Node 已安排的重连。Node 产品入口从 0.2.0 起默认在意外断线或读取失败后重连原 `path`，间隔 3000ms、最多 3 次；通用 `connectSerial / Shroom.connect` 默认关闭，可传 `reconnect: true` 或 `{ intervalMs, maxAttempts }` 开启。首次打开失败、主动关闭、授权失效和解析错误不重试；`CALLBACK_FAILED` 不会停止设备或触发重连。重连复用原句柄及数据订阅、清空旧半帧；端口号改变需重新查询选择。完整参数见[Node 自动重连](BACKEND-GUIDE.md#node-reconnect)。

串口重连只恢复实时数据，断线中的录制会以 `error` 收尾，不能自动续录或伪造连续数据。Web Serial、浏览器 WS 和 Python 没有自动重连；Python 同步调用用 `with` 或 `try / finally` 释放设备。正常结束时也要显式关闭连接。

不要直接把相对 ADC 值当成 kPa 或牛顿；物理单位换算需要产品对应的标定数据。
