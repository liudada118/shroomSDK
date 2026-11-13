"""产品流服务：订阅已有设备，广播 WS 帧，并管理带标签录制与同端口 HTTP 下载。

线上协议与 JavaScript SDK 的 serveDevice 相同（shroom.frame.v1），浏览器端的
shroom-sdk 可以直接连接本服务。只使用标准库：HTTP 与 WebSocket 共用一个端口。
"""

import base64
import binascii
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from math import isfinite
import os
import re
import socket
from threading import Condition, Event, Lock, RLock, Thread, Timer
from time import monotonic
from urllib.parse import urlsplit

from . import _trust
from ._hub import logger
from ._ws import (OP_BINARY, OP_CLOSE, OP_PING, OP_PONG, OP_TEXT, MessageReader,
                  WebSocketProtocolError, accept_key, close_payload, encode_frame, force_close,
                  parse_close, parse_json, read_exactly)
from .errors import ShroomError, make_error
from .license import _assert_license, _subscribe_license
from .recording import (RECORDING_ID, RecordingStore, create_recording_url, recording_csv,
                        recording_jsonl, recording_to_wire)
from .stream_codec import STREAM_SCHEMA, encode_stream_frame

DEFAULT_PORT = 19999
_MAX_CONTROL_BYTES = 64 * 1024
_DOWNLOAD_CHUNK = 64 * 1024
_RECORDING_PATH = re.compile(r"/recordings/([^/]+)\.(csv|jsonl)\Z")
_SECURITY_HEADERS = (("X-Content-Type-Options", "nosniff"), ("Cache-Control", "no-store"), ("Vary", "Origin"))


def _dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _public_error(error) -> dict:
    """WS / HTTP 只发送错误码与消息，不传内部堆栈和完整异常对象。"""
    return {"code": getattr(error, "code", None) or "SERVER_ERROR", "message": str(error) or "服务操作失败。"}


def _is_loopback(host) -> bool:
    """识别明确的本机回环地址，用于默认监听与来源校验。"""
    return isinstance(host, str) and host.lower() in ("127.0.0.1", "localhost", "::1", "[::1]")


def _exact_origin(origin) -> bool:
    """只接受形如 http://host[:port] 的明确来源：不含路径、凭据、通配符，也不接受 null。"""
    if not isinstance(origin, str) or origin == "null":
        return False
    try:
        parsed = urlsplit(origin)
        host, port = parsed.hostname, parsed.port
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not host:
        return False
    if port == (80 if parsed.scheme == "http" else 443):
        port = None
    authority = (f"[{host}]" if ":" in host else host) + (f":{port}" if port else "")
    return f"{parsed.scheme}://{authority}" == origin


def _wire_key(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def _wire_info(info) -> dict:
    """设备信息转成 JavaScript 端使用的 camelCase 键；只保留可直接序列化的标量。"""
    if not isinstance(info, dict):
        return {}
    # JSON 不能表示 NaN / 无穷大；与 JSON.stringify 一样写成 null，不让一个字段使握手失败。
    return {_wire_key(key): None if isinstance(value, float) and not isfinite(value) else value
            for key, value in info.items()
            if isinstance(key, str) and (value is None or isinstance(value, (str, int, float, bool)))}


def _discard_inbound(sock, seconds: float) -> None:
    """关闭帧发出后读掉对端仍在发送的数据，直到对端断开或超时。

    带着未读数据关闭套接字会让连接被重置，对端可能收不到刚发出的关闭码。
    """
    deadline = monotonic() + seconds
    try:
        while True:
            remaining = deadline - monotonic()
            if remaining <= 0:
                return
            sock.settimeout(remaining)
            if not sock.recv(65536):
                return
    except (OSError, ValueError):
        return


def _server_options(port, host, recordings_dir, allowed_origins, max_buffered_bytes, max_queue_frames):
    """在创建录制目录和订阅设备前校验配置，避免错误参数留下资源。"""
    def integer(value, low, high):
        return not isinstance(value, bool) and isinstance(value, int) and low <= value <= high
    if recordings_dir is None:
        recordings_dir = os.path.abspath(".shroom-recordings")
    if (not integer(port, 0, 65535) or not isinstance(host, str) or not host.strip()
            or not isinstance(recordings_dir, (str, os.PathLike)) or not str(recordings_dir).strip()
            or not integer(max_buffered_bytes, 1024, 2 ** 53) or not integer(max_queue_frames, 1, 100000)):
        raise make_error("INVALID_CONFIG", "检查端口、主机、录制目录和缓冲区限制。", stage="configure")
    if allowed_origins is not None:
        if isinstance(allowed_origins, str) or not isinstance(allowed_origins, (list, tuple)) or not all(
                _exact_origin(origin) for origin in allowed_origins):
            raise make_error("INVALID_CONFIG", "allowed_origins 必须是明确的 HTTP/HTTPS origin 列表，不能使用通配符。",
                             stage="configure")
        allowed_origins = tuple(allowed_origins)
    if not _is_loopback(host) and not allowed_origins:
        raise make_error("INVALID_CONFIG", "非本机服务必须显式设置 allowed_origins，限定允许接入的网页来源。",
                         stage="configure")
    return port, host, os.fspath(recordings_dir), allowed_origins


class _Client:
    """一个 WS 连接的发送端：独立写线程加有界队列，慢客户端不会拖住设备读取线程。"""

    def __init__(self, sock, max_buffered: int):
        self._socket = sock
        self._max_buffered = max_buffered
        self._queue: deque = deque()
        self._buffered = 0
        self._condition = Condition()
        self._closing = self._closed = False
        self._timer = None
        self._writer = Thread(target=self._run, name="shroom-ws-writer", daemon=True)
        self._writer.start()

    def send(self, frame: bytes) -> None:
        """排队一个已编码的帧；待发送字节超限时主动断开，防止缓冲区无限增长。"""
        with self._condition:
            if self._closing or self._closed:
                return
            if self._buffered + len(frame) <= self._max_buffered:
                self._queue.append(frame)
                self._buffered += len(frame)
                self._condition.notify()
                return
        self.close(1013, "客户端读取过慢，请重新连接")

    def close(self, code: int, reason: str = "") -> None:
        """丢弃未发送的数据，发送关闭帧后断开；对端不读取时 1 秒后强制断开。"""
        with self._condition:
            if self._closing or self._closed:
                return
            self._closing = True
            self._queue.clear()
            self._queue.append(encode_frame(OP_CLOSE, close_payload(code, reason)))
            self._queue.append(None)
            self._condition.notify()
            self._timer = Timer(1.0, self.terminate)
            self._timer.daemon = True
            self._timer.start()

    def terminate(self) -> None:
        with self._condition:
            if self._closed:
                return
            self._closed = True
            self._condition.notify()
            if self._timer is not None:
                self._timer.cancel()
        force_close(self._socket)

    def drain(self, timeout: float) -> None:
        """等待关闭帧发出；超时后由调用方强制断开。"""
        self._writer.join(timeout)

    def _run(self) -> None:
        while True:
            with self._condition:
                while not self._queue and not self._closed:
                    self._condition.wait()
                if self._closed:
                    return
                frame = self._queue.popleft()
            if frame is None:
                # 关闭帧已发出：只关闭发送方向，由读取方读完对端剩余数据后再断开（或由定时器强制断开）。
                try:
                    self._socket.shutdown(socket.SHUT_WR)
                except OSError:
                    pass
                return
            try:
                self._socket.sendall(frame)
            except OSError:
                self.terminate()
                return
            with self._condition:
                self._buffered = max(0, self._buffered - len(frame))


class _HttpServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32
    # Windows 上 SO_REUSEADDR 允许多个进程绑定同一端口，端口占用会被悄悄忽略。
    allow_reuse_address = os.name != "nt"

    def __init__(self, address, handler, app):
        self.app = app
        self.address_family = socket.AF_INET6 if ":" in address[0] else socket.AF_INET
        super().__init__(address, handler)

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def handle_error(self, request, client_address):
        # 连接层异常只影响该连接，不向标准错误输出堆栈；需要排查时打开 shroom_sdk 的 DEBUG 日志。
        logger.debug("[shroom] 数据服务连接处理出错", exc_info=True)


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ShroomSDK"
    sys_version = ""
    timeout = 30  # 只限制请求头的读取；WS 与下载开始后改为不限时。

    def log_message(self, *args):
        pass

    def handle(self):
        # 一个连接只处理一个请求。请求正文从不读取；如果保持连接，正文会被当成下一个请求解析，
        # 网页就能借此绕过来源与 Host 校验。
        self.handle_one_request()

    def setup(self):
        super().setup()
        self.server.app._track(self.connection)

    def finish(self):
        try:
            super().finish()
        except (OSError, ValueError):
            pass
        finally:
            self.server.app._untrack(self.connection)

    def do_GET(self):
        if self.headers.get("Upgrade"):
            self.server.app._handle_upgrade(self)
        else:
            self.server.app._handle_http(self)

    def _other(self):
        self.server.app._handle_http(self)

    do_OPTIONS = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = _other


class StreamServer:
    """serve_device 返回的服务对象：提供地址、采集控制和关闭方法。

    host / port / url / http_url 描述实际监听地址。关闭服务会写完记录并断开客户端，
    但不会关闭调用方的设备。可用作上下文管理器。
    """

    def __init__(self, device, *, port, host, recordings_dir, allowed_origins,
                 max_buffered_bytes, max_queue_frames):
        self._device = device
        self._allowed_origins = allowed_origins
        self._max_buffered = max_buffered_bytes
        self._bind_host = host
        self._mock = _trust.is_mock_device(device)
        self._source_feature = _trust.get_device_license_feature(device) or "serial.raw"
        self._source_license_error = None
        self._source_failure_revision = 0
        self._state_lock = RLock()
        self._control_lock = Lock()
        self._clients: set[_Client] = set()
        self._sockets: set = set()
        self._closed = False
        self._closing = False
        self._closed_event = Event()
        self._stop_event = Event()
        self._unsubscribe_data = self._unsubscribe_error = self._unsubscribe_license = None
        self._http = None
        self._serving = False
        self._network_down = False
        subscribe = getattr(device, "on_data", None) or getattr(device, "on_frame", None)
        if not callable(subscribe):
            raise make_error("INVALID_CONFIG", "serve_device 需要一个提供 on_data 或 on_frame 的设备。",
                             stage="configure")
        self._assert_source_license()
        try:
            self._recorder = RecordingStore(recordings_dir, max_queue_frames=max_queue_frames,
                                            on_change=self._recording_changed)
        except ShroomError:
            raise
        except Exception as cause:
            raise make_error("RECORDING_WRITE_FAILED", "无法打开录制目录，请检查目录权限和磁盘空间。",
                             stage="recording", cause=cause) from cause
        try:
            self._assert_source_license()
            try:
                self._http = _HttpServer((host.strip("[]"), port), _Handler, self)
            except OSError as cause:
                raise make_error("SERVER_START_FAILED", f"无法启动 WS 服务：{cause}", stage="serve", cause=cause,
                                 suggestion="请检查端口是否被占用、主机地址是否属于本机，或改用其他端口。",
                                 details={"errno": cause.errno}) from cause
            self.host = host
            self.port = self._http.server_address[1]
            authority = f"[{host.strip('[]')}]" if ":" in host else host
            self.url = f"ws://{authority}:{self.port}"
            self.http_url = f"http://{authority}:{self.port}"
            Thread(target=self._http.serve_forever, kwargs={"poll_interval": 0.1},
                   name="shroom-stream-server", daemon=True).start()
            self._serving = True
            self._assert_source_license()
            self._unsubscribe_data = subscribe(self._on_frame)
            on_error = getattr(device, "on_error", None)
            if callable(on_error):
                self._unsubscribe_error = on_error(self._on_source_error)
            if not self._mock:
                self._unsubscribe_license = _subscribe_license(self._license_changed)
            self._assert_source_license()
        except BaseException:
            self._closed = self._closing = True
            self._detach_source()
            self._shutdown_network()
            try:
                self._recorder.close()
            except ShroomError:
                pass
            self._closed_event.set()
            raise
        Thread(target=self._tick, name="shroom-recording-status", daemon=True).start()

    # ------------------------------------------------------------------ 授权与数据源

    def _assert_source_license(self) -> None:
        """内置模拟源免许可；真实源同时要求设备读取权限和 stream 权限。"""
        if self._mock:
            return
        if self._source_license_error is not None:
            raise self._source_license_error
        _assert_license(self._source_feature)
        _assert_license("stream")

    def _assert_recording_license(self) -> None:
        """录制在读取和流权限之外，还需要 recording 权限。"""
        self._assert_source_license()
        if not self._mock:
            _assert_license("recording")

    def _assert_source_connected(self) -> None:
        """重连期间不能创建空记录；未提供 state 的自定义数据源保持既有契约。"""
        state = getattr(self._device, "state", None)
        if state is not None and state != "open":
            raise make_error("DISCONNECTED", "设备未连接或正在重连，请恢复连接后重新开始采集。", stage="recording")

    def _detach_source(self) -> None:
        """解除数据、错误和授权订阅，隔离自定义数据源的清理异常。"""
        with self._state_lock:
            subscriptions = (self._unsubscribe_data, self._unsubscribe_error, self._unsubscribe_license)
            self._unsubscribe_data = self._unsubscribe_error = self._unsubscribe_license = None
        for unsubscribe in subscriptions:
            if callable(unsubscribe):
                try:
                    unsubscribe()
                except Exception:
                    pass  # 源的清理失败不妨碍服务继续释放自身资源。

    def _license_changed(self) -> None:
        if self._closed:
            return
        try:
            self._assert_source_license()
        except ShroomError as error:
            self._source_license_invalid(error)
            return
        if self._recorder.is_recording:
            try:
                _assert_license("recording")
            except ShroomError as error:
                self._recording_license_invalid(error)

    def _source_license_invalid(self, error) -> None:
        """设备或流授权失效时停止实时订阅并终止采集，保留历史文件下载能力。"""
        with self._state_lock:
            if self._closed or self._source_license_error is not None:
                return
            self._source_license_error = error
        self._detach_source()
        self._broadcast({"type": "error", "error": _public_error(error)})
        self._recorder.abort(error, wait=False)

    def _recording_license_invalid(self, error) -> None:
        """单独失去录制权限时结束当前记录；获得独立授权的实时查看仍可继续。"""
        if self._closed:
            return
        self._broadcast({"type": "error", "error": _public_error(error)})
        self._recorder.abort(error, wait=False)

    def _on_frame(self, frame) -> None:
        """设备读取线程上的数据入口：同一份序列化帧同时交给录制器和实时广播。"""
        if self._closed or self._source_license_error is not None:
            return
        try:
            self._assert_source_license()
        except ShroomError as error:
            self._source_license_invalid(error)
            return
        recording = self._recorder.is_recording
        if not recording and not self._clients:
            return  # 没有观看者也没有采集时不做编码。
        try:
            wire = encode_stream_frame(frame)
            text = _dumps(wire)
            self._assert_source_license()
            if recording:
                try:
                    self._assert_recording_license()
                    self._recorder.append(wire, text)
                except ShroomError as error:
                    self._recording_license_invalid(error)
            self._broadcast_text('{"type":"frame","schema":"' + STREAM_SCHEMA + '","frame":' + text + "}")
        except Exception as error:
            if getattr(error, "stage", None) == "license":
                self._source_license_invalid(error)
                return
            self._broadcast({"type": "error", "error": _public_error(error)})
            self._recorder.abort(error, wait=False)

    def _on_source_error(self, error) -> None:
        self._broadcast({"type": "error", "error": _public_error(error)})
        if getattr(error, "code", None) != "CALLBACK_FAILED":
            self._source_failure_revision += 1
            if self._recorder.is_recording:
                self._recorder.abort(error, wait=False)

    # ------------------------------------------------------------------ 广播

    def _broadcast_text(self, text: str) -> None:
        """一次编码后广播给所有客户端，避免为每个订阅者重复序列化。"""
        with self._state_lock:
            clients = tuple(self._clients)
        if clients:
            frame = encode_frame(OP_TEXT, text.encode("utf-8"))
            for client in clients:
                client.send(frame)

    def _broadcast(self, message: dict) -> None:
        try:
            self._broadcast_text(_dumps(message))
        except (TypeError, ValueError):
            pass

    def _recording_changed(self, recording: dict) -> None:
        self._broadcast({"type": "recording", "recording": recording_to_wire(recording)})

    def _tick(self) -> None:
        """采集进度按已提交到 SQLite 的帧数广播，与观看端渲染帧数无关。"""
        while not self._stop_event.wait(1.0):
            recording = self._recorder.status()
            if recording and recording["status"] == "recording":
                self._recording_changed(recording)

    # ------------------------------------------------------------------ 采集控制

    def start_recording(self, label: str) -> dict:
        """校验权限并开始带标签采集，返回会话快照；保存不依赖是否有网页连接。

        所有来源（本进程和各个客户端）的起停操作串行执行，避免互相覆盖。
        """
        with self._control_lock:
            if self._closed:
                raise make_error("SERVER_CLOSED", "服务已关闭。", stage="serve")
            self._assert_recording_license()
            self._assert_source_connected()
            revision = self._source_failure_revision
            info = self._device.info if isinstance(getattr(self._device, "info", None), dict) else {}
            result = self._recorder.start(label, product=info.get("product"), side=info.get("side"),
                                          source=info.get("source"))
            try:
                if self._closed:
                    raise make_error("SERVER_CLOSED", "服务已关闭。", stage="serve")
                self._assert_recording_license()
                self._assert_source_connected()
                if revision != self._source_failure_revision:
                    raise make_error("RECORDING_INTERRUPTED", "开始采集期间设备断开，请确认设备恢复后重新开始。",
                                     stage="recording")
            except ShroomError as error:
                self._recorder.abort(error)
                raise
            return result

    def stop_recording(self) -> dict:
        """等待缓冲帧和最终状态写入后返回记录；不会停止设备或 WS 数据流。"""
        with self._control_lock:
            if self._closed:
                raise make_error("SERVER_CLOSED", "服务已关闭。", stage="serve")
            return self._recorder.stop()

    def list_recordings(self) -> list[dict]:
        """查询历史及活动记录，只返回会话元信息，不暴露服务器文件路径。"""
        with self._control_lock:
            if self._closed:
                raise make_error("SERVER_CLOSED", "服务已关闭。", stage="serve")
            return self._recorder.list()

    def get_recording_status(self) -> dict | None:
        """直接读取本进程最近一次采集状态，不经过网络。"""
        return self._recorder.status()

    def get_recording_url(self, recording_id: str, *, format: str = "csv") -> str:
        """只返回指定记录的同源下载地址；不检查记录存在性，也不发起下载。"""
        return create_recording_url(self.http_url, recording_id, format=format)

    # ------------------------------------------------------------------ HTTP

    def _track(self, sock) -> None:
        with self._state_lock:
            if not self._network_down:
                self._sockets.add(sock)
                return
        force_close(sock)  # 关闭服务的同时才被接受的连接：不能在 close() 返回后继续收发。

    def _untrack(self, sock) -> None:
        with self._state_lock:
            self._sockets.discard(sock)

    def _origin_allowed(self, origin) -> bool:
        """优先采用显式网页来源白名单；默认仅允许 HTTP/HTTPS 的本机页面来源。"""
        if origin is None:
            return True  # 原生客户端通常不发送 Origin。
        if self._allowed_origins is not None:  # 空列表表示不允许任何网页来源。
            return origin in self._allowed_origins
        try:
            parsed = urlsplit(origin)
            return parsed.scheme in ("http", "https") and _is_loopback(parsed.hostname)
        except ValueError:
            return False

    def _request_allowed(self, headers) -> bool:
        """同时校验 Origin 与回环服务的 Host，防止外部域名绕过本机访问约束。"""
        if not self._origin_allowed(headers.get("Origin")):
            return False
        if not _is_loopback(self._bind_host):
            return True
        try:
            return _is_loopback(urlsplit("http://" + (headers.get("Host") or "")).hostname)
        except ValueError:
            return False

    @staticmethod
    def _respond(handler, status: int, headers=(), body: bytes = b"") -> None:
        handler.send_response(status)
        for name, value in (*_SECURITY_HEADERS, ("Connection", "close"), *headers):
            handler.send_header(name, value)
        if status != 204:
            handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        if body and handler.command != "HEAD":
            handler.wfile.write(body)

    def _respond_json(self, handler, status: int, payload: dict, headers=()) -> None:
        self._respond(handler, status, (*headers, ("Content-Type", "application/json; charset=utf-8")),
                      _dumps(payload).encode("utf-8"))

    def _handle_http(self, handler) -> None:
        """HTTP 仅处理健康检查与按 UUID 下载；正在写入返回 409，未知记录返回 404。"""
        if not self._request_allowed(handler.headers):
            self._respond_json(handler, 403, {"error": {"code": "ORIGIN_DENIED", "message": "网页来源或服务 Host 不允许。"}})
            return
        origin = handler.headers.get("Origin")
        cors = (("Access-Control-Allow-Origin", origin),) if origin else ()
        if handler.command == "OPTIONS":
            self._respond(handler, 204, (*cors, ("Access-Control-Allow-Methods", "GET, OPTIONS")))
            return
        if handler.command != "GET":
            self._respond(handler, 405, (*cors, ("Allow", "GET, OPTIONS")))
            return
        path = urlsplit(handler.path).path
        if path == "/health":
            self._respond_json(handler, 200, {
                "ok": not self._closed, "schema": STREAM_SCHEMA,
                "info": _wire_info(getattr(self._device, "info", None)),
                "recording": recording_to_wire(self._recorder.status())}, cors)
            return
        match = _RECORDING_PATH.match(path)
        if not match or not RECORDING_ID.match(match.group(1)):
            self._respond(handler, 404, cors)
            return
        try:
            recording = self._recorder.download(match.group(1))
            if not os.path.exists(recording["path"]):
                raise make_error("RECORDING_NOT_FOUND", "找不到录制记录。", stage="recording")
        except ShroomError as error:
            status = 409 if error.code == "RECORDING_ACTIVE" else 404 if error.code == "RECORDING_NOT_FOUND" else 500
            self._respond_json(handler, status, {"error": _public_error(error)}, cors)
            return
        self._send_recording(handler, recording, match.group(2), cors)

    def _send_recording(self, handler, recording: dict, extension: str, cors) -> None:
        """按页从 SQLite 读取并流式发送；客户端断开或导出出错时关闭只读连接并中止响应。"""
        chunked = handler.request_version == "HTTP/1.1"
        handler.send_response(200)
        for name, value in (*_SECURITY_HEADERS, *cors,
                            ("Content-Type", "text/csv; charset=utf-8" if extension == "csv"
                             else "application/x-ndjson; charset=utf-8"),
                            ("Content-Disposition", f'attachment; filename="shroom-{recording["meta"]["id"]}.{extension}"'),
                            ("Access-Control-Expose-Headers", "Content-Disposition"),
                            ("Connection", "close"),
                            *((("Transfer-Encoding", "chunked"),) if chunked else ())):
            handler.send_header(name, value)
        handler.end_headers()
        handler.connection.settimeout(None)  # 慢速下载不受请求头超时限制。
        lines = recording_csv(recording) if extension == "csv" else recording_jsonl(recording)
        write = handler.wfile.write

        def send(data: bytes) -> None:
            write(b"%x\r\n%b\r\n" % (len(data), data) if chunked else data)
        try:
            pending, size = [], 0
            for line in lines:
                data = line.encode("utf-8")
                pending.append(data)
                size += len(data)
                if size >= _DOWNLOAD_CHUNK:
                    send(b"".join(pending))
                    pending, size = [], 0
            if pending:
                send(b"".join(pending))
            if chunked:
                write(b"0\r\n\r\n")
        except Exception:
            # 响应头已发出：不发送结束块，直接断开，让客户端把它识别为未完成的下载。
            pass
        finally:
            lines.close()

    # ------------------------------------------------------------------ WebSocket

    def _handle_upgrade(self, handler) -> None:
        handler.close_connection = True
        headers = handler.headers
        if (self._closed or not self._request_allowed(headers)
                or urlsplit(handler.path).path not in ("/", "/ws")):
            handler.wfile.write(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
            return
        key = headers.get("Sec-WebSocket-Key", "")
        try:
            valid_key = len(base64.b64decode(key, validate=True)) == 16
        except (binascii.Error, ValueError):
            valid_key = False
        if (headers.get("Upgrade", "").lower() != "websocket" or not valid_key
                or "upgrade" not in headers.get("Connection", "").lower()):
            handler.wfile.write(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
            return
        if headers.get("Sec-WebSocket-Version") != "13":
            handler.wfile.write(b"HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n")
            return
        handler.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                             f"Sec-WebSocket-Accept: {accept_key(key)}\r\n\r\n").encode("ascii"))
        handler.wfile.flush()
        handler.connection.settimeout(None)
        handler.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        # ready 必须先于任何数据帧入队；在同一把锁内生成并登记，期间的采集状态广播不会被漏掉。
        # 先完成序列化再创建发送线程，序列化失败时不会留下线程。
        with self._state_lock:
            if self._closed:
                return
            ready = encode_frame(OP_TEXT, _dumps({
                "type": "ready", "schema": STREAM_SCHEMA,
                "info": _wire_info(getattr(self._device, "info", None)),
                "recording": recording_to_wire(self._recorder.status())}).encode("utf-8"))
            client = _Client(handler.connection, self._max_buffered)
            client.send(ready)
            self._clients.add(client)
        reader = MessageReader(read_exactly(handler.rfile), max_size=_MAX_CONTROL_BYTES, expect_mask=True)
        try:
            while True:
                opcode, payload = reader.next()
                if opcode == OP_CLOSE:
                    code = parse_close(payload)[0]
                    client.close(code if 1000 <= code < 5000 and code not in (1005, 1006) else 1000)
                    client.drain(1.0)
                    break
                if opcode == OP_PING:
                    client.send(encode_frame(OP_PONG, payload))
                elif opcode != OP_PONG:
                    self._handle_message(client, opcode, payload)
        except WebSocketProtocolError as error:
            client.close(error.close_code, str(error))
            client.drain(1.0)
            # 对端可能还在发送被拒绝的那条消息；读完再断开，关闭码才能送达。
            _discard_inbound(handler.connection, 1.0)
        except (OSError, ValueError):
            pass
        finally:
            with self._state_lock:
                self._clients.discard(client)
            client.terminate()

    def _handle_message(self, client: _Client, opcode: int, payload: bytes) -> None:
        """处理一条控制消息；requestId 原样带回响应，由客户端匹配各自等待中的请求。"""
        def respond(request_id, ok: bool, body: dict) -> None:
            client.send(encode_frame(OP_TEXT, _dumps(
                {"type": "response", "requestId": request_id, "ok": ok, **body}).encode("utf-8")))
        try:
            if opcode == OP_BINARY:
                raise make_error("INVALID_REQUEST", "控制消息必须是 JSON 文本。", stage="serve")
            try:
                text = payload.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise WebSocketProtocolError(1007, "invalid UTF-8") from exc
            request = parse_json(text)
            request_id = request.get("requestId") if isinstance(request, dict) else None
            # 非有限数值无法写回响应；必须在执行任何操作之前拒绝。
            if (isinstance(request_id, bool) or not isinstance(request_id, (str, int, float))
                    or (isinstance(request_id, float) and not isfinite(request_id))
                    or len(str(request_id)) > 128):
                raise make_error("INVALID_REQUEST", "控制消息需要有效的 requestId。", stage="serve")
        except WebSocketProtocolError:
            raise
        except Exception as error:
            respond(None, False, {"error": _public_error(error)})
            return
        actions = {
            "recording.start": lambda: recording_to_wire(self.start_recording(request.get("label"))),
            "recording.stop": lambda: recording_to_wire(self.stop_recording()),
            "recording.status": lambda: recording_to_wire(self._recorder.status()),
            "recording.list": lambda: [recording_to_wire(meta) for meta in self.list_recordings()],
        }
        action = actions.get(request.get("type")) if isinstance(request.get("type"), str) else None
        if action is None:
            respond(request_id, False, {"error": {"code": "INVALID_REQUEST", "message": "不支持的控制消息。"}})
            return
        try:
            result = action()
        except Exception as error:
            respond(request_id, False, {"error": _public_error(error)})
            return
        respond(request_id, True, {"result": result})

    # ------------------------------------------------------------------ 关闭

    def _shutdown_network(self) -> None:
        with self._state_lock:
            self._network_down = True
            clients = tuple(self._clients)
            self._clients.clear()
        for client in clients:
            client.terminate()
        if self._http is not None:
            if self._serving:
                self._http.shutdown()  # 接受循环从未启动时 shutdown 会一直等待，必须跳过。
            self._http.server_close()
        with self._state_lock:
            sockets = tuple(self._sockets)
        for sock in sockets:
            force_close(sock)

    def close(self) -> None:
        """幂等关闭：解除订阅、等待进行中的采集操作和文件写入、释放连接；不关闭调用方的设备。"""
        with self._state_lock:
            if self._closing:
                first = False
            else:
                first = self._closing = self._closed = True
        if not first:
            self._closed_event.wait()
            return
        persistence_error = None
        try:
            # 即使收尾被中断（例如 Ctrl+C），也要关闭网络并放行其他等待关闭的调用方。
            try:
                self._stop_event.set()
                self._detach_source()
                with self._control_lock:
                    pass  # 等待进行中的起停操作结束。
                try:
                    self._recorder.close()
                except ShroomError as error:
                    persistence_error = error
            finally:
                self._shutdown_network()
        finally:
            self._closed_event.set()
        if persistence_error is not None:
            raise persistence_error

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        try:
            self.close()
        except ShroomError:
            if exc_type is None:
                raise
        return False


def serve_device(device, *, port: int = DEFAULT_PORT, host: str = "127.0.0.1", recordings_dir=None,
                 allowed_origins=None, max_buffered_bytes: int = 1024 * 1024,
                 max_queue_frames: int = 1000) -> StreamServer:
    """将已有设备发布为 WS 数据流，并在同一端口提供采集控制与 HTTP 文件下载。

    device 需提供 on_data 或 on_frame 订阅（SDK 的设备对象都支持）。默认只监听
    127.0.0.1:19999，录制保存在当前目录的 .shroom-recordings；跨机监听必须显式配置
    allowed_origins。Origin 校验不是公网身份鉴权，公网使用仍需外部认证和 HTTPS/WSS 代理。
    真实设备需要 stream 授权，采集另需 recording 授权；SDK 自建的模拟设备不需要授权。
    返回的服务用完须 close()：它会写完记录并断开客户端，设备仍由调用方关闭。
    """
    port, host, recordings_dir, allowed_origins = _server_options(
        port, host, recordings_dir, allowed_origins, max_buffered_bytes, max_queue_frames)
    return StreamServer(device, port=port, host=host, recordings_dir=recordings_dir,
                        allowed_origins=allowed_origins, max_buffered_bytes=max_buffered_bytes,
                        max_queue_frames=max_queue_frames)
