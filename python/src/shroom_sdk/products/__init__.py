"""已支持产品的唯一静态注册表：登记规范 ID、连接别名及适配器。

新产品实现独立适配器后在此登记；不会根据参数、数据长度或设备名猜测产品。
"""

from . import body, glove, glove_segmented, insole, pad
from ._adapter import ProductAdapter

DEVICE_PRODUCT_ADAPTERS: tuple[ProductAdapter, ...] = (
    glove_segmented.ADAPTER, glove.ADAPTER, pad.ADAPTER, body.ADAPTER, insole.ADAPTER)

_CANONICAL: dict[str, ProductAdapter] = {}
_CONNECTION: dict[str, ProductAdapter] = {}
for _adapter in DEVICE_PRODUCT_ADAPTERS:
    _canonical = _adapter.profile["product"]
    for _name in (_canonical, *_adapter.aliases):
        if not isinstance(_name, str) or not _name or _name in _CONNECTION:
            raise RuntimeError(f"产品注册表包含无效或重复 ID：{_name!r}")
        _CONNECTION[_name] = _adapter
    _CANONICAL[_canonical] = _adapter
del _adapter, _canonical, _name


def get_device_product_adapter(product, *, allow_aliases: bool = True) -> ProductAdapter | None:
    """连接可接受别名；网络帧必须使用规范 ID，避免扩大 WS 协议的接受范围。"""
    if not isinstance(product, str):
        return None
    return (_CONNECTION if allow_aliases else _CANONICAL).get(product)
