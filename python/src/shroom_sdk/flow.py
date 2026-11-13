"""五步快速流程：取数 → 创建 WS → 开始采集 → 停止采集 → 下载。

这五个函数只调用基础 API（connect_product、connect_stream、serve_device 以及连接或
服务自身的录制方法），并负责记住本次采集的记录 ID 和释放资源。

采集电脑（先安装驱动、pyserial，并激活 SDK 授权）::

    from shroom_sdk import read_product, create_ws

    device = read_product("glove", "COM3", side="left",
                          on_data=lambda frame: print(frame.max),      # ① 持续收到解析后的产品帧
                          on_error=lambda error: print(error.code, error))
    server = create_ws(device, port=19999)                             # ② 创建本机 WS
    ...
    server.close()   # 退出时调用：等待文件写完并释放串口

查看端（可以是另一个 Python 进程，也可以是使用 JavaScript SDK 的网页）::

    from shroom_sdk import read_product, start_recording, stop_recording, download_recording

    stream = read_product(url="ws://127.0.0.1:19999", on_data=print)
    start_recording(stream, label="本次采集")                           # ③ 开始保存
    stop_recording(stream)                                             # ④ 等待文件写完
    download_recording(stream, "capture.csv")                          # ⑤ 保存本次记录

后三个函数也可以直接传入 create_ws 返回的服务。
"""

from threading import Lock
import weakref

from .errors import ShroomError, make_error
from .product_device import connect_product
from .quick_server import serve_device
from .recording import create_recording_url
from .stream_client import connect_stream, save_recording

# 每个服务 / 连接独立保存操作状态；只保存 ID 字符串，外部修改返回的记录不影响下载。
_states = weakref.WeakKeyDictionary()
_states_lock = Lock()
_URL_ONLY = ("host", "port", "timeout")


def _flow_error(code: str, message: str) -> ShroomError:
    return make_error(code, message, stage="stream")


class _State:
    def __init__(self):
        self.lock = Lock()
        self.busy = False
        self.recording_id = None
        self.closed = False


def _register(target) -> _State:
    state = _State()
    with _states_lock:
        _states[target] = state
    return state


def _state(target) -> _State:
    try:
        with _states_lock:
            state = _states.get(target)
    except TypeError:
        state = None
    if state is None:
        raise _flow_error("INVALID_CONFIG", "请传入 read_product(url=...) 返回的连接或 create_ws 返回的服务。")
    if state.closed:
        raise _flow_error("SERVER_CLOSED", "采集服务已经关闭。")
    return state


def read_product(product=None, path=None, *, url=None, on_data=None, on_error=None, **options):
    """① 取数：传入 url 时订阅 WS 数据服务；否则按注册产品连接本机串口。

    串口模式返回产品设备（参数同 connect_product）；WS 模式返回数据连接（可再传
    host / port / timeout），此时不能同时传产品、串口或重连参数。
    """
    if url is not None:
        if product is not None or path is not None or any(key not in _URL_ONLY for key in options):
            raise _flow_error("INVALID_CONFIG", "WS 取数请填写 url，不要同时传入产品、串口或重连参数。")
        stream = connect_stream(url, on_data=on_data, on_error=on_error, **options)
        _register(stream)
        return stream
    for key in _URL_ONLY:
        if key in options:
            raise _flow_error("INVALID_CONFIG", f"{key} 只用于 WS 取数，请同时传入 url。")
    return connect_product(product, path, on_data=on_data, on_error=on_error, **options)


class ProductServer:
    """create_ws 返回的服务：采集控制与地址同 serve_device 的结果，close() 额外关闭设备。"""

    def __init__(self, service, device):
        self._service = service
        self._device = device
        self._close_lock = Lock()
        self._closed = False
        self.host, self.port = service.host, service.port
        self.url, self.http_url = service.url, service.http_url

    def start_recording(self, label: str) -> dict:
        return self._service.start_recording(label)

    def stop_recording(self) -> dict:
        return self._service.stop_recording()

    def list_recordings(self) -> list[dict]:
        return self._service.list_recordings()

    def get_recording_status(self) -> dict | None:
        return self._service.get_recording_status()

    def get_recording_url(self, recording_id: str, *, format: str = "csv") -> str:
        return self._service.get_recording_url(recording_id, format=format)

    def close(self) -> None:
        """先关闭服务（等待记录写完），再关闭设备；两步都会执行，可重复调用。"""
        with self._close_lock:
            if self._closed:
                return
            self._closed = True
        with _states_lock:
            state = _states.get(self)
        if state is not None:
            state.closed = True
        errors = []
        for close in (self._service.close, self._device.close):
            try:
                close()
            except Exception as error:
                errors.append(error)
        if errors:
            raise errors[0]

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        try:
            self.close()
        except Exception:
            if exc_type is None:
                raise
        return False


def create_ws(device, **options) -> ProductServer:
    """② 创建 WS：把设备发布为数据服务并接管其关闭责任；启动失败也会释放设备。

    options 同 serve_device（port、host、recordings_dir、allowed_origins 等）。
    """
    if device is None or not callable(getattr(device, "close", None)):
        raise _flow_error("INVALID_CONFIG", "请传入可关闭的设备，例如 read_product 返回的 device。")
    try:
        service = serve_device(device, **options)
    except BaseException:
        try:
            device.close()
        except Exception:
            pass  # 保留服务启动失败这一主要原因。
        raise
    server = ProductServer(service, device)
    _register(server)
    return server


def _control(target, operation):
    """同一连接不并发提交起停命令；失败后释放门闩，调用方可查询真实状态再处理。"""
    state = _state(target)
    with state.lock:
        if state.busy:
            raise _flow_error("INVALID_REQUEST", "采集操作正在进行，请等待完成。")
        state.busy = True
    try:
        return operation(state)
    finally:
        state.busy = False


def start_recording(target, label: str = "本次采集") -> dict:
    """③ 开始保存；成功后清除上一轮的下载 ID，失败时保留已完成的记录。"""
    def operation(state: _State):
        session = target.start_recording(label)
        state.recording_id = None
        return session
    return _control(target, operation)


def stop_recording(target) -> dict:
    """④ 等待录制收尾并记住实际返回的记录 ID；实时取数与 WS 保持连接。"""
    def operation(state: _State):
        recording = target.stop_recording()
        identifier = recording.get("id") if isinstance(recording, dict) else None
        try:
            create_recording_url("http://localhost", identifier)
        except ShroomError:
            raise _flow_error("INVALID_REQUEST", "服务未返回有效的采集记录 ID。") from None
        state.recording_id = identifier
        return recording
    return _control(target, operation)


def download_recording(target, path=None, *, format: str = "csv"):
    """⑤ 下载此连接最近一次成功停止的记录。

    传入 path 时把文件保存到该路径并返回路径；不传时只返回下载地址。format 为 csv 或 jsonl。
    """
    if format not in ("csv", "jsonl"):
        raise _flow_error("INVALID_CONFIG", "下载格式仅支持 csv 或 jsonl。")
    state = _state(target)
    if state.busy:
        raise _flow_error("INVALID_REQUEST", "请等待采集操作完成后再下载。")
    if not state.recording_id:
        raise _flow_error("RECORDING_NOT_ACTIVE", "请先开始并停止本次采集，再下载。")
    url = target.get_recording_url(state.recording_id, format=format)
    return url if path is None else save_recording(url, path)
