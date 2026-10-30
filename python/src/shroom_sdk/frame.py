"""把单字节 ADC 点阵解码为 Frame，字段与统计规则对齐 sdk/core/frame.js。"""

from array import array
from dataclasses import dataclass
from functools import lru_cache
from math import isfinite, isqrt
from numbers import Real
from time import time_ns
from typing import Sequence

from .errors import ShroomParseTypeError, invalid_config

MAX_MATRIX_POINTS = 1_048_576


@dataclass(frozen=True)
class Center:
    """有效点的压力加权中心；x/y 为 0～1 相对坐标，无有效点时取中心 (0.5, 0.5)。"""

    x: float
    y: float


@dataclass(frozen=True)
class Frame:
    """一帧数据快照：raw 保留原始顺序，values 为映射后按行优先排列的相对值。

    数据类字段不可重新赋值；values 本身仍是可供 NumPy 读取的 float32 数组。
    """

    raw: bytes
    values: array  # float32，可通过 numpy.frombuffer(frame.values, dtype=np.float32) 读取。
    rows: int
    cols: int
    min: float
    max: float
    avg: float
    area: int  # 超过 threshold 的点数，不是物理面积。
    center: Center
    timestamp: int  # Unix 毫秒时间戳，与 JavaScript 的 Date.now() 一致。

    def to_dict(self) -> dict:
        """返回使用 JavaScript Frame 字段名的 JSON 快照，字节与数组转换为列表。"""
        return {
            "raw": list(self.raw), "values": list(self.values),
            "rows": self.rows, "cols": self.cols,
            "min": self.min, "max": self.max, "avg": self.avg,
            "area": self.area, "center": {"x": self.center.x, "y": self.center.y},
            "timestamp": self.timestamp,
        }

    def matrix(self) -> list[list[float]]:
        """返回 rows × cols 的二维相对值列表，逐行组织且无需安装 NumPy。"""
        return [list(self.values[y * self.cols:(y + 1) * self.cols]) for y in range(self.rows)]


def _integer(value: int, name: str, minimum: int = 0) -> int:
    """检查整数下限；显式排除 Python 中属于 int 子类的 bool。"""
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise invalid_config(f"{name} must be an integer >= {minimum}", option=name)
    return value


def _number(value: float, name: str, minimum: float, *, inclusive: bool = True) -> float:
    """检查有限实数及下限；inclusive=False 表示必须严格大于下限。"""
    try:
        valid = (not isinstance(value, bool) and isinstance(value, Real) and isfinite(value)
                 and (value >= minimum if inclusive else value > minimum))
    except (OverflowError, TypeError, ValueError):
        valid = False
    if not valid:
        relation = ">=" if inclusive else ">"
        raise invalid_config(f"{name} must be finite and {relation} {minimum}", option=name)
    return value


def resolve_shape(points: int, *, rows: int | None = None, cols: int | None = None) -> tuple[int, int]:
    """返回 (rows, cols)；显式尺寸须成对给出，否则平方点数取方阵，其余取单行。

    显式尺寸允许与 points 不同；实际填充与截取由 decode_frame 完成。
    """
    _integer(points, "points")
    if points > MAX_MATRIX_POINTS:
        raise invalid_config(f"points must be <= {MAX_MATRIX_POINTS}", option="points")
    if rows is not None or cols is not None:
        if rows is None or cols is None:
            raise invalid_config("Specify both rows and cols", option="rows/cols")
        shape = _integer(rows, "rows", 1), _integer(cols, "cols", 1)
        if shape[0] * shape[1] > MAX_MATRIX_POINTS:
            raise invalid_config(f"rows*cols must be <= {MAX_MATRIX_POINTS}", option="rows/cols")
        return shape
    side = isqrt(points)
    return (side, side) if side * side == points else (1, points)


@lru_cache(maxsize=32)
def _builtin_layout(name: str, rows: int, cols: int) -> tuple[int, ...] | None:
    """缓存内置线序；raw 保持原顺序，mat32 仅用于 32 × 32 点阵。"""
    if name == "raw":
        return None
    if name != "mat32":
        raise invalid_config(f"Unknown layout: {name!r}; use 'raw', 'mat32' or a permutation", option="layout")
    if (rows, cols) != (32, 32):
        raise invalid_config("mat32 requires rows=32 and cols=32", option="layout")
    return tuple((15 + y if y <= 16 else 31 - y) * cols + x
                 for y in range(rows) for x in range(cols))


def get_layout(layout: str | Sequence[int] | None, rows: int, cols: int) -> tuple[int, ...] | None:
    """返回 perm[显示位置] = 原始位置；None 表示不重排。

    自定义序列必须是 0～rows*cols-1 的完整排列，不能缺项、重复或越界。
    """
    _integer(rows, "rows")
    _integer(cols, "cols")
    if rows * cols > MAX_MATRIX_POINTS:
        raise invalid_config(f"rows*cols must be <= {MAX_MATRIX_POINTS}", option="rows/cols")
    if layout is None or isinstance(layout, str):
        return _builtin_layout(layout or "raw", rows, cols)
    if not isinstance(layout, Sequence):
        raise invalid_config("layout must be 'raw', 'mat32' or an integer permutation", option="layout")
    size = rows * cols
    if _layout_length(layout) != size:
        raise invalid_config("layout must be a permutation of 0 .. rows*cols-1", option="layout")
    try:
        perm = tuple(layout)
    except (TypeError, ValueError, BufferError, OverflowError, NotImplementedError) as exc:
        raise invalid_config("layout must be a readable integer permutation", option="layout", cause=exc) from exc
    if (len(perm) != size or any(isinstance(i, bool) or not isinstance(i, int) for i in perm)
            or set(perm) != set(range(size))):
        raise invalid_config("layout must be a permutation of 0 .. rows*cols-1", option="layout")
    return perm


def _layout_length(layout: Sequence[int]) -> int:
    """读取用户序列长度，并把不可读缓冲区等错误统一转换为配置错误。"""
    try:
        return len(layout)
    except (TypeError, ValueError, BufferError, OverflowError, NotImplementedError) as exc:
        raise invalid_config("layout must be a readable integer permutation", option="layout", cause=exc) from exc


def _validate_decode_options(options: dict) -> dict:
    """在取得串口句柄前校验解析配置，并返回可安全保存的配置副本。"""
    supported = {"rows", "cols", "points", "full_scale", "threshold", "layout"}
    unknown = set(options) - supported
    if unknown:
        name = sorted(unknown)[0]
        raise invalid_config(f"Unknown decode option: {name}", option=name)
    _number(options.get("full_scale", 255), "full_scale", 0, inclusive=False)
    _number(options.get("threshold", 0.02), "threshold", 0)
    points = options.get("points")
    if points is not None:
        _integer(points, "points")
        if points > MAX_MATRIX_POINTS:
            raise invalid_config(f"points must be <= {MAX_MATRIX_POINTS}", option="points")
    rows, cols = options.get("rows"), options.get("cols")
    layout = options.get("layout", "raw")
    if rows is not None or cols is not None:
        shape = resolve_shape(0, rows=rows, cols=cols)
    elif isinstance(layout, str) and layout == "mat32":
        if points is not None and points < 1024:
            raise invalid_config("mat32 requires at least 1024 points", option="points")
        shape = (32, 32)
    elif layout is not None and not isinstance(layout, str):
        if not isinstance(layout, Sequence):
            raise invalid_config("layout must be 'raw', 'mat32' or an integer permutation", option="layout")
        shape = resolve_shape(points if points is not None else _layout_length(layout))
    else:
        shape = resolve_shape(points or 0)
    permutation = get_layout(layout, *shape)
    # 将调用方的可变排列固定为元组，避免校验后被外部修改。
    return {**options, **({"layout": permutation} if permutation is not None else {})}


def decode_frame(
    payload: bytes | bytearray | memoryview, *, rows: int | None = None,
    cols: int | None = None, points: int | None = None, full_scale: float = 255,
    threshold: float = 0.02, layout: str | Sequence[int] | None = "raw",
) -> Frame:
    """按每字节一个 ADC 点解析，返回包含矩阵统计和加权中心的 Frame。

    points 限定使用的原始字节数；指定矩阵更大时补零，更小时仅统计矩阵范围。
    layout 决定 values 的排列，raw 保留选取后的原始字节。full_scale 为归一化除数，
    threshold 用于有效点与中心统计；values 是相对值，不是 kPa 或牛顿，也不强制截到 1。
    """
    if not isinstance(payload, (bytes, bytearray, memoryview)):
        raise ShroomParseTypeError("payload must be bytes, bytearray or memoryview",
                                   code="PARSE_FAILED", stage="parse",
                                   suggestion="请向 decode_frame() 传入 bytes、bytearray 或 memoryview。")
    _number(full_scale, "full_scale", 0, inclusive=False)
    _number(threshold, "threshold", 0)
    try:
        data = bytes(payload)
    except (TypeError, ValueError) as exc:
        raise ShroomParseTypeError(str(exc), code="PARSE_FAILED", stage="parse",
                                   suggestion="请传入可读取的字节数据。", cause=exc) from exc
    if points is not None:
        _integer(points, "points")
        if points > MAX_MATRIX_POINTS:
            raise invalid_config(f"points must be <= {MAX_MATRIX_POINTS}", option="points")
    count = len(data) if points is None else min(_integer(points, "points"), len(data))
    rows, cols = resolve_shape(count, rows=rows, cols=cols)
    perm = get_layout(layout, rows, cols)
    raw = data[:count]
    values = array("f")
    low, high, total, weight, cx, cy, area = float("inf"), 0.0, 0.0, 0.0, 0.0, 0.0, 0
    for i in range(rows * cols):
        src = perm[i] if perm is not None else i
        value = raw[src] / full_scale if src < count else 0.0
        values.append(value)
        # 与 JS 保持一致：统计使用写入 float32 前的值，避免额外的精度差异。
        low, high = min(low, value), max(high, value)
        total += value
        if value > threshold:
            area += 1
            weight += value
            cx += (i % cols) * value
            cy += (i // cols) * value
    center = Center(cx / weight / max(1, cols - 1), cy / weight / max(1, rows - 1)) if weight else Center(0.5, 0.5)
    return Frame(raw, values, rows, cols, low if values else 0.0, high,
                 total / len(values) if values else 0.0, area, center, time_ns() // 1_000_000)
