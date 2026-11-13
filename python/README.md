# Shroom Python SDK

Python 3.10+ 的 Shroom 压力传感器 SDK，不依赖 Node.js。安装后通过 `shroom_sdk.__version__` 查询实际运行版本。它与 JavaScript SDK 使用同一套产品协议、点位映射、WS 数据格式和录制数据库：

- **按产品取数**：分包/整包手套、手部检测垫、人体全身、鞋垫，选产品即可收到已解析的数据。
- **五步流程**：取数 → 创建 WS → 开始采集 → 停止采集 → 下载，带标签录制保存到 SQLite，导出 CSV / JSONL。
- **通用串口与矩阵**：自定义协议的拆帧、统一 `Frame`、30 种点位排列、模拟设备与终端热力图。
- **已有后端客户端**：`BackendSdkClient` 通过 HTTP / WebSocket 访问已运行的主项目后端。

核心解析、模拟设备、数据服务和录制只用 Python 标准库；真实串口需要 `pyserial`，RSA 离线密钥需要 `cryptography`。

数值都是**相对 ADC 值**：`values` 是 ADC / 满量程，`area` 是超过阈值的点数，不是平方厘米。SDK 不提供 kPa/N 换算、力学标定、手势识别、三维模型或历史回放，也不自动识别产品型号和左右侧。浏览器专属的 Web Serial 与 Canvas 热力图只在 JavaScript SDK 中提供。

> 本包的产品协议以 JavaScript 实现为基准逐项对照验证，使用的是合成数据；接入实物前请用真实设备核对固件、触点和持续取数结果。

## 安装

从 0.6.0 起发布在 [PyPI](https://pypi.org/project/shroom-sdk/)，推荐直接用 pip 安装：

```bash
# 核心解码、产品解析、模拟设备、数据服务与录制：无需第三方运行依赖
python -m pip install shroom-sdk

# 需要连接真实设备：同时安装 pySerial
python -m pip install "shroom-sdk[serial]"

# 使用 RSA 离线密钥：增加签名验证依赖（在线密钥无需该依赖）
python -m pip install "shroom-sdk[serial,license]"

# 可选 Matplotlib 图形示例（含串口）
python -m pip install "shroom-sdk[serial,plot]"

# 确认当前解释器实际加载的 SDK 版本。
python -c "import shroom_sdk; print(shroom_sdk.__version__)"
```

需要可复现的环境时在项目依赖里固定版本，例如 `shroom-sdk[serial]==0.6.0`。升级前查看 [CHANGELOG.md](https://github.com/liudada118/shroomSDK/blob/main/CHANGELOG.md)。

也可以从下载包离线安装：把 `shroom-sdk-python.zip`（文件名含版本）解压后，在包含 `python/` 文件夹的目录执行 `python -m pip install "./python[serial]"`，可选依赖的写法相同。旧版完整包 `shroom-sdk.zip` 也使用相同命令；Node.js 下载包只附此说明，不含 Python 源码。0.5.0 及更早的 Python 包只有通用串口与矩阵能力，没有发布到 PyPI。

Windows 可用 `py -3` 替代 `python`，macOS/Linux 常用 `python3`。推荐先创建虚拟环境。若仅缺串口依赖，可以运行 `python -m pip install pyserial`，不要安装名称相近的 `serial` 包。在源码仓库根目录开发时使用 `python -m pip install -e ./python`。

需要 AI 辅助接入时，让 AI 先读下载包里的 `python/AI-CONTEXT.md` 和 `python/README.md`，不要照抄 JavaScript 的参数名和 Promise 写法。

## 实机必备：先安装串口驱动

使用 CH340 / CH341 / CH34x USB 串口设备时，操作系统需要对应驱动。**缺少驱动可能无法识别串口，SDK 和 pySerial 也无法读取设备。** 驱动与 Python 的 `pyserial` 是两项依赖，都要确认。

- Windows：[CH341SER.EXE 驱动安装程序](https://shroom.jq-industries.com/drive/CH341SER.EXE)。下载后运行安装，重新插拔设备，在设备管理器的“端口（COM 和 LPT）”中确认 COM 端口。
- macOS：[CH34xVCPDriver.zip 驱动压缩包](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip)。解压后按包内说明安装；如系统提示，请在系统设置中允许驱动，按提示重启并重新插拔设备。

驱动安装完成后运行 `python -m shroom_sdk --list` 确认串口，再激活 SDK 密钥并连接。macOS 通常选择 `/dev/cu.*` 端口。若仍没有端口，先检查驱动、数据线和供电；安装驱动或激活密钥不会自动补齐设备协议与点位配置。

## SDK 授权

真实串口连接前必须激活 `shroom-sdk` 产品密钥。它与上位机共用授权后台，但 `shroom-desktop` 密钥和未标明产品的旧密钥均不能激活 SDK。**SDK 授权不按设备型号限制**，旧 SDK 密钥中仅包含某款设备的范围也不会限制其他产品或自定义串口协议。有效期、电脑名额和功能权限仍生效：

| 功能 | 用于 |
| --- | --- |
| `serial` | 产品连接与通用串口（通用入口的 `serial.raw` 由 SDK 自动补齐，但仍要求 `serial`） |
| `stream` | 把真实设备发布为 WS 数据服务（`serve_device` / `create_ws`） |
| `recording` | 在数据服务上开始采集 |

模拟设备（含产品模拟）、纯解析、文字热力图、串口枚举，以及连接数据服务的客户端（`connect_stream`、`BackendSdkClient`）不需要授权。

```python
from pathlib import Path
from shroom_sdk import Shroom

key = Path("sdk.license").read_text(encoding="utf-8-sig").strip()
Shroom.activate_license(key)  # 在线，默认同一后台 https://shroom.jq-industries.com
print(Shroom.get_license_status())
with Shroom.connect_glove("COM3", side="left") as device:
    print(device.read_frame(timeout=2))
Shroom.clear_license()
```

在线模式通过 HTTPS 请求 `/licenseCheck`，明确发送 `productType: "shroom-sdk"`。后台必须明确返回 SDK 产品、有效状态、`sdkFeatures` 与短期租约；SDK 不依赖 `sensorTypes` 判断设备权限。授权每 30 秒复核；最后一次成功校验的使用许可最长 60 秒，断网不会无限延长。到期、后台停用、权限撤销或 `clear_license()` 会关闭相关真实串口、停止数据服务的实时转发并以错误状态结束正在进行的采集；已保存的记录仍可下载。恢复后需显式重新连接并重新创建服务。

RSA 离线密钥使用 `Shroom.activate_license(key, mode="offline")`，需要 `[license]` 依赖。SDK 验证原始 payload 的 RSA 签名，并检查 `productType`、到期时间、电脑名额和 `sdkFeatures`；旧的 `boundSensorTypes` / `sensorTypes` 型号范围不再用于限制 SDK。默认公钥与现有后台一致；使用自定义 RSA 密钥对时通过 `public_key=Path("trusted-public.pem").read_text()` 指定预先信任的公钥，不能信任许可证自行附带的公钥。未限制电脑数量的离线密钥本地使用到签名到期时间，离线期间无法即时感知后台吊销。限定数量码的服务端回复不能延长签名到期时间，也不能额外增加签名中缺少的功能权限。

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

`get_license_status()` 返回独立字典，包含 `valid / product_type / mode / status / expires_at / lease_expires_at / sensor_types / all_products / sdk_features / error`。有效 SDK 许可始终为 `sensor_types: ["all"]`、`all_products: True`；时间戳单位为毫秒，不返回密钥。高级接入可配置 `server_url`；除本机回环调试外必须使用 HTTPS，授权请求不跟随重定向。源码交付下的授权检查不是防篡改机制。

## 30 秒运行

```bash
python -m shroom_sdk --frames 3                # 通用模拟设备，输出三帧文字热力图
python -m shroom_sdk --list                    # 列出串口，需要 [serial]
python python/examples/product_demo.py glove --side left --mock --frames 3   # 产品模拟：手套分区数据
python python/examples/quick_demo.py --mock --side left                      # 五步流程：采集端（保持运行）
python python/examples/stream_client.py --seconds 3 --output capture.csv     # 五步流程：查看端，另开终端
```

后三条命令用到的示例脚本随下载包和[源码仓库](https://github.com/liudada118/shroomSDK/tree/main/python/examples)提供，路径以解压后的目录为准；从 PyPI 安装的包里不含示例文件。

`python -m shroom_sdk`（安装后也可用 `shroom-demo`）是通用矩阵的命令行：省略端口表示使用模拟设备；`--frames 0`（默认）持续读取直到 Ctrl+C；`--json` 每行输出一个完整 Frame；`--layout` 接受 `raw` 或任一内置排列名。真实设备默认等待一帧 5 秒，超时会给出错误并退出，可用 `--timeout` 调整：

```bash
python -m shroom_sdk COM3 --license-file sdk.license --rows 32 --cols 32
python -m shroom_sdk /dev/ttyUSB0 --license-file sdk.license --layout mat32 --frames 10 --json
```

离线码添加 `--license-mode offline`，限定数量码添加 `--device-id <已保存的64位标识>`。自定义后台用 `--license-server https://...`，自定义离线签名公钥用 `--license-public-key trusted-public.pem`。密钥从文件读取，无需把完整密钥放入命令行。

## 按产品取数

已封装协议的产品由 SDK 固定波特率、分帧和点位映射，应用只选产品并处理数据。`list_device_products()` 返回这些产品的默认配置：

| 产品 ID（连接别名） | 必填参数 | 串口与协议 | 帧类型 |
| --- | --- | --- | --- |
| `handGloveSegmented`（`glove`） | 手动：`path` 与 `side="left"` / `"right"`；或省略其一由 SDK 自动识别 | 921600；130 字节首包 + 146 字节尾包，各带 `AA 55 03 99` 帧尾 | `GloveFrame` |
| `handGloveFullPacket` | `side` | 921600；274 字节整包（旧设备，需显式选择） | `GloveFrame` |
| `hand`（`pad`） | 无（不接受 `side`） | 1000000；1024 字节 + 帧尾 | `PadFrame` |
| `humanBody`（`body`） | 无（不接受 `side`） | 1000000；1024 字节 + 帧尾 | `BodyFrame` |
| `jqInsole`（`insole`） | `side`；可选 `protocol="12bit"`（默认）或 `"8bit"`，可选 `baud_rate` | 默认 921600，可选 1500000 / 3000000 / 460800 / 256000 / 115200 / 9600 | `InsoleFrame` |

别名只用于连接；帧的 `product`、WS 数据和录制始终使用产品 ID。整包手套和鞋垫的左右**必须按实物指定**，协议和串口信息都不足以判断；只有分包手套可以按包类型自动识别（见下文“分包手套的自动发现”）。产品不接受 `rows`、`delimiter` 等底层覆盖，自定义协议请用通用 `connect()`。

```python
from shroom_sdk import Shroom, ShroomError, connect_product

def on_data(frame):                       # 在读取线程上执行，只做轻量处理
    print(frame.fingers.thumb.raw, frame.palm.matrix[0])

def on_error(error):                      # 连接后的运行期错误，重连期间的中间错误也到这里
    print(error.code, error.stage, error, error.suggestion)

try:
    print(Shroom.list_ports())
    Shroom.activate_license(key)
    device = connect_product("glove", "COM3", side="left", on_data=on_data, on_error=on_error)
except ShroomError as error:              # 配置、授权和首次连接失败直接抛出
    print(error.code, error.suggestion)
...
device.close()                            # 退出前释放串口
```

`connect_glove(path, side=...)` 与 `connect_hand_pad(path)` 是固定了产品的便捷写法。手垫、人体、鞋垫和整包手套未传 `path` 时仅在系统恰有一个串口时自动选择；多个串口返回 `PORT_AMBIGUOUS`，不会按顺序猜测。

### 分包手套的自动发现

分包手套有两种连接方式：

- **手动直连**：同时给出 `path` 和 `side="left"` / `"right"`。不扫描，按指定手侧映射；此时包类型只是首尾包的配对字节。
- **自动发现**：省略 `path` 或 `side`（或传 `side="auto"`、`scan={...}`）。SDK 先逐个串口只读采样，按包类型识别手侧（当前固件 1=左手、2=右手），**唯一匹配才连接**；`device.info` 会带上识别到的 `side` 与 `packet_type`。

```python
from shroom_sdk import connect_glove, scan_product_ports, ShroomError

device = connect_glove(side="left", on_data=on_data)           # 找到唯一的左手手套并连接
device = connect_glove("COM3")                                 # 指定串口，手侧由协议识别
device = connect_glove(scan={"paths": ["COM3", "COM4"], "timeout": 1.2})

try:
    device = connect_glove()                                   # 两只手都接着时无法决定
except ShroomError as error:
    if error.code == "PORT_AMBIGUOUS":
        for candidate in error.details["scan"]["devices"]:     # 展示候选，让用户选择
            print(candidate["path"], candidate["side"])

report = scan_product_ports(side="right", timeout=1.2)         # 只查询，不连接
print(report["devices"], report["ports"])
```

- `scan_product_ports(product="glove", side=None, paths=None, timeout=1.2, cancel=None)` 返回 `{"devices": [...], "ports": [...]}`：`devices` 每项含 `path / product / label / baud_rate / side / packet_type`（可用时另有 `serial_number`）；`ports` 逐口给出 `status`（`matched` / `unrecognized` / `error`）及 `device` 或 `error`。`timeout` 是每个串口的采样秒数（0.05–10）；`cancel` 可传 `threading.Event`，置位后以 `USER_CANCELLED` 结束。
- 同一串口至少收到 3 个完整且手侧一致的帧才算识别成功；半包、未知类型或左右混杂的串口报告为 `unrecognized`。扫描会以 921600 波特率短暂打开每个候选串口，系统里有其他设备时请用 `paths` 限定范围。
- 没有匹配返回 `PORT_NOT_FOUND`，多个匹配返回 `PORT_AMBIGUOUS`，`error.details["scan"]` 带完整的扫描结果。扫描到的样本不会进入回调或采集；正式连接后每一帧仍核对手侧，重连后发现换成了另一只手会以 `PARSE_FAILED` 终止，避免用错线序。
- 只识别手侧，不把包类型当作设备的唯一编号：同侧接了多只手套时请指定 `path`。整包手套、鞋垫和其他产品不支持自动发现。
- 扫描与连接共用进程内的串口预约：已被本进程连接占用（包括等待重连的间隙）的串口在扫描中报告为 `PORT_BUSY`，不会被再次打开。连接的端口关闭失败时路径保持占用，再次调用 `close()` 会重试释放。
- 扫描需要含 `serial` 功能的 SDK 授权。

**两种取数方式，不要在同一设备上混用：**

- 回调：传入 `on_data`（或之后调用 `device.on_data(handler)`），SDK 启动一个后台线程读取并同步调用回调。回调抛出的异常转成 `CALLBACK_FAILED` 交给 `on_error`，不影响其他订阅和连接。回调可能早于 `connect_product()` 返回，应直接使用传入的帧。
- 同步读取：不传回调，用 `device.read_frame(timeout=2)`、`for frame in device` 配合 `with`。超时返回 `None`。

**断线重连**：产品连接默认在意外断线后重连原串口，每 3 秒一次、最多 3 次；设备对象和订阅保持不变，只有收到有效帧后尝试次数才清零。`reconnect=False` 关闭，`reconnect={"interval": 1.5, "max_attempts": 5}` 调整（`interval` 单位为秒）。`on_state_change` 或 `device.on_state_change(handler)` 收到 `{"state", "path", "attempt", "max_attempts"}`，`state` 为 `open / reconnecting / error / closed`。重连期间 `read_frame()` 返回 `None`；重试用尽后设备进入 `error`，读取方收到导致终止的错误。首次连接失败、主动 `close()`、授权失效、解析错误和权限错误不重试；只恢复原 `path`，设备换了 COM 号需要重新查询并连接。重连只恢复实时数据，不会自动续录。

### 产品帧字段

产品帧都继承通用 `Frame`（`raw / values / rows / cols / min / max / avg / area / center / timestamp`），属性用 snake_case。`frame.to_dict()` 返回与 JavaScript SDK 相同字段名（`pressureMatrix`、`sourceIndices` 等）的 JSON 快照，可直接 `json.dumps()`。字节数据是 `bytes`，浮点是 `array('f')`，超过 255 的整数通道是 `array('H')`；每帧的数组都是独立快照。

**手套 `GloveFrame`**

| 字段 | 含义 |
| --- | --- |
| `side` | 连接时指定的 `left` / `right` |
| `pressure`（同 `raw`） | 256 字节原始扫描 ADC |
| `fingers.thumb / index / middle / ring / little` | 每指 4×3 共 12 点；`.pulp` 是独立的 1×1 指腹点。`fingers.items()` 按拇指到小指遍历 |
| `palm` | 手掌 72 点，`row_lengths` 为 `(12, 15, 15, 15, 15)`，首行不补零 |
| 分区对象 | `name`（中文名）、`rows / cols / row_lengths`、`source_indices`（0 基原始通道）、`raw`（ADC）、`values`（ADC / 满量程）、`matrix`（按真实行长的二维 ADC 列表） |
| `imu.raw` | 16 个原始字节；不解释轴序、四元数语义或单位 |
| `packet_type` | 原始包类型字节，不代表手侧 |
| `protocol` / `sequence` | 分包为 `"segmented"` 且 `sequence` 为 `None`；整包 `protocol` 为 `None`，`sequence` 是设备帧序号 |
| `pressure_matrix / values / rows / cols` | 旧版 13×15 展示矩阵，仅为兼容保留；新业务读取 `fingers` 与 `palm` |

**手部检测垫 `PadFrame`**：`pressure`（同 `raw`）是 1024 字节原扫描顺序；`pressure_matrix` 与 `values` 是按 `mat32` 搬到实际位置后的 32×32 数据。

**人体全身 `BodyFrame`**：`pressure` 保留 1024 个扫描 ADC；`regions` 是十块物理矩阵（`back / chest / rightArm / rightShoulder / leftArm / leftShoulder / backPantsRight / backPantsLeft / frontPantsLeft / frontPantsRight`，共 400 个唯一通道），每块含 `name / rows / cols / source_indices / raw / values / matrix`。顶层 32×32 只是扫描存储形状，不是身体平面图。

**鞋垫 `InsoleFrame`**

| 字段 | 含义 |
| --- | --- |
| `side / protocol / bit_depth / full_scale` | 脚侧；`12bit` 为 12 / 4095，`8bit` 为 8 / 255 |
| `raw` | 原始 ADC 字节：12bit 为 512 字节（小端 uint16），8bit 为 256 字节 |
| `pressure / pressure_matrix` | 256 个扫描 ADC：12bit 为 `array('H')`（0–4095），8bit 为 `bytes` |
| `sensors` | A 版 112 个真实点：`rows=14, cols=8`、`source_indices`、`raw`、`values`、`positions`（每点 `row / col / x_mm / y_mm`） |
| `imu` | `raw` 原始字节；`quaternion`（4 个分量）；12bit 另有 `gyroscope`、`acceleration`（各 3 个）。不归一化、不推断单位 |
| `sequence` | 仅 8bit：分包序号；12bit 为 `None` |

顶层 16×16 是扫描顺序，不代表鞋形或物理足底重心。

### 无硬件：产品模拟与纯解析

```python
from shroom_sdk import create_product_mock_device, create_product_parser

with create_product_mock_device("glove", side="left") as device:   # 也可用 Shroom.mock_product(...)
    frame = device.read_frame(timeout=2)

parser = create_product_parser("insole", side="right", protocol="8bit")
for frame in parser.push(serial_bytes):     # 自己提供字节：支持半包、粘包和重新同步
    ...
print(parser.dropped_count, parser.frame_length)
```

产品模拟只支持分包手套、整包手套和手部检测垫：合成字节经过真实的产品解析器，手套 IMU 为零值，不需要授权。`create_product_parser()` 的解析器每个连接各建一个，`reset()` 清空半包与计数。`decode_glove_packet(payload, side=...)` 解码单个 274 字节整包，`create_glove_regions(pressure, side=...)` 从 256 字节原始压力提取 `(fingers, palm)`。

## 五步流程：取数、WS、采集与下载

采集电脑读取设备并创建本机数据服务；查看端连接该服务，控制带标签采集并下载记录。查看端可以是另一个 Python 进程，也可以是使用 JavaScript SDK 的网页，两种语言的服务和客户端可以互连。

```python
# 采集电脑（先安装驱动、pyserial，并激活含 serial、stream、recording 的 SDK 授权）
from shroom_sdk import read_product, create_ws

device = read_product("glove", "COM3", side="left",                 # ① 取数
                      on_error=lambda error: print(error.code, error))
server = create_ws(device, port=19999)                              # ② 创建 WS，默认只监听 127.0.0.1
print(server.url, server.http_url)
...
server.close()        # 退出时调用：等待记录写完，再关闭服务和串口
```

```python
# 查看端
from shroom_sdk import read_product, start_recording, stop_recording, download_recording

stream = read_product(url="ws://127.0.0.1:19999", on_data=lambda frame: print(frame.max))
session = start_recording(stream, label="握力测试")                  # ③ 开始保存（由服务端写入磁盘）
...
recording = stop_recording(stream)                                  # ④ 等待写完，返回 frame_count 等
path = download_recording(stream, "capture.csv")                    # ⑤ 保存本次记录；format="jsonl" 可选
stream.close()        # 只关闭本连接，不停止服务端或正在进行的采集
```

| 函数 | 作用 | 对应的基础 API |
| --- | --- | --- |
| `read_product(product, path, ...)` | 连接本机串口上的产品，返回设备 | `connect_product` |
| `read_product(url=...)` | 订阅数据服务，返回连接；可再传 `host / port / timeout` | `connect_stream` |
| `create_ws(device, **options)` | 发布设备并接管其关闭；启动失败也会释放设备 | `serve_device` |
| `start_recording(target, label="本次采集")` | 开始带标签采集，成功后清除上一轮的下载 ID | 连接或服务的 `start_recording` |
| `stop_recording(target)` | 等待收尾，记住本次记录 ID | 连接或服务的 `stop_recording` |
| `download_recording(target, path=None, format="csv")` | 传 `path` 保存文件并返回路径；不传只返回下载地址 | `download_recording` / `get_recording_url` |

后三个函数的 `target` 是 `read_product(url=...)` 返回的连接或 `create_ws` 返回的服务，其他对象会被拒绝。同一 `target` 上的起停不能并发；下载只针对它最近一次成功停止的记录。历史记录用 `list_recordings()` 取得 ID 后，调用 `stream.download_recording(recording_id, path)`。

与 JavaScript 的差别：没有浏览器，`download_recording` 直接把文件保存到 `path`；标签用 `label=` 关键字而不是配置对象；等待时间一律以秒为单位。

### 数据服务 `serve_device`

```python
from shroom_sdk import serve_device

server = serve_device(device, port=19999, host="127.0.0.1", recordings_dir=".shroom-recordings")
server.start_recording("标签")      # 也可以由任一客户端发起
server.stop_recording()
server.list_recordings()
server.get_recording_url(recording_id, format="jsonl")
server.close()                      # 写完记录并断开客户端；不关闭 device
```

- `device` 是任何提供 `on_data` 或 `on_frame` 订阅的对象：产品设备、通用设备、模拟设备，或应用自己的数据源。自定义数据源按真实数据处理，需要 `serial` 与 `stream` 授权；只有 SDK 自带的模拟设备免授权。
- 同一端口提供 WS 数据、采集控制和 HTTP 下载。`port=0` 让系统分配端口，实际值见 `server.port`。
- 默认只绑定 `127.0.0.1`，并校验 Origin 与 Host：拒绝远程网页和 `file://` 页面。跨机访问必须显式传 `host` 与 `allowed_origins=["https://app.example"]`（明确来源，不支持通配符）。Origin 校验不是身份鉴权，公网使用仍需外部认证和 HTTPS/WSS 代理。
- 读取慢的客户端在待发送数据超过 `max_buffered_bytes`（默认 1 MiB）时被断开（关闭码 1013），不会拖慢设备读取和其他客户端。

| 协议 | 路径或消息 | 用途 |
| --- | --- | --- |
| HTTP GET | `/health` | 数据协议、设备信息与当前采集状态 |
| HTTP GET | `/recordings/<id>.csv`、`/recordings/<id>.jsonl` | 导出已结束的记录；采集中返回 409，未知 ID 返回 404 |
| WebSocket | `/` 或 `/ws` | `ready`、产品帧、采集状态与错误 |
| WS 请求 | `recording.start / stop / status / list` | 带 `requestId` 的采集控制 |

### 录制

- 一次采集对应一个标签和一个 UUID；标签为 1–200 个字符，不含控制字符。同一服务同时只有一场采集，所有来源的起停操作串行执行。
- 帧进入有界队列，每批最多 200 帧或等待 250 毫秒后以事务提交；`frame_count` 只统计已提交的帧。停止会先拒绝新帧，再等待队列写完。
- 写入跟不上（超过 `max_queue_frames`，默认 1000 帧，或 16 MiB）时采集以 `RECORDING_OVERFLOW` 结束，不静默丢帧；设备断线、授权失效同样以 `error` 状态结束。已提交的数据保留并可下载。
- 数据保存在 `recordings_dir/recordings.sqlite`，同一目录同时只允许一个服务使用。进程异常退出后，下次打开会把未结束的采集标为 `RECORDING_INTERRUPTED` 并按已提交帧恢复计数。
- 数据库结构与 JavaScript SDK 相同，同一目录可以先后由两种语言的服务打开；旧版 `<id>.meta.json + .jsonl` 记录保持只读兼容。
- CSV 带 UTF-8 BOM，按帧一行，数组和分区保存为 JSON 单元格，并对可能被表格软件当作公式的内容加前缀；JSONL 每行是完整帧。导出按页读取、流式发送。
- 下载必须使用记录 ID（停止采集的返回值或 `list_recordings()` 的 `id`），不能用标签、产品或端口代替，也不会默认选最新一场。

记录快照是字典：`id / label / started_at / ended_at / frame_count / status`（`recording`、`stopped`、`error`），以及可选的 `product / side / source / error`（`{"code", "message"}`）。时间戳为毫秒。

### 数据连接 `connect_stream`

```python
from shroom_sdk import connect_stream

with connect_stream("ws://127.0.0.1:19999", on_data=on_data, on_error=on_error, timeout=10) as stream:
    print(stream.info, stream.state, stream.recording)
    stream.on_recording(lambda recording: print(recording))    # 服务端采集状态变化
    stream.start_recording("标签")
    recording = stream.stop_recording()
    stream.download_recording(recording["id"], "capture.jsonl", format="jsonl")
```

收到兼容的 `ready` 握手后返回；连接失败直接抛出。`stream.info` 是服务端设备信息（snake_case 键）。帧在接收线程上交给回调；采集控制方法会阻塞等待服务端响应，**不要在数据回调里调用**。请求超时（`REQUEST_TIMEOUT`）只表示没收到回应，不代表服务端没有执行，应先 `get_recording_status()` 再决定是否重试。断线后不自动重连，也不重放开始/停止命令；客户端断开不会停止服务端的采集。

`encode_stream_frame(frame)` / `decode_stream_frame(dict)` 是 WS 帧的编解码：编码得到可 `json.dumps()` 的字典，解码先校验结构、长度和数值一致性，再还原成对应的帧对象；`STREAM_SCHEMA` 为 `"shroom.frame.v1"`。

## 通用串口与矩阵

产品不在上表中、或需要自定义协议时使用通用入口。默认协议是 `AA 55 03 99` 分隔帧，每个采样点占一个字节。

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

无硬件时把设备创建语句换成 `Shroom.mock(rows=32, cols=32, fps=30)`，其余代码不变。

`with` 会在正常结束、异常或 Ctrl+C 时关闭连接。`read_frame()` 返回一帧或 `None`；`timeout` 单位是秒，可传 `None` 持续等待。设备关闭后再读写会抛出异常。`for frame in device` / `device.frames()` 会在无数据时继续等待，不会因为一次超时终止；`break` 只结束循环，连接由外围 `with` 或 `close()` 释放。

默认是同步、单消费者读取，没有后台采集线程。需要回调时调用 `device.on_frame(handler)`（别名 `on_data`）和 `device.on_error(handler)`：首次订阅会启动一个后台读取线程，此后不要再从其他线程调用 `read_frame`。后台读取遇到读写、解析或授权错误时通知 `on_error` 一次并关闭设备。耗时算法应与采集分离并使用有界队列，避免处理过慢导致操作系统串口缓冲区溢出。

通用串口默认不重连；`Shroom.connect("COM3", reconnect=True, on_state_change=...)` 启用与产品连接相同的有限重连规则。

### Frame 字段

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

### 协议和点位配置

```python
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
- 帧长锁定规则与 JS 相同：连续 3 帧同长度后锁定；新长度连续出现 12 次后重新锁定。可用 `lock_length=False` 接收变长帧。
- 两个分隔符之间才构成一个完整帧；最后一帧要等到下一个分隔符，超时不会强行输出半帧。
- 如协议要求发送启动命令，可用 `device.write(bytes.fromhex('...'))`，命令内容应来自该设备的协议文档；SDK 不自动重发。

**点位排列 `layout`**：串口字节是采集板的扫描顺序，不等于垫子上的位置。

- `layout="raw"`（默认）保持扫描顺序。
- 内置排列名（`mat32`、`sit`、`carSeat`、`car10`、`footInsole` 等 30 种）把扫描顺序搬到实际位置，并在省略 `rows / cols` 时决定输出行列：例如 `car10` 从 1024 个扫描点里取 10×10。`list_layouts()` 列出名称、中文标签和行列；显式传入的 `rows / cols` 必须与排列一致。
- 排列只搬位置、不改数值；个别产品没有传感器的空位固定为 0。小样垫和触觉足底一帧是 256 个扫描点，其余为 1024 个；数据不足一帧扫描点时报错，不会静默显示空白。
- 也可以传一维排列列表 `perm[显示位置] = 原始下标`，必须是 `0 .. rows*cols-1` 的完整排列。
- 未知排列名、尺寸不符和无效排列都会被拒绝（JavaScript 对未知名称回退为原始顺序，Python 不回退）。排列会连同重心一起变换，`raw` 始终保留原始顺序。
- `list_products()` / `get_product(name)` 是与桌面端菜单一致的通用矩阵产品清单，给出每个产品对应的 `layout` 与行列；它不同于上文已封装协议的 `list_device_products()`。

手套不走排列表：请使用产品接口。

### 自己提供原始数据

```python
from shroom_sdk import Framer, decode_frame

framer = Framer()
chunk = bytes.fromhex("AA 55 03 99 00 20 40 60 80 A0 C0 FF AA 55 03 99")
for payload in framer.push(chunk):
    frame = decode_frame(payload, rows=2, cols=4)
    print(frame.matrix())
```

`Framer.push()` 支持分隔符跨数据块、一次收到多帧和前导杂字节；返回本次切出的 payload 列表。`reset()` 清理缓存与计数器。

### 显示

`Shroom.render_ascii(frame)` 把矩阵画成终端字符图。`shroom / jet / jet_white / grey` 把 0～1 的值映射为 `(R, G, B)`，与 JavaScript SDK 的调色板一致，可通过 `get_colormap(name)` 按名字取用；SDK 本身不绘图。安装 `[plot]` 后可运行 Matplotlib 示例：

```bash
python python/examples/heatmap.py         # 模拟数据图形热力图
python python/examples/heatmap.py COM3 --license-file sdk.license  # 真实串口
python python/examples/read_frames.py    # 输出 100 帧基础统计
```

Matplotlib 示例显示相对值，不作物理标定。关闭图形窗口或按 Ctrl+C 会释放设备。

## 错误与诊断

查询、配置、连接、读写、解析、关闭、数据服务和采集都可能抛出 `ShroomError`。错误包含 `code`（稳定错误码）、`stage`（发生阶段）、`suggestion`（检查建议）和 `details`（相关参数）；`str(error)` 为可读说明，`cause / __cause__` 保留底层异常。按 `code` 判断，不要匹配文案；全部错误码见 `ERROR_CODES`。

| 类别 | 常见错误码 | 兼容的内置异常 |
| --- | --- | --- |
| 配置与取消 | `INVALID_CONFIG`；`USER_CANCELLED`（扫描被取消） | `ValueError`（配置） |
| 串口 | `PORT_NOT_FOUND / PORT_AMBIGUOUS / PORT_BUSY / PERMISSION_DENIED / CONNECTION_FAILED / DISCONNECTED / READ_FAILED / WRITE_FAILED / CLOSE_FAILED` | `OSError` |
| 解析与回调 | `PARSE_FAILED / CALLBACK_FAILED` | `ValueError`（解析） |
| 依赖 | `DEPENDENCY_MISSING` | `ImportError` |
| 授权 | `LICENSE_REQUIRED / LICENSE_PRODUCT_MISMATCH / LICENSE_EXPIRED / LICENSE_FEATURE_DENIED / LICENSE_DEVICE_REQUIRED / LICENSE_REJECTED / LICENSE_UNAVAILABLE / LICENSE_INVALID` | `PermissionError` |
| 数据服务 | `SERVER_START_FAILED / SERVER_CLOSED / ORIGIN_DENIED / INVALID_REQUEST / REQUEST_FAILED / REQUEST_TIMEOUT` | — |
| 采集 | `RECORDING_ACTIVE / RECORDING_NOT_ACTIVE / RECORDING_NOT_FOUND / RECORDING_INTERRUPTED / RECORDING_OVERFLOW / RECORDING_WRITE_FAILED` | — |

同步调用（创建连接、`read_frame`、采集控制、下载）的错误在调用处抛出；回调模式下连接后的错误交给 `on_error`。没有任何错误订阅时，后台线程里的运行期错误写入名为 `shroom_sdk` 的 `logging` 记录器。

`device.state` 返回 `open / closed / error`（受管理的连接另有 `reconnecting`）。串口与模拟设备均支持无参数的 `device.get_diagnostics()`，立即返回字典快照：

| 键 | 说明 |
| --- | --- |
| `source / state` | 设备来源及生命周期状态 |
| `bytes_received` | 串口收到的字节数；Mock 累加生成的原始字节数 |
| `frame_count` | 成功解析的帧数；Mock 为生成的帧数 |
| `dropped_count / frame_length` | 丢弃的帧或错误片段数，以及最近的载荷长度；尚无有效帧时长度为 0 |
| `last_error` | 最近错误的可序列化字典，无错误时为 `None`；不含 cause |
| `status / hint` | 当前观测状态与下一步检查建议 |
| `reconnect_attempt / reconnect_max_attempts` | 仅受管理的连接：当前重连尝试次数与上限 |

`status` 为 `waiting-data / waiting-frame / streaming / reconnecting / closed / error`。`waiting-data` 表示还没有字节，`waiting-frame` 表示有字节但还没有完整帧；`streaming` 表示曾产出帧，不证明仍在持续发送。快照不会等待或读取新数据，也不能自动判定根因；仍需核对供电、端口、协议、尺寸和线序。

`read_frame()` 超时保持返回 `None`，不会仅因为超时将设备判为 I/O 失败。`close()` 可重复调用，正常关闭为 `closed`，发生故障后释放资源仍保留 `error` 状态和错误历史；关闭失败会抛出。

## 连接已有后端

`BackendSdkClient` 通过 HTTP / WebSocket 查询和控制**已经运行的主项目后端**（默认 `http://127.0.0.1:19245` 与 `ws://127.0.0.1:19999`）。它不是采集服务，不读取本机串口，也不需要 SDK 授权；后端帧按原样交给调用方，不做点位映射。它使用主项目的通道订阅协议，与上文 `serve_device` 的数据协议不同。

```python
from shroom_sdk import BackendSdkClient, BackendError

client = BackendSdkClient(http_base_url="http://127.0.0.1:19245", ws_url="ws://127.0.0.1:19999", timeout=10)
try:
    contract = client.get_contract()           # 缓存契约并加载其中的接口路径
    print(client.list_serial_ports(), client.get_serial_status())
except BackendError as error:
    print(error, error.status)

client.on("frame", lambda frame: print(frame))
client.on("error", lambda error: print("error:", error))
client.connect_realtime(["pressure"])          # 立即返回；通过 open / error / close 事件观察结果
...
client.disconnect_realtime()                   # 不会让后端关闭串口或停止采集
```

查询方法：`get_contract / get_channels / get_ws_status / list_display_systems / get_display_system / list_serial_ports / get_serial_status / get_current_sensor`。控制方法只在显式调用时发送，写操作不自动重试：`set_sensor_type / open_serial / close_serial / start_collection / stop_collection`。`request(route_or_path, method=..., body=..., query=...)` 访问其他根相对路径。HTTP 失败、业务错误码和无效 JSON 抛出 `BackendError`。

事件为 `open / close / error / message / frame / raw`，用 `on / off / once / remove_all_listeners` 管理，在接收线程上触发；监听器抛出的异常转交 `error` 事件。断开后不自动重连。请求不使用系统代理。

## API 与 JavaScript 对照

Python 使用 snake_case 参数、同步调用和秒为单位的时间；不要照抄 JavaScript 的参数名。

| JavaScript | Python |
| --- | --- |
| `readProduct({ product, path, side, onData })` | `read_product(product, path, side=..., on_data=...)` |
| `readProduct({ url, onData })` | `read_product(url=..., on_data=...)` |
| `createWS(device, { port })` | `create_ws(device, port=...)` |
| `startRecording(stream, { label })` | `start_recording(stream, label=...)` |
| `stopRecording(stream)` | `stop_recording(stream)` |
| `downloadRecording(stream, { format })` | `download_recording(stream, path, format=...)` |
| `Shroom.connectProduct({ product, ... })` | `connect_product(product, path, ...)` |
| `Shroom.connectGlove({ side, path })` / `connectHandPad({ path })` | `connect_glove(path, side=...)` / `connect_hand_pad(path)` |
| `scanProductPorts({ side, paths, timeoutMs, signal })` | `scan_product_ports(side=..., paths=..., timeout=秒, cancel=Event)` |
| `readProduct({ product: 'glove', scan: { timeoutMs } })` | `read_product("glove", scan={"timeout": 秒})` |
| `reconnect: { intervalMs: 3000, maxAttempts: 3 }` | `reconnect={"interval": 3.0, "max_attempts": 3}` |
| `device.onData(fn)` / `onError(fn)` / `onStateChange(fn)` | `device.on_data(fn)` / `on_error(fn)` / `on_state_change(fn)` |
| `listDeviceProducts()` | `list_device_products()` |
| `createProductMockDevice({ product, side })` | `create_product_mock_device(product, side=...)` |
| `serveDevice(device, options)` | `serve_device(device, **options)` |
| `connectStream({ url })` | `connect_stream(url)` |
| `encodeStreamFrame / decodeStreamFrame` | `encode_stream_frame / decode_stream_frame` |
| `Shroom.connect({ path: 'COM3' })` | `Shroom.connect('COM3')` |
| `Shroom.mock({ rows: 32, cols: 32 })` | `Shroom.mock(rows=32, cols=32)` |
| `Shroom.listPorts()` | `Shroom.list_ports()` |
| `Shroom.activateLicense(key, options)` | `Shroom.activate_license(key, **options)` |
| `Shroom.getLicenseStatus()` / `clearLicense()` | `Shroom.get_license_status()` / `clear_license()` |
| `device.onFrame(callback)` | `device.on_frame(callback)`，或 `for frame in device` / `device.read_frame()` |
| `await device.close()` | `device.close()`，推荐 `with` |
| `Shroom.renderAscii(frame)` | `Shroom.render_ascii(frame)` |
| `decodeFrame(payload, options)` | `decode_frame(payload, **options)` |
| `createFramer(options)` | `Framer(**options)` |
| `getLayout / listLayouts / listProducts / getProduct` | `get_layout / list_layouts / list_products / get_product` |
| `device.getDiagnostics()` | `device.get_diagnostics()` |
| `new BackendSdkClient({ httpBaseUrl, wsUrl })` | `BackendSdkClient(http_base_url=..., ws_url=...)` |
| `connectSerial`（Web Serial）、`createHeatmap`、`createProductView` | 浏览器专属，Python 不提供 |

`list_ports()` 返回 `PortInfo` 列表，包含 path、description、manufacturer、serial_number、vendor_id 和 product_id。`connect()` 未传端口时，仅在检测到恰好一个端口时自动连接。`mock()` 的 `fps` 范围为 `1000 / 2147483647` 至 `1000`（含边界）；可传 `seed=7` 获得可复现的模拟数据。Python 与 JS 的随机数算法不同，模拟原始字节不保证逐字节相同，但相同输入字节的解码结果一致。

## 测试与构建

在本仓库根目录，安装 `./python[serial,license]` 后：

```bash
python -m unittest discover -s python/tests -v
python -m pip install build
python -m build python
```

测试覆盖核心数值、全部线序、五种产品协议（含半包、粘包、噪声与重新同步）、分包手套的自动手侧与串口发现、WS 帧编解码与损坏帧拒绝、回调与有限重连、数据服务的握手/来源限制/慢客户端、SQLite 录制与恢复、五步流程、授权执行、后端客户端，以及 pySerial `loop://` 回环。若可用 Node，测试会调用现有 JS 实现逐项比较：线序表、解码结果、产品解析器在每个数据块之后的帧与丢弃计数、调色板；安装了仓库的 npm 依赖时，还会用 JS 的网页端客户端连接 Python 服务、用 Python 客户端连接 Node 服务，并互读对方写入的录制目录。Node 只用于这些开发校验，不是 Python SDK 的运行依赖。合成数据和回环测试不能替代真实传感器联调。

wheel / sdist 生成在 `python/dist/`；客户 ZIP 包含 Python 源码、安装配置和示例，排除测试、虚拟环境、缓存和构建产物。

串口底层 API 参考 [pySerial 官方文档](https://pyserial.readthedocs.io/en/latest/pyserial_api.html)。
