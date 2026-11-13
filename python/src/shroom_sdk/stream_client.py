"""产品数据客户端：连接 serve_device（或 JavaScript SDK 的 serveDevice）创建的 WS 服务。

接收 ready 握手和产品帧，通过请求 ID 关联录制命令的响应；下载走同端口 HTTP。
本模块不直接操作串口，关闭订阅也不会停止服务端正在进行的录制。
"""

from http.client import HTTPException
import json
import os
from pathlib import Path
import re
from threading import Event, RLock, Thread, current_thread
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

from ._hub import FrameHub, require_callable
from ._ws import OP_TEXT, ClientConnection, ConnectionClosed, WebSocketProtocolError, parse_json
from .errors import ShroomError, as_shroom_error, make_error
from .recording import create_recording_url, recording_from_wire
from .stream_codec import STREAM_SCHEMA, decode_stream_frame

_MAX_MESSAGE_BYTES = 8 * 1024 * 1024
_HOST = re.compile(r"[^\s/@?#]+\Z")
_CAMEL = re.compile(r"(?<!^)(?=[A-Z])")


def _stream_error(code: str, message: str, cause: BaseException | None = None) -> ShroomError:
    """为实时连接和录制操作产生可供应用判断的错误。"""
    return make_error(code, message, stage="stream", cause=cause)


def _local_info(info: dict) -> dict:
    """服务端的 camelCase 设备信息转成 snake_case 键。"""
    return {_CAMEL.sub("_", key).lower(): value for key, value in info.items() if isinstance(key, str)}


def _resolve_url(url, host, port) -> str:
    """验证 WS 地址，同时阻止把凭据或片段误放进连接。"""
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise _stream_error("INVALID_CONFIG", "WS 端口必须是 1 到 65535 的整数")
    if not isinstance(host, str) or not _HOST.match(host):
        raise _stream_error("INVALID_CONFIG", "host 应为主机名或 IP，不包含协议或路径")
    if url is None:
        url = f"ws://{host}:{port}"
    try:
        if not isinstance(url, str) or not url.strip():
            raise ValueError("empty url")
        parsed = urlsplit(url)
        valid = (parsed.scheme in ("ws", "wss") and parsed.hostname and not parsed.username
                 and not parsed.password and not parsed.fragment
                 and (parsed.port is None or 1 <= parsed.port <= 65535))
    except ValueError as cause:
        raise _stream_error("INVALID_CONFIG", "WS 地址无效", cause) from cause
    if not valid:
        raise _stream_error("INVALID_CONFIG", "仅支持不含账号、密码和片段的 ws:// 或 wss:// 地址")
    return url


def save_recording(url: str, path, *, timeout: float = 30.0) -> Path:
    """把下载地址指向的记录流式保存到 path 并返回该路径；不使用系统代理。

    先写入同目录的临时文件，完成后再改名，中途失败不会留下看似完整的文件。
    记录不存在、仍在采集或服务不可达时抛出对应的 ShroomError。
    """
    target = Path(path)
    partial = target.with_name(target.name + ".part")
    try:
        with build_opener(ProxyHandler({})).open(url, timeout=timeout) as response, open(partial, "wb") as output:
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                output.write(chunk)
        os.replace(partial, target)
        return target
    except HTTPError as exc:
        code, message = "REQUEST_FAILED", f"下载失败（HTTP {exc.code}）"
        try:
            detail = json.loads(exc.read(64 * 1024)).get("error", {})
            if isinstance(detail.get("code"), str):
                code = detail["code"]
            if isinstance(detail.get("message"), str):
                message = detail["message"]
        except (ValueError, AttributeError, OSError):
            pass
        exc.close()
        raise _stream_error(code, message, exc) from exc
    except HTTPException as exc:
        # 服务端中途断开时响应不完整；这不是 OSError，需要单独转换。
        raise _stream_error("REQUEST_FAILED", "记录下载未完成：数据服务中途断开，请确认服务仍在运行后重新下载", exc) from exc
    except (URLError, OSError, ValueError) as exc:
        raise _stream_error("REQUEST_FAILED", "记录下载失败，请检查数据服务是否在运行以及保存路径是否可写", exc) from exc
    finally:
        try:
            os.remove(partial)
        except OSError:
            pass


class StreamClient:
    """connect_stream 返回的客户端：订阅帧、远程控制同一服务端的带标签录制并下载记录。

    回调在接收线程上执行；录制控制方法会阻塞等待服务端响应，不要在数据回调里调用。
    断线不会自动重连，也不会重放开始/停止命令。可用作上下文管理器。
    """

    def __init__(self, url: str, timeout: float, on_data=None, on_error=None):
        self._url = url
        self._timeout = timeout
        self._hub = FrameHub()
        self._lock = RLock()
        self._recording_handlers: dict[int, object] = {}
        self._requests: dict[str, dict] = {}
        self._sequence = self._handler_id = 0
        self._info = None
        self._recording = None
        self._state = "connecting"
        self._intentional = False
        self._failure: ShroomError | None = None
        self._ready = Event()
        if on_error is not None:
            self._hub.on_error(on_error)
        if on_data is not None:
            self._hub.on_frame(on_data)
        try:
            self._connection = ClientConnection(url, timeout=timeout, max_size=2 * _MAX_MESSAGE_BYTES)
        except (OSError, ValueError, WebSocketProtocolError) as cause:
            self._state = "error"
            self._hub.clear()
            raise _stream_error("CONNECTION_FAILED", "无法连接数据服务，请核对地址、端口和服务是否已启动", cause) from cause
        self._thread = Thread(target=self._receive, name="shroom-stream-client", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout):
            self._fail(_stream_error("CONNECTION_FAILED", "等待数据服务 ready 握手超时"))
        if self._state != "open":
            error = self._failure or _stream_error("CONNECTION_FAILED", "数据服务连接失败")
            self._hub.clear()
            raise error

    # ------------------------------------------------------------------ 连接状态

    @property
    def info(self) -> dict | None:
        """服务端设备信息（snake_case 键），例如 product、side、source。"""
        return dict(self._info) if self._info is not None else None

    @property
    def state(self) -> str:
        """connecting / open / closed / error。"""
        return self._state

    @property
    def recording(self) -> dict | None:
        """最近一次收到的服务端录制状态快照。"""
        return dict(self._recording) if self._recording is not None else None

    @property
    def url(self) -> str:
        return self._url

    def _fail(self, error: ShroomError, next_state: str = "error") -> None:
        """中止握手或现有连接，保证所有等待中的请求都有明确结果。"""
        with self._lock:
            if self._state in ("closed", "error"):
                return
            opened = self._state == "open"
            self._state = next_state
            self._failure = error
            pending = tuple(self._requests.values())
            self._requests.clear()
        for request in pending:
            request["error"] = error
            request["event"].set()
        self._ready.set()
        # 握手阶段的失败由 connect_stream 直接抛出，不重复通知错误订阅。
        if opened and not self._intentional:
            self._hub.emit_error(error)
        self._connection.close()

    def _receive(self) -> None:
        try:
            while True:
                opcode, payload = self._connection.receive()
                if self._state in ("closed", "error"):
                    return
                self._on_message(opcode, payload)
        except ConnectionClosed:
            # 不把客户端断线误当成服务端录制已经停止。
            self._fail(_stream_error("DISCONNECTED", "WS 数据连接已断开，录制状态需重新连接后确认"), "closed")
        except Exception as exc:  # 接收线程不能静默退出，未知异常也要让等待方得到结果。
            self._fail(as_shroom_error(exc, code="CONNECTION_FAILED", stage="stream"))

    def _notify_recording(self, recording) -> None:
        """隔离应用的录制回调，避免一个回调抛错影响后续网络消息。"""
        snapshot = recording_from_wire(recording)
        with self._lock:
            self._recording = snapshot
            handlers = tuple(self._recording_handlers.values())
        for handler in handlers:
            try:
                handler(dict(snapshot) if snapshot is not None else None)
            except Exception as cause:
                self._hub.emit_error(_stream_error("CALLBACK_FAILED", "应用的 on_recording 回调执行失败", cause))

    @staticmethod
    def _response_error(value) -> ShroomError:
        """校验响应结构，原样保留服务端公开的结构化错误码。"""
        value = value if isinstance(value, dict) else {}
        code, message = value.get("code"), value.get("message")
        return _stream_error(code if isinstance(code, str) else "REQUEST_FAILED",
                             message if isinstance(message, str) else "数据服务拒绝了请求")

    def _on_message(self, opcode: int, payload: bytes) -> None:
        """解码服务端消息；损坏帧或应用回调不会终止接收。"""
        ready = self._state == "open"
        try:
            if opcode != OP_TEXT or len(payload) > _MAX_MESSAGE_BYTES:
                raise _stream_error("PARSE_FAILED", "WS 消息应为大小受限的 JSON 文本")
            message = parse_json(payload.decode("utf-8"))
            if not isinstance(message, dict):
                raise _stream_error("PARSE_FAILED", "无效的 WS 消息")
            kind = message.get("type")
            if kind == "ready":
                if message.get("schema") != STREAM_SCHEMA or not isinstance(message.get("info"), dict):
                    raise _stream_error("PARSE_FAILED", "数据服务版本或产品信息无效")
                if not ready:
                    with self._lock:
                        if self._state != "connecting":
                            return
                        self._info = _local_info(message["info"])
                        self._state = "open"
                    self._notify_recording(message.get("recording"))
                    self._ready.set()
            elif kind == "frame":
                if not ready:
                    raise _stream_error("PARSE_FAILED", "数据服务在 ready 握手前发送了数据")
                if message.get("schema") != STREAM_SCHEMA:
                    raise _stream_error("PARSE_FAILED", "数据帧版本不匹配")
                self._hub.emit(decode_stream_frame(message.get("frame")))
            elif kind == "recording":
                self._notify_recording(message.get("recording"))
            elif kind == "response":
                identifier = message.get("requestId")
                with self._lock:
                    request = self._requests.pop(identifier, None) if isinstance(identifier, str) else None
                if request is None:
                    return
                if message.get("ok") is True:
                    if request["type"] != "recording.list":
                        self._notify_recording(message.get("result"))
                    request["result"] = message.get("result")
                else:
                    request["error"] = self._response_error(message.get("error"))
                request["event"].set()
            elif kind == "error":
                self._hub.emit_error(self._response_error(message.get("error")))
        except Exception as cause:
            error = cause if isinstance(cause, ShroomError) else _stream_error("PARSE_FAILED", "WS 消息解析失败", cause)
            # 不兼容的 ready 消息无法建立可用连接；运行中的坏帧则单独报告。
            if not ready:
                self._fail(error)
            else:
                self._hub.emit_error(error)

    # ------------------------------------------------------------------ 订阅

    def on_data(self, handler):
        """订阅已解码的产品帧，返回取消订阅函数；回调在接收线程上同步执行。"""
        return self._hub.on_frame(handler)

    def on_frame(self, handler):
        """on_data 的别名。"""
        return self._hub.on_frame(handler)

    def on_error(self, handler):
        """订阅网络、解码、服务端通知或回调错误，返回取消订阅函数。"""
        return self._hub.on_error(handler)

    def on_recording(self, handler):
        """订阅服务端录制状态（snake_case 快照或 None），返回取消订阅函数。"""
        require_callable(handler, "on_recording")
        with self._lock:
            self._handler_id += 1
            identifier = self._handler_id
            self._recording_handlers[identifier] = handler

        def unsubscribe() -> None:
            with self._lock:
                self._recording_handlers.pop(identifier, None)
        return unsubscribe

    # ------------------------------------------------------------------ 录制控制

    def _request(self, kind: str, **payload):
        """发送带关联 ID 的控制请求并等待响应。

        超时只表示没收到回应，不能据此认定服务端没有执行；应先查询状态再决定是否重试。
        """
        if current_thread() is self._thread:
            raise _stream_error("INVALID_REQUEST", "不能在数据或状态回调里等待录制请求，请在其他线程调用")
        request = {"event": Event(), "type": kind, "result": None, "error": None}
        with self._lock:
            if self._state != "open":
                raise _stream_error("DISCONNECTED", "请先连接 WS 数据服务")
            self._sequence += 1
            identifier = f"python-{self._sequence}"
            self._requests[identifier] = request
        try:
            self._connection.send_text(json.dumps({"type": kind, "requestId": identifier, **payload},
                                                  ensure_ascii=False))
        except ConnectionClosed as cause:
            with self._lock:
                self._requests.pop(identifier, None)
            raise _stream_error("WRITE_FAILED", "录制请求发送失败", cause) from cause
        if not request["event"].wait(self._timeout):
            with self._lock:
                self._requests.pop(identifier, None)
            raise _stream_error("REQUEST_TIMEOUT", "录制操作等待超时，请查询服务端状态后再操作")
        if request["error"] is not None:
            raise request["error"]
        return request["result"]

    def start_recording(self, label: str) -> dict:
        """开始一次对应单个标签的服务端录制，返回会话快照；不依赖本客户端是否保持连接。"""
        if not isinstance(label, str) or not label.strip() or len(label.strip().encode("utf-16-le")) > 400:
            raise _stream_error("INVALID_CONFIG", "请输入 1 到 200 个字符的采集标签")
        return recording_from_wire(self._request("recording.start", label=label.strip()))

    def stop_recording(self) -> dict:
        """停止录制并等待写入后返回记录；从未开始时服务报错，设备与 WS 仍保留。"""
        return recording_from_wire(self._request("recording.stop"))

    def get_recording_status(self) -> dict | None:
        """主动查询服务端状态，适用于重连或操作超时后的确认。"""
        return recording_from_wire(self._request("recording.status"))

    def list_recordings(self) -> list[dict]:
        """查询持久化录制列表；重新连接后仍可取得历史记录的 ID。"""
        result = self._request("recording.list")
        return [meta for meta in map(recording_from_wire, result if isinstance(result, list) else []) if meta]

    def get_recording_url(self, recording_id: str, *, format: str = "csv") -> str:
        """用采集记录 ID 构造同主机同端口的下载地址；只拼 URL，不检查文件是否存在。"""
        return create_recording_url(self._url, recording_id, format=format)

    def download_recording(self, recording_id: str, path, *, format: str = "csv") -> Path:
        """把指定记录保存到 path 并返回该路径。

        ID 来自停止采集的结果或历史列表，不可用标签或端口代替；记录仍在采集时服务返回错误。
        """
        return save_recording(self.get_recording_url(recording_id, format=format), path,
                              timeout=max(self._timeout, 30.0))

    def close(self) -> None:
        """仅关闭本客户端的订阅，不停止服务端或其正在进行的录制；可重复调用。"""
        self._intentional = True
        self._fail(_stream_error("DISCONNECTED", "客户端已关闭连接"), "closed")
        self._hub.clear()
        with self._lock:
            self._recording_handlers.clear()
        if current_thread() is not self._thread:
            self._thread.join(timeout=1.0)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close()
        return False


def connect_stream(url: str | None = None, *, host: str = "127.0.0.1", port: int = 19999,
                   timeout: float = 10.0, on_data=None, on_error=None) -> StreamClient:
    """连接产品数据服务，收到兼容的 ready 握手后返回客户端；连接失败直接抛出。

    url 为完整的 ws:// 或 wss:// 地址，设置后优先于 host 与 port；默认连接
    ws://127.0.0.1:19999。timeout 是握手和每个控制请求的等待秒数（0.001–300）。
    on_data 收到已还原的产品帧，on_error 收到连接后的运行期错误。
    """
    url = _resolve_url(url, host, port)
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0.001 <= timeout <= 300:
        raise _stream_error("INVALID_CONFIG", "timeout 应在 0.001 到 300 秒之间")
    for name, handler in (("on_data", on_data), ("on_error", on_error)):
        if handler is not None and not callable(handler):
            raise _stream_error("INVALID_CONFIG", f"{name} 需要传入可调用对象")
    return StreamClient(url, float(timeout), on_data, on_error)
