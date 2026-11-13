"""手部检测垫适配器：固定 1024 点协议、mat32 映射与压力帧校验。"""

from types import MappingProxyType

from ..frame import Center, decode_frame
from ..layout import get_named_layout
from ..product_frames import PadFrame
from ._adapter import TAIL, ProductAdapter
from ._stream import stream_invalid, stream_pressure_fields
from ._tail import TailParser

PROFILE = MappingProxyType({
    "product": "hand", "label": "手部检测垫", "family": "mat",
    "baud_rate": 1000000, "payload_length": 1024, "sensor_points": 1024, "rows": 32, "cols": 32,
})


def _validate_options(options: dict, invalid) -> None:
    if options.get("side") is not None:
        invalid("side", "手部检测垫不需要 side 参数。")


def _decode(payload: bytes) -> PadFrame:
    base = decode_frame(payload, layout="mat32")
    perm = get_named_layout("mat32").perm
    # pressure 保持原始扫描顺序；pressure_matrix 是按 mat32 搬到实际位置后的 ADC。
    return PadFrame(raw=base.raw, values=base.values, rows=base.rows, cols=base.cols, min=base.min,
                    max=base.max, avg=base.avg, area=base.area, center=base.center,
                    timestamp=base.timestamp, product=PROFILE["product"], pressure=base.raw,
                    pressure_matrix=bytes(payload[source] for source in perm))


def _create_parser(options: dict | None = None) -> TailParser:
    return TailParser(payload_length=PROFILE["payload_length"], delimiter=TAIL, decode_payload=_decode)


def _read_stream_fields(source: dict, output: dict, typed: bool) -> dict:
    stream_pressure_fields(source, output, typed)
    if output["rows"] != 32 or output["cols"] != 32 or len(output["raw"]) != 1024:
        stream_invalid("hand.shape")
    return output


def _build_frame(fields: dict) -> PadFrame:
    return PadFrame(
        raw=fields["raw"], values=fields["values"], rows=fields["rows"], cols=fields["cols"],
        min=fields["min"], max=fields["max"], avg=fields["avg"], area=fields["area"],
        center=Center(fields["center"]["x"], fields["center"]["y"]), timestamp=fields["timestamp"],
        product=fields["product"], pressure=fields["pressure"], pressure_matrix=fields["pressureMatrix"])


ADAPTER = ProductAdapter(
    profile=PROFILE,
    aliases=("pad",),
    # 允许省略或显式传 side=None；非空手侧仍按原接口规则拒绝。
    option_fields=("side",),
    validate_options=_validate_options,
    connection_info=lambda options: {},
    create_parser=_create_parser,
    read_stream_fields=_read_stream_fields,
    build_frame=_build_frame,
)
