"""人体全身适配器：保留全部扫描字节，并按十块物理源矩阵提取 400 点。

十块物理采集矩阵不包含模型 UV、屏幕左右翻转或重复显示行。来源表使用 1 基通道号，
这里只在定义时转换一次，帧内 source_indices 统一为 0 基；名称保留来源 key，不推断穿戴者左右。
"""

from array import array
from types import MappingProxyType

from ..errors import invalid_config
from ..frame import Center, decode_frame
from ..product_frames import BodyFrame, BodyRegion
from ._adapter import TAIL, ProductAdapter
from ._stream import (float32_list, stream_array, stream_invalid, stream_number, stream_object,
                      stream_output, stream_pressure_fields)
from ._tail import TailParser

PROFILE = MappingProxyType({
    "product": "humanBody", "label": "人体全身", "family": "body",
    "baud_rate": 1000000, "payload_length": 1024, "sensor_points": 1024,
    "mapped_sensor_points": 400, "rows": 32, "cols": 32,
})

_CHANNELS = {
    "back": (
        (619, 620, 621, 622, 623, 609, 610, 611, 612, 613),
        (651, 652, 653, 654, 655, 641, 642, 643, 644, 645),
        (683, 684, 685, 686, 687, 673, 674, 675, 676, 677),
        (75, 76, 77, 78, 79, 65, 66, 67, 68, 69),
        (43, 44, 45, 46, 47, 33, 34, 35, 36, 37),
        (11, 12, 13, 14, 15, 1, 2, 3, 4, 5),
    ),
    "chest": (
        (692, 691, 690, 689, 688, 682, 681, 680, 679, 678),
        (660, 659, 658, 657, 656, 650, 649, 648, 647, 646),
        (628, 627, 626, 625, 624, 618, 617, 616, 615, 614),
        (20, 19, 18, 17, 16, 10, 9, 8, 7, 6),
        (52, 51, 50, 49, 48, 42, 41, 40, 39, 38),
        (84, 83, 82, 81, 80, 74, 73, 72, 71, 70),
    ),
    "rightArm": (
        (736, 768, 800, 832, 864, 1024, 992),
        (735, 767, 799, 831, 863, 1023, 991),
        (734, 766, 798, 830, 862, 1022, 990),
        (733, 765, 797, 829, 861, 1021, 989),
        (732, 764, 796, 828, 860, 1020, 988),
        (731, 763, 795, 827, 859, 1019, 987),
    ),
    "rightShoulder": (
        (960, 928, 896),
        (959, 927, 895),
        (958, 926, 894),
        (957, 925, 893),
        (956, 924, 892),
        (955, 923, 891),
    ),
    "leftArm": (
        (1013, 981, 853, 821, 789, 757, 725),
        (1014, 982, 854, 822, 790, 758, 726),
        (1015, 983, 855, 823, 791, 759, 727),
        (1016, 984, 856, 824, 792, 760, 728),
        (1017, 985, 857, 825, 793, 761, 729),
        (1018, 986, 858, 826, 794, 762, 730),
    ),
    "leftShoulder": (
        (885, 917, 949),
        (886, 918, 950),
        (887, 919, 951),
        (888, 920, 952),
        (889, 921, 953),
        (890, 922, 954),
    ),
    "backPantsRight": (
        (197, 196, 195, 194, 193),
        (165, 164, 163, 162, 161),
        (133, 132, 131, 130, 129),
        (101, 100, 99, 98, 97),
        (229, 228, 227, 226, 225),
        (261, 260, 259, 258, 257),
        (293, 292, 291, 290, 289),
        (325, 324, 323, 322, 321),
    ),
    "backPantsLeft": (
        (495, 494, 493, 492, 491),
        (527, 526, 525, 524, 523),
        (559, 558, 557, 556, 555),
        (591, 590, 589, 588, 587),
        (463, 462, 461, 460, 459),
        (431, 430, 429, 428, 427),
        (399, 398, 397, 396, 395),
        (367, 366, 365, 364, 363),
    ),
    "frontPantsLeft": (
        (500, 499, 498, 497, 496),
        (532, 531, 530, 529, 528),
        (564, 563, 562, 561, 560),
        (596, 595, 594, 593, 592),
        (468, 467, 466, 465, 464),
        (436, 435, 434, 433, 432),
        (404, 403, 402, 401, 400),
        (372, 371, 370, 369, 368),
    ),
    "frontPantsRight": (
        (202, 201, 200, 199, 198),
        (170, 169, 168, 167, 166),
        (138, 137, 136, 135, 134),
        (106, 105, 104, 103, 102),
        (234, 233, 232, 231, 230),
        (266, 265, 264, 263, 262),
        (298, 297, 296, 295, 294),
        (330, 329, 328, 327, 326),
    ),
}

#: 区域名 → (行数, 列数, 0 基来源下标)；只读，帧内数组均为独立快照。
HUMAN_BODY_REGION_LAYOUTS = MappingProxyType({
    name: (len(rows), len(rows[0]), tuple(channel - 1 for row in rows for channel in row))
    for name, rows in _CHANNELS.items()
})
_BYTE_VALUES = float32_list(value / 255 for value in range(256))


def _validate_options(options, invalid) -> None:
    """人体没有手侧选择；左右区域随整帧一起输出，不据此猜测安装朝向。"""
    if not isinstance(options, dict):
        invalid("options", "人体产品解析参数必须是对象。")
    if "side" in options:
        invalid("side", "人体全身不接受 side 参数，十个源矩阵随整帧一起返回。")


def _raise_config(field: str, message: str):
    raise invalid_config(message, option=field)


def _build_regions(payload: bytes) -> dict:
    """每帧新建区域快照，matrix 和 raw 保留 ADC 原值，values 只做除以 255 的归一化。"""
    regions = {}
    for key, (rows, cols, indices) in HUMAN_BODY_REGION_LAYOUTS.items():
        raw = bytes(payload[index] for index in indices)
        regions[key] = BodyRegion(
            name=key, rows=rows, cols=cols, source_indices=array("H", indices), raw=raw,
            values=array("f", [value / 255 for value in raw]),
            matrix=[list(raw[row * cols:(row + 1) * cols]) for row in range(rows)])
    return regions


def _decode(payload: bytes) -> BodyFrame:
    base = decode_frame(payload, rows=32, cols=32, layout="raw")
    return BodyFrame(raw=base.raw, values=base.values, rows=32, cols=32, min=base.min, max=base.max,
                     avg=base.avg, area=base.area, center=base.center, timestamp=base.timestamp,
                     product=PROFILE["product"], pressure=base.raw, pressure_matrix=base.raw,
                     regions=_build_regions(base.raw))


def _create_parser(options: dict | None = None) -> TailParser:
    """固定 1024 字节 + AA 55 03 99 帧尾；32×32 仅表示扫描存储形状，不是人体展开图。"""
    _validate_options({} if options is None else options, _raise_config)
    return TailParser(payload_length=PROFILE["payload_length"], delimiter=TAIL, decode_payload=_decode)


def _read_stream_region(value, key: str, frame_raw: list, typed: bool) -> dict:
    """WS 中的线序必须与内置物理表完全相同，并逐点核对原始值、矩阵和归一化值。"""
    field = f"regions.{key}"
    rows, cols, layout = HUMAN_BODY_REGION_LAYOUTS[key]
    size = len(layout)
    stream_object(value, field)
    if value.get("name") != key or value.get("rows") != rows or value.get("cols") != cols:
        stream_invalid(f"{field}.shape")
    indices = stream_array(value.get("sourceIndices"), f"{field}.sourceIndices", maximum=size)
    raw = stream_array(value.get("raw"), f"{field}.raw", maximum=size, byte=True)
    values = stream_array(value.get("values"), f"{field}.values", maximum=size)
    if len(indices) != size or len(raw) != size or len(values) != size:
        stream_invalid(f"{field}.length")
    # 身体通道可到 1023，不能使用 0–255 的字节限制或先转成更窄的类型。
    for i in range(size):
        index = stream_number(indices[i], f"{field}.sourceIndices[{i}]", 0, 1023, True)
        if index != layout[i]:
            stream_invalid(f"{field}.sourceIndices[{i}]")
        if raw[i] != frame_raw[index]:
            stream_invalid(f"{field}.raw[{i}]")
    if float32_list(values) != [_BYTE_VALUES[entry] for entry in raw]:
        stream_invalid(f"{field}.values")
    matrix_input = value.get("matrix")
    if not isinstance(matrix_input, (list, tuple)) or len(matrix_input) != rows:
        stream_invalid(f"{field}.matrix")
    matrix = []
    for row_index, row in enumerate(matrix_input):
        result = stream_array(row, f"{field}.matrix[{row_index}]", maximum=cols, byte=True)
        if result != raw[row_index * cols:(row_index + 1) * cols]:
            stream_invalid(f"{field}.matrix[{row_index}]")
        matrix.append(result)
    return {"name": key, "rows": rows, "cols": cols, "matrix": matrix,
            "sourceIndices": stream_output(list(layout), typed, "H"),
            "raw": stream_output(raw, typed, "B"), "values": stream_output(values, typed, "f")}


def _read_stream_fields(source: dict, output: dict, typed: bool) -> dict:
    """白名单复制人体字段；完整扫描矩阵不得混入屏幕显示映射或裁剪后的数值。"""
    stream_pressure_fields(source, output, typed)
    raw = list(output["raw"])
    if (source.get("product") != PROFILE["product"] or output["rows"] != 32 or output["cols"] != 32
            or len(raw) != 1024 or len(output["values"]) != 1024):
        stream_invalid("humanBody.shape")
    if (list(output["pressureMatrix"]) != raw
            or float32_list(output["values"]) != [_BYTE_VALUES[entry] for entry in raw]):
        stream_invalid("humanBody.scanOrder")
    regions = stream_object(source.get("regions"), "regions")
    if len(regions) != len(HUMAN_BODY_REGION_LAYOUTS) or any(key not in regions for key in HUMAN_BODY_REGION_LAYOUTS):
        stream_invalid("regions.keys")
    output["regions"] = {key: _read_stream_region(regions[key], key, raw, typed)
                         for key in HUMAN_BODY_REGION_LAYOUTS}
    return output


def _build_frame(fields: dict) -> BodyFrame:
    regions = {key: BodyRegion(name=region["name"], rows=region["rows"], cols=region["cols"],
                               source_indices=region["sourceIndices"], raw=region["raw"],
                               values=region["values"], matrix=region["matrix"])
               for key, region in fields["regions"].items()}
    return BodyFrame(
        raw=fields["raw"], values=fields["values"], rows=fields["rows"], cols=fields["cols"],
        min=fields["min"], max=fields["max"], avg=fields["avg"], area=fields["area"],
        center=Center(fields["center"]["x"], fields["center"]["y"]), timestamp=fields["timestamp"],
        product=fields["product"], pressure=fields["pressure"], pressure_matrix=fields["pressureMatrix"],
        regions=regions)


ADAPTER = ProductAdapter(
    profile=PROFILE,
    aliases=("body",),
    option_fields=(),
    validate_options=_validate_options,
    connection_info=lambda options: {},
    create_parser=_create_parser,
    read_stream_fields=_read_stream_fields,
    build_frame=_build_frame,
)
