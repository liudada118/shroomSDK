# Shroom Python SDK · AI 接入指南

先阅读同目录的 [README.md](README.md)，它是 Python API 的完整使用说明。本文件是接入上下文，不是可安装的 Agent Skill。

## 安装与验证

- 要求 Python 3.10+，无需 Node.js，尚未发布 PyPI。
- 解压 `shroom-sdk-python.zip`，在包含 `python/` 的根目录运行 `python -m pip install "./python[serial]"`。
- 在本仓库根目录开发时路径是 `./sdk/python`，不要混淆。
- 没有设备时先运行 `python -m shroom_sdk --frames 3` 验证模拟数据。
- 图形示例可安装 `"./python[serial,plot]"` 后运行 `python python/examples/heatmap.py`。
- CH34x 实机接入前必须确认操作系统已安装串口驱动，缺少驱动可能找不到串口。Windows 使用 [CH341SER.EXE](https://shroom.jq-industries.com/drive/CH341SER.EXE)，macOS 解压 [CH34xVCPDriver.zip](https://shroom.jq-industries.com/drive/CH34xVCPDriver.zip) 按包内说明安装；完成后重新插拔设备，先用 `python -m shroom_sdk --list` 验证，再激活密钥并连接。`pyserial` 不能替代系统驱动。

## Python 接口

按查询串口 → 配置连接 → 自动拆帧解码 → 错误诊断组织接入代码。`list_ports()` 只枚举系统端口，不自动识别产品、协议或线序；按设备资料提供参数，错误处理覆盖查询、连接、读取和关闭。

```python
from shroom_sdk import Shroom

with Shroom.mock(rows=32, cols=32) as device:
    for frame in device:
        print(frame.max, frame.area, frame.center.x, frame.center.y)
        break
```

- 实机连接前使用 `Shroom.activate_license(key)` 激活 `shroom-sdk` 产品密钥；未标产品的旧密钥和 `shroom-desktop` 密钥不能互用。SDK 密钥不按设备型号限制，旧 SDK 密钥的型号范围也被忽略；有效期、电脑名额和功能权限仍生效。通用串口自动包含 `serial.raw`，同时必须有 `serial` 采集功能。再使用 `Shroom.connect("COM3", baud_rate=1_000_000, rows=32, cols=32)`，端口和尺寸必须由设备资料确定。
- 在线默认后台 `https://shroom.jq-industries.com`，每 30 秒复核，最后成功许可最长 60 秒；网络失败不会无限使用。RSA 离线激活用 `mode="offline"`，安装 `[license]` 依赖；`public_key` 只能来自可信应用配置，不能读取许可证自带公钥作为信任依据。
- 限定数量密钥必须由应用持久保存并传入 64 位小写十六进制 `device_id`；不要每次启动重新生成。限定数量 RSA 离线码也需要联网激活和复核，不存在七天本地缓存。
- `Shroom.get_license_status()` 返回不含密钥的字典；`Shroom.clear_license()` 立即撤销本进程许可并关闭相关真实串口。到期或后台停用时同样关闭；Mock、纯解析、渲染和串口枚举无需授权。
- 有效 SDK 状态的 `all_products` 为 `True`，`sensor_types` 为 `["all"]`；签名和 SDK 产品类型仍必须通过校验。不可据此把桌面产品密钥自动转换为 SDK 密钥。
- 使用 `Shroom.list_ports()` 枚举串口，`device.read_frame(timeout=2)` 单次读取；超时返回 `None`。
- `for frame in device` 在无数据时持续等待；用 `with` 或 `close()` 释放串口，`break` 本身不负责关闭。
- API 是同步接口，不使用 Promise、`onFrame()` 或 `on_frame()`，没有后台采集线程；授权有后台复核及到期定时器。
- 查询、配置、连接、读写和关闭失败时在调用处捕获 `ShroomError`（从 `shroom_sdk` 导入），读取 `code / stage / suggestion / details`；配置错误兼容 `ValueError`，I/O 错误兼容 `OSError`。没有 `onError()` 回调。
- 串口与 Mock 都提供 `device.state`（`open / closed / error`）和无参数 `device.get_diagnostics()`；快照键为 `source / state / bytes_received / frame_count / dropped_count / frame_length / last_error / status / hint`。
- `last_error` 是可序列化错误字典，不含原始 cause。Mock 字节数和帧数记录模拟生成量，不是串口吞吐；`frame_length` 首帧前为 0、首帧后为模拟点数，`dropped_count` 为 0。
- 诊断 `status` 为 `waiting-data / waiting-frame / streaming / closed / error`，用于描述当前观测；`hint` 是检查建议，不是根因判定。超时的 `read_frame()` 仍返回 `None`，不要臆造异常、自动重连或后台处理。
- 串口、拆帧、解码配置在打开端口前严格校验。同步采集用 `with` 或 `try / finally` 关闭设备；`close()` 幂等，正常关闭为 closed，故障释放后保留 error 状态与错误历史；出错后由应用决定是否重新连接。
- `frame.values` 是 float32 数组，`frame.raw` 是 bytes；`frame.matrix()` / `frame.to_dict()` 用于转二维列表 / JSON 可序列化快照。
- 参数使用 `baud_rate`、`full_scale`、`lock_length` 等 snake_case；不要照抄 JavaScript 参数。
- Mock 的 `fps` 必须是有限数值，范围为 `1000 / 2147483647` 至 `1000`（含边界，约 `4.657e-7` 至 `1000`）。

## 能力边界

提供串口读取、拆帧、raw/mat32 排列、Mock、文字热力图及可选 Matplotlib 示例。
默认协议是 `AA 55 03 99` 分隔帧，每点一个字节；默认 values 为 0～1 相对 ADC 值，area 为阈值以上的点数。
不提供 kPa/N 换算、手套专用协议、IMU、手势识别、数据库、录制回放。
先确认设备协议与点位排列，再接真实设备；未知协议不要编造。
