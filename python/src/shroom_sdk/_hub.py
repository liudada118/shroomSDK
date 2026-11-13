"""帧订阅中心：设备和数据流共用的回调分发，每个实例的订阅彼此独立。

回调在读取线程上同步执行，帧率可能到 100 Hz，回调里不要做耗时操作；
一个回调抛错不影响其他回调，异常会转成 CALLBACK_FAILED 交给错误订阅。
"""

import logging
from threading import RLock

from .errors import as_shroom_error

#: 没有任何错误订阅时，运行期错误通过此 logger 输出，不直接写标准输出。
logger = logging.getLogger("shroom_sdk")


def require_callable(handler, name: str) -> None:
    if not callable(handler):
        raise TypeError(f"{name} 需要传入一个可调用对象")


class FrameHub:
    """线程安全的帧 / 错误订阅集合；emit 基于订阅快照，回调内增删订阅不影响本轮分发。"""

    def __init__(self):
        self._lock = RLock()
        self._frames: dict[int, object] = {}
        self._errors: dict[int, object] = {}
        self._next = 0
        self.last_error = None

    def _add(self, registry: dict, handler):
        with self._lock:
            self._next += 1
            identifier = self._next
            registry[identifier] = handler

        def unsubscribe() -> None:
            with self._lock:
                registry.pop(identifier, None)
        return unsubscribe

    def on_frame(self, handler):
        """订阅每一帧，返回取消订阅的函数。"""
        require_callable(handler, "on_frame")
        return self._add(self._frames, handler)

    def on_error(self, handler):
        """订阅运行期错误，返回取消订阅函数；不会重放此前的 last_error。"""
        require_callable(handler, "on_error")
        return self._add(self._errors, handler)

    @property
    def count(self) -> int:
        with self._lock:
            return len(self._frames)

    def emit(self, frame) -> None:
        """同步分发同一帧对象；回调异常被隔离并报告给错误订阅。"""
        with self._lock:
            handlers = tuple(self._frames.values())
        for handler in handlers:
            try:
                handler(frame)
            except Exception as exc:
                self.emit_error(as_shroom_error(exc, code="CALLBACK_FAILED", stage="callback",
                                                message="应用的数据回调执行失败"))

    def error_handlers(self) -> tuple:
        """当前错误订阅的快照；用于在订阅被清空之前先确定通知对象。"""
        with self._lock:
            return tuple(self._errors.values())

    def emit_error(self, error, *, log: bool = True, handlers=None) -> None:
        """记录最近错误并通知错误订阅；没有订阅且 log 为真时写入日志。

        handlers 可传入此前取得的订阅快照，使通知不受其后清空订阅的影响。
        """
        with self._lock:
            self.last_error = error
            if handlers is None:
                handlers = tuple(self._errors.values())
        if not handlers and log:
            logger.error("[shroom] %s: %s", getattr(error, "code", type(error).__name__), error)
        for handler in handlers:
            try:
                handler(error)
            except Exception:
                # 错误回调自身抛错时只记录日志，避免递归派发。
                logger.exception("[shroom] on_error 回调出错")

    def clear(self) -> None:
        """连接关闭时释放全部回调引用；最近错误仍可由 last_error 读取。"""
        with self._lock:
            self._frames.clear()
            self._errors.clear()
