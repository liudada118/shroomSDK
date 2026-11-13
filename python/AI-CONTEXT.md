# Shroom Python SDK · AI 接入指南

先阅读同目录的 [README.md](README.md)，它是 Python API 的完整使用说明。本文件是接入上下文，不是可安装的 Agent Skill。

## 安装与验证

- 要求 Python 3.10+，无需 Node.js。从 0.6.0 起发布在 PyPI：`python -m pip install "shroom-sdk[serial]"`。产品接口和五步流程需要 0.6.0 及以上，先用 `python -c "import shroom_sdk; print(shroom_sdk.__version__)"` 确认版本。
- 离线安装：解压 `shroom-sdk-python.zip`，在包含 `python/` 的根目录运行 `python -m pip install "./python[serial]"`。示例脚本只在下载包和源码仓库的 `python/examples/` 中，PyPI 安装的包不含示例文件。
- 在本仓库根目录开发时路径是 `./sdk/python`，不要混淆。
- 没有设备时先运行 `python -m shroom_sdk --frames 3`（通用矩阵）或 `python python/examples/product_demo.py glove --side left --mock --frames 3`（产品数据）验证。
- 图形示例可安装 `"./python[serial,plot]"` 后运行 `python python/examples/heatmap.py`。
- CH34x 实机接入前必须确认操作系统已安装串口驱动，缺少驱动可能找不到串口。Windows 使用 [CH341SER.EXE](https://shroom.jq-industries.com/drive/CH341SER.EXE)，macOS 解压 [CH34xVCPDriver.zip](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip) 按包内说明安装；完成后重新插拔设备，先用 `python -m shroom_sdk --list` 验证，再激活密钥并连接。`pyserial` 不能替代系统驱动。

## 选哪条路线

| 需求 | 使用 |
| --- | --- |
| 已支持的产品（手套、手部检测垫、人体全身、鞋垫）取数 | `connect_product(product, path, ...)`，或快速函数 `read_product(...)` |
| 取数后给其他进程/网页查看、带标签采集并下载 | 五个函数：`read_product → create_ws → start_recording → stop_recording → download_recording` |
| 其他矩阵产品或自定义协议 | `Shroom.connect(path, baud_rate=..., rows=..., cols=..., layout=...)` |
| 已有主项目后端的 HTTP / WS | `BackendSdkClient` |

不要根据串口名称、帧长或包类型猜产品、协议和左右侧；这些必须由用户按实物确认。

## 按产品取数

```python
from shroom_sdk import Shroom, ShroomError, connect_product

try:
    Shroom.activate_license(key)
    device = connect_product("glove", "COM3", side="left",
                             on_data=lambda frame: print(frame.fingers.thumb.raw),
                             on_error=lambda error: print(error.code, error))
except ShroomError as error:
    print(error.code, error.stage, error.suggestion)
...
device.close()
```

- 产品 ID（别名）：`handGloveSegmented`（`glove`，分包，默认手套）、`handGloveFullPacket`（旧整包，需显式选择）、`hand`（`pad`）、`humanBody`（`body`）、`jqInsole`（`insole`）。帧的 `product` 始终是产品 ID。
- 整包手套、鞋垫必须传 `side="left"` 或 `"right"`；手垫和人体不接受 `side`。分包手套有两种方式：`path` 与 `side` 都给出时手动直连；省略其一（或传 `scan={...}`）时 SDK 扫描串口并按包类型识别手侧，唯一匹配才连接，否则抛 `PORT_NOT_FOUND` / `PORT_AMBIGUOUS`（`error.details["scan"]` 带候选），此时把候选展示给用户选择，不要自行挑一个。只查询不连接用 `scan_product_ports(side=..., paths=..., timeout=秒)`。鞋垫可选 `protocol="12bit"`（默认）/ `"8bit"` 和限定范围内的 `baud_rate`。产品不接受 `rows`、`delimiter`、`layout` 等底层参数。
- 配置错误、授权错误和首次连接失败在调用处抛出 `ShroomError`；连接后的错误交给 `on_error`。`on_data` 在后台读取线程上执行，可能早于 `connect_product()` 返回，回调里只用传入的帧，不做耗时操作。
- 不传 `on_data` 时用同步方式：`with connect_product(...) as device: frame = device.read_frame(timeout=2)`，超时返回 `None`。回调和同步读取不要在同一设备上混用。
- 默认断线后重连原串口，每 3 秒一次、最多 3 次；`reconnect=False` 关闭，`reconnect={"interval": 秒, "max_attempts": 次数}` 调整。`on_state_change` 收到 `{"state", "path", "attempt", "max_attempts"}`，状态为 `open / reconnecting / error / closed`。首次连接失败、主动关闭、授权/解析/权限错误不重试；不会自动续录。
- 其他产品未传 `path` 时仅在恰有一个串口时自动选择；多个串口抛 `PORT_AMBIGUOUS`。先用 `Shroom.list_ports()` 让用户选择。自动发现只适用于分包手套，会短暂打开候选串口，系统里有其他串口设备时用 `scan={"paths": [...]}` 限定。
- 帧属性是 snake_case：手套 `frame.fingers.thumb.raw`、`frame.fingers.thumb.pulp.raw`、`frame.palm.matrix`（行长 12/15/15/15/15）、`frame.imu.raw`（16 个原始字节）、`frame.pressure`（256 字节）；手垫 `frame.pressure_matrix`（32×32）；人体 `frame.regions["back"].matrix`；鞋垫 `frame.sensors.raw`（112 点）、`frame.sensors.positions[i].x_mm`、`frame.imu.quaternion`。`frame.to_dict()` 返回 JavaScript 字段名（camelCase）的 JSON 快照。
- 分包手套帧 `protocol == "segmented"`、`sequence is None`。手动直连时 `packet_type` 只是配对字节，手侧以传入的 `side` 为准；自动发现时按 1=左、2=右识别。IMU 只有原始数据，不要编造轴序、单位或姿态。
- 无硬件：`create_product_mock_device("glove", side="left")`（仅分包手套、整包手套、手垫）；纯解析：`create_product_parser(product, **options).push(data)`。

## 五步流程

```python
# 采集端
from shroom_sdk import read_product, create_ws
device = read_product("pad", "COM4", on_error=print)       # ①
server = create_ws(device, port=19999)                     # ② close() 时写完记录并释放串口

# 查看端（另一进程，或使用 JavaScript SDK 的网页）
from shroom_sdk import read_product, start_recording, stop_recording, download_recording
stream = read_product(url="ws://127.0.0.1:19999", on_data=print)
start_recording(stream, label="本次采集")                   # ③
recording = stop_recording(stream)                         # ④ 返回 id、frame_count、status
download_recording(stream, "capture.csv")                  # ⑤ 保存文件；format="jsonl" 可选
```

- 函数名固定为这五个，不要发明第六个快速函数。`start_recording / stop_recording / download_recording` 的第一个参数只能是 `read_product(url=...)` 返回的连接或 `create_ws` 返回的服务。
- 采集由服务端写入 SQLite（`.shroom-recordings/recordings.sqlite`），查看端断开不会停止采集；`stop_recording` 等待写完才返回。
- `download_recording(target, path)` 保存文件并返回路径；不传 `path` 返回下载 URL。只下载该连接最近一次成功停止的记录；历史记录用 `stream.list_recordings()` 的 `id` 调用 `stream.download_recording(id, path)`。不能用标签、产品或端口代替记录 ID。
- 采集控制会阻塞等待服务端响应，不要在 `on_data` 回调里调用。超时 `REQUEST_TIMEOUT` 不代表服务端没执行，先 `stream.get_recording_status()` 再决定。
- 设备断线、授权失效或写入溢出时采集以 `status == "error"` 结束并保留已写入的数据；重连后需由应用显式开始新的采集。
- 服务默认只监听 `127.0.0.1` 并拒绝非本机网页来源；跨机访问要显式传 `host` 和 `allowed_origins`，这不是身份鉴权。
- 授权：真实设备的 `create_ws / serve_device` 需要 `stream`，开始采集另需 `recording`；模拟设备和查看端不需要。
- 线上协议与 JavaScript SDK 相同（`shroom.frame.v1`）：JS 网页可连接 Python 服务，Python 也可连接 Node 的 `createWS` 服务。

## 通用串口与矩阵

- 实机连接前使用 `Shroom.activate_license(key)` 激活 `shroom-sdk` 产品密钥；未标产品的旧密钥和 `shroom-desktop` 密钥不能互用。SDK 密钥不按设备型号限制；有效期、电脑名额和功能权限仍生效。通用串口自动包含 `serial.raw`，同时必须有 `serial` 采集功能。再使用 `Shroom.connect("COM3", baud_rate=1_000_000, rows=32, cols=32)`，端口和尺寸必须由设备资料确定。
- 在线默认后台 `https://shroom.jq-industries.com`，每 30 秒复核，最后成功许可最长 60 秒；网络失败不会无限使用。RSA 离线激活用 `mode="offline"`，安装 `[license]` 依赖；`public_key` 只能来自可信应用配置，不能读取许可证自带公钥作为信任依据。
- 限定数量密钥必须由应用持久保存并传入 64 位小写十六进制 `device_id`；不要每次启动重新生成。限定数量 RSA 离线码也需要联网激活和复核，不存在七天本地缓存。
- `Shroom.get_license_status()` 返回不含密钥的字典；`Shroom.clear_license()` 立即撤销本进程许可并关闭相关真实串口。Mock、纯解析、渲染和串口枚举无需授权。
- 使用 `Shroom.list_ports()` 枚举串口，`device.read_frame(timeout=2)` 单次读取；超时返回 `None`。`for frame in device` 在无数据时持续等待；用 `with` 或 `close()` 释放串口，`break` 本身不负责关闭。
- 默认是同步读取，没有后台线程；需要回调时用 `device.on_frame(handler)` / `device.on_error(handler)`，此后不要再调用 `read_frame`。没有 Promise 和 `await`。
- `layout` 可取 `"raw"`、`list_layouts()` 中的内置排列名（如 `mat32`、`carSeat`、`car10`），或完整排列列表。内置排列在省略 `rows / cols` 时决定输出行列；未知名称会报错，不会回退。排列名必须来自用户的设备资料，不要猜。
- 查询、配置、连接、读写和关闭失败时捕获 `ShroomError`，读取 `code / stage / suggestion / details`；配置错误兼容 `ValueError`，I/O 错误兼容 `OSError`，授权错误兼容 `PermissionError`。
- 串口与 Mock 都提供 `device.state` 和无参数 `device.get_diagnostics()`；快照键为 `source / state / bytes_received / frame_count / dropped_count / frame_length / last_error / status / hint`，受管理的连接另有 `reconnect_attempt / reconnect_max_attempts`。`status` 为 `waiting-data / waiting-frame / streaming / reconnecting / closed / error`；`hint` 是检查建议，不是根因判定。
- `frame.values` 是 float32 数组，`frame.raw` 是 bytes；`frame.matrix()` / `frame.to_dict()` 用于转二维列表 / JSON 可序列化快照。
- 参数使用 `baud_rate`、`full_scale`、`lock_length`、`on_data`、`max_attempts` 等 snake_case，时间单位是秒；不要照抄 JavaScript 的 `baudRate`、`onData`、`intervalMs`。

## 能力边界

提供：产品协议与点位分区、产品与通用串口连接、有限重连、模拟设备、WS 数据服务与客户端、SQLite 带标签录制与 CSV / JSONL 导出、30 种点位排列、文字热力图、调色板函数、已有后端客户端。
不提供：kPa/N 换算与标定、手势识别、姿态解算、三维模型、历史回放、业务数据库、自动识别产品或左右侧、自动续录；Web Serial 和 Canvas 热力图只在 JavaScript SDK 中。
数值是相对 ADC 值，`area` 是阈值以上的点数。先确认设备协议与点位排列，再接真实设备；未知协议不要编造。产品协议经合成数据与 JavaScript 实现对照验证，仍需真机联调确认。
