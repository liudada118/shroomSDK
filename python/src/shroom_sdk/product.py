"""产品连接适配层：按产品规则生成串口配置，再把字节流解析成产品帧。

本模块不打开端口，也不自动识别设备或侧别；实际连接见 product_device.py。
"""

from dataclasses import dataclass

from .errors import invalid_config
from .products import DEVICE_PRODUCT_ADAPTERS, get_device_product_adapter
from .products._adapter import ProductAdapter


@dataclass(frozen=True)
class ProductSession:
    """一次产品连接的准备结果：串口参数、独立解析器与设备元数据；不代表已连接。"""

    adapter: ProductAdapter
    baud_rate: int
    parser: object
    info: dict


def list_device_products() -> list[dict]:
    """列出已封装连接协议的产品（默认配置的副本）；不等于通用线序/展示产品清单，也不探测硬件。"""
    return [dict(adapter.profile) for adapter in DEVICE_PRODUCT_ADAPTERS]


def _invalid(field: str, message: str):
    raise invalid_config(message, option=field)


def prepare_product_connection(product, options: dict | None = None) -> ProductSession:
    """在打开端口前验证产品及其专用参数，只允许产品适配器明确支持的配置。

    options 是产品专用参数（如 side、protocol、baud_rate）；值为 None 视为未提供。
    波特率、分帧和线序由产品固定，自定义协议请使用通用 connect()。
    """
    if options is None:
        options = {}
    if not isinstance(options, dict):
        _invalid("options", "产品连接参数必须是一个字典。")
    adapter = get_device_product_adapter(product)
    if adapter is None:
        supported = " 或 ".join(f"{a.profile['product']}（{a.profile['label']}）" for a in DEVICE_PRODUCT_ADAPTERS)
        _invalid("product", f"请选择已支持的产品：{supported}。")
    options = {key: value for key, value in options.items() if value is not None}
    for field in options:
        if field not in adapter.option_fields:
            _invalid(field, f"当前产品不支持 {field} 配置；可用参数由产品协议决定。自定义协议请使用 connect()。")
    adapter.validate_options(options, _invalid)
    # 部分产品明确支持多个传输格式/波特率，交由自身适配器解析，公共入口不判断型号。
    profile = adapter.resolve_profile(options) if adapter.resolve_profile else adapter.profile
    info = {"product": profile["product"], "label": profile["label"],
            "rows": profile["rows"], "cols": profile["cols"], **adapter.connection_info(options)}
    return ProductSession(adapter, profile["baud_rate"], adapter.create_parser(options), info)


def create_product_parser(product, **options):
    """从注册表创建产品自己的流解析器；不靠帧长推测型号或手侧。

    返回带 push(chunk) / reset() 和 dropped_count / frame_length 的解析器，每个连接各建一个。
    鞋垫和整包手套必须明确传入 side='left' 或 'right'；分包手套另支持 side='auto'，按包类型 1=左、2=右识别。
    """
    adapter = get_device_product_adapter(product)
    if adapter is None:
        _invalid("product", "请选择已支持的产品，并按产品说明配置侧别与协议。")
    options = {key: value for key, value in options.items() if value is not None}
    for field in options:
        if field not in adapter.option_fields:
            _invalid(field, f"当前产品不支持 {field} 配置。")
    # 与连接入口使用同一套参数校验，不让无意义的参数（如手垫的 side）被悄悄忽略。
    adapter.validate_options(options, _invalid)
    return adapter.create_parser(options)
