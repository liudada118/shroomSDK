"""调色板：把 0～1 的值映射成颜色，对齐 src/core/colormap.js。

内置 shroom、jet、jet_white、grey；均返回 0～255 的 (R, G, B) 元组。输入先限制到 0～1。
SDK 本身不绘图，这些函数供应用用自己选择的图形库（Matplotlib、Pillow 等）着色。
"""

from math import floor


def _clamp01(value: float) -> float:
    return 0.0 if value < 0 else 1.0 if value > 1 else value


def _round(value: float) -> int:
    """四舍五入到整数，0.5 向上取整，与 JavaScript 的 Math.round 一致。"""
    lower = floor(value)
    return lower + 1 if value - lower >= 0.5 else lower


def jet(value: float) -> tuple[int, int, int]:
    """经典 jet 彩虹配色：蓝 → 青 → 绿 → 黄 → 红。"""
    x = _clamp01(value)
    r = g = b = 1.0
    if x < 0.25:
        r, g = 0.0, 4 * x
    elif x < 0.5:
        r, b = 0.0, 1 + 4 * (0.25 - x)
    elif x < 0.75:
        r, b = 4 * (x - 0.5), 0.0
    else:
        g, b = 1 + 4 * (0.75 - x), 0.0
    return _round(255 * r), _round(255 * g), _round(255 * b)


def jet_white(value: float) -> tuple[int, int, int]:
    """白底 jet：0 是白色，压力越大越红；适合打印和浅色界面。"""
    x = _clamp01(value)
    if x <= 0.001:
        return 255, 255, 255
    fade = min(1.0, x / 0.15)
    return tuple(_round(255 + (channel - 255) * fade) for channel in jet(x))


def grey(value: float) -> tuple[int, int, int]:
    """灰度：黑到白。"""
    level = _round(255 * _clamp01(value))
    return level, level, level


# 色标和取值点与正式上位机一致：深紫底 → 蓝紫 → 青 → 绿 → 黄 → 红。
_SHROOM_STOPS = (
    (0.0, (21, 18, 42)),
    (0.4, (62, 0, 248)),
    (0.55, (149, 253, 237)),
    (0.7, (154, 255, 62)),
    (0.85, (246, 254, 71)),
    (1.0, (216, 36, 36)),
)


def shroom(value: float) -> tuple[int, int, int]:
    """Shroom 上位机同款配色；按相邻色标做 RGB 线性插值。"""
    x = _clamp01(value)
    for index in range(1, len(_SHROOM_STOPS)):
        upper, upper_color = _SHROOM_STOPS[index]
        if x > upper:
            continue
        lower, lower_color = _SHROOM_STOPS[index - 1]
        k = 0.0 if upper == lower else (x - lower) / (upper - lower)
        return tuple(_round(a + (b - a) * k) for a, b in zip(lower_color, upper_color))
    return _SHROOM_STOPS[-1][1]


#: 名称 → 调色板函数；键与 JavaScript SDK 相同（含 jetWhite）。
COLORMAPS = {"shroom": shroom, "jet": jet, "jetWhite": jet_white, "grey": grey}


def get_colormap(name):
    """按名字取调色板，取不到就回退到 jet；直接传函数时原样返回，供调用方自定义颜色。"""
    if callable(name):
        return name
    return COLORMAPS.get(name, jet) if isinstance(name, str) else jet
