"""Python SDK 公共入口：核心解析、产品协议、模拟设备与数据服务只依赖标准库。

真实串口通过可选依赖 pySerial 提供；离线签名校验按需加载 cryptography。
可直接导入函数，也可通过 Shroom 统一调用。本入口不自动激活授权或连接设备。
"""

from .device import Device, MockDevice, PortInfo, SerialDevice, connect, list_ports, mock
from .display import render_ascii
from .frame import Center, Frame, decode_frame, get_layout, resolve_shape
from .framer import DEFAULT_DELIMITER, Framer
from .errors import (ERROR_CODES, ShroomConfigError, ShroomDependencyError, ShroomError, ShroomIOError,
                     ShroomParseError, ShroomParseTypeError, ShroomPortAmbiguousError,
                     ShroomStateError, ShroomLicenseError, as_shroom_error)
from .license import activate_license, clear_license, get_license_status
from .layout import LAYOUTS, PRODUCTS, get_product, list_layouts, list_products
from .colormap import COLORMAPS, get_colormap, grey, jet, jet_white, shroom
from .glove import create_glove_regions, decode_glove_packet
from .product import create_product_parser, list_device_products
from .product_frames import (BodyFrame, BodyRegion, FingerRegion, GloveFingers, GloveFrame, GloveImu,
                             InsoleFrame, InsoleImu, InsolePosition, InsoleSensors, PadFrame,
                             ProductFrame, Region)
from .product_device import (ManagedSerialDevice, ProductMockDevice, connect_glove, connect_hand_pad,
                             connect_product, create_product_mock_device)
from .serial_scan import scan_product_ports
from .stream_codec import STREAM_SCHEMA, decode_stream_frame, encode_stream_frame
from .recording import create_recording_url
from .quick_server import StreamServer, serve_device
from .stream_client import StreamClient, connect_stream, save_recording
from .flow import (ProductServer, create_ws, download_recording, read_product, start_recording,
                   stop_recording)
from .backend_client import BackendError, BackendSdkClient
from ._version import __version__

__all__ = ["Shroom", "Device", "SerialDevice", "MockDevice", "PortInfo", "Frame", "Center",
           "connect", "mock", "list_ports", "render_ascii", "decode_frame", "resolve_shape",
           "get_layout", "Framer", "DEFAULT_DELIMITER", "ShroomError", "ShroomConfigError",
           "ShroomDependencyError", "ShroomIOError", "ShroomParseError", "ShroomParseTypeError",
           "ShroomPortAmbiguousError", "ShroomStateError", "ShroomLicenseError",
           "activate_license", "clear_license", "get_license_status", "__version__",
           # 线序与通用矩阵产品菜单
           "LAYOUTS", "PRODUCTS", "list_layouts", "list_products", "get_product",
           # 调色板（供应用自行绘图时着色）
           "COLORMAPS", "get_colormap", "shroom", "jet", "jet_white", "grey",
           # 产品协议与产品帧
           "list_device_products", "create_product_parser", "decode_glove_packet", "create_glove_regions",
           "ProductFrame", "GloveFrame", "GloveFingers", "GloveImu", "Region", "FingerRegion",
           "PadFrame", "BodyFrame", "BodyRegion", "InsoleFrame", "InsoleImu", "InsoleSensors",
           "InsolePosition",
           # 产品连接与模拟
           "connect_product", "connect_glove", "connect_hand_pad", "create_product_mock_device",
           "scan_product_ports",
           "ManagedSerialDevice", "ProductMockDevice",
           # 数据服务、录制与下载
           "serve_device", "StreamServer", "connect_stream", "StreamClient", "save_recording",
           "encode_stream_frame", "decode_stream_frame", "STREAM_SCHEMA", "create_recording_url",
           # 五步快速流程
           "read_product", "create_ws", "start_recording", "stop_recording", "download_recording",
           "ProductServer",
           # 已有后端的连接客户端与错误工具
           "BackendSdkClient", "BackendError", "ERROR_CODES", "as_shroom_error"]


class Shroom:
    """常用接口的命名空间；静态方法与同名模块函数共用实现。"""

    version = __version__
    connect = staticmethod(connect)
    mock = staticmethod(mock)
    list_ports = staticmethod(list_ports)
    render_ascii = staticmethod(render_ascii)
    activate_license = staticmethod(activate_license)
    get_license_status = staticmethod(get_license_status)
    clear_license = staticmethod(clear_license)
    # 选产品即可收取已解析数据。
    connect_product = staticmethod(connect_product)
    connect_glove = staticmethod(connect_glove)
    connect_hand_pad = staticmethod(connect_hand_pad)
    list_device_products = staticmethod(list_device_products)
    # 只读打开候选串口，按完整产品帧识别左右手；结果返回前释放端口。
    scan_product_ports = staticmethod(scan_product_ports)
    mock_product = staticmethod(create_product_mock_device)
    # 将已有设备发布为 WS 数据源，并提供持久化标签录制与下载。
    serve_device = staticmethod(serve_device)
    connect_stream = staticmethod(connect_stream)
    encode_stream_frame = staticmethod(encode_stream_frame)
    decode_stream_frame = staticmethod(decode_stream_frame)
    STREAM_SCHEMA = STREAM_SCHEMA
    # 线序与通用矩阵产品菜单。
    list_layouts = staticmethod(list_layouts)
    list_products = staticmethod(list_products)
    get_product = staticmethod(get_product)
