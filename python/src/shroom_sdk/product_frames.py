"""产品帧数据类：在通用 Frame 之上增加手套、手垫、人体与鞋垫的专用字段。

属性使用 snake_case；to_dict() 返回与 JavaScript SDK 相同字段名的 JSON 快照
（pressureMatrix、sourceIndices 等），可直接 json.dumps，也是 WS 传输和录制使用的格式。
字节类数据为 bytes，浮点为 array('f')，超过 255 的整数通道为 array('H')。
"""

from array import array
from dataclasses import dataclass

from .frame import Frame

_SAFE_INTEGER = 9007199254740992.0


def wire_number(value):
    """整数值的浮点数写成整数，与 JSON.stringify 的输出一致，也让录制文件更紧凑。"""
    if type(value) is float and value.is_integer() and -_SAFE_INTEGER < value < _SAFE_INTEGER:
        return int(value)
    return value


def wire_floats(values) -> list:
    """把 float32 数组转成 JSON 数值列表；规则同 wire_number。"""
    # 用取模判断整数值：手工构造的帧可能含 int，而 int.is_integer 只在 Python 3.12 起存在。
    return [int(v) if v % 1 == 0 and -_SAFE_INTEGER < v < _SAFE_INTEGER else v for v in values]


def base_wire_fields(frame: Frame) -> dict:
    """通用 Frame 的传输字段；产品帧在此基础上追加自己的字段。"""
    return {
        "raw": list(frame.raw), "values": wire_floats(frame.values),
        "rows": frame.rows, "cols": frame.cols,
        "min": wire_number(frame.min), "max": wire_number(frame.max), "avg": wire_number(frame.avg),
        "area": frame.area,
        "center": {"x": wire_number(frame.center.x), "y": wire_number(frame.center.y)},
        "timestamp": frame.timestamp,
    }


@dataclass(frozen=True)
class Region:
    """手套的一个命名分区：按真实行长保存原始 ADC、相对值和来源通道。

    source_indices 是 0 基原始扫描通道下标；matrix 的每行长度见 row_lengths，
    手掌首行 12 点、其余 15 点，不补零。values = raw / full_scale，不是物理量。
    """

    name: str
    rows: int
    cols: int
    row_lengths: tuple[int, ...]
    source_indices: array  # uint16
    raw: bytes
    values: array  # float32
    matrix: list[list[int]]

    def to_dict(self) -> dict:
        return {"name": self.name, "rows": self.rows, "cols": self.cols,
                "rowLengths": list(self.row_lengths), "sourceIndices": list(self.source_indices),
                "raw": list(self.raw), "values": wire_floats(self.values),
                "matrix": [list(row) for row in self.matrix]}


@dataclass(frozen=True)
class FingerRegion(Region):
    """一根手指的 4×3 主体，pulp 为独立的 1×1 指腹点。"""

    pulp: Region

    def to_dict(self) -> dict:
        result = super().to_dict()
        result["pulp"] = self.pulp.to_dict()
        return result


FINGER_KEYS = ("thumb", "index", "middle", "ring", "little")


@dataclass(frozen=True)
class GloveFingers:
    """五指分区；可用属性访问，也可用 items() 按 thumb → little 顺序遍历。"""

    thumb: FingerRegion
    index: FingerRegion
    middle: FingerRegion
    ring: FingerRegion
    little: FingerRegion

    def items(self):
        return [(key, getattr(self, key)) for key in FINGER_KEYS]

    def to_dict(self) -> dict:
        return {key: finger.to_dict() for key, finger in self.items()}


@dataclass(frozen=True)
class GloveImu:
    """手套 IMU 的 16 个原始字节；SDK 不解释轴序、四元数语义或单位。"""

    raw: bytes

    def to_dict(self) -> dict:
        return {"raw": list(self.raw)}


@dataclass(frozen=True)
class ProductFrame(Frame):
    """产品帧基类；product 始终是正式产品 ID，不使用连接别名。"""

    product: str


@dataclass(frozen=True)
class PadFrame(ProductFrame):
    """手部检测垫：pressure 是 1024 字节原扫描 ADC，pressure_matrix 是 mat32 映射后的 ADC。"""

    pressure: bytes
    pressure_matrix: bytes

    def to_dict(self) -> dict:
        return {**base_wire_fields(self), "product": self.product,
                "pressure": list(self.pressure), "pressureMatrix": list(self.pressure_matrix)}


@dataclass(frozen=True)
class GloveFrame(ProductFrame):
    """触觉手套帧：256 通道原始压力、五指/指腹/手掌分区与原始 IMU。

    raw / pressure 是同一份原始扫描压力；pressure_matrix / values / rows / cols 是旧版
    13×15 展示矩阵，仅为兼容保留，新业务读取 fingers 与 palm。分包协议的 protocol 为
    'segmented' 且没有 sequence；整包协议的 protocol 为 None 并带设备帧序号。
    packet_type 是原始包类型字节，不代表手侧。
    """

    side: str
    pressure: bytes
    pressure_matrix: bytes
    fingers: GloveFingers
    palm: Region
    imu: GloveImu
    packet_type: int
    protocol: str | None = None
    sequence: int | None = None

    def to_dict(self) -> dict:
        result = {**base_wire_fields(self), "product": self.product,
                  "pressure": list(self.pressure), "pressureMatrix": list(self.pressure_matrix),
                  "side": self.side, "imu": self.imu.to_dict(),
                  "fingers": self.fingers.to_dict(), "palm": self.palm.to_dict()}
        if self.protocol is not None:
            result["protocol"] = self.protocol
        result["packetType"] = self.packet_type
        if self.sequence is not None:
            result["sequence"] = self.sequence
        return result


@dataclass(frozen=True)
class BodyRegion:
    """人体的一块物理源矩阵；source_indices 为 0 基扫描通道（可到 1023）。"""

    name: str
    rows: int
    cols: int
    source_indices: array  # uint16
    raw: bytes
    values: array  # float32
    matrix: list[list[int]]

    def to_dict(self) -> dict:
        return {"name": self.name, "rows": self.rows, "cols": self.cols,
                "sourceIndices": list(self.source_indices), "raw": list(self.raw),
                "values": wire_floats(self.values), "matrix": [list(row) for row in self.matrix]}


@dataclass(frozen=True)
class BodyFrame(ProductFrame):
    """人体全身帧：1024 个扫描 ADC 与十块物理矩阵（共 400 点）。

    顶层 32×32 只是扫描存储形状，不是身体平面图；regions 的键保留来源名称。
    """

    pressure: bytes
    pressure_matrix: bytes
    regions: dict

    def to_dict(self) -> dict:
        return {**base_wire_fields(self), "product": self.product,
                "pressure": list(self.pressure), "pressureMatrix": list(self.pressure_matrix),
                "regions": {key: region.to_dict() for key, region in self.regions.items()}}


@dataclass(frozen=True)
class InsolePosition:
    """鞋垫一个真实传感点的位置：14×8 点表的零基行列与原始毫米坐标。"""

    row: int
    col: int
    x_mm: float
    y_mm: float

    def to_dict(self) -> dict:
        return {"row": self.row, "col": self.col, "xMm": wire_number(self.x_mm), "yMm": wire_number(self.y_mm)}


@dataclass(frozen=True)
class InsoleSensors:
    """鞋垫 A 版 112 个真实点：来源扫描下标、坐标、原始 ADC 与相对值。"""

    rows: int
    cols: int
    source_indices: array  # uint16
    positions: tuple[InsolePosition, ...]
    raw: object  # 12bit 为 array('H')，8bit 为 bytes
    values: array  # float32

    def to_dict(self) -> dict:
        return {"rows": self.rows, "cols": self.cols,
                "positions": [position.to_dict() for position in self.positions],
                "sourceIndices": list(self.source_indices), "raw": list(self.raw),
                "values": wire_floats(self.values)}


@dataclass(frozen=True)
class InsoleImu:
    """鞋垫 IMU：原始字节与按小端 float32 解出的分量；不归一化、不推断单位。

    两种协议都有 quaternion（4 个分量）；12bit 另有 gyroscope 与 acceleration（各 3 个）。
    """

    raw: bytes
    quaternion: array  # float32
    gyroscope: array | None = None
    acceleration: array | None = None

    def to_dict(self) -> dict:
        result = {"raw": list(self.raw), "quaternion": wire_floats(self.quaternion)}
        if self.gyroscope is not None:
            result["gyroscope"] = wire_floats(self.gyroscope)
        if self.acceleration is not None:
            result["acceleration"] = wire_floats(self.acceleration)
        return result


@dataclass(frozen=True)
class InsoleFrame(ProductFrame):
    """鞋垫帧：raw 保留原始 ADC 字节，pressure 为 256 个扫描 ADC。

    12bit 协议的 pressure / pressure_matrix 为 array('H')（0–4095），8bit 为 bytes，并带
    分包序号 sequence。顶层 16×16 是扫描顺序，不代表鞋形；真实点位见 sensors。
    """

    side: str
    protocol: str
    bit_depth: int
    full_scale: int
    pressure: object
    pressure_matrix: object
    imu: InsoleImu
    sensors: InsoleSensors
    sequence: int | None = None

    def to_dict(self) -> dict:
        result = {**base_wire_fields(self), "product": self.product, "side": self.side,
                  "protocol": self.protocol, "bitDepth": self.bit_depth, "fullScale": self.full_scale}
        if self.sequence is not None:
            result["sequence"] = self.sequence
        result.update(pressure=list(self.pressure), pressureMatrix=list(self.pressure_matrix),
                      imu=self.imu.to_dict(), sensors=self.sensors.to_dict())
        return result
