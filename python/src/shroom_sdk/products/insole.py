"""鞋垫 A 版：显式协议与脚侧、原始 ADC/IMU、112 个真实点位及 WS 校验。

坐标表是原始传感器坐标与扫描线序，不包含显示插值、左右脚镜像或标定。
来源 JQInsoleStudio_v2.3_dev_3.html；每项为 (data_col, x_mm, y_mm)。
"""

from array import array
from math import isfinite
import struct
import sys
from time import time_ns
from types import MappingProxyType

from ..errors import invalid_config
from ..frame import Center
from ..product_frames import InsoleFrame, InsoleImu, InsolePosition, InsoleSensors
from . import _adapter
from ._adapter import TAIL as MAGIC, ProductAdapter, chunk_bytes
from ._stream import (MAX_NUMBER, float32_list, stream_invalid, stream_number, stream_numbers,
                      stream_object, stream_output)

BAUD_RATES = (921600, 1500000, 3000000, 460800, 256000, 115200, 9600)
SEGMENT_MAX_AGE_MS = 1000
# 协议名 → (位深, 满量程, ADC 字节数, IMU 字节数, 载荷长度, ADC 数组类型码)
PROTOCOLS = MappingProxyType({
    "12bit": (12, 4095, 512, 40, 552, "H"),
    "8bit": (8, 255, 256, 16, 272, "B"),
})
PROFILE = MappingProxyType({
    "product": "jqInsole", "label": "鞋垫（A 版）", "family": "insole",
    "baud_rate": 921600, "payload_length": 552, "sensor_points": 256,
    "mapped_sensor_points": 112, "rows": 16, "cols": 16,
})

_SOURCE_ROWS = (
    ((1, -14.2, -1.6), (2, -10.2, -0.2), (3, -6.3, 0.2), (4, -1.9, 0.7), (5, 1.9, 0.9), (6, 5.8, 0.5), (7, 10.3, 0.1), (8, 15.6, -0.7)),
    ((1, -20, -18.3), (2, -14.6, -16.9), (3, -9.1, -16), (4, -2.7, -15.4), (5, 3.2, -15), (6, 9.9, -15), (7, 16.5, -15.3), (8, 23.9, -16.4)),
    ((1, -24, -36.3), (2, -17, -34), (3, -10, -32.2), (4, -2.8, -31.1), (5, 5.3, -31.1), (6, 13, -31), (7, 21.6, -31.7), (8, 30.2, -32.2)),
    ((1, -25.8, -52.6), (2, -17.9, -50.3), (3, -9.5, -48.1), (4, -1.6, -47.3), (5, 7.2, -46.1), (6, 16.5, -46.1), (7, 25.3, -46.7), (8, 33.6, -47.5)),
    ((1, -24, -68.5), (2, -16.5, -65.9), (3, -8.6, -64.5), (4, 0.6, -62.8), (5, 9.5, -62.4), (6, 18.4, -61.9), (7, 27.2, -62.8), (8, 34.8, -63.5)),
    ((1, -20.8, -83.3), (2, -14, -80.9), (3, -6.3, -79.3), (4, 2.1, -77.7), (5, 10.4, -77.5), (6, 18.7, -77.6), (7, 27.2, -78.5), (8, 35.3, -79.6)),
    ((1, -16.825, -97.7), (2, -11.7, -96.3), (3, -4.2, -94.7), (4, 3, -93.8), (5, 9.9, -93.3), (6, 17.4, -93.2), (7, 25.3, -93.9), (8, 32.8, -94.9)),
    ((1, -15.5, -112.1), (2, -10, -111), (3, -4, -109.7), (4, 2.5, -108.9), (5, 8.6, -108.9), (6, 15.5, -109.3), (7, 22.5, -109.5), (8, 29.4, -110.4)),
    ((1, -13.9, -126.7), (2, -9.1, -125.5), (3, -3.6, -125), (4, 1.8, -124.6), (5, 7.6, -124.3), (6, 13.2, -124.6), (7, 19, -124.6), (8, 25.3, -125.3)),
    ((1, -13.2, -141.2), (2, -8.8, -140.4), (3, -3.6, -140), (4, 1.2, -140), (5, 6.3, -140), (6, 11.3, -140.3), (7, 16.5, -140.6), (8, 21.9, -141.3)),
    ((1, -13.2, -156.1), (2, -8.8, -155.7), (3, -4.3, -155.4), (4, 0.9, -155.7), (5, 6.2, -155.4), (6, 11.3, -155.8), (7, 16.4, -156.1), (8, 22.1, -156.9)),
    ((1, -13.9, -170.9), (2, -9.4, -171.4), (3, -4.3, -171.7), (4, 1, -172), (5, 6.3, -172.3), (6, 11.8, -172.6), (7, 17.4, -172.3), (8, 23.5, -172.3)),
    ((1, -14, -184.2), (2, -9.4, -185.4), (3, -4.4, -186.3), (4, 0.7, -186.6), (5, 5.8, -187.3), (6, 11.8, -187.2), (7, 17.8, -186.8), (8, 23, -186.6)),
    ((1, -13.7, -197.5), (2, -9.1, -199.3), (3, -4.2, -200.7), (4, 0.7, -201.9), (5, 5.8, -202.6), (6, 11.4, -202.6), (7, 16.7, -202.1), (8, 21.6, -201.4)),
)
#: row/col 是 14×8 原始点表的零基索引，并非扫描矩阵坐标；左右脚共用同一坐标表。
INSOLE_POSITIONS = tuple(InsolePosition(b, col, float(x), float(y))
                         for b, row in enumerate(_SOURCE_ROWS) for col, (_, x, y) in enumerate(row))


def _source_indices(side: str) -> tuple:
    return tuple((8 - dc if side == "right" else dc + 7) * 16 + (2 + b if side == "right" else 13 - b)
                 for b, row in enumerate(_SOURCE_ROWS) for dc, _, _ in row)


INSOLE_SOURCE_INDICES = MappingProxyType({side: _source_indices(side) for side in ("left", "right")})


def _validate_options(options, invalid) -> None:
    if not isinstance(options, dict):
        invalid("options", "鞋垫参数必须为对象。")
    if options.get("side") not in ("left", "right"):
        invalid("side", "鞋垫必须明确指定 side: left 或 right；协议没有可靠的脚侧标识。")
    protocol = options.get("protocol")
    if protocol is not None and (not isinstance(protocol, str) or protocol not in PROTOCOLS):
        invalid("protocol", "鞋垫 protocol 必须为 12bit 或 8bit。")
    baud_rate = options.get("baud_rate")
    if baud_rate is not None and (isinstance(baud_rate, bool) or baud_rate not in BAUD_RATES):
        invalid("baud_rate", "请选择鞋垫支持的波特率：921600、1500000、3000000、460800、256000、115200 或 9600。")


def _raise_config(field: str, message: str):
    raise invalid_config(message, option=field)


def _decode_imu(raw: bytes, imu_bytes: int):
    """不归一化四元数、不融合姿态、不猜测单位；非有限浮点数使整个候选帧无效。"""
    components = struct.unpack(f"<{imu_bytes // 4}f", raw)
    if not all(map(isfinite, components)):
        return None
    if imu_bytes == 40:
        return InsoleImu(raw, array("f", components[:4]), array("f", components[4:7]), array("f", components[7:10]))
    return InsoleImu(raw, array("f", components[:4]))


def _decode_adc(raw: bytes, bit_depth: int):
    """12bit 为 256 个小端 uint16，8bit 每点一个字节；返回可按下标读取的 ADC 序列。"""
    if bit_depth != 12:
        return raw
    pressure = array("H")
    pressure.frombytes(raw)
    if sys.byteorder == "big":
        pressure.byteswap()
    return pressure


def _decode_payload(payload: bytes, side: str, protocol: str, sequence: int | None = None):
    bit_depth, full_scale, adc_bytes, imu_bytes, _, _ = PROTOCOLS[protocol]
    raw = payload[:adc_bytes]
    pressure = _decode_adc(raw, bit_depth)
    if max(pressure) > full_scale:
        return None
    imu = _decode_imu(payload[adc_bytes:], imu_bytes)
    if imu is None:
        return None
    # 基础矩阵统计作用于 16×16 扫描顺序，不代表鞋形或物理足底重心。
    values = array("f")
    low, high, total, weight, cx, cy, area = float("inf"), 0.0, 0.0, 0.0, 0.0, 0.0, 0
    for i in range(256):
        value = pressure[i] / full_scale
        values.append(value)
        low, high = min(low, value), max(high, value)
        total += value
        if value > 0.02:
            area += 1
            weight += value
            cx += (i % 16) * value
            cy += (i // 16) * value
    center = Center(cx / weight / 15, cy / weight / 15) if weight else Center(0.5, 0.5)
    indices = INSOLE_SOURCE_INDICES[side]
    sensor_raw = [pressure[index] for index in indices]
    sensors = InsoleSensors(
        rows=14, cols=8, source_indices=array("H", indices), positions=INSOLE_POSITIONS,
        raw=array("H", sensor_raw) if bit_depth == 12 else bytes(sensor_raw),
        values=array("f", [value / full_scale for value in sensor_raw]))
    return InsoleFrame(
        raw=raw, values=values, rows=16, cols=16, min=low, max=high, avg=total / 256, area=area,
        center=center, timestamp=time_ns() // 1_000_000, product=PROFILE["product"], side=side,
        protocol=protocol, bit_depth=bit_depth, full_scale=full_scale, pressure=pressure,
        pressure_matrix=pressure[:], imu=imu, sensors=sensors, sequence=sequence)


class InsoleParser:
    """同步头在前的鞋垫流解析器：最多缓存一个候选帧，每次只保留一个 128 字节首段。

    12bit 为同步头 + 552 字节整帧；8bit 为 type1（134 字节）+ type2（150 字节）两段，
    仅接受 1 秒内相邻、同 index 的 type1→type2，不跨噪声或错序拼接历史缓存。
    """

    def __init__(self, side: str, protocol: str):
        self._side, self._protocol = side, protocol
        self._payload_length = PROTOCOLS[protocol][4]
        self.reset()

    def reset(self) -> None:
        self._buffer = bytearray()
        self._first = None  # (index, 128 字节载荷, 收到时间)
        self._dropped = self._frame_length = 0

    @property
    def dropped_count(self) -> int:
        return self._dropped

    @property
    def frame_length(self) -> int:
        return self._frame_length

    def _clear_segment(self) -> None:
        if self._first is not None:
            self._dropped += 1
            self._first = None

    def _realign(self) -> bool:
        """丢弃前缀直到缓冲以同步头开始或不足 4 字节；返回是否丢弃过数据。"""
        buffer = self._buffer
        if len(buffer) < 4 or buffer.startswith(MAGIC):
            return False
        position = buffer.find(MAGIC, 1)
        # 找不到同步头时最多留下 3 个可能属于下一同步头的字节。
        del buffer[:position if position >= 0 else len(buffer) - 3]
        return True

    def push(self, chunk) -> list:
        data = chunk_bytes(chunk, "鞋垫输入必须为字节数据。")
        frames = []
        now = _adapter.now_ms()
        first = self._first
        if first is not None and (now - first[2] > SEGMENT_MAX_AGE_MS or now < first[2]):
            self._clear_segment()
        buffer, twelve = self._buffer, self._protocol == "12bit"
        position, total = 0, len(data)
        while position < total:
            used = len(buffer)
            if used < 4 or not buffer.startswith(MAGIC):
                # 未对齐：并入剩余输入后整体查找同步头，被跳过的数据同时清除待配对首段。
                buffer += data[position:]
                position = total
                found = buffer.find(MAGIC)
                if found < 0:
                    if self._realign():
                        self._clear_segment()
                    break
                if found:
                    self._clear_segment()
                # 只保留同步头本身，其后的数据交回下一轮按对齐状态处理。
                position -= len(buffer) - found - 4
                del buffer[found + 4:]
                del buffer[:found]
                continue
            if twelve:
                target = 556
            elif used == 4:
                target = 5
            else:
                target = 134 if buffer[4] == 1 else 150
            take = min(target - used, total - position)
            buffer += data[position:position + take]
            position += take
            if used + take < target:
                break
            if twelve:
                frame = _decode_payload(bytes(buffer[4:556]), self._side, self._protocol)
                if frame is not None:
                    frames.append(frame)
                    self._frame_length = self._payload_length
                    buffer.clear()
                else:
                    self._dropped += 1
                    # 候选帧错误只前移一字节，保留其中可能存在的真正下一帧。
                    del buffer[0]
                    self._realign()
                continue
            kind = buffer[4]
            if target == 5:
                if kind != 1 and kind != 2:
                    self._dropped += 1
                    self._clear_segment()
                    del buffer[0]
                continue
            index = buffer[5]
            if kind == 1:
                self._clear_segment()
                self._first = (index, bytes(buffer[6:134]), now)
            else:
                first, self._first = self._first, None  # 即使 index 不匹配，也不能让旧首段留待下次回绕。
                frame = None
                if first is not None and first[0] == index and 0 <= now - first[2] <= SEGMENT_MAX_AGE_MS:
                    frame = _decode_payload(first[1] + bytes(buffer[6:150]), self._side, self._protocol, index)
                if frame is not None:
                    frames.append(frame)
                    self._frame_length = self._payload_length
                else:
                    self._dropped += 1
            buffer.clear()
        return frames


def _create_parser(options: dict) -> InsoleParser:
    _validate_options(options, _raise_config)
    return InsoleParser(options["side"], options.get("protocol") or "12bit")


def _resolve_profile(options: dict) -> dict:
    _validate_options(options, _raise_config)
    return {**PROFILE, "baud_rate": options.get("baud_rate") or 921600,
            "payload_length": PROTOCOLS[options.get("protocol") or "12bit"][4]}


def _connection_info(options: dict) -> dict:
    protocol = options.get("protocol") or "12bit"
    return {"side": options["side"], "protocol": protocol,
            "bit_depth": PROTOCOLS[protocol][0], "full_scale": PROTOCOLS[protocol][1]}


def _read_stream_fields(source: dict, output: dict, typed: bool) -> dict:
    """发送/接收都逐字段校验，并核对原始字节、扫描 ADC、点位映射与 IMU 解码的一致性。"""
    protocol = source.get("protocol")
    if (source.get("product") != "jqInsole" or source.get("side") not in ("left", "right")
            or not isinstance(protocol, str) or protocol not in PROTOCOLS):
        stream_invalid("insole.product/side/protocol")
    bit_depth, full_scale, adc_bytes, imu_bytes, _, adc_kind = PROTOCOLS[protocol]
    if (source.get("bitDepth") != bit_depth or source.get("fullScale") != full_scale
            or output["rows"] != 16 or output["cols"] != 16 or len(output["raw"]) != adc_bytes):
        stream_invalid("insole.shape")
    pressure = stream_numbers(source.get("pressure"), "pressure", 256, 0, full_scale, True)
    matrix = stream_numbers(source.get("pressureMatrix"), "pressureMatrix", 256, 0, full_scale, True)
    if pressure != list(_decode_adc(bytes(output["raw"]), bit_depth)):
        stream_invalid("pressure/raw")
    if matrix != pressure:
        stream_invalid("pressureMatrix/pressure")
    if list(output["values"]) != float32_list(value / full_scale for value in pressure):
        stream_invalid("values/pressure")
    for field in ("min", "max", "avg"):
        stream_number(output[field], field, 0, 1)

    output.update(product="jqInsole", side=source["side"], protocol=protocol,
                  bitDepth=bit_depth, fullScale=full_scale)
    if protocol == "8bit":
        output["sequence"] = stream_number(source.get("sequence"), "sequence", 0, 255, True)
    elif source.get("sequence") is not None:
        stream_invalid("sequence")
    output["pressure"] = stream_output(pressure, typed, adc_kind)
    output["pressureMatrix"] = stream_output(matrix, typed, adc_kind)

    sensors = stream_object(source.get("sensors"), "sensors")
    layout = list(INSOLE_SOURCE_INDICES[source["side"]])
    if sensors.get("rows") != 14 or sensors.get("cols") != 8:
        stream_invalid("sensors.shape")
    indices = stream_numbers(sensors.get("sourceIndices"), "sensors.sourceIndices", 112, 0, 255, True)
    sensor_raw = stream_numbers(sensors.get("raw"), "sensors.raw", 112, 0, full_scale, True)
    sensor_values = stream_numbers(sensors.get("values"), "sensors.values", 112, 0, 1)
    if indices != layout:
        stream_invalid("sensors.sourceIndices/layout")
    if sensor_raw != [pressure[index] for index in indices]:
        stream_invalid("sensors.raw/pressure")
    if sensor_values != float32_list(value / full_scale for value in sensor_raw):
        stream_invalid("sensors.values/raw")
    positions = sensors.get("positions")
    if not isinstance(positions, (list, tuple)) or len(positions) != 112:
        stream_invalid("sensors.positions")
    for i, position in enumerate(positions):
        stream_object(position, f"sensors.positions[{i}]")
        expected = INSOLE_POSITIONS[i].to_dict()
        for field, value in expected.items():
            actual = position.get(field)
            if type(actual) not in (int, float) or actual != value:
                stream_invalid(f"sensors.positions[{i}].{field}")
    output["sensors"] = {
        "rows": 14, "cols": 8,
        "positions": INSOLE_POSITIONS if typed else [position.to_dict() for position in INSOLE_POSITIONS],
        "sourceIndices": stream_output(indices, typed, "H"),
        "raw": stream_output(sensor_raw, typed, adc_kind),
        "values": stream_output(sensor_values, typed, "f"),
    }

    imu_source = stream_object(source.get("imu"), "imu")
    imu_raw = stream_numbers(imu_source.get("raw"), "imu.raw", imu_bytes, 0, 255, True)
    decoded = _decode_imu(bytes(imu_raw), imu_bytes)
    if decoded is None:
        stream_invalid("imu.raw")
    output["imu"] = {"raw": stream_output(imu_raw, typed, "B")}
    for field in ("quaternion", "gyroscope", "acceleration"):
        expected = getattr(decoded, field)
        if expected is None:
            if imu_source.get(field) is not None:
                stream_invalid(f"imu.{field}")
            continue
        values = stream_numbers(imu_source.get(field), f"imu.{field}", len(expected), -MAX_NUMBER, MAX_NUMBER)
        if values != expected.tolist():
            stream_invalid(f"imu.{field}/raw")
        # JSON 会把 -0 写成 0；验证后按原始字节重建，保留 IEEE-754 的符号位。
        output["imu"][field] = expected if typed else stream_output(expected.tolist(), False, "f")
    return output


def _build_frame(fields: dict) -> InsoleFrame:
    sensors, imu = fields["sensors"], fields["imu"]
    return InsoleFrame(
        raw=fields["raw"], values=fields["values"], rows=fields["rows"], cols=fields["cols"],
        min=fields["min"], max=fields["max"], avg=fields["avg"], area=fields["area"],
        center=Center(fields["center"]["x"], fields["center"]["y"]), timestamp=fields["timestamp"],
        product=fields["product"], side=fields["side"], protocol=fields["protocol"],
        bit_depth=fields["bitDepth"], full_scale=fields["fullScale"], pressure=fields["pressure"],
        pressure_matrix=fields["pressureMatrix"],
        imu=InsoleImu(imu["raw"], imu["quaternion"], imu.get("gyroscope"), imu.get("acceleration")),
        sensors=InsoleSensors(rows=14, cols=8, source_indices=sensors["sourceIndices"],
                              positions=sensors["positions"], raw=sensors["raw"], values=sensors["values"]),
        sequence=fields.get("sequence"))


ADAPTER = ProductAdapter(
    profile=PROFILE,
    aliases=("insole",),
    option_fields=("side", "protocol", "baud_rate"),
    validate_options=_validate_options,
    connection_info=_connection_info,
    create_parser=_create_parser,
    read_stream_fields=_read_stream_fields,
    build_frame=_build_frame,
    resolve_profile=_resolve_profile,
)
