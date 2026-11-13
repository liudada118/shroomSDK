"""点位排列（线序）：把采集板扫描顺序换成垫子上的实际位置，对齐 src/core/layout.js。

串口里的字节按采集板扫描顺序发出，不等于从垫子左上角逐行数过去的顺序。
每种产品走线不同，排列要按产品选择，不能自动猜。几点约定：

1. 排列决定输出的行列，例如 car10 从 1024 个扫描点里取 10×10 的一块。
2. 这里只搬位置、不改数值；坏点插值、空行填补和压力换算不在 SDK 范围内。
3. 个别产品有无传感器的空位（如 carCol 中间一列），排列表里记为 -1，解码后固定为 0。
4. 手套走产品层（connect_glove），不属于此通用矩阵线序表。
5. 多数排列一帧 1024 个扫描点，小样垫和触觉足底为 256 个，由 scan 字段记录。
"""

from dataclasses import dataclass
from functools import lru_cache

SCAN = 32
SCAN_SIZE = SCAN * SCAN
SCAN_SIZE_256 = 256


# ------------------------------------------------------------------ 通用工具
# 与正式上位机的同名函数一一对应，这里搬运的是下标而不是数值。

def _rotate90(a: list[int], side: int) -> list[int]:
    """逆时针旋转 90°（方阵）。"""
    out = [0] * (side * side)
    for i in range(side):
        for j in range(side):
            out[(side - 1 - j) * side + i] = a[i * side + j]
    return out


def _rotate90cw(a: list[int], side: int) -> list[int]:
    """顺时针旋转 90°（方阵）。"""
    out = [0] * (side * side)
    for i in range(side):
        for j in range(side):
            out[j * side + (side - 1 - i)] = a[i * side + j]
    return out


def _flip_x(a: list[int], rows: int, cols: int) -> list[int]:
    """每行左右翻转。"""
    out: list[int] = []
    for i in range(rows):
        out.extend(reversed(a[i * cols:(i + 1) * cols]))
    return out


def _flip_y(a: list[int], rows: int, cols: int) -> list[int]:
    """上下翻转（整行对调）。"""
    out: list[int] = []
    for i in range(rows - 1, -1, -1):
        out.extend(a[i * cols:(i + 1) * cols])
    return out


def _reverse_cols(a: list[int], rows: int, cols: int, start: int, end: int) -> list[int]:
    """每行把 [start, end] 这一段列前后倒过来。"""
    out = a[:]
    for i in range(rows):
        base = i * cols
        out[base + start:base + end + 1] = reversed(a[base + start:base + end + 1])
    return out


def _swap_rows(a: list[int], cols: int, r1: int, r2: int) -> None:
    """原地交换第 r1、r2 两行。"""
    p, q = r1 * cols, r2 * cols
    a[p:p + cols], a[q:q + cols] = a[q:q + cols], a[p:p + cols]


def _swap(a: list[int], p: int, q: int) -> None:
    a[p], a[q] = a[q], a[p]


def _pick(a: list[int], row_spans, col_spans) -> list[int]:
    """从扫描矩阵里按行段、列段抠出一块；段写成 (起, 止)，起 > 止表示倒着取。"""
    def expand(spans):
        out = []
        for start, end in spans:
            out.extend(range(start, end - 1, -1) if start > end else range(start, end + 1))
        return out
    cols = expand(col_spans)
    return [a[r * SCAN + c] for r in expand(row_spans) for c in cols]


# -------------------------------------------------------------- 各产品的线序

def _jqbed(src):
    """32×32 通用压力垫（床垫 / 手部垫 / 眠枕 / 宠物垫共用）。"""
    a = src[:]
    for i in range(8):
        _swap_rows(a, SCAN, i, 14 - i)
    return a[15 * SCAN:] + a[:15 * SCAN]


def _sit_pad(src):
    """坐垫：在通用垫的基础上再左右翻一次。"""
    return _flip_x(_jqbed(src), 32, 32)


def _fold_right(a):
    """第 15 列往右的 17 列，以第 23 列为轴对折。"""
    for i in range(SCAN):
        for j in range(8):
            _swap(a, i * SCAN + j + 15, i * SCAN + 31 - j)


def _car_seat(src):
    """汽车坐垫 / 脚垫。"""
    a = src[:]
    for i in range(8):
        _swap_rows(a, SCAN, i, 15 - i)
    _fold_right(a)
    return _flip_x(a, 32, 32)


def _car_back(src):
    """汽车靠背。"""
    a = src[:]
    for i in range(8):
        _swap_rows(a, SCAN, i, 14 - i)
    _fold_right(a)
    rolled = a[15 * SCAN:] + a[:15 * SCAN]
    return _flip_y(_flip_x(_rotate90cw(rolled, SCAN), 32, 32), 32, 32)


def _car10(src):
    """10×10 汽车坐垫：只用扫描矩阵左上角 10 行 × 右边 10 列。"""
    a = _pick(src, [(0, 9)], [(22, 31)])
    for i in range(2):
        _swap_rows(a, 10, i, 4 - i)
    for i in range(5):
        _swap_rows(a, 10, i, i + 5)
    return a


def _car10_back(src):
    """10×10 汽车靠背；最外一圈没有传感器，沿用上位机做法抄邻边的值。"""
    a = _car10(src)
    for i in range(10):
        for j in range(5):
            _swap(a, i * 10 + j, i * 10 + 9 - j)
    for i in range(10):
        a[i * 10] = a[i * 10 + 1]
        a[i * 10 + 9] = a[i * 10 + 8]
        a[i] = a[10 + i]
    return _rotate90(a, 10)


def _sit10(src):
    """10×10 坐垫。"""
    a = _pick(src, [(0, 9)], [(22, 31)])
    for i in range(2):
        _swap_rows(a, 10, i, 4 - i)
    return _rotate90(a, 10)


def _yanfeng10(src):
    """延锋 10×10 坐垫。"""
    a = _pick(src, [(6, 15)], [(0, 9)])
    for i in range(2):
        _swap_rows(a, 10, 5 + i, 9 - i)
    return _flip_x(_rotate90(a, 10), 10, 10)


def _yanfeng10_back(src):
    """延锋 10×10 靠背。"""
    a = _pick(src, [(6, 15)], [(0, 9)])
    for i in range(2):
        _swap_rows(a, 10, i, 4 - i)
    return _rotate90(a, 10)


def _volvo_common(src):
    """volvo 坐垫 / 靠背共用的前半段。"""
    a = src[:]
    for i in range(SCAN):  # 左半 16 列以第 7/8 列为轴对折
        for j in range(8):
            _swap(a, i * SCAN + j, i * SCAN + 15 - j)
    for i in range(SCAN):  # 左右两个半区整体对调
        for j in range(16):
            _swap(a, i * SCAN + j, i * SCAN + 16 + j)
    for i in range(9):
        _swap_rows(a, SCAN, i, 17 - i)
    return a


def _volvo(src):
    """volvo 坐垫。"""
    return _flip_y(_rotate90cw(_volvo_common(src), SCAN), 32, 32)


def _volvo_back(src):
    """volvo 靠背。"""
    return _rotate90(_volvo_common(src), SCAN)


def _volvo_head(src):
    """volvo 头枕 10×10。"""
    a = _pick(src, [(6, 15)], [(0, 9)])
    for i in range(2):
        _swap_rows(a, 10, 5 + i, 9 - i)
    return _rotate90(a, 10)


def _small_m(src):
    """长条垫 32 行 × 10 列。"""
    a = [src[i * SCAN + j] for j in range(SCAN) for i in range(22, SCAN)]
    for i in range(SCAN):
        for j in range(2):
            _swap(a, i * 10 + j, i * 10 + 4 - j)
    return a


def _rect(src):
    """方垫 16 行 × 10 列。"""
    a = [src[i * SCAN + j] for i in range(22, SCAN) for j in range(16)]
    for i in range(10):
        for j in range(7, 12):
            _swap(a, i * 16 + j, i * 16 + 22 - j)
    return [a[i * 16 + j] for j in range(16) for i in range(10)]


def _short(src):
    """短垫 32×32：左右各自对折一次。"""
    a = src[:]
    for i in range(SCAN):
        for j in range(16, 24):
            _swap(a, i * SCAN + j, i * SCAN + 47 - j)
    return _flip_x(a, 32, 32)


def _mat_col(src):
    """列式垫 16 行 × 10 列。"""
    a = _pick(src, [(0, 15)], [(0, 9)])
    for i in range(4):
        _swap_rows(a, 10, i, 7 - i)
    return a[80:] + a[:80]


def _sit_col(src):
    """列式坐垫 32×32。"""
    a = src[:]
    for i in range(8):  # 下半 16 行前后倒过来
        _swap_rows(a, SCAN, 16 + i, 31 - i)
    for i in range(SCAN):  # 每行前 15 列前后倒过来
        for j in range(8):
            _swap(a, i * SCAN + j, i * SCAN + 14 - j)
    return a


def _xiyue(src):
    """喜悦 32×32。"""
    a = src[:]
    for i in range(6):
        _swap_rows(a, SCAN, i, 10 - i)
    return a


def _car_col(src):
    """列式汽车垫 9 行 × 10 列，中间一列没有传感器。"""
    a = _pick(src, [(6, 15)], [(0, 8)])
    for i in range(2):
        _swap_rows(a, 9, i, 4 - i)
    for i in range(2, 9):
        a[i * 9 + 4] = -1  # 这一段没走线
    return [a[i * 9 + j] for j in range(9) for i in range(10)]


def _sit100(src):
    """sit100 坐垫 12 行 × 6 列：右侧、左侧、中间三块拼起来。"""
    left = _pick(src, [(0, 2)], [(1, 0)])
    center = _pick(src, [(3, 12)], [(7, 2)])
    right = _pick(src, [(15, 13)], [(9, 8)])
    for i in range(2):
        _swap_rows(center, 6, 5 + i, 9 - i)
    return right + left + center


def _endi_sit(src):
    """恩迪 23×23 坐垫。"""
    return _pick(src, [(11, 22), (10, 0)], [(0, 22)])


def _sofa(src):
    """沙发 16×16。"""
    return _pick(src, [(0, 15)], [(7, 0), (8, 15)])


def _hand_single_point(src):
    """手部单点垫 32×32：以第 15 行为界上下两块前后调换。"""
    return _pick(src, [(15, 30), (14, 0), (31, 31)], [(0, 31)])


def _whole_chair_common(src):
    """整椅坐垫、靠背共用的开头：取左上 16×16，再把每行右半段倒过来。"""
    return _reverse_cols(_pick(src, [(0, 15)], [(0, 15)]), 16, 16, 8, 15)


def _whole_chair_sit(src):
    """整椅坐垫 16×16。"""
    return _rotate90(_whole_chair_common(src), 16)


def _whole_chair_back(src):
    """整椅靠背 16×16。"""
    return _flip_y(_rotate90(_flip_y(_whole_chair_common(src), 16, 16), 16), 16, 16)


def _whole_chair_head(src):
    """整椅头枕 10×10：取扫描矩阵第 6~15 行、左边 10 列。"""
    a = _reverse_cols(_pick(src, [(6, 15)], [(0, 9)]), 10, 10, 5, 9)
    return _flip_y(_rotate90cw(_flip_x(a, 10, 10), 10), 10, 10)


def _temp_full_bed(src):
    """温度全床 12 行 × 15 列；只管压力矩阵的位置，温度点不在此排列中。"""
    return _pick(_jqbed(src), [(20, 31)], [(13, 19), (21, 28)])


_SMALL_SAMPLE_TABLE = (
    223, 222, 221, 220, 219, 218, 217, 216, 215, 214,
    239, 238, 237, 236, 235, 234, 233, 232, 231, 230,
    255, 254, 253, 252, 251, 250, 249, 248, 247, 246,
    15, 14, 13, 12, 11, 10, 9, 8, 7, 6,
    31, 30, 29, 28, 27, 26, 25, 24, 23, 22,
    207, 206, 205, 204, 203, 202, 201, 200, 199, 198,
    191, 190, 189, 188, 187, 186, 185, 184, 183, 182,
    175, 174, 173, 172, 171, 170, 169, 168, 167, 166,
    159, 158, 157, 156, 155, 154, 153, 152, 151, 150,
    143, 142, 141, 140, 139, 138, 137, 136, 135, 134,
)

_FOOT_INSOLE_TABLE = (
    224, 208, 192, 176, 160, 144, 223, 207, 191, 175, 159, 143,
    222, 206, 190, 174, 158, 142, 221, 205, 189, 173, 157, 141,
    220, 204, 188, 172, 156, 140, 219, 203, 187, 171, 155, 139,
    218, 202, 186, 170, 154, 138, 217, 201, 185, 169, 153, 137,
    216, 200, 184, 168, 152, 136, 215, 199, 183, 167, 151, 135,
)


def _small_sample(src):
    """小样垫 10×10：一帧 256 个点，纯查表。"""
    return [src[i] for i in _SMALL_SAMPLE_TABLE]


def _foot_insole(src):
    """触觉足底 10 行 × 6 列，一帧 256 个点，纯查表（表内编号从 1 开始）。"""
    return [src[i - 1] for i in _FOOT_INSOLE_TABLE]


# ------------------------------------------------------------------ 排列注册表
# name: (rows, cols, label, build, scan)；label 供界面下拉使用，scan 是一帧的扫描点数。
_DEFINITIONS = {
    "mat32": (32, 32, "通用压力垫", _jqbed, SCAN_SIZE),
    "sit": (32, 32, "坐垫", _sit_pad, SCAN_SIZE),
    "bed1": (32, 32, "床垫（另一版走线）", _jqbed, SCAN_SIZE),
    "carSeat": (32, 32, "汽车坐垫 / 脚垫", _car_seat, SCAN_SIZE),
    "carBack": (32, 32, "汽车靠背", _car_back, SCAN_SIZE),
    "car10": (10, 10, "汽车坐垫", _car10, SCAN_SIZE),
    "car10Back": (10, 10, "汽车靠背", _car10_back, SCAN_SIZE),
    "sit10": (10, 10, "坐垫", _sit10, SCAN_SIZE),
    "yanfeng10": (10, 10, "延锋坐垫", _yanfeng10, SCAN_SIZE),
    "yanfeng10Back": (10, 10, "延锋靠背", _yanfeng10_back, SCAN_SIZE),
    "volvo": (32, 32, "volvo 坐垫", _volvo, SCAN_SIZE),
    "volvoBack": (32, 32, "volvo 靠背", _volvo_back, SCAN_SIZE),
    "volvoHead": (10, 10, "volvo 头枕", _volvo_head, SCAN_SIZE),
    "smallM": (32, 10, "长条垫", _small_m, SCAN_SIZE),
    "rect": (16, 10, "方垫", _rect, SCAN_SIZE),
    "short": (32, 32, "短垫", _short, SCAN_SIZE),
    "matCol": (16, 10, "列式垫", _mat_col, SCAN_SIZE),
    "sitCol": (32, 32, "列式坐垫", _sit_col, SCAN_SIZE),
    "xiyue": (32, 32, "喜悦", _xiyue, SCAN_SIZE),
    "carCol": (9, 10, "列式汽车垫", _car_col, SCAN_SIZE),
    "sit100": (12, 6, "sit100 坐垫", _sit100, SCAN_SIZE),
    "endiSit": (23, 23, "恩迪坐垫", _endi_sit, SCAN_SIZE),
    "sofa": (16, 16, "沙发", _sofa, SCAN_SIZE),
    "handSinglePoint": (32, 32, "手部单点垫", _hand_single_point, SCAN_SIZE),
    "wholeChair": (16, 16, "整椅坐垫", _whole_chair_sit, SCAN_SIZE),
    "wholeChairBack": (16, 16, "整椅靠背", _whole_chair_back, SCAN_SIZE),
    "wholeChairHead": (10, 10, "整椅头枕", _whole_chair_head, SCAN_SIZE),
    "tempFullBed": (12, 15, "温度全床", _temp_full_bed, SCAN_SIZE),
    "smallSample": (10, 10, "小样垫", _small_sample, SCAN_SIZE_256),
    "footInsole": (10, 6, "触觉足底", _foot_insole, SCAN_SIZE_256),
}

#: 全部排列名，顺序与 JavaScript 的 LAYOUTS 一致。
LAYOUTS = tuple(_DEFINITIONS)


@dataclass(frozen=True)
class Layout:
    """一条线序：perm[显示位置] = 扫描顺序里的下标，-1 表示该位置没有传感器。"""

    name: str
    label: str
    rows: int
    cols: int
    scan: int
    perm: tuple[int, ...]


@lru_cache(maxsize=None)
def get_named_layout(name: str) -> Layout | None:
    """按名称取排列；'raw' 或未知名称返回 None。结果只读并按名称缓存。"""
    definition = _DEFINITIONS.get(name) if isinstance(name, str) else None
    if definition is None:
        return None
    rows, cols, label, build, scan = definition
    perm = tuple(build(list(range(scan))))
    if len(perm) != rows * cols:
        raise RuntimeError(f"layout {name} produced {len(perm)} points, expected {rows * cols}")
    return Layout(name, label, rows, cols, scan, perm)


def list_layouts() -> list[dict]:
    """列出所有排列（按线序）；界面下拉框请用 list_products()。"""
    return [{"name": name, "label": d[2], "rows": d[0], "cols": d[1]} for name, d in _DEFINITIONS.items()]


# ------------------------------------------------------------------ 产品菜单
# 与公司桌面端「请选择传感器」下拉的名称和顺序一致；多个产品可指向同一条线序。
# layout='raw' 的产品不需要换线序，行列在此写死。手套由产品接口提供，不在此菜单中。
PRODUCTS = (
    {"name": "hand", "label": "手部检测", "layout": "mat32"},
    {"name": "smallSample", "label": "10*10小样", "layout": "smallSample"},
    {"name": "footVideo", "label": "触觉足底", "layout": "footInsole"},
    {"name": "jqbed", "label": "小床监测", "layout": "mat32"},
    {"name": "smallBedNoAlg", "label": "小床检测(数据)", "layout": "mat32"},
    {"name": "tempFullBed", "label": "温度全床系统", "layout": "tempFullBed"},
    {"name": "petCare", "label": "宠物看护", "layout": "mat32"},
    {"name": "petCareMini", "label": "mini看护", "layout": "mat32"},
    {"name": "fast256", "label": "16*16高速", "layout": "raw", "rows": 16, "cols": 16},
    {"name": "fast1024", "label": "32*32高速", "layout": "raw", "rows": 32, "cols": 32},
    {"name": "handSinglePoint", "label": "32*32(检测点)", "layout": "handSinglePoint"},
    {"name": "normal", "label": "正常测试", "layout": "raw", "rows": 32, "cols": 32},
    {"name": "humanBody", "label": "人体全身", "layout": "raw", "rows": 32, "cols": 32},
)


def _with_shape(product: dict) -> dict:
    """补上行列：走线序的从排列表取，raw 的产品使用自己写死的尺寸。"""
    definition = _DEFINITIONS.get(product["layout"])
    return {"name": product["name"], "label": product["label"], "layout": product["layout"],
            "rows": product.get("rows", definition[0] if definition else None),
            "cols": product.get("cols", definition[1] if definition else None)}


def get_product(name: str) -> dict | None:
    """按产品名取一项，返回 name / label / layout / rows / cols；未知名称返回 None。"""
    for product in PRODUCTS:
        if product["name"] == name:
            return _with_shape(product)
    return None


def list_products() -> list[dict]:
    """列出通用矩阵产品菜单，顺序与桌面端一致；不含需要专用协议的产品接口。"""
    return [_with_shape(product) for product in PRODUCTS]
