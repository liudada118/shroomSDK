"""Python SDK 公共入口：核心解析与模拟设备不依赖第三方库。

真实串口通过可选依赖 pySerial 提供；离线签名校验按需加载 cryptography。
可直接导入函数，也可通过 Shroom 统一调用。本入口不自动激活授权或连接设备。
"""

from .device import Device, MockDevice, PortInfo, SerialDevice, connect, list_ports, mock
from .display import render_ascii
from .frame import Center, Frame, decode_frame, get_layout, resolve_shape
from .framer import DEFAULT_DELIMITER, Framer
from .errors import (ShroomConfigError, ShroomDependencyError, ShroomError, ShroomIOError,
                     ShroomParseError, ShroomParseTypeError, ShroomPortAmbiguousError,
                     ShroomStateError, ShroomLicenseError)
from .license import activate_license, clear_license, get_license_status
from ._version import __version__

__all__ = ["Shroom", "Device", "SerialDevice", "MockDevice", "PortInfo", "Frame", "Center",
           "connect", "mock", "list_ports", "render_ascii", "decode_frame", "resolve_shape",
           "get_layout", "Framer", "DEFAULT_DELIMITER", "ShroomError", "ShroomConfigError",
           "ShroomDependencyError", "ShroomIOError", "ShroomParseError", "ShroomParseTypeError",
           "ShroomPortAmbiguousError", "ShroomStateError", "ShroomLicenseError",
           "activate_license", "clear_license", "get_license_status", "__version__"]


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
