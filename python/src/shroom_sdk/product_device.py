"""带回调与有限重连的串口连接：产品连接和可选的通用重连共用同一实现。

读取核心仍是同步的 read_frame；订阅 on_data 后由基类的后台线程代为读取。
意外断线后只在原端口上按固定间隔有限重试，不重新枚举端口，也不猜测设备。
"""

from collections import deque
from dataclasses import dataclass
from math import isfinite
from threading import RLock
from time import monotonic

from . import _trust
from ._hub import require_callable
from ._serial_path import reserve_serial_path
from .device import Device, MockDevice, _serial_module, _timeout, list_ports
from .errors import ShroomError, as_shroom_error, invalid_config, make_error, serial_error
from .frame import _integer, _validate_decode_options, decode_frame
from .framer import DEFAULT_DELIMITER, Framer
from .license import _assert_license, _subscribe_license
from .product import prepare_product_connection
from .products import get_device_product_adapter
from .products._adapter import TAIL
from .serial_scan import scan_product_ports

_MOCK_PRODUCTS = ("handGloveSegmented", "handGloveFullPacket", "hand")
_FATAL_RETRY_CODES = ("INVALID_CONFIG", "PARSE_FAILED", "PERMISSION_DENIED")


@dataclass(frozen=True)
class ReconnectPolicy:
    """重连策略：interval 为两次尝试之间的秒数，max_attempts 为一次断线后的最多尝试次数。"""

    enabled: bool
    interval: float
    max_attempts: int


def reconnect_policy(reconnect, default_enabled: bool = False) -> ReconnectPolicy:
    """检查重连配置；配置错误必须在查询或打开硬件之前返回。

    reconnect 可为 None（取默认）、布尔值，或 {"interval": 秒, "max_attempts": 次数}。
    默认每 3 秒一次、最多 3 次。
    """
    policy = default_enabled if reconnect is None else reconnect
    if not isinstance(policy, (bool, dict)):
        raise invalid_config("reconnect 必须是布尔值或包含 interval / max_attempts 的字典。", option="reconnect")
    config = policy if isinstance(policy, dict) else {}
    for field in config:
        if field not in ("interval", "max_attempts"):
            raise invalid_config(f"无效的 reconnect.{field} 配置。", option=f"reconnect.{field}")
    interval = config.get("interval", 3.0)
    attempts = config.get("max_attempts", 3)
    if (isinstance(interval, bool) or not isinstance(interval, (int, float)) or not isfinite(interval)
            or not 0.001 <= interval <= 2_147_483.647):
        raise invalid_config("reconnect.interval 必须是 0.001 至 2147483.647 秒之间的数值。",
                             option="reconnect.interval")
    if isinstance(attempts, bool) or not isinstance(attempts, int) or not 1 <= attempts <= 1000:
        raise invalid_config("reconnect.max_attempts 必须是 1 至 1000 的整数。", option="reconnect.max_attempts")
    return ReconnectPolicy(policy is not False, float(interval), attempts)


class ManagedSerialDevice(Device):
    """受管理的串口设备：稳定保留订阅，在原端口上有限重试，并按连接代次隔离解析状态。

    state 为 open / reconnecting / error / closed。重连期间 read_frame 超时返回 None，
    中间错误交给 on_error；重试用尽、授权失效或解析失败后进入 error 并向读取方抛出。
    重连只恢复实时数据，不会自动续录。
    """

    def __init__(self, *, serial, path: str, baud_rate: int, info: dict, make_parser, decode,
                 feature: str, policy: ReconnectPolicy, on_data=None, on_error=None,
                 on_state_change=None):
        # 预约贯穿整台设备的生命周期（含等待重连的间隙），扫描或其他连接不能抢占这个串口。
        release_path = reserve_serial_path(path)
        super().__init__({"source": "python-serial", "path": path, "baud_rate": baud_rate, **info})
        self._release_path = release_path
        self._stuck_port = None  # 关闭失败且仍被驱动持有的端口；再次 close() 时重试释放。
        self._serial = serial
        self._make_parser = make_parser
        self._decode_payload = decode
        self._feature = feature
        self._policy = policy
        self._io_lock = RLock()
        self._pending: deque = deque()
        self._state_handlers: dict[int, object] = {}
        self._state_revision = self._handler_id = 0
        self._retry_attempt = 0
        self._retry_at = 0.0
        self._archived_dropped = 0
        self._current_bytes = self._current_frames = 0
        self._port = None
        self._parser = None
        self._parser_archived = True
        self._terminal: ShroomError | None = None
        self._license_unsubscribe = None
        if on_error is not None:
            self._hub.on_error(on_error)
        if on_state_change is not None:
            self.on_state_change(on_state_change)
        try:
            # 首次连接失败直接抛给调用方，不进入后台重试。
            self._open()
        except BaseException:
            self._state = "error"
            self._closed.set()
            self._hub.clear()
            self._state_handlers.clear()
            self._free_path()
            raise
        self._license_unsubscribe = _subscribe_license(self._license_changed)
        _trust.mark_licensed_device(self, feature)
        self._notify_state()
        if on_data is not None and not self.closed:
            # 回调最后注册：数据留在系统缓冲区里，不会因注册晚于打开而丢首帧。
            self.on_frame(on_data)

    # ------------------------------------------------------------------ 状态与诊断

    def on_state_change(self, handler):
        """订阅低频连接状态，返回取消订阅函数。

        回调收到 {"state", "path", "attempt", "max_attempts"}；有效帧到达后 attempt 才清零。
        """
        require_callable(handler, "on_state_change")
        with self._io_lock:
            self._handler_id += 1
            identifier = self._handler_id
            self._state_handlers[identifier] = handler

        def unsubscribe() -> None:
            with self._io_lock:
                self._state_handlers.pop(identifier, None)
        return unsubscribe

    def _set_state(self, state: str) -> bool:
        """在未关闭时切换连接状态；close() 与读取线程并发时以关闭为准。"""
        with self._io_lock:
            if self.closed:
                return False
            self._state = state
            return True

    def _state_snapshot(self) -> tuple:
        """取当前状态与订阅者的快照；调用方可以先取快照、稍后再通知。"""
        with self._io_lock:
            self._state_revision += 1
            status = {"state": self._state, "path": self.info["path"],
                      "attempt": self._retry_attempt, "max_attempts": self._policy.max_attempts}
            return self._state_revision, tuple(self._state_handlers.values()), status

    def _notify_state(self) -> None:
        self._deliver_state(self._state_snapshot())

    def _deliver_state(self, snapshot: tuple) -> None:
        """状态回调与帧回调一样隔离异常，避免业务代码中断设备清理。"""
        revision, handlers, status = snapshot
        for handler in handlers:
            # 回调可能同步关闭设备；更新的状态发布后不再继续广播旧快照。
            if revision != self._state_revision:
                break
            try:
                handler(dict(status))
            except Exception as exc:
                self._hub.emit_error(as_shroom_error(exc, code="CALLBACK_FAILED", stage="callback",
                                                     message="应用的 on_state_change 回调执行失败"))

    @property
    def dropped_count(self) -> int:
        parser = self._parser
        current = 0 if parser is None or self._parser_archived else parser.dropped_count
        return self._archived_dropped + current

    @property
    def frame_length(self) -> int:
        parser = self._parser
        return parser.frame_length if parser is not None else 0

    def get_diagnostics(self) -> dict:
        """累计计数保留历史，本次物理连接的计数决定 waiting / streaming 状态。"""
        last = self._last_error
        dropped = self.dropped_count
        if self._state == "reconnecting":
            status, hint = "reconnecting", "串口已断开，正在尝试重新连接原端口；当前采集不会自动续录。"
        elif self._state == "error":
            status = "error"
            hint = last.suggestion if last else "连接发生错误；请检查设备连接和串口配置。"
        elif self.closed:
            status, hint = "closed", "连接已关闭。"
        elif self._current_frames:
            status = "streaming"
            hint = (f"已成功解析 {self.frame_count} 帧，已丢弃 {dropped} 帧；请检查波特率、分隔符和帧长配置。"
                    if dropped else f"已成功解析 {self.frame_count} 帧；此累计计数不表示设备仍在持续发送数据。")
        elif self._current_bytes:
            status, hint = "waiting-frame", "已收到字节，尚未解析出完整帧；请检查波特率、分隔符和帧长配置。"
            if dropped:
                hint += f" 已丢弃 {dropped} 帧。"
        else:
            status, hint = "waiting-data", "尚未收到字节；请检查设备供电、端口、接线，以及设备是否正在发送数据。"
        return {"source": self.info["source"], "state": self._state,
                "bytes_received": self.bytes_received, "frame_count": self.frame_count,
                "dropped_count": dropped, "frame_length": self.frame_length,
                "last_error": last.to_dict() if last else None, "status": status, "hint": hint,
                "reconnect_attempt": self._retry_attempt,
                "reconnect_max_attempts": self._policy.max_attempts}

    # ------------------------------------------------------------------ 连接代次

    def _open(self) -> None:
        """创建全新的解析状态并打开物理端口；打开前后各检查一次授权。"""
        _assert_license(self._feature)
        self._parser = self._make_parser()
        self._parser_archived = False
        self._current_bytes = self._current_frames = 0
        path = self.info["path"]
        try:
            port = self._serial.serial_for_url(path, baudrate=self.info["baud_rate"],
                                               timeout=0.1, write_timeout=1.0)
        except Exception as exc:
            raise serial_error(exc, "connect", path=path) from exc
        try:
            _assert_license(self._feature)
        except ShroomError:
            self._close_quietly(port)
            raise
        with self._io_lock:
            if self.closed:
                # 打开期间设备已被关闭：不能留下无人持有的端口。
                self._close_quietly(port)
                raise make_error("CONNECTION_FAILED", "串口连接已取消。", stage="connect")
            self._port = port

    def _close_quietly(self, port) -> None:
        try:
            port.close()
        except Exception:
            if getattr(port, "is_open", False) is True:
                self._stuck_port = port

    def _free_path(self) -> None:
        """设备已终止且物理端口确认释放后才解除预约；关闭失败的端口继续占用路径。"""
        if self.closed and self._port is None and self._stuck_port is None:
            self._release_path()

    def _release_port(self) -> ShroomError | None:
        """释放当前物理连接并归档其丢帧计数；返回关闭错误而不是抛出，由调用方决定如何处理。"""
        with self._io_lock:
            port, self._port = self._port, None
            if self._parser is not None and not self._parser_archived:
                self._archived_dropped += self._parser.dropped_count
                self._parser_archived = True
        if port is None:
            return None
        try:
            port.close()
        except Exception as exc:
            if getattr(port, "is_open", False) is True:
                self._stuck_port = port
            return serial_error(exc, "close", path=self.info["path"])
        return None

    def _terminate(self, error: ShroomError):
        """停止重试并释放端口，保留最后错误供诊断读取，再向读取方抛出。"""
        with self._io_lock:
            first = self._terminal is None
            if first:
                self._terminal = error
                self._record_error(error)
                # 由本线程负责上报：读取线程随后看到同一个错误时不再重复通知。
                self._reported = error
                # 先取订阅快照再发出停止信号：读取线程退出时会清空订阅，不能因此漏掉这次通知。
                state_snapshot = self._state_snapshot()
                error_handlers = self._hub.error_handlers()
                self._closed.set()
        if first:
            if self._license_unsubscribe is not None:
                self._license_unsubscribe()
            self._pending.clear()
            self._deliver_state(state_snapshot)
            # 同步读取时错误会抛给调用方，没有错误订阅也不必再写一遍日志。
            log = self._pump is not None
            self._hub.emit_error(error, log=log, handlers=error_handlers)
            close_error = self._release_port()
            if close_error is not None:
                self._hub.emit_error(close_error, log=log, handlers=error_handlers)
            self._free_path()
        raise self._terminal

    def _check_license(self) -> None:
        try:
            _assert_license(self._feature)
        except ShroomError as error:
            self._terminate(error)

    def _license_changed(self) -> None:
        """授权管理器通知变化时立即复核，保证闲置连接也会在授权失效时关闭。"""
        if not self.closed:
            try:
                self._check_license()
            except ShroomError:
                pass

    def _ensure_open(self, stage: str = "read") -> None:
        if self.closed and self._terminal is not None:
            raise self._terminal
        super()._ensure_open(stage)

    def _read_error(self, exc: Exception) -> ShroomError:
        error = serial_error(exc, "read", path=self.info["path"])
        # Windows 上拔出设备时 pySerial 报 "ClearCommError failed (PermissionError ... Access is denied)"；
        # 英文系统的文案会先命中权限分类，这里按断开处理，才能进入原端口重连。
        if error.code == "PERMISSION_DENIED" and "clearcommerror failed" in str(exc).lower():
            error.code = "DISCONNECTED"
            error.suggestion = "设备可能已拔出；请检查线缆和供电。"
        return error

    def _recover(self, error: ShroomError) -> None:
        """读取失败后的处理：可重试则进入 reconnecting 并释放旧端口，否则终止。"""
        retryable = self._policy.enabled and error.code in ("DISCONNECTED", "READ_FAILED")
        if not retryable or self._retry_attempt >= self._policy.max_attempts:
            self._terminate(error)
        self._last_error = error
        if not self._set_state("reconnecting"):
            return
        self._notify_state()
        if self.closed:
            return
        self._hub.emit_error(error)
        close_error = self._release_port()
        if close_error is not None:
            self._terminate(close_error)
        self._retry_at = monotonic() + self._policy.interval

    def _retry(self) -> None:
        """在原路径上尝试一次重新打开；重试只沿用原 path 和原协议配置。"""
        if self._retry_attempt >= self._policy.max_attempts:
            self._terminate(self._last_error or make_error("CONNECTION_FAILED", "串口重连次数已用尽。", stage="connect"))
        self._retry_attempt += 1
        self._notify_state()
        if self.closed:
            return
        try:
            self._open()
        except ShroomError as error:
            if self.closed:
                return
            # 授权、配置和权限问题重试也不会好转；最后一次尝试失败同样直接终止，错误只通知一次。
            if (error.stage == "license" or error.code in _FATAL_RETRY_CODES
                    or self._retry_attempt >= self._policy.max_attempts):
                self._terminate(error)
            self._last_error = error
            self._hub.emit_error(error)
            self._retry_at = monotonic() + self._policy.interval
            return
        if self._set_state("open"):
            self._notify_state()

    # ------------------------------------------------------------------ 读写

    def _consume(self, chunk: bytes) -> None:
        self._bytes_received += len(chunk)
        self._current_bytes += len(chunk)
        try:
            payloads = self._parser.push(chunk)
            for payload in payloads:
                _assert_license(self._feature)
                frame = self._decode_payload(payload)
                self._frame_count += 1
                self._current_frames += 1
                if self._retry_attempt:
                    # 有效帧到达后才清零尝试次数，避免“能打开但没有数据”被当成已恢复。
                    self._retry_attempt = 0
                    self._notify_state()
                self._pending.append(frame)
        except Exception as exc:
            if isinstance(exc, ShroomError) and exc.stage == "license":
                self._terminate(exc)
            self._terminate(as_shroom_error(exc, code="PARSE_FAILED", stage="parse",
                                            suggestion="请检查产品协议与数据帧配置。"))

    def read_frame(self, timeout: float | None = 1.0):
        """读取一帧；超时或正在重连时返回 None，连接终止后抛出导致终止的错误。"""
        self._ensure_open()
        _timeout(timeout)
        deadline = monotonic() + timeout if timeout is not None else None
        while not self.closed:
            self._check_license()
            if self._pending:
                return self._pending.popleft()
            remaining = deadline - monotonic() if deadline is not None else 0.1
            if remaining <= 0:
                return None
            if self._state == "reconnecting":
                delay = self._retry_at - monotonic()
                if delay > 0:
                    self._closed.wait(min(delay, remaining))
                else:
                    self._retry()
                continue
            try:
                port = self._port
                if port is None or getattr(port, "is_open", True) is False:
                    raise OSError("Serial device is disconnected")
                port.timeout = min(0.1, remaining)
                chunk = port.read(min(4096, max(1, port.in_waiting)))
            except Exception as exc:
                if self.closed:
                    break
                self._check_license()
                self._recover(self._read_error(exc))
                continue
            if chunk:
                self._consume(chunk)
        if self._terminal is not None:
            raise self._terminal
        return None

    def write(self, data: bytes) -> int:
        """发送调用方提供的设备命令，返回写入字节数；不自动拼接启动或校准指令，也不自动重发。"""
        self._ensure_open("write")
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise invalid_config("data must be bytes, bytearray or memoryview", option="data")
        self._check_license()
        try:
            port = self._port
            if port is None or getattr(port, "is_open", True) is False:
                raise OSError("Serial device is disconnected")
            return port.write(data)
        except Exception as exc:
            error = serial_error(exc, "write", path=self.info["path"])
            self._last_error = error
            raise error from exc

    def close(self) -> None:
        """终止自动重连并释放端口；可重复调用，关闭失败会抛出且可在诊断中查询。

        端口关闭失败时路径保持占用；再次调用 close() 会重试释放。
        """
        with self._io_lock:
            first = not self.closed
            self._closed.set()
            stuck, self._stuck_port = self._stuck_port, None
        if stuck is not None:
            try:
                stuck.close()
            except Exception as exc:
                if getattr(stuck, "is_open", False) is True:
                    self._stuck_port = stuck
                    error = serial_error(exc, "close", path=self.info["path"])
                    self._record_error(error)
                    raise error from exc
        if first and self._license_unsubscribe is not None:
            self._license_unsubscribe()
        super().close()
        self._pending.clear()
        if first:
            self._notify_state()
        with self._io_lock:
            self._state_handlers.clear()
        close_error = self._release_port()
        self._free_path()
        if close_error is not None:
            self._record_error(close_error)
            raise close_error


def _resolve_path(path, *, product: bool) -> str:
    """首次解析端口选择；后续重连固定使用此路径，不重新枚举并猜测设备。"""
    if path is not None:
        return path
    ports = list_ports()
    if not ports:
        raise make_error("PORT_NOT_FOUND", "没有检测到串口设备。", stage="query",
                         suggestion="请连接设备并安装对应的串口驱动，再用 list_ports() 重新查询。")
    if len(ports) > 1:
        subject = "产品使用的" if product else "目标"
        raise make_error("PORT_AMBIGUOUS", f"检测到多个串口，请指定{subject} path。", stage="query",
                         suggestion="调用 list_ports() 查看端口，再用 path 指定设备；SDK 不会根据串口顺序猜测产品。",
                         details={"ports": [port.path for port in ports]})
    return ports[0].path


def _validate_common(path, callbacks: dict) -> None:
    if path is not None and (not isinstance(path, str) or not path.strip()):
        raise invalid_config("path must be a non-empty string or None", option="path")
    for name, handler in callbacks.items():
        if handler is not None and not callable(handler):
            raise invalid_config(f"{name} 必须是可调用对象。", option=name)


class _IdentityParser:
    """自动识别后的连接仍逐帧核对身份：换接的另一只手不能被映射成原来的手侧。"""

    def __init__(self, parser, identify, expected: dict, path: str):
        self._parser, self._identify, self._expected, self._path = parser, identify, expected, path

    def push(self, chunk) -> list:
        frames = self._parser.push(chunk)
        for frame in frames:
            identity = self._identify(frame)
            if identity != self._expected:
                raise make_error("PARSE_FAILED", "串口中的手套手侧与自动识别结果不一致。", stage="parse",
                                 suggestion="关闭连接后重新扫描；一只手套应独占一个串口。",
                                 details={"path": self._path, "expected_side": self._expected.get("side"),
                                          "actual_side": identity.get("side")})
        return frames

    def reset(self) -> None:
        self._parser.reset()

    @property
    def dropped_count(self) -> int:
        return self._parser.dropped_count

    @property
    def frame_length(self) -> int:
        return self._parser.frame_length


def _discover(adapter, product, path, side, scan) -> dict:
    """自动模式：扫描候选串口，只有唯一匹配才继续连接；否则带着逐口结果报错。"""
    scan = {} if scan is None else scan
    if not isinstance(scan, dict) or any(key not in ("paths", "timeout", "cancel") for key in scan):
        raise invalid_config("scan 仅支持 paths、timeout、cancel。", option="scan")
    if path is not None and scan.get("paths") is not None:
        raise invalid_config("指定 path 后不应再提供 scan['paths']。", option="scan.paths")
    arguments = {key: value for key, value in scan.items() if value is not None}
    if path is not None:
        arguments["paths"] = [path]
    result = scan_product_ports(product, side=side if side in ("left", "right") else None, **arguments)
    if len(result["devices"]) != 1:
        multiple = len(result["devices"]) > 1
        raise make_error(
            "PORT_AMBIGUOUS" if multiple else "PORT_NOT_FOUND",
            "识别到多个符合条件的手套，请按候选列表指定串口。" if multiple else "没有识别到符合条件的手套。",
            stage="query", details={"scan": result},
            suggestion=("指定 side 筛选左/右手；同侧有多只手套时指定 path。" if multiple
                        else "检查驱动、供电、端口占用与手侧；可查看 details['scan'] 的逐口结果。"))
    return result["devices"][0]


def connect_product(product, path: str | None = None, *, on_data=None, on_error=None,
                    on_state_change=None, reconnect=None, scan: dict | None = None,
                    **options) -> ManagedSerialDevice:
    """按产品连接串口：协议、波特率与点位映射由产品固定，回调收到已解析的产品帧。

    product 为正式 ID 或别名（glove / pad / body / insole）；options 是产品专用参数，
    例如鞋垫的 side、protocol 与 baud_rate。默认开启有限重连（每 3 秒一次、最多 3 次），
    可用 reconnect=False 关闭。连接前须激活带 serial 功能的 SDK 授权；用完须 close()。

    分包手套有两种连接方式：同时给出 path 和 side='left' / 'right' 时直接连接；省略 path 或
    side（或 side='auto'、传入 scan）时先扫描串口，按包类型识别左右手，唯一匹配才连接。
    scan 可含 paths（候选串口）、timeout（每口采样秒数）、cancel（threading.Event）。
    其他产品不支持自动识别：未传 path 时仅在系统恰有一个串口时自动选择。
    """
    adapter = get_device_product_adapter(product)
    discovered = None
    if adapter is None or adapter.discovery is None:
        if scan is not None:
            raise invalid_config("当前产品不支持 scan 自动识别；请指定 path。", option="scan")
        session = prepare_product_connection(product, options)
    else:
        side = options.get("side")
        automatic = path is None or side is None or side == "auto" or scan is not None
        session = prepare_product_connection(product, {**options, "side": side or "auto"})
    policy = reconnect_policy(reconnect, True)
    _validate_common(path, {"on_data": on_data, "on_error": on_error, "on_state_change": on_state_change})
    if adapter is not None and adapter.discovery is not None and automatic:
        discovered = _discover(adapter, product, path, side, scan)
    _assert_license("serial")
    serial = _serial_module()
    parser = session.parser
    if discovered is not None:
        # 扫描样本不进入业务回调；正式连接从干净的解析器开始，并记住识别到的身份。
        path = discovered["path"]
        identity = {"side": discovered["side"], "packet_type": discovered["packet_type"]}
        session.info.update(identity)
        parser = _IdentityParser(adapter.discovery.create_parser(), adapter.discovery.identify, identity, path)
    else:
        path = _resolve_path(path, product=True)

    def make_parser():
        # 每次物理连接都从干净状态开始，旧连接的半包不能带进新连接。
        parser.reset()
        return parser

    return ManagedSerialDevice(serial=serial, path=path, baud_rate=session.baud_rate, info=session.info,
                               make_parser=make_parser, decode=lambda frame: frame, feature="serial",
                               policy=policy, on_data=on_data, on_error=on_error,
                               on_state_change=on_state_change)


def connect_glove(path: str | None = None, *, side: str | None = None, **options) -> ManagedSerialDevice:
    """连接分包手套；SDK 完成首尾包配对后才交付数据。

    同时给出 path 与 side='left' / 'right' 为手动直连；省略其一时自动扫描并按协议识别手侧。
    旧整包手套请使用 connect_product('handGloveFullPacket', path, side=...)，它不支持自动识别。
    """
    return connect_product("handGloveSegmented", path, side=side, **options)


def connect_hand_pad(path: str | None = None, **options) -> ManagedSerialDevice:
    """连接手部检测垫；无需 side，回调收到映射后的 32×32 矩阵。"""
    return connect_product("hand", path, **options)


def connect_managed_serial(path: str | None = None, *, reconnect=None, on_state_change=None,
                           on_frame=None, on_error=None, baud_rate: int = 1_000_000,
                           delimiter: bytes = DEFAULT_DELIMITER, min_length: int = 8,
                           max_length: int = 8192, lock_length: bool = True,
                           **decode_options) -> ManagedSerialDevice:
    """通用串口的受管理连接：使用调用方提供的协议参数，可选有限重连。

    通常经由 connect(..., reconnect=True) 调用。未传 path 时仅在恰有一个串口时自动选择。
    """
    _integer(baud_rate, "baud_rate", 1)
    options = _validate_decode_options(decode_options)
    framer_options = {"delimiter": delimiter, "min_length": min_length,
                      "max_length": max_length, "lock_length": lock_length}
    Framer(**framer_options)  # 在打开端口前校验分帧配置。
    policy = reconnect_policy(reconnect, False)
    _validate_common(path, {"on_frame": on_frame, "on_error": on_error, "on_state_change": on_state_change})
    _assert_license("serial.raw")
    serial = _serial_module()
    path = _resolve_path(path, product=False)
    info = {"rows": decode_options.get("rows"), "cols": decode_options.get("cols")}
    return ManagedSerialDevice(serial=serial, path=path, baud_rate=baud_rate, info=info,
                               make_parser=lambda: Framer(**framer_options),
                               decode=lambda payload: decode_frame(payload, **options),
                               feature="serial.raw", policy=policy, on_data=on_frame,
                               on_error=on_error, on_state_change=on_state_change)


class ProductMockDevice(_trust.FrozenSource, Device):
    """产品模拟设备：生成字节并经过真实的产品解析器，输出与真机相同结构的产品帧。

    仅支持分包手套、整包手套和手部检测垫；手套 IMU 保持零值，不生成虚构姿态。
    不占用串口，也不要求 SDK 授权；模拟数据不代表真实产品的物理量。
    """

    def __init__(self, product, **options):
        adapter = get_device_product_adapter(product)
        if adapter is not None and adapter.discovery is not None and options.get("side") not in ("left", "right"):
            # 模拟数据没有可供识别的实物，手侧只能由调用方指定。
            raise invalid_config("产品模拟请明确选择 side: left 或 right。", option="side")
        session = prepare_product_connection(product, options)
        if any(field != "side" for field in options):
            raise invalid_config("产品模拟仅支持 product 和 side。")
        name = session.info["product"]
        if name not in _MOCK_PRODUCTS:
            raise invalid_config("产品模拟仅支持分包手套、整包手套和手部检测垫。", option="product")
        glove = name != "hand"
        self._session = session
        self._segmented = name == "handGloveSegmented"
        self._wire_length = 284 if self._segmented else 278 if glove else 1028
        self._source = MockDevice(rows=16 if glove else 32, cols=16 if glove else 32)
        self._sequence = 0
        self._pending: deque = deque()
        super().__init__({**self._source.info, **session.info})
        if type(self) is ProductMockDevice:
            _trust.mark_mock_device(self)

    @property
    def bytes_received(self) -> int:
        return self._source.frame_count * self._wire_length

    @property
    def frame_count(self) -> int:
        return self._source.frame_count

    @property
    def dropped_count(self) -> int:
        return self._session.parser.dropped_count

    @property
    def frame_length(self) -> int:
        return self._session.parser.frame_length

    def _packets(self, raw: bytes) -> tuple:
        if self._segmented:
            # 分包没有设备帧序号；固定类型 2 同样可用于左/右手，点位表由显式 side 决定。
            return (bytes((1, 2)) + raw[:128] + TAIL, bytes((2, 2)) + raw[128:] + bytes(16) + TAIL)
        if self._wire_length == 278:
            sequence, self._sequence = self._sequence, (self._sequence + 1) & 255
            return (bytes((sequence, 2)) + raw + bytes(16) + TAIL,)
        return (raw + TAIL,)

    def read_frame(self, timeout: float | None = 1.0):
        """等待下一模拟帧并返回产品帧；等待超时或期间关闭返回 None。"""
        self._ensure_open()
        _timeout(timeout)
        if not self._pending:
            source = self._source.read_frame(timeout)
            if source is None:
                return None
            for packet in self._packets(source.raw):
                self._pending.extend(self._session.parser.push(packet))
        return self._pending.popleft() if self._pending else None

    def close(self) -> None:
        # 先停止本设备的读取，再关闭内部数据源：回调模式的读取线程不会在关闭瞬间看到“源已关闭而设备仍打开”。
        super().close()
        self._source.close()


def create_product_mock_device(product, **options) -> ProductMockDevice:
    """创建产品模拟设备，例如 create_product_mock_device('glove', side='left')；用完须 close()。"""
    return ProductMockDevice(product, **options)
