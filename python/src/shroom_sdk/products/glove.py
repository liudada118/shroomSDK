"""整包触觉手套适配器：固定串口配置、左右手要求、协议解析与 WS 分区校验。"""

from types import MappingProxyType

from ..errors import invalid_config
from ..frame import Center
from ..glove import decode_glove_packet
from ..product_frames import FINGER_KEYS, FingerRegion, GloveFingers, GloveFrame, GloveImu, Region
from ._adapter import TAIL, ProductAdapter
from ._stream import (stream_array, stream_invalid, stream_number, stream_object, stream_output,
                      stream_pressure_fields)
from ._tail import TailParser

PROFILE = MappingProxyType({
    "product": "handGloveFullPacket", "label": "触觉手套（整包）", "family": "glove",
    "baud_rate": 921600, "payload_length": 274, "sensor_points": 256, "rows": 13, "cols": 15,
})


def _validate_options(options: dict, invalid) -> None:
    """手侧必须由应用按实物明确指定，不能从包类型或串口猜测。"""
    if options.get("side") not in ("left", "right"):
        invalid("side", "整包手套必须明确指定 side: left 或 right，不能根据串口或包类型猜测手侧。")


def _raise_config(field: str, message: str):
    raise invalid_config(message, option=field)


def _create_parser(options: dict) -> TailParser:
    _validate_options(options, _raise_config)
    side = options["side"]
    return TailParser(payload_length=PROFILE["payload_length"], delimiter=TAIL,
                      decode_payload=lambda payload: decode_glove_packet(payload, side=side))


def _stream_region(value, field: str, typed: bool, expected_rows: list) -> dict:
    """校验真实行长；手掌保留 72 点，不补成 5×15 的规则矩阵。"""
    stream_object(value, field)
    name = value.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 64:
        stream_invalid(f"{field}.name")
    rows = stream_number(value.get("rows"), f"{field}.rows", 1, 5, True)
    cols = stream_number(value.get("cols"), f"{field}.cols", 1, 15, True)
    row_lengths = stream_array(value.get("rowLengths"), f"{field}.rowLengths", maximum=5, index=True)
    if rows != len(expected_rows) or row_lengths != expected_rows or cols != max(expected_rows):
        stream_invalid(f"{field}.rowLengths")
    size = sum(row_lengths)
    raw = stream_array(value.get("raw"), f"{field}.raw", maximum=75, byte=True)
    values = stream_array(value.get("values"), f"{field}.values", maximum=75)
    indices = stream_array(value.get("sourceIndices"), f"{field}.sourceIndices", maximum=75, index=True)
    if len(raw) != size or len(values) != size or len(indices) != size:
        stream_invalid(f"{field}.length")
    matrix_input = value.get("matrix")
    if not isinstance(matrix_input, (list, tuple)) or len(matrix_input) != rows:
        stream_invalid(f"{field}.matrix")
    matrix = []
    for i, row in enumerate(matrix_input):
        result = stream_array(row, f"{field}.matrix[{i}]", maximum=15, byte=True)
        if len(result) != row_lengths[i]:
            stream_invalid(f"{field}.matrix[{i}]")
        matrix.append(result)
    return {"name": name, "rows": rows, "cols": cols, "rowLengths": row_lengths, "matrix": matrix,
            "raw": stream_output(raw, typed, "B"), "values": stream_output(values, typed, "f"),
            "sourceIndices": stream_output(indices, typed, "H")}


def read_glove_data_fields(source: dict, output: dict, typed: bool) -> dict:
    """两套手套协议共用压力、分区与 IMU 原始字节校验；协议字段由各适配器处理。"""
    stream_pressure_fields(source, output, typed)
    if output["rows"] != 13 or output["cols"] != 15 or len(output["raw"]) != 256:
        stream_invalid("glove.shape")
    if source.get("side") not in ("left", "right"):
        stream_invalid("side")
    output["side"] = source["side"]
    imu_source = stream_object(source.get("imu"), "imu")
    imu = stream_array(imu_source.get("raw"), "imu.raw", maximum=16, byte=True)
    if len(imu) != 16:
        stream_invalid("imu.raw.length")
    output["imu"] = {"raw": stream_output(imu, typed, "B")}
    fingers = stream_object(source.get("fingers"), "fingers")
    output["fingers"] = {}
    for key in FINGER_KEYS:
        field = f"fingers.{key}"
        finger = _stream_region(fingers.get(key), field, typed, [3, 3, 3, 3])
        finger["pulp"] = _stream_region(fingers[key].get("pulp"), f"{field}.pulp", typed, [1])
        output["fingers"][key] = finger
    output["palm"] = _stream_region(source.get("palm"), "palm", typed, [12, 15, 15, 15, 15])
    return output


def _read_stream_fields(source: dict, output: dict, typed: bool) -> dict:
    """整包的 sequence 和 packetType 保持原有含义，不与分包的段号/配对类型混用。"""
    read_glove_data_fields(source, output, typed)
    output["sequence"] = stream_number(source.get("sequence"), "sequence", 0, 255, True)
    output["packetType"] = stream_number(source.get("packetType"), "packetType", 0, 255, True)
    return output


def _region(fields: dict, pulp: Region | None = None) -> Region:
    values = (fields["name"], fields["rows"], fields["cols"], tuple(fields["rowLengths"]),
              fields["sourceIndices"], fields["raw"], fields["values"], fields["matrix"])
    return Region(*values) if pulp is None else FingerRegion(*values, pulp)


def build_glove_frame(fields: dict) -> GloveFrame:
    """把已校验的传输字段还原成 GloveFrame；两套手套协议共用。"""
    fingers = GloveFingers(**{key: _region(finger, _region(finger["pulp"]))
                              for key, finger in fields["fingers"].items()})
    return GloveFrame(
        raw=fields["raw"], values=fields["values"], rows=fields["rows"], cols=fields["cols"],
        min=fields["min"], max=fields["max"], avg=fields["avg"], area=fields["area"],
        center=Center(fields["center"]["x"], fields["center"]["y"]), timestamp=fields["timestamp"],
        product=fields["product"], side=fields["side"], pressure=fields["pressure"],
        pressure_matrix=fields["pressureMatrix"], fingers=fingers, palm=_region(fields["palm"]),
        imu=GloveImu(fields["imu"]["raw"]), packet_type=fields["packetType"],
        protocol=fields.get("protocol"), sequence=fields.get("sequence"))


ADAPTER = ProductAdapter(
    profile=PROFILE,
    aliases=(),
    option_fields=("side",),
    validate_options=_validate_options,
    connection_info=lambda options: {"side": options["side"]},
    create_parser=_create_parser,
    read_stream_fields=_read_stream_fields,
    build_frame=build_glove_frame,
)
