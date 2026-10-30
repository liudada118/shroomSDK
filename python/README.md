# Shroom Python SDK

Python 3.10+ 的压力传感器基础 SDK：串口读取、拆帧、统一 Frame、点位排列、模拟设备与终端热力图，不依赖 Node.js。安装后通过 `shroom_sdk.__version__` 查询实际运行版本。默认协议与 JavaScript SDK 一致：`AA 55 03 99` 分隔帧，每个采样点占一个字节。

接入路线是 **查询串口 → 配置连接 → 自动解析 → 错误诊断**：用 `list_ports()` 确认端口，按设备资料配置协议与尺寸，连接后用同步读取获得 `Frame`，再结合结构化错误和诊断快照排查问题。端口查询不识别产品、波特率或线序，错误处理需要覆盖整条路线。

`values` 是默认满量程 255 下的 **0～1 相对 ADC 值**；`area` 是超过阈值的点数，不是平方厘米。SDK 不提供 kPa/N 换算、手套专用协议、IMU、手势识别、数据库或采集回放。

## 安装

官网 SDK 下载区直接点击 **下载 Python SDK**，下载文件名包含版本；`shroom-sdk-python.zip` 兼容 URL 仍指向当前构建。当前交付流程是 ZIP 本地安装，没有自动向 PyPI 发布。解压后进入包含 `python/` 文件夹的 SDK 目录，再执行本地安装。旧版完整包 `shroom-sdk.zip` 也使用相同命令；Node.js 下载包只附此说明，不含 Python 源码，请另外下载 Python 版本：

```bash
# 仅核心解码、模拟设备与文字热力图：无需第三方运行依赖
python -m pip install ./python

# 需要连接真实设备：同时安装 pySerial
python -m pip install "./python[serial]"

# 使用 RSA 离线密钥：增加签名验证依赖（在线密钥无需该依赖）
python -m pip install "./python[serial,license]"

# 可选 Matplotlib 图形示例（含串口）
python -m pip install "./python[serial,plot]"

# 确认当前解释器实际加载的 SDK 版本。
python -c "import shroom_sdk; print(shroom_sdk.__version__)"
```

升级前查看包内 [CHANGELOG.md](../CHANGELOG.md)，保留原版本包和项目依赖记录。同一发行版本包含的 Python 与 JavaScript 能力不同，Python 不提供 JavaScript 五步采集接口。

在本仓库根目录开发时同样使用 `./python`；Windows 可用 `py -3` 替代 `python`，macOS/Linux 常用 `python3`。推荐先创建虚拟环境。若仅缺串口依赖，可以运行 `python -m pip install pyserial`，不要安装名称相近的 `serial` 包。

需要 AI 辅助接入时，让 AI 先读下载包里的 `python/AI-CONTEXT.md` 和 `python/README.md`，不要混用 JavaScript 的回调 API。

## 实机必备：先安装串口驱动

使用 CH340 / CH341 / CH34x USB 串口设备时，操作系统需要对应驱动。**缺少驱动可能无法识别串口，SDK 和 pySerial 也无法读取设备。** 驱动与 Python 的 `pyserial` 是两项依赖，都要确认。

- Windows：[CH341SER.EXE 驱动安装程序](https://shroom.jq-industries.com/drive/CH341SER.EXE)。下载后运行安装，重新插拔设备，在设备管理器的“端口（COM 和 LPT）”中确认 COM 端口。
- macOS：[CH34xVCPDriver.zip 驱动压缩包](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)。解压后按包内说明安装；如系统提示，请在系统设置中允许驱动，按提示重启并重新插拔设备。

驱动安装完成后运行 `python -m shroom_sdk --list` 确认串口，再激活 SDK 密钥并连接。macOS 通常选择 `/dev/cu.*` 端口。若仍没有端口，先检查驱动、数据线和供电；安装驱动或激活密钥不会自动补齐设备协议与点位配置。

## SDK 授权

真实串口连接前必须激活 `shroom-sdk` 产品密钥。它与上位机共用授权后台，但 `shroom-desktop` 密钥和未标明产品的旧密钥均不能激活 SDK。**SDK 授权不再按设备型号限制**，旧 SDK 密钥中仅包含某款设备的范围也不会限制手垫、手套或自定义串口协议。有效期、电脑名额和独立功能权限仍生效。Python 通用串口需要 `serial` 功能，SDK 为已验证密钥自动提供 `serial.raw` 通用入口；缺少 `serial` 时仍禁止采集。模拟设备、纯解析、文字热力图和串口枚举无需授权。

```python
from pathlib import Path
from shroom_sdk import Shroom

key = Path("sdk.license").read_text(encoding="utf-8-sig").strip()
Shroom.activate_license(key)  # 在线，默认同一后台 https://shroom.jq-industries.com
print(Shroom.get_license_status())
with Shroom.connect("COM3", rows=32, cols=32) as device:
    print(device.read_frame(timeout=2))
Shroom.clear_license()
```

在线模式通过 HTTPS 请求 `/licenseCheck`，明确发送 `productType: "shroom-sdk"`。后台必须明确返回 SDK 产品、有效状态、`sdkFeatures` 与短期租约；SDK 不依赖 `sensorTypes` 判断设备权限。授权每 30 秒复核；最后一次成功校验的使用许可最长 60 秒，断网不会无限延长。到期、后台停用、采集权限撤销或 `clear_license()` 会关闭相关真实串口，诊断快照保留授权错误；恢复后需显式重新连接。

RSA 离线密钥使用 `Shroom.activate_license(key, mode="offline")`，需要 `[license]` 依赖。SDK 验证原始 payload 的 RSA 签名，并检查 `productType`、到期时间、电脑名额和 `sdkFeatures`；旧的 `boundSensorTypes` / `sensorTypes` 型号范围不再用于限制 SDK。默认公钥与现有后台一致；使用自定义 RSA 密钥对时通过 `public_key=Path("trusted-public.pem").read_text()` 指定预先信任的公钥，不能信任许可证自行附带的公钥。未限制电脑数量的离线密钥本地使用到签名到期时间，离线期间无法即时感知后台吊销。限定数量码的服务端回复不能延长签名到期时间，也不能额外增加签名中缺少的独立功能权限。

限定电脑数量的密钥需要传入 `device_id`：64 位小写十六进制字符串，应用应首次生成并持久保存，后续启动复用；不要每次请求重新生成。在线模式把它发给 `/licenseCheck`；签入 `deviceLimit` 的离线码也必须联网调用 `/api/license/devices/check`，同样执行 30 秒复核和最长 60 秒许可，当前没有七天离线租约缓存。示例：

```python
from pathlib import Path
from secrets import token_hex

identity_file = Path(".shroom-device-id")
if not identity_file.exists():
    identity_file.write_text(token_hex(32), encoding="ascii")
device_id = identity_file.read_text(encoding="ascii").strip()
Shroom.activate_license(key, device_id=device_id)  # 离线码再添加 mode="offline"
```

`get_license_status()` 返回独立字典，包含 `valid / product_type / mode / status / expires_at / lease_expires_at / sensor_types / all_products / sdk_features / error`。有效 SDK 许可始终为 `sensor_types: ["all"]`、`all_products: True`；时间戳单位为毫秒，不返回密钥。高级接入可配置 `server_url`；除本机回环调试外必须使用 HTTPS，授权请求不跟随重定向。

## 30 秒运行

```bash
python -m shroom_sdk --frames 3                # 模拟设备，输出三帧文字热力图
python -m shroom_sdk --list                    # 列出串口，需要 [serial]
python -m shroom_sdk COM3 --license-file sdk.license --rows 32 --cols 32
python -m shroom_sdk /dev/ttyUSB0 --license-file sdk.license
python -m shroom_sdk /dev/cu.usbserial-XXXX --license-file sdk.license
python -m shroom_sdk COM3 --license-file sdk.license --layout mat32 --frames 10 --json
```

也可以使用安装后生成的 `shroom-demo` 命令。省略端口表示使用模拟设备；`--frames 0`（默认）持续读取直到 Ctrl+C。`--json` 每行输出一个完整 Frame，方便接其他工具。真实设备默认等待一帧 5 秒，超时会给出错误并退出，可用 `--timeout` 调整。

离线码添加 `--license-mode offline`，限定数量码添加 `--device-id <已保存的64位标识>`。自定义后台用 `--license-server https://...`，自定义离线签名公钥用 `--license-public-key trusted-public.pem`。密钥从文件读取，无需把完整密钥放入命令行。

## 在 Python 程序中使用

```python
from shroom_sdk import Shroom

with Shroom.mock(rows=32, cols=32, fps=30) as device:
    for frame in device:
        print(frame.max, frame.area, frame.center.x, frame.center.y)
        # 示例只取第一帧；移除 break 可持续读取
        break
```

连接真实设备只需替换设备创建语句：

```python
from shroom_sdk import Shroom, ShroomError
from pathlib import Path

try:
    print(Shroom.list_ports())
    Shroom.activate_license(Path("sdk.license").read_text().strip())
    with Shroom.connect("COM3", baud_rate=1_000_000, rows=32, cols=32) as device:
        frame = device.read_frame(timeout=2.0)
        if frame is None:
            print("等待完整帧超时", device.get_diagnostics())
        else:
            print(Shroom.render_ascii(frame))
except ShroomError as error:
    print(error.code, error.stage, str(error), error.suggestion)
```

`with` 会在正常结束、异常或 Ctrl+C 时关闭连接。`read_frame()` 返回一帧或 `None`；`timeout` 单位是秒，可传 `None` 持续等待。设备关闭后再读写会抛出异常。

`for frame in device` / `device.frames()` 会在无数据时继续等待，不会因为一次超时终止。需要“没数据就结束”的任务，请直接用 `read_frame(timeout=...)` 判断。串口断开等 I/O 错误会向调用方抛出，不会静默忽略。

采用同步、单消费者读取，没有后台采集线程和无限累积的数据队列。授权管理器使用后台定时器复核许可并在过期时释放串口。不要让多个线程同时读取同一设备；耗时算法应与采集分离并使用有界队列，避免处理过慢导致操作系统串口缓冲区溢出。`break` 只结束循环，连接由外围 `with` 或 `close()` 释放。

## Frame 字段

| 字段 | Python 类型 | 含义 |
| --- | --- | --- |
| `raw` | `bytes` | 原始字节快照，未重排 |
| `values` | `array('f')` | float32 相对值，长度始终等于 rows × cols |
| `rows / cols` | `int` | 行列数 |
| `min / max / avg` | `float` | 极值与均值，计算规则与 JS 相同 |
| `area` | `int` | 超过 threshold 的点数 |
| `center.x / center.y` | `float` | 0～1 的加权重心，无有效点时为 0.5 / 0.5 |
| `timestamp` | `int` | 本机解码时的 Unix 毫秒时间，不是硬件采样时钟 |

行优先索引为 `frame.values[y * frame.cols + x]`。`frame.matrix()` 返回二维列表，`frame.to_dict()` 返回可以直接 `json.dumps()` 的快照。

需要 NumPy 时，用户自行安装后转换，不增加 SDK 基础依赖：

```python
import numpy as np

matrix = np.frombuffer(frame.values, dtype=np.float32).reshape(frame.rows, frame.cols)
# 上面是共享视图；需要独立修改/长期保存时使用 matrix.copy()
```

## API 与 JavaScript 对照

| JavaScript | Python |
| --- | --- |
| `Shroom.connect({path: 'COM3'})` | `Shroom.connect('COM3')` |
| `Shroom.mock({rows: 32, cols: 32})` | `Shroom.mock(rows=32, cols=32)` |
| `Shroom.listPorts()` | `Shroom.list_ports()` |
| `Shroom.activateLicense(key, options)` | `Shroom.activate_license(key, **options)` |
| `Shroom.getLicenseStatus()` | `Shroom.get_license_status()` |
| `Shroom.clearLicense()` | `Shroom.clear_license()` |
| `device.onFrame(callback)` | `for frame in device` 或 `device.read_frame()` |
| `await device.close()` | `device.close()`，推荐 `with` |
| `Shroom.renderAscii(frame)` | `Shroom.render_ascii(frame)`（纯文字） |
| `decodeFrame(payload, options)` | `decode_frame(payload, **options)` |
| `createFramer(options)` | `Framer(**options)` |
| `bytesReceived / frameCount` | `bytes_received / frame_count` |
| `droppedCount / frameLength` | `dropped_count / frame_length` |
| `device.state` | `device.state` |
| `device.getDiagnostics()` | `device.get_diagnostics()` |
| `device.onError(callback)` | 在同步调用处捕获 `ShroomError` |

也可直接导入 `connect`、`mock`、`list_ports`、`decode_frame`、`get_layout`、`resolve_shape`、`render_ascii`、`Framer`、`Frame`、`ShroomError`。`list_ports()` 返回 `PortInfo` 列表，包含 path、description、manufacturer、serial_number、vendor_id 和 product_id。

授权函数也支持直接导入 `activate_license / get_license_status / clear_license`。`ShroomLicenseError` 属于 `ShroomError`，同时兼容 `PermissionError`，`stage` 为 `license`；常见错误码为 `LICENSE_REQUIRED / LICENSE_PRODUCT_MISMATCH / LICENSE_EXPIRED / LICENSE_FEATURE_DENIED / LICENSE_DEVICE_REQUIRED / LICENSE_REJECTED / LICENSE_UNAVAILABLE`。

`connect()` 未传端口时，仅在检测到恰好一个端口时自动连接；存在多个端口会提示明确指定。`mock()` 的 `fps` 必须是有限数值，范围为 `1000 / 2147483647` 至 `1000`（含边界，约 `4.657e-7` 至 `1000`）；可传 `seed=7` 获得可复现的模拟数据。Python 与 JS 的随机数算法不同，模拟原始字节不保证逐字节相同，但相同输入字节的解码结果一致。

**错误与诊断**

查询、配置、打开端口、读写、解析及关闭可能抛出 `ShroomError`。错误包含 `code`（稳定错误码）、`stage`（发生阶段）、`suggestion`（检查建议）和 `details`（相关参数）；`str(error)` 为可读说明，`cause / __cause__` 保留底层异常。配置错误保留 `ValueError` 兼容性，I/O 错误保留 `OSError` 兼容性，缺依赖兼容 `ImportError`，关闭后读写还兼容 `RuntimeError`。可继续使用原来的异常处理，也可统一捕获 `ShroomError`。没有 `onError()` 回调或后台采集线程。

`device.state` 返回 `open / closed / error`。串口与 Mock 均支持无参数的 `device.get_diagnostics()`，立即返回字典快照：

| 键 | 说明 |
| --- | --- |
| `source / state` | 设备来源及生命周期状态 |
| `bytes_received` | 串口收到的字节数；Mock 累加生成的原始字节数 |
| `frame_count` | 串口成功切出的 payload 数；Mock 生成的帧数 |
| `dropped_count / frame_length` | 串口丢帧数及锁定长度；Mock 丢帧为 0，首帧前长度为 0、首帧后为模拟点数 |
| `last_error` | 最近错误的可序列化字典，无错误时为 `None`；不含 cause |
| `status / hint` | 当前观测状态与下一步检查建议 |

`status` 为 `waiting-data / waiting-frame / streaming / closed / error`。`waiting-data` 表示还没有字节，`waiting-frame` 表示有字节但还没有完整帧；`streaming` 表示曾产出帧，不证明仍在持续发送。快照不会等待或读取新数据，也不能自动判定根因；仍需核对供电、端口、协议、尺寸和线序。Mock 计数反映数据生成量，不是串口吞吐。

`read_frame()` 超时保持返回 `None`，不会仅因为超时将设备判为 I/O 失败。Python 同步采集使用 `with` 或 `try / finally` 关闭设备；`close()` 可重复调用，正常关闭为 `closed`，发生读写或解析故障后释放资源仍保留 `error` 状态和错误历史。SDK 不自动重连，错误后的恢复由应用决定。

## 协议和点位配置

```python
from shroom_sdk import Shroom

# 先安装串口驱动，再按“SDK 授权”章节激活具有 serial 采集能力的 SDK 密钥。
with Shroom.connect(
    "COM3",
    baud_rate=1_000_000,
    delimiter=bytes.fromhex("AA 55 03 99"),
    min_length=8,
    max_length=8192,
    lock_length=True,
    rows=32, cols=32,
    full_scale=255,
    threshold=0.02,
    layout="mat32",
) as device:
    frame = device.read_frame(timeout=2)
```

- `rows` 和 `cols` 必须成对指定；省略时，平方点数推断成方阵，其他长度推断成单行。
- 串口、拆帧和解码配置会在打开端口前校验；分隔符不能为空，长度范围、波特率、满量程、阈值与排列都必须有效。
- `points=N` 只使用前 N 个字节；不足 rows × cols 的位置补零。默认 min_length=8，小于 8 点的设备需要调整。
- `layout='raw'` 保持扫描顺序；`layout='mat32'` 使用已有 32×32 压力垫排列，会连同重心一起变换。也支持一维排列列表 `perm[显示位置] = 原始下标`。
- Python 会拒绝未知布局、错误的 mat32 尺寸和无效排列，避免静默显示错误点位。
- 帧长锁定规则与 JS 相同：连续 3 帧同长度后锁定；新长度连续出现 12 次后重新锁定。可用 `lock_length=False` 接收变长帧。
- 两个分隔符之间才构成一个完整帧；最后一帧要等到下一个分隔符，超时不会强行输出半帧。
- 如协议要求发送启动命令，可用 `device.write(bytes.fromhex('...'))`，命令内容应来自该设备的协议文档。

手套不应直接套用 mat32；需要先确认手套实际协议、通道定义和 Mapping。

## 自己提供原始数据

```python
from shroom_sdk import Framer, decode_frame

framer = Framer()
chunk = bytes.fromhex("AA 55 03 99 00 20 40 60 80 A0 C0 FF AA 55 03 99")
for payload in framer.push(chunk):
    frame = decode_frame(payload, rows=2, cols=4)
    print(frame.matrix())
```

`Framer.push()` 支持分隔符跨数据块、一次收到多帧和前导杂字节；返回本次切出的 payload 列表。`reset()` 清理缓存与计数器。核心模块只使用 Python 标准库。

## 图形示例

安装 `[plot]` 后，在解压后的 SDK 根目录执行：

```bash
python python/examples/heatmap.py         # 模拟数据图形热力图
python python/examples/heatmap.py COM3 --license-file sdk.license  # 真实串口
python python/examples/read_frames.py    # 输出 100 帧基础统计
```

Matplotlib 示例显示相对值，不作物理标定。关闭图形窗口或按 Ctrl+C 会释放设备。纯服务器环境使用命令行和 `--json` 即可。

## 测试与构建

在本仓库根目录，安装 `./python[serial,license]` 后：

```bash
python -m unittest discover -s python/tests -v
python -m pip install build
python -m build python
```

测试覆盖核心数值、线序、拆帧、长度锁定、异常释放、模拟设备、CLI、真实 RSA 签名、产品隔离、联网协议、短期许可、权限变更与过期关闭串口，以及 pySerial `loop://` 回环。若可用 Node，测试会调用现有 JS 实现逐项比较 Frame 和拆帧结果；Node 只用于此项开发校验，不是 Python SDK 的运行依赖。硬件回环测试不能替代真实传感器联调。

wheel / sdist 生成在 `python/dist/`；客户 ZIP 包含 Python 源码、安装配置和示例，排除测试、虚拟环境、缓存和构建产物。开发测试保留在源码仓库，独立 wheel/sdist 不带依赖兄弟 JS 目录的测试。

串口底层 API 参考 [pySerial 官方文档](https://pyserial.readthedocs.io/en/latest/pyserial_api.html)。
