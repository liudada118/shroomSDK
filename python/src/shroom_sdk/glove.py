"""手套压力映射、标准分区与整包解码；分包协议复用同一映射，不伪造整包序号。"""

from array import array

from .errors import ShroomParseError, invalid_config
from .frame import _number, decode_frame
from .product_frames import FingerRegion, GloveFingers, GloveFrame, GloveImu, Region, FINGER_KEYS

# 沿用 handGloveFullPacket 旧展示的点位表（编号从 1 开始），仅用于兼容矩阵；不是标准分区表。
_FULL_PACKET_LAYOUTS = {
    "left": {
        "finger_rows": (
            (65, 66, 67, 38, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79),
            (49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63),
            (33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47),
            (17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31),
        ),
        "finger_tips": (2, 5, 8, 11, 14),
        "palm": (
            129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143,
            145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159,
            161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175,
            177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191,
            193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207,
            209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223,
        ),
        "palm_leading_blank_count": 3,
        "palm_top_rows": (
            (244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255),
            (228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239),
        ),
    },
    "right": {
        "finger_rows": (
            (190, 191, 192, 187, 188, 189, 184, 185, 186, 181, 182, 183, 178, 179, 180),
            (206, 207, 208, 203, 204, 205, 200, 201, 202, 197, 198, 199, 194, 195, 196),
            (222, 223, 224, 219, 220, 221, 216, 217, 218, 213, 214, 215, 210, 211, 212),
            (238, 239, 240, 235, 236, 237, 232, 233, 234, 229, 230, 231, 226, 227, 228),
        ),
        "finger_tips": (255, 252, 249, 246, 243),
        "palm": (
            114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128,
            98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112,
            82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96,
            66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80,
            50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
            34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
        ),
        "palm_leading_blank_count": 0,
        "palm_top_rows": (
            (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13),
            (18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29),
        ),
    },
}


def _matrix_sources(layout: dict) -> tuple[int, ...]:
    """把旧版 13×15 展示轮廓展开成 195 个来源通道（0 基）；未填位置为 -1。"""
    result = [-1] * 195
    for row_index, row in enumerate(layout["finger_rows"]):
        for col, point in enumerate(row):
            result[row_index * 15 + col] = point - 1
    for finger, point in enumerate(layout["finger_tips"]):
        result[61 + finger * 3] = point - 1
    for row_index, row in enumerate(layout["palm_top_rows"]):
        start = 75 + row_index * 15 + layout["palm_leading_blank_count"]
        for col, point in enumerate(row):
            result[start + col] = point - 1
    for index, point in enumerate(layout["palm"]):
        result[105 + index] = point - 1
    return tuple(result)


_MATRIX_SOURCES = {side: _matrix_sources(layout) for side, layout in _FULL_PACKET_LAYOUTS.items()}

# 产品方提供的分区表：编号从 1 开始，指向原始扫描通道，而非旧展示矩阵的坐标。
_REGION_LAYOUTS = {
    "left": {
        "little": ("小拇指", ((31, 30, 29), (15, 14, 13), (255, 254, 253), (239, 238, 237)), ((222,),)),
        "ring": ("无名指", ((28, 27, 26), (12, 11, 10), (252, 251, 250), (236, 235, 234)), ((219,),)),
        "middle": ("中指", ((25, 24, 23), (9, 8, 7), (249, 248, 247), (233, 232, 231)), ((216,),)),
        "index": ("食指", ((22, 21, 20), (6, 5, 4), (246, 245, 244), (230, 229, 228)), ((213,),)),
        "thumb": ("大拇指", ((19, 18, 17), (3, 2, 1), (243, 242, 241), (227, 226, 225)), ((210,),)),
        "palm": ("手掌", (
            (207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196),
            (191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 178, 177),
            (175, 174, 173, 172, 171, 170, 169, 168, 167, 166, 165, 164, 163, 162, 161),
            (159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 149, 148, 147, 146, 145),
            (143, 142, 141, 140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129),
        )),
    },
    "right": {
        "thumb": ("大拇指", ((240, 239, 238), (256, 255, 254), (16, 15, 14), (32, 31, 30)), ((47,),)),
        "index": ("食指", ((237, 236, 235), (253, 252, 251), (13, 12, 11), (29, 28, 27)), ((44,),)),
        "middle": ("中指", ((234, 233, 232), (250, 249, 248), (10, 9, 8), (26, 25, 24)), ((41,),)),
        "ring": ("无名指", ((231, 230, 229), (247, 246, 245), (7, 6, 5), (23, 22, 21)), ((38,),)),
        "little": ("小拇指", ((228, 227, 226), (244, 243, 242), (4, 3, 2), (20, 19, 18)), ((35,),)),
        "palm": ("手掌", (
            (61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50),
            (80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66),
            (96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82),
            (112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98),
            (128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114),
        )),
    },
}


def _region_plan(name: str, rows, cols: int):
    """把 1 基行表整理为每帧复用的只读描述：名称、形状、行长与 0 基来源下标。"""
    return (name, len(rows), cols, tuple(len(row) for row in rows),
            tuple(position - 1 for row in rows for position in row))


def _side_plan(layout: dict) -> dict:
    plan = {}
    for key in FINGER_KEYS:
        name, rows, pulp = layout[key]
        plan[key] = (_region_plan(name, rows, 3), _region_plan(f"{name}指腹", pulp, 1))
    plan["palm"] = _region_plan(layout["palm"][0], layout["palm"][1], 15)
    return plan


_REGION_PLANS = {side: _side_plan(layout) for side, layout in _REGION_LAYOUTS.items()}


def _read_region(plan, pressure: bytes, full_scale: float, pulp: Region | None = None) -> Region:
    """按分区行表读取压力；每个输出数组都是独立快照，0 是有效测量值。"""
    name, rows, cols, row_lengths, indices = plan
    raw = bytes(pressure[position] for position in indices)
    matrix, offset = [], 0
    for length in row_lengths:
        matrix.append(list(raw[offset:offset + length]))
        offset += length
    fields = (name, rows, cols, row_lengths, array("H", indices), raw,
              array("f", [value / full_scale for value in raw]), matrix)
    return Region(*fields) if pulp is None else FingerRegion(*fields, pulp)


def _require_side(side, message: str) -> None:
    if side not in ("left", "right"):
        error = invalid_config(message, option="side")
        error.suggestion = "按实际连接的左手或右手设置 side；不能根据包类型或串口顺序猜测。"
        raise error


def _pressure_bytes(pressure, length: int, message: str, suggestion: str) -> bytes:
    """复制并校验原始压力/载荷长度；不接受字符串或其他非字节输入。"""
    actual = len(pressure) if isinstance(pressure, (bytes, bytearray)) else (
        pressure.nbytes if isinstance(pressure, memoryview) else None)
    if actual != length:
        raise ShroomParseError(message, code="PARSE_FAILED", stage="parse", suggestion=suggestion,
                               details={"expected_length": length, "actual_length": actual})
    return bytes(pressure)


def create_glove_regions(pressure, *, side: str, full_scale: float = 255) -> tuple[GloveFingers, Region]:
    """提取命名五指、独立指腹与行长不齐的手掌，返回 (fingers, palm)。

    pressure 必须是 256 字节、保持原始扫描顺序的 ADC；side 按实物明确为 left / right。
    values = raw / full_scale，不做物理量标定或截断；手掌 row_lengths 为 (12, 15, 15, 15, 15)。
    """
    _require_side(side, "手套分区需要明确指定 side 为 left 或 right")
    _number(full_scale, "full_scale", 0, inclusive=False)
    data = _pressure_bytes(pressure, 256, "手套分区需要 256 字节的原始扫描压力数据",
                           "请传入整帧 256 通道的原始压力，不要传入映射后的展示矩阵。")
    plan = _REGION_PLANS[side]
    fingers = {key: _read_region(plan[key][0], data, full_scale,
                                 _read_region(plan[key][1], data, full_scale))
               for key in FINGER_KEYS}
    return GloveFingers(**fingers), _read_region(plan["palm"], data, full_scale)


def create_glove_frame(pressure, *, side: str, product: str, packet_type: int, imu: bytes,
                       protocol: str | None = None, sequence: int | None = None,
                       full_scale: float = 255, threshold: float = 0.02) -> GloveFrame:
    """由已组包的 256 通道压力生成手套帧；协议身份、序号和 IMU 由调用的适配器提供。

    输入会被复制，保留的帧不随串口缓存复用而改变；不会构造不存在的 sequence。
    """
    _require_side(side, "手套需要明确指定 side 为 left 或 right")
    data = _pressure_bytes(pressure, 256, "手套压力需要 256 字节的原始扫描数据",
                           "确认已按协议完成组包，再生成手套帧。")
    sources = _MATRIX_SOURCES[side]
    matrix = bytes(data[source] if source >= 0 else 0 for source in sources)
    base = decode_frame(matrix, rows=13, cols=15, full_scale=full_scale, threshold=threshold)
    # 分区从原始扫描压力取值，不经旧版 195 格展示矩阵，避免重复映射。
    fingers, palm = create_glove_regions(data, side=side, full_scale=full_scale)
    return GloveFrame(raw=data, values=base.values, rows=13, cols=15, min=base.min, max=base.max,
                      avg=base.avg, area=base.area, center=base.center, timestamp=base.timestamp,
                      product=product, side=side, pressure=data, pressure_matrix=matrix,
                      fingers=fingers, palm=palm, imu=GloveImu(bytes(imu)), packet_type=packet_type,
                      protocol=protocol, sequence=sequence)


def decode_glove_packet(payload, *, side: str, full_scale: float = 255, threshold: float = 0.02) -> GloveFrame:
    """解码一份 274 字节的整包手套载荷（不含串口尾分隔符）。

    载荷为 1 字节序号 + 1 字节包类型 + 256 字节压力 + 16 字节 IMU。必须显式设置 side：
    不能可靠地通过包类型判断左右手。IMU 只保留原始字节，不猜测轴序或单位。
    """
    _require_side(side, "手套需要明确指定 side 为 left 或 right")
    data = _pressure_bytes(payload, 274, "整包手套需要 274 字节载荷（不含串口分隔符）",
                           "确认设备为 handGloveFullPacket 整包协议；分包或旧版手套不能使用此解析器。")
    return create_glove_frame(data[2:258], side=side, product="handGloveFullPacket",
                              packet_type=data[1], sequence=data[0], imu=data[258:274],
                              full_scale=full_scale, threshold=threshold)
