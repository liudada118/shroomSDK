"""把点阵相对值转换为终端字符热力图，不依赖终端颜色或 GUI。"""

from math import isfinite

from .frame import Frame, _integer


def render_ascii(frame: Frame, *, width: int = 32, gain: float = 1.0) -> str:
    """返回多行字符图；width 限制字符列数，gain 仅放大显示，不修改原始帧。

    采样后的显示值限制在 0～1，再映射为由浅到深的字符；空矩阵返回空字符串。
    """
    _integer(width, "width", 1)
    if not isfinite(gain) or gain <= 0:
        raise ValueError("gain must be finite and > 0")
    if frame.rows == 0 or frame.cols == 0:
        return ""
    shades = " .:-=+*#%@"
    cols = min(width, frame.cols)
    # 普通终端字符通常高于宽，行数减半以近似保持点阵显示比例。
    rows = max(1, int(frame.rows * cols / frame.cols / 2 + 0.5))
    lines = []
    for y in range(rows):
        sy = min(frame.rows - 1, y * frame.rows // rows)
        line = []
        for x in range(cols):
            sx = min(frame.cols - 1, x * frame.cols // cols)
            value = max(0.0, min(1.0, frame.values[sy * frame.cols + sx] * gain))
            line.append(shades[int(value * (len(shades) - 1))])
        lines.append("".join(line))
    return "\n".join(lines)
