"""产品适配器和 WS 编解码器共用的字段校验；不引用注册表，避免循环依赖。"""

from array import array
import sys

from ..errors import ShroomParseError
from ..product_frames import wire_number

STREAM_FRAME_MAX_POINTS = 16384
MAX_NUMBER = sys.float_info.max
# 能舍入为有限 float32 的上界（不含）；达到此值的数在 float32 中为无穷大。
_FLOAT32_LIMIT = float.fromhex("0x1.ffffffp+127")
_SAFE_INTEGER = 9007199254740991
_ARRAYS = (list, tuple, array, bytes, bytearray)


def stream_invalid(field: str):
    """在分配数组和绘图前拒绝无效输入，保留可定位的字段名。"""
    raise ShroomParseError(f"数据帧字段无效：{field}", code="PARSE_FAILED", stage="parse",
                           suggestion="确认服务端与客户端使用相同版本的 Shroom SDK 数据协议。",
                           details={"field": field})


def stream_object(value, field: str) -> dict:
    """后续逐字段构造结果，不直接展开未经验证的网络对象。"""
    if not isinstance(value, dict):
        stream_invalid(field)
    return value


def stream_number(value, field: str, minimum=0, maximum=MAX_NUMBER, integer: bool = False):
    """不隐式转换字符串或布尔值；排除 NaN、无穷值和超出范围的数值。

    integer=True 时接受数值为整数的浮点（JSON 中的 3.0）并返回 int。其余数值中，JSON 解析成
    超出 2^53 的 Python 整数会先转为双精度，与 JavaScript 端读到的数值保持一致。
    """
    kind = type(value)
    if (kind is not int and kind is not float) or not minimum <= value <= maximum:
        stream_invalid(field)
    if integer:
        if kind is float:
            if not value.is_integer():
                stream_invalid(field)
            value = int(value)
        if not -_SAFE_INTEGER <= value <= _SAFE_INTEGER:
            stream_invalid(field)
    elif kind is int and not -_SAFE_INTEGER <= value <= _SAFE_INTEGER:
        value = float(value)
    return value


def stream_array(value, field: str, *, maximum: int = STREAM_FRAME_MAX_POINTS,
                 byte: bool = False, index: bool = False) -> list:
    """限制长度并复制数值；字节/通道下标为 0–255 整数，浮点值不能溢出 float32。"""
    if not isinstance(value, _ARRAYS) or len(value) > maximum:
        stream_invalid(field)
    if isinstance(value, (bytes, bytearray)):
        return list(value)
    result = list(value)
    if byte or index:
        for position, entry in enumerate(result):
            kind = type(entry)
            if kind is float and entry.is_integer():
                result[position] = entry = int(entry)
                kind = int
            if kind is not int or not 0 <= entry <= 255:
                stream_invalid(field)
    else:
        for position, entry in enumerate(result):
            kind = type(entry)
            if (kind is not float and kind is not int) or not 0 <= entry < _FLOAT32_LIMIT:
                stream_invalid(field)
            if kind is int and entry > _SAFE_INTEGER:
                result[position] = float(entry)
    return result


def stream_numbers(value, field: str, length: int, minimum, maximum, integer: bool = False) -> list:
    """固定长度的数值数组：允许负数与超过 255 的整数，绝不按字节截断。"""
    if not isinstance(value, _ARRAYS) or len(value) != length:
        stream_invalid(field)
    result = [stream_number(entry, field, minimum, maximum, integer) for entry in value]
    if not integer and any(not -_FLOAT32_LIMIT < entry < _FLOAT32_LIMIT for entry in result):
        stream_invalid(field)
    return result


def float32_list(values) -> list:
    """按 float32 舍入后的双精度值列表，用于与类型数组内容逐点比较。"""
    return array("f", values).tolist()


def stream_output(values: list, typed: bool, kind: str):
    """编码返回 JSON 数值列表；解码创建独立的 bytes / array 快照。"""
    if not typed:
        return [wire_number(value) for value in values] if kind == "f" else values
    return bytes(values) if kind == "B" else array(kind, values)


def stream_pressure_fields(source: dict, output: dict, typed: bool) -> dict:
    """现有压力产品共用的扩展：原扫描压力必须等于 raw，映射 ADC 长度必须匹配矩阵。"""
    pressure = stream_array(source.get("pressure"), "pressure", byte=True)
    matrix = stream_array(source.get("pressureMatrix"), "pressureMatrix", byte=True)
    raw = output["raw"]
    if pressure != list(raw) or len(matrix) != output["rows"] * output["cols"]:
        stream_invalid("pressure/pressureMatrix")
    output["product"] = source["product"]
    output["pressure"] = raw if typed else list(raw)
    output["pressureMatrix"] = stream_output(matrix, typed, "B")
    return output
