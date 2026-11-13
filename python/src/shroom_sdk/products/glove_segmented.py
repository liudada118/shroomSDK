"""手套分包协议：130 字节首包 + 146 字节尾包，各带 AA 55 03 99 帧尾。

byte[0] 是段号 1/2；byte[1] 在自动模式下表示 1=左手、2=右手，并非连续帧序号。
side="auto" 从包内识别手侧；显式 left / right 保留手动映射及原始 0–255 配对类型兼容。
协议无 CRC 和真实序号，不能证明完整采样帧从未丢失；仅发布同连接、同类型的有效配对。
"""

from types import MappingProxyType

from ..errors import invalid_config
from ..glove import create_glove_frame
from . import _adapter
from ._adapter import TAIL, Discovery, ProductAdapter, chunk_bytes
from ._stream import stream_invalid, stream_number
from .glove import build_glove_frame, read_glove_data_fields

FIRST_SIZE = 130
SECOND_SIZE = 146
PAIR_TIMEOUT_MS = 1000
SIDE_BY_TYPE = {1: "left", 2: "right"}
_BUFFER_SIZE = SECOND_SIZE + len(TAIL)
PROFILE = MappingProxyType({
    "product": "handGloveSegmented", "label": "触觉手套（分包）", "family": "glove",
    "baud_rate": 921600, "payload_length": 276, "sensor_points": 256, "rows": 13, "cols": 15,
    "first_packet_length": FIRST_SIZE, "second_packet_length": SECOND_SIZE,
})


def _validate_options(options: dict, invalid) -> None:
    if not isinstance(options, dict) or options.get("side") not in ("left", "right", "auto"):
        invalid("side", "分包手套必须指定 side: left、right 或 auto；auto 根据包内手侧识别，left/right 使用指定线序。")


def _raise_config(field: str, message: str):
    raise invalid_config(message, option=field)


class SegmentedGloveParser:
    """每个连接对应一只手，只保留最新首包；新首包、错类型尾包都不能带过旧缓存。

    待处理数据最多保留一个最大分包加帧尾的长度，无论串口输入多大都不累积整块输入。
    """

    def __init__(self, side: str):
        self._side = side
        self.reset()

    def reset(self) -> None:
        self._pending = b""
        self._overflow = False
        self._first = None  # (128 字节压力, 配对类型, 收到时间)
        self._dropped = self._frame_length = 0

    @property
    def dropped_count(self) -> int:
        return self._dropped

    @property
    def frame_length(self) -> int:
        return self._frame_length

    def _discard_first(self) -> None:
        if self._first is not None:
            self._first = None
            self._dropped += 1

    def _expire_first(self, now: float) -> None:
        first = self._first
        if first is not None and (now < first[2] or now - first[2] > PAIR_TIMEOUT_MS):
            self._discard_first()

    def _process(self, packet: bytes, now: float):
        length = len(packet)
        if length == 1 and packet[0] == 3:
            self._discard_first()
            return None
        if not ((length == FIRST_SIZE and packet[0] == 1) or (length == SECOND_SIZE and packet[0] == 2)):
            self._discard_first()
            self._dropped += 1
            return None
        packet_type = packet[1]
        side = SIDE_BY_TYPE.get(packet_type) if self._side == "auto" else self._side
        if side is None:
            # 自动识别只接受已定义的左右手类型；未知类型不能把前一只手的半包带过去。
            self._discard_first()
            self._dropped += 1
            return None
        if length == FIRST_SIZE:
            self._discard_first()
            self._first = (packet[2:FIRST_SIZE], packet_type, now)
            return None
        head, self._first = self._first, None  # 尾包总会消费缓存一次；孤立或重复尾包不能发布。
        if head is None or head[1] != packet_type:
            self._dropped += 1
            return None
        self._frame_length = FIRST_SIZE + SECOND_SIZE
        # 保留原始 16 字节 IMU，不猜测四元数轴序、单位，也不伪造 sequence。
        return create_glove_frame(head[0] + packet[2:130], side=side, product=PROFILE["product"],
                                  protocol="segmented", packet_type=packet_type, imu=packet[130:SECOND_SIZE])

    def push(self, chunk) -> list:
        data = chunk_bytes(chunk, "手套分包输入必须是字节数据。")
        now = _adapter.now_ms()
        self._expire_first(now)
        data = self._pending + data
        frames, offset = [], 0
        while True:
            tail = data.find(TAIL, offset)
            if tail < 0:
                break
            length = tail - offset
            self._expire_first(now)
            if self._overflow:
                self._dropped += 1
            elif length > SECOND_SIZE:
                # 超长段：首包不能跨过未知数据，整段计为一次丢弃。
                self._discard_first()
                self._dropped += 1
            elif length > 0:
                frame = self._process(data[offset:tail], now)
                if frame is not None:
                    frames.append(frame)
            else:
                # 空帧尾也是边界；若位于首尾包之间，不能把首包带过未知数据段。
                self._discard_first()
            self._overflow = False
            offset = tail + len(TAIL)
        pending = data[offset:]
        if len(pending) > _BUFFER_SIZE:
            # 超长段丢弃至下个帧尾，仅留最后 3 字节以识别跨读取边界的分隔符。
            self._overflow = True
            self._discard_first()
            pending = pending[-(len(TAIL) - 1):]
        self._pending = pending
        return frames


def _create_parser(options: dict) -> SegmentedGloveParser:
    _validate_options(options, _raise_config)
    return SegmentedGloveParser(options["side"])


def _read_stream_fields(source: dict, output: dict, typed: bool) -> dict:
    read_glove_data_fields(source, output, typed)
    if source.get("protocol") != "segmented":
        stream_invalid("protocol")
    if "sequence" in source:
        stream_invalid("sequence")
    packet_type = stream_number(source.get("packetType"), "packetType", 0, 255, True)
    output["protocol"] = "segmented"
    output["packetType"] = packet_type
    return output


ADAPTER = ProductAdapter(
    profile=PROFILE,
    aliases=("glove",),
    option_fields=("side",),
    validate_options=_validate_options,
    connection_info=lambda options: ({"protocol": "segmented"} if options["side"] == "auto"
                                     else {"side": options["side"], "protocol": "segmented"}),
    create_parser=_create_parser,
    read_stream_fields=_read_stream_fields,
    build_frame=build_glove_frame,
    # 串口扫描复用正式解析器，只有完整首尾包才提供左右手识别结果。
    discovery=Discovery(
        create_parser=lambda: SegmentedGloveParser("auto"),
        identify=lambda frame: {"side": frame.side, "packet_type": frame.packet_type}),
)
