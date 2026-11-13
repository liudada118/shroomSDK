"""扫描与正式连接共用的串口预约：同一进程内，一个串口同时只属于一个连接或一次扫描。

操作系统并不总是阻止重复打开同一串口（POSIX 上默认允许），而第二个读取方会偷走数据。
预约只在本进程内有效，不代替系统层面的端口占用检查。
"""

import os
from threading import Lock
import weakref

from .errors import make_error

_reservations: dict[str, object] = {}
# 同步的通用串口设备（Shroom.connect）按弱引用登记：它们打开时不做预约检查，行为与以前一致；
# 但扫描和受管理的连接不能再打开一个仍被它们持有的串口。
_open_devices: dict[str, weakref.WeakSet] = {}
_lock = Lock()


def _is_device_path(path: str) -> bool:
    """只管理操作系统的串口设备；loop://、socket:// 等 pySerial URL 每次打开都是独立连接。"""
    return "://" not in path


def path_key(path: str) -> str:
    """同一设备的规范键：Windows 的 COM 名称不区分大小写。"""
    return path.strip().lower() if os.name == "nt" else path.strip()


def _busy(path: str):
    return make_error("PORT_BUSY", "此串口正在被连接或扫描占用。", stage="query", details={"path": path},
                      suggestion="关闭已有设备连接，或等待上次扫描完成串口释放后重试。")


def _taken(key: str) -> bool:
    if key in _reservations:
        return True
    devices = _open_devices.get(key)
    if devices is None:
        return False
    if any(not device.closed for device in devices):
        return True
    del _open_devices[key]  # 全部已关闭或已回收：不再占用。
    return False


def note_open_device(path: str, device) -> None:
    """登记一个已打开的通用串口设备；设备关闭或被回收后自动失效。"""
    if _is_device_path(path):
        with _lock:
            _open_devices.setdefault(path_key(path), weakref.WeakSet()).add(device)


def assert_serial_path_available(path: str) -> None:
    """本进程中已被扫描或连接占用的路径不能再次打开。"""
    with _lock:
        if _is_device_path(path) and _taken(path_key(path)):
            raise _busy(path)


def reserve_serial_path(path: str):
    """预约路径并返回幂等的释放函数；旧连接的迟到释放不能解除后来同路径的新预约。"""
    if not _is_device_path(path):
        return lambda: None
    key, token = path_key(path), object()
    with _lock:
        if _taken(key):
            raise _busy(path)
        _reservations[key] = token

    def release() -> None:
        with _lock:
            if _reservations.get(key) is token:
                del _reservations[key]
    return release
