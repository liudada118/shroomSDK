"""连接已有主项目后端的 HTTP / WebSocket 客户端，对应 JavaScript SDK 的 BackendSdkClient。

不直接读取串口或数据库；后端帧按原样交给调用方，不做 SDK 的点位映射。使用主项目的
通道订阅协议，与 serve_device 的独立产品流协议不同。本客户端不自动启动后端，也不要求
SDK 授权；鉴权与设备权限由后端负责。
"""

from http.client import HTTPException
import json
import logging
import re
from threading import RLock, Thread, current_thread
from types import MappingProxyType
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from urllib.request import ProxyHandler, Request, build_opener

from ._ws import OP_TEXT, ClientConnection, ConnectionClosed, parse_json

DEFAULT_HTTP_BASE_URL = "http://127.0.0.1:19245"
DEFAULT_WS_URL = "ws://127.0.0.1:19999"
#: 默认接口表；路由名是后端契约里的标识，保持原样。契约中的路由可覆盖默认值，调用方的 routes 优先级最高。
DEFAULT_ROUTES = MappingProxyType({
    "channels": "/api/channels",
    "wsStatus": "/api/ws/status",
    "sdkContract": "/api/sdk/contract",
    "displaySystems": "/api/display-systems",
    "displaySystemById": "/api/display-systems/:id",
    "serialPorts": "/api/serial/ports",
    "serialStatus": "/api/serial/status",
    "serialOpen": "/api/serial/open",
    "serialClose": "/api/serial/close",
    "sensorCurrent": "/api/sensor/current",
    "sensorType": "/api/sensor/type",
    "collectionStart": "/api/collection/start",
    "collectionStop": "/api/collection/stop",
})
_UNSET = object()
_ROUTE_PARAMETER = re.compile(r":([A-Za-z_]\w*)")
_logger = logging.getLogger("shroom_sdk")


class BackendError(Exception):
    """后端请求或实时连接失败；status 为 HTTP 状态码（没有响应时为 None）。"""

    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


def normalize_http_result(payload):
    """解开后端的 {code, data} 包装；非零 code 抛错，没有包装的数据按原样返回。"""
    if not isinstance(payload, dict) or "code" not in payload:
        return payload
    if payload["code"] != 0:
        raise BackendError(str(payload.get("message") or payload.get("error") or f"Backend error {payload['code']}"))
    return payload.get("data")


def _backend_url(value, schemes: tuple) -> str:
    """校验后端地址协议，拒绝夹带凭据、查询参数或片段，统一去掉尾部斜线。"""
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme in schemes and parsed.hostname and not parsed.username
                 and not parsed.password and not parsed.query and not parsed.fragment)
        parsed.port  # 端口非法时在这里抛出 ValueError。
    except (ValueError, AttributeError, TypeError):
        valid = False
    if not valid:
        raise ValueError(f"Invalid backend URL: use {' or '.join(schemes)} without credentials, query or fragment")
    return value.rstrip("/")


def _backend_timeout(value) -> float:
    """HTTP 请求与 WS 建连共用的正秒数校验。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value < float("inf"):
        raise ValueError("timeout must be a positive number of seconds")
    return float(value)


def _backend_channels(value) -> list[str]:
    """将单通道或通道序列统一为去重列表；仅校验名称，不改变通道标识。"""
    channels = [value] if isinstance(value, str) else value
    if not isinstance(channels, (list, tuple)) or any(not isinstance(item, str) or not item.strip() for item in channels):
        raise ValueError("channels must be a string or a sequence of non-empty strings")
    return list(dict.fromkeys(channels))


class BackendSdkClient:
    """后端客户端：HTTP 负责查询 / 控制，WS 负责通道订阅及原始帧事件。

    构造时不连接网络；调用 request / get_contract / connect_realtime 等方法才发起请求。
    timeout 以秒为单位。opener 可注入带 open(request, timeout=...) 的对象（默认不使用系统
    代理）；connection_factory 可注入 WebSocket 连接实现，供测试或特殊网络环境使用。
    """

    def __init__(self, *, http_base_url: str = DEFAULT_HTTP_BASE_URL, ws_url: str = DEFAULT_WS_URL,
                 contract: dict | None = None, routes: dict | None = None, headers: dict | None = None,
                 timeout: float = 10.0, opener=None, connection_factory=None):
        self.http_base_url = _backend_url(http_base_url, ("http", "https"))
        self.ws_url = _backend_url(ws_url, ("ws", "wss"))
        self.timeout = _backend_timeout(timeout)
        self.headers = dict(headers or {})
        self.contract = contract
        self.route_overrides = dict(routes or {})
        self.routes = self._merge_routes(contract)
        self._opener = opener if opener is not None else build_opener(ProxyHandler({}))
        self._connection_factory = connection_factory or ClientConnection
        self._lock = RLock()
        self._listeners: dict[str, list] = {}
        self._connection = None
        self._generation = 0
        self._realtime_state = "closed"
        self._pending_channels: list[str] = []
        self._thread = None

    def _merge_routes(self, contract) -> dict:
        contract_routes = {}
        if isinstance(contract, dict) and isinstance(contract.get("http"), dict):
            contract_routes = contract["http"].get("routes") or {}
        return {**DEFAULT_ROUTES, **contract_routes, **self.route_overrides}

    # ------------------------------------------------------------------ 事件

    def on(self, event: str, handler):
        """注册事件监听并返回客户端自身。事件：open、close、error、message、frame、raw。

        实时事件在接收线程上触发；监听器抛出的异常会转交 error 事件，不会中断接收。
        """
        if not callable(handler):
            raise TypeError("event handler must be callable")
        with self._lock:
            self._listeners.setdefault(event, []).append(handler)
        return self

    def off(self, event: str, handler):
        """移除指定监听器，也支持通过原处理函数移除 once 的包装。"""
        with self._lock:
            listeners = self._listeners.get(event, [])
            self._listeners[event] = [item for item in listeners
                                      if item is not handler and getattr(item, "original", None) is not handler]
        return self

    def once(self, event: str, handler):
        """只触发一次；调用处理函数前先移除，避免重入时重复执行。"""
        if not callable(handler):
            raise TypeError("event handler must be callable")

        def wrapper(*args):
            self.off(event, wrapper)
            handler(*args)
        wrapper.original = handler
        return self.on(event, wrapper)

    def remove_all_listeners(self, event: str | None = None):
        """传事件名只清理该事件；省略参数清理所有事件监听。"""
        with self._lock:
            if event is None:
                self._listeners.clear()
            else:
                self._listeners.pop(event, None)
        return self

    def emit(self, event: str, *args) -> None:
        """基于当前监听器快照分发，回调期间增删监听不影响这一轮遍历。"""
        with self._lock:
            handlers = tuple(self._listeners.get(event, ()))
        for handler in handlers:
            handler(*args)

    def _emit_safely(self, event: str, *args) -> None:
        """接收线程上的分发：监听器异常转交 error 事件，error 监听器自身出错只记日志。"""
        try:
            self.emit(event, *args)
        except Exception as exc:
            if event == "error":
                _logger.exception("[shroom] backend error listener failed")
            else:
                self._emit_safely("error", exc)

    # ------------------------------------------------------------------ HTTP

    def route(self, name: str, params: dict | None = None) -> str:
        """查找命名路由并编码替换 :id 等路径参数，缺少参数时立即抛错。"""
        template = self.routes.get(name)
        if not isinstance(template, str):
            raise BackendError(f"Unknown backend route: {name}")
        params = params or {}

        def replace(match):
            key = match.group(1)
            if params.get(key) is None:
                raise BackendError(f"Missing route parameter: {key}")
            return quote(str(params[key]), safe="")
        return _ROUTE_PARAMETER.sub(replace, template)

    def request(self, route_or_name: str, *, method: str = "GET", body=_UNSET, query: dict | None = None,
                raw: bool = False, route_params: dict | None = None, headers: dict | None = None,
                timeout: float | None = None):
        """请求命名路由或根相对路径；body 自动编码为 JSON，query 添加到查询串。

        默认返回解包后的 data；raw=True 时仍校验业务错误，但保留完整响应对象。
        写操作不自动重试。失败抛出 BackendError。
        """
        path = route_or_name if route_or_name.startswith("/") else self.route(route_or_name, route_params)
        # 包括后端契约提供的路由，也必须是配置后端上的根相对路径。
        if not path.startswith("/") or path.startswith("//") or "\\" in path:
            raise ValueError("Backend routes must be root-relative paths")
        timeout = self.timeout if timeout is None else _backend_timeout(timeout)
        parts = urlsplit(self.http_base_url + path)
        pairs = parse_qsl(parts.query, keep_blank_values=True)
        names = {key for key, value in (query or {}).items() if value is not None}
        pairs = [pair for pair in pairs if pair[0] not in names] + [
            (key, str(value)) for key, value in (query or {}).items() if value is not None]
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(pairs), ""))
        request_headers = {**self.headers, **(headers or {})}
        data = None
        if body is not _UNSET:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            request_headers = {key: value for key, value in request_headers.items() if key.lower() != "content-type"}
            request_headers["Content-Type"] = "application/json"
        request = Request(url, data=data, method=method, headers=request_headers)
        try:
            with self._opener.open(request, timeout=timeout) as response:
                status, text = response.status, response.read().decode("utf-8", "replace")
        except HTTPError as exc:
            status, text = exc.code, exc.read().decode("utf-8", "replace")
            exc.close()
        except TimeoutError as exc:
            raise BackendError("Backend HTTP request timed out") from exc
        except URLError as exc:
            if isinstance(exc.reason, TimeoutError):
                raise BackendError("Backend HTTP request timed out") from exc
            raise BackendError(f"Backend HTTP request failed: {exc.reason}") from exc
        except (OSError, HTTPException) as exc:
            # HTTPException 覆盖响应被截断等情况，它不是 OSError。
            raise BackendError(f"Backend HTTP request failed: {exc!r}") from exc
        ok = 200 <= status < 300
        try:
            payload = parse_json(text) if text else None
        except ValueError as exc:
            raise BackendError("Backend returned invalid JSON" if ok
                               else f"HTTP {status}: backend returned non-JSON data", status=status) from exc
        if not ok:
            detail = payload if isinstance(payload, dict) else {}
            raise BackendError(str(detail.get("message") or detail.get("error") or f"HTTP {status}"), status=status)
        result = normalize_http_result(payload)
        return payload if raw else result

    def get_contract(self, *, refresh: bool = False) -> dict:
        """获取并缓存后端契约；refresh 强制刷新，显式 routes 配置仍保持最高优先级。"""
        if self.contract and not refresh:
            return self.contract
        contract = self.request("sdkContract")
        if not isinstance(contract, dict):
            raise BackendError("Invalid backend contract")
        self.contract = contract
        self.routes = self._merge_routes(contract)
        return contract

    def get_channels(self):
        """查询通道配置，保留后端完整响应格式。"""
        return self.request("channels", raw=True)

    def get_ws_status(self):
        """查询后端 WS 服务状态，保留完整响应格式。"""
        return self.request("wsStatus", raw=True)

    def list_display_systems(self):
        """列出已有展示系统，保留完整响应格式。"""
        return self.request("displaySystems", raw=True)

    def get_display_system(self, identifier):
        """按 ID 读取展示系统；ID 会经过 URL 路径编码。"""
        return self.request("displaySystemById", raw=True, route_params={"id": identifier})

    def list_serial_ports(self):
        """查询运行后端的电脑上的串口，不是本机的串口。"""
        return self.request("serialPorts")

    def get_serial_status(self, role: str | None = None):
        """查询指定角色的串口状态；省略 role 时交由后端决定查询范围。"""
        return self.request("serialStatus", query={"role": role})

    def get_current_sensor(self):
        """获取后端当前传感器类型。"""
        return self.request("sensorCurrent")

    def set_sensor_type(self, sensor_type):
        """显式请求后端切换传感器类型，会改变后端配置。"""
        return self.request("sensorType", method="POST", body={"type": sensor_type})

    def open_serial(self, *, role: str = "sit", port: str | None = None, path: str | None = None,
                    port_path: str | None = None):
        """请求后端打开角色对应串口；兼容 port / path / port_path，优先使用 port。"""
        selected = port or path or port_path
        if not selected:
            raise ValueError("open_serial requires a port")
        return self.request("serialOpen", method="POST", body={"role": role, "port": selected})

    def close_serial(self, *, role: str = "sit"):
        """请求后端关闭指定角色的串口，默认角色为 sit。"""
        return self.request("serialClose", method="POST", body={"role": role})

    def start_collection(self, options: dict | None = None):
        """调用主项目的采集接口，options 按其契约原样发送；不同于独立数据流的 start_recording。"""
        return self.request("collectionStart", method="POST", body=options or {})

    def stop_collection(self):
        """请求主项目停止采集；具体返回结果由该后端定义。"""
        return self.request("collectionStop", method="POST", body={})

    # ------------------------------------------------------------------ 实时连接

    @property
    def realtime_state(self) -> str:
        """实时连接状态：closed、connecting 或 open。"""
        return self._realtime_state

    def connect_realtime(self, channels=(), *, timeout: float | None = None, protocols=None) -> None:
        """在后台建立或复用 WS 连接并立即返回；通过 open / error / close 事件观察结果。

        channels 在连接成功后订阅。此操作不会自动打开后端串口，也不会调用 start_collection。
        """
        requested = _backend_channels(list(channels) if not isinstance(channels, str) else channels)
        timeout = self.timeout if timeout is None else _backend_timeout(timeout)
        if protocols is not None and not (isinstance(protocols, str) and protocols) and not (
                isinstance(protocols, (list, tuple)) and protocols
                and all(isinstance(item, str) and item for item in protocols)):
            raise ValueError("protocols must be a non-empty string or a sequence of non-empty strings")
        with self._lock:
            if self._realtime_state == "open":
                subscribe_now = bool(requested)
            elif self._realtime_state == "connecting":
                self._pending_channels = _backend_channels([*self._pending_channels, *requested])
                return
            else:
                subscribe_now = False
                self._generation += 1
                generation = self._generation
                self._realtime_state = "connecting"
                self._pending_channels = requested
                self._thread = Thread(target=self._run_realtime, args=(generation, timeout, protocols),
                                      name="shroom-backend-realtime", daemon=True)
                self._thread.start()
        if subscribe_now:
            self.subscribe(requested)

    def _run_realtime(self, generation: int, timeout: float, protocols) -> None:
        try:
            connection = self._connection_factory(self.ws_url, timeout=timeout, protocols=protocols)
        except Exception as exc:  # 任何建连失败都必须让状态回到 closed，否则客户端会一直停在 connecting。
            with self._lock:
                if generation != self._generation:
                    return
                self._realtime_state = "closed"
                self._pending_channels = []
            message = ("Backend WebSocket connection timed out" if isinstance(exc, TimeoutError)
                       else f"Backend WebSocket connection failed: {exc}")
            self._emit_safely("error", BackendError(message))
            self._emit_safely("close", {"code": 1006, "reason": "", "was_clean": False})
            return
        with self._lock:
            if generation != self._generation:
                connection.close()
                return
            self._connection = connection
            self._realtime_state = "open"
            pending, self._pending_channels = self._pending_channels, []
        try:
            # 先完成排队订阅再通知 open，避免 open 回调主动断开后继续使用旧连接。
            if pending:
                self.subscribe(pending)
        except BackendError as exc:
            self._emit_safely("error", exc)
        self._emit_safely("open")
        code, reason = 1006, ""
        try:
            while True:
                opcode, payload = connection.receive()
                if generation != self._generation:
                    return
                self._dispatch(payload.decode("utf-8", "replace") if opcode == OP_TEXT else payload)
        except ConnectionClosed as closed:
            code, reason = closed.code, closed.reason
        with self._lock:
            if generation != self._generation:
                return
            self._generation += 1
            self._connection = None
            self._realtime_state = "closed"
        self._emit_safely("close", {"code": code, "reason": reason, "was_clean": code != 1006})

    def _dispatch(self, raw_message) -> None:
        try:
            self.handle_realtime_message(raw_message)
        except Exception as exc:
            self._emit_safely("error", exc)

    def disconnect_realtime(self) -> None:
        """关闭本客户端的订阅连接；不向后端发送关闭串口或停止采集指令。"""
        with self._lock:
            if self._realtime_state == "closed":
                return
            self._generation += 1
            connection, self._connection = self._connection, None
            self._realtime_state = "closed"
            self._pending_channels = []
            thread = self._thread
        if connection is not None:
            connection.close()
        if thread is not None and thread is not current_thread():
            thread.join(timeout=1.0)
        self.emit("close", {"code": 1000, "reason": "client disconnect", "was_clean": False})

    def send_realtime(self, message) -> None:
        """仅在连接已打开时发送 JSON；连接中或已关闭时抛错。"""
        with self._lock:
            connection = self._connection if self._realtime_state == "open" else None
        if connection is None:
            raise BackendError("WebSocket is not connected")
        try:
            connection.send_text(json.dumps(message, ensure_ascii=False))
        except ConnectionClosed as exc:
            raise BackendError("WebSocket is not connected") from exc

    def _message_type(self, name: str, default: str) -> str:
        contract = self.contract if isinstance(self.contract, dict) else {}
        types = (contract.get("websocket") or {}).get("messageTypes") or {}
        return types.get(name) or default

    def subscribe(self, channels) -> None:
        """订阅通道；消息类型优先使用后端契约中的 SUBSCRIBE。"""
        self.send_realtime({"type": self._message_type("SUBSCRIBE", "subscribe"),
                            "channels": _backend_channels(channels)})

    def unsubscribe(self, channels) -> None:
        """取消通道订阅，不关闭 WS，也不停止后端采集。"""
        self.send_realtime({"type": self._message_type("UNSUBSCRIBE", "unsubscribe"),
                            "channels": _backend_channels(channels)})

    def handle_realtime_message(self, raw_message) -> None:
        """分发完整 message 与逐帧 frame；无法解析的文本进入 raw 事件，帧内容不做 SDK 映射。"""
        message = raw_message
        if isinstance(raw_message, str):
            try:
                message = parse_json(raw_message)
            except ValueError:
                self.emit("raw", raw_message)
                return
        self.emit("message", message)
        if isinstance(message, dict):
            if isinstance(message.get("frames"), list):
                for frame in message["frames"]:
                    self.emit("frame", frame)
            elif any(key in message for key in ("channelId", "portId", "value")):
                self.emit("frame", message)
