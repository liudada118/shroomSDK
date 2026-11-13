"""WS 帧编解码：发送前把帧转成可 JSON 序列化的字典，接收后校验结构并还原为帧对象。

传输格式与 JavaScript SDK 的 shroom.frame.v1 相同（camelCase 字段）。本模块只转换
传输表示，不重新拆串口包、不二次映射点位，也不推断产品类型。
"""

from .frame import Center, Frame
from .product_frames import wire_number
from .products import get_device_product_adapter
from .products._stream import (STREAM_FRAME_MAX_POINTS, stream_array, stream_invalid, stream_number,
                               stream_object, stream_output)

#: Python / Node 服务和各端客户端共用的传输协议版本标识。
STREAM_SCHEMA = "shroom.frame.v1"
MAX_STREAM_POINTS = STREAM_FRAME_MAX_POINTS


def _read_frame(source, typed: bool) -> tuple[dict, object]:
    """校验并复制通用帧，产品扩展交给注册表中的适配器；typed 决定数组表示。

    不在传输层按产品写分支，新增协议也不能跳过公共帧大小及数值安全检查。
    """
    stream_object(source, "frame")
    rows = stream_number(source.get("rows"), "rows", 0, MAX_STREAM_POINTS, True)
    cols = stream_number(source.get("cols"), "cols", 0, MAX_STREAM_POINTS, True)
    size = rows * cols
    if size > MAX_STREAM_POINTS or (rows == 0) != (cols == 0):
        stream_invalid("rows/cols")
    raw = stream_array(source.get("raw"), "raw", byte=True)
    values = stream_array(source.get("values"), "values")
    if len(values) != size:
        stream_invalid("values.length")
    center = stream_object(source.get("center"), "center")
    scalar = float if typed else wire_number
    output = {
        "raw": stream_output(raw, typed, "B"), "values": stream_output(values, typed, "f"),
        "rows": rows, "cols": cols,
        "min": scalar(stream_number(source.get("min"), "min")),
        "max": scalar(stream_number(source.get("max"), "max")),
        "avg": scalar(stream_number(source.get("avg"), "avg")),
        "area": stream_number(source.get("area"), "area", 0, size, True),
        "center": {"x": scalar(stream_number(center.get("x"), "center.x", 0, 1)),
                   "y": scalar(stream_number(center.get("y"), "center.y", 0, 1))},
        "timestamp": wire_number(stream_number(source.get("timestamp"), "timestamp")),
    }
    if output["min"] > output["max"]:
        stream_invalid("min/max")
    if "product" not in source:
        return output, None
    adapter = get_device_product_adapter(source["product"], allow_aliases=False)
    if adapter is None:
        stream_invalid("product")
    return adapter.read_stream_fields(source, output, typed), adapter


def encode_stream_frame(frame) -> dict:
    """把一帧转换为独立、可 json.dumps 的字典，所有数值数组均为普通列表。

    frame 可以是 Frame / 产品帧对象，也可以是同结构的字典；缺字段或形状不符时
    抛出 PARSE_FAILED。这里只生成字典，不返回 JSON 字符串。
    """
    source = frame.to_dict() if hasattr(frame, "to_dict") else frame
    return _read_frame(source, False)[0]


def decode_stream_frame(frame: dict):
    """把 json.loads 后的帧字典还原成帧对象，保留已有的点位映射结果。

    frame 是网络消息内的帧对象，而非完整 WS 信封或 JSON 字符串。带 product 的帧
    返回对应的产品帧（GloveFrame、PadFrame、BodyFrame、InsoleFrame），否则返回 Frame。
    """
    fields, adapter = _read_frame(frame, True)
    if adapter is not None:
        return adapter.build_frame(fields)
    return Frame(raw=fields["raw"], values=fields["values"], rows=fields["rows"], cols=fields["cols"],
                 min=fields["min"], max=fields["max"], avg=fields["avg"], area=fields["area"],
                 center=Center(fields["center"]["x"], fields["center"]["y"]),
                 timestamp=fields["timestamp"])
