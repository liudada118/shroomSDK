"""设备来源登记：区分 SDK 自建的模拟源与已按授权打开的真实设备。

登记按对象身份保存在模块内部，应用修改设备公开的 info 不会改变这份记录。
源码交付下这不是防篡改机制，只保证正常使用路径上的授权判断一致。
"""

import weakref

_mock_devices = weakref.WeakSet()
_licensed_devices = weakref.WeakKeyDictionary()


def mark_mock_device(device):
    """登记 SDK 自带的模拟设备实例；只有这些实例可走免授权演示路线，子类实例不登记。"""
    _mock_devices.add(device)
    return device


def is_mock_device(device) -> bool:
    """是否为 SDK 内部创建并登记的模拟实例；不能靠改公开 info 冒充。"""
    try:
        return device in _mock_devices
    except TypeError:
        return False


def mark_licensed_device(device, feature: str):
    """把连接时的权限要求绑定到设备实例。"""
    _licensed_devices[device] = feature
    return device


def get_device_license_feature(device) -> str | None:
    """返回设备连接时要求的功能；未登记的外部来源返回 None，由服务层决定如何校验。"""
    try:
        return _licensed_devices.get(device)
    except TypeError:
        return None


class FrozenSource:
    """模拟源的取数与订阅方法不能在实例上替换，避免把自定义数据接入免授权路线。"""

    _FROZEN = frozenset(("read_frame", "frames", "on_frame", "on_data", "on_error",
                         "_pump_frames", "_start_pump", "_packets"))
    # 这些属性只在构造时赋值一次：订阅中心、内部数据源与产品解析会话。
    _ONCE = frozenset(("_hub", "_source", "_session"))

    def __setattr__(self, name, value):
        if name in self._FROZEN or (name in self._ONCE and name in self.__dict__):
            raise AttributeError(f"模拟设备的 {name} 不可替换；自定义数据源请自行实现并按真实数据授权。")
        super().__setattr__(name, value)
