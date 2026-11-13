"""固定载荷 + 尾分隔协议的共用分帧器；其他协议由产品适配器提供自己的解析器。"""

from ..errors import invalid_config
from ._adapter import chunk_bytes


class TailParser:
    """为一个连接保存独立状态；decode_payload 只接收长度正确、已复制且不含分隔符的载荷。

    配置由内置产品适配器提供，不接受用户覆盖协议，也不根据帧长识别产品。
    """

    def __init__(self, *, payload_length: int, delimiter: bytes, decode_payload):
        if (isinstance(payload_length, bool) or not isinstance(payload_length, int) or payload_length < 1
                or not isinstance(delimiter, (bytes, bytearray)) or not delimiter
                or not callable(decode_payload)):
            raise invalid_config("产品拆帧器需要正整数载荷长度、非空字节分隔符和解码函数。")
        self._payload_length = payload_length
        self._delimiter = bytes(delimiter)  # 固定本连接协议，避免外部修改分隔符影响正在取数的设备。
        self._decode = decode_payload
        self.reset()

    def push(self, chunk) -> list:
        """输入串口字节；保留半包，丢弃错误长度和溢出段，并累计诊断计数。"""
        data = chunk_bytes(chunk, "产品输入必须是字节数据。")
        if not data:
            return []
        data = self._pending + data
        delimiter, size = self._delimiter, len(self._delimiter)
        offset, frames = 0, []
        while True:
            tail = data.find(delimiter, offset)
            if tail < 0:
                break
            length = tail - offset
            if not self._overflowed and length == self._payload_length:
                frames.append(self._decode(data[offset:tail]))
                self._frame_length = self._payload_length
            elif self._overflowed or length > 0:
                self._dropped += 1
            self._overflowed = False
            offset = tail + size
        pending = data[offset:]
        if len(pending) > self._payload_length + size - 1:
            # 超长段丢弃到下个帧尾；仅保留可能跨读取边界的分隔符前缀，避免拼出伪帧。
            self._overflowed = True
            pending = pending[-(size - 1):] if size > 1 else b""
        self._pending = pending
        return frames

    def reset(self) -> None:
        """重置半包及累计诊断，供同一解析器在重新连接后重新开始。"""
        self._pending = b""
        self._overflowed = False
        self._dropped = self._frame_length = 0

    @property
    def dropped_count(self) -> int:
        return self._dropped

    @property
    def frame_length(self) -> int:
        return self._frame_length
