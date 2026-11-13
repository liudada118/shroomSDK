"""产品适配器的统一结构与各协议共用的工具。"""

from dataclasses import dataclass
from time import monotonic
from types import MappingProxyType
from typing import Callable

from ..errors import ShroomParseTypeError

TAIL = bytes((0xAA, 0x55, 0x03, 0x99))


@dataclass(frozen=True)
class Discovery:
    """串口发现钩子：用正式解析器读出完整帧，再从帧里取出可识别的身份。"""

    create_parser: Callable
    identify: Callable


@dataclass(frozen=True)
class ProductAdapter:
    """一个已支持产品的全部规则：串口配置、参数校验、流解析与 WS 字段校验。

    profile 使用 snake_case 键；aliases 只用于连接，输出帧和网络传输始终使用 profile['product']。
    """

    profile: MappingProxyType
    aliases: tuple
    option_fields: tuple
    validate_options: Callable
    connection_info: Callable
    create_parser: Callable
    read_stream_fields: Callable
    build_frame: Callable
    resolve_profile: Callable | None = None
    discovery: Discovery | None = None


def now_ms() -> float:
    """分包配对使用的单调毫秒时钟；测试可替换本函数模拟超时。"""
    return monotonic() * 1000


def chunk_bytes(chunk, message: str) -> bytes:
    """解析器只接受字节输入；其他类型按解析错误拒绝。"""
    if not isinstance(chunk, (bytes, bytearray, memoryview)):
        raise ShroomParseTypeError(message, code="PARSE_FAILED", stage="parse",
                                   suggestion="请向产品解析器传入串口读取的字节数据。")
    return bytes(chunk)
