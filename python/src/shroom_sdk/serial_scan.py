"""产品发现：逐个串口只读采样，用完整的产品帧确认协议与身份，释放端口后才返回结果。

目前只有分包手套支持发现：在 921600 波特率下读取完整的首尾包，按包类型 1 / 2 识别左 / 右手。
这只识别手侧，不把类型字节当作设备的唯一编号；扫描到的样本不会进入业务回调或采集。
"""

from time import monotonic

from ._serial_path import path_key, reserve_serial_path
from .device import _serial_module, list_ports
from .errors import ShroomError, as_shroom_error, invalid_config, make_error, serial_error
from .license import _assert_license
from .products import get_device_product_adapter

_MAX_PROBE_BYTES = 2 * 1024 * 1024
_MIN_FRAMES = 3
_ABORTING = ("CLOSE_FAILED", "USER_CANCELLED")


def _cancelled() -> ShroomError:
    return make_error("USER_CANCELLED", "串口自动识别已取消。", stage="query",
                      suggestion="需要识别时重新调用扫描或连接。")


def prepare_product_scan(product="glove", *, side=None, paths=None, timeout=1.2, cancel=None) -> dict:
    """在加载驱动和访问硬件之前验证扫描配置；哪些产品支持发现由适配器声明。"""
    def invalid(field: str):
        return invalid_config(f"无效的扫描参数 {field}。", option=field)
    adapter = get_device_product_adapter(product)
    if adapter is None or adapter.discovery is None:
        raise invalid("product")
    if side is not None and side not in ("left", "right"):
        raise invalid("side")
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0.05 <= timeout <= 10:
        raise invalid("timeout")
    if cancel is not None and not callable(getattr(cancel, "is_set", None)):
        raise invalid("cancel")
    if paths is not None:
        if (isinstance(paths, str) or not isinstance(paths, (list, tuple)) or not paths
                or any(not isinstance(path, str) or not path.strip() for path in paths)):
            raise invalid("paths")
        paths = list({path_key(path): path.strip() for path in paths}.values())
    return {"adapter": adapter, "side": side, "paths": paths, "timeout": float(timeout), "cancel": cancel}


def _probe_port(serial, path: str, config: dict):
    """对单个串口做有界采样，返回识别到的身份或 None；端口确认释放后才解除预约。"""
    adapter, cancel = config["adapter"], config["cancel"]
    _assert_license("serial")
    if cancel is not None and cancel.is_set():
        raise _cancelled()
    parser = adapter.discovery.create_parser()
    release_path = reserve_serial_path(path)
    try:
        port = serial.serial_for_url(path, baudrate=adapter.profile["baud_rate"], timeout=0.05)
    except Exception as exc:
        release_path()
        raise serial_error(exc, "connect", path=path) from exc
    failure = identity = None
    mixed, count, received = False, 0, 0
    deadline = monotonic() + config["timeout"]
    try:
        while monotonic() < deadline:
            if cancel is not None and cancel.is_set():
                failure = _cancelled()
                break
            _assert_license("serial")
            try:
                chunk = port.read(min(4096, max(1, port.in_waiting)))
            except Exception as exc:
                failure = serial_error(exc, "read", path=path)
                break
            if not chunk:
                continue
            received += len(chunk)
            if received > _MAX_PROBE_BYTES:
                failure = make_error("PARSE_FAILED", "扫描数据超过单口采样上限。", stage="parse", details={"path": path})
                break
            try:
                for frame in parser.push(chunk):
                    found = adapter.discovery.identify(frame)
                    if identity is None:
                        identity = found
                    elif found != identity:
                        mixed = True  # 同一串口出现两种身份：不能当作一只确定的手。
                    count += 1
            except Exception as exc:
                failure = as_shroom_error(exc, code="PARSE_FAILED", stage="parse")
                break
    except ShroomError as error:  # 采样期间授权失效。
        failure = error
    try:
        port.close()
    except Exception as exc:
        if getattr(port, "is_open", False) is True:
            # 无法确认释放：保留路径预约并终止本轮扫描，不能重开仍被占用的串口。
            raise make_error("CLOSE_FAILED", "扫描串口尚未确认释放，已停止继续扫描。", stage="close", cause=exc,
                             details={"path": path},
                             suggestion="等待驱动完成关闭，或检查设备连接；不能重开仍占用的串口。") from exc
    release_path()
    if failure is not None:
        raise failure
    return identity if not mixed and count >= _MIN_FRAMES else None


def scan_product_ports(product="glove", *, side=None, paths=None, timeout=1.2, cancel=None) -> dict:
    """临时打开候选串口读取完整协议帧，全部关闭后返回识别到的设备与逐口诊断。

    product 目前只支持分包手套（``glove`` / ``handGloveSegmented``）。side 只保留指定手侧的
    设备；paths 限定候选串口（默认扫描系统的全部串口）；timeout 是每个串口的采样秒数
    （0.05–10，默认 1.2）；cancel 可传 ``threading.Event``，置位后扫描以 USER_CANCELLED 结束。

    返回 ``{"devices": [...], "ports": [...]}``：devices 的每项含 ``path / product / label /
    baud_rate / side / packet_type``（以及可用时的 ``serial_number``）；ports 逐口给出
    ``status``（``matched`` / ``unrecognized`` / ``error``），并附 ``device`` 或 ``error``（字典）。
    同一串口至少收到 3 个完整且手侧一致的帧才算识别成功。需要含 serial 功能的 SDK 授权。
    被本进程其他连接或扫描占用的串口报告为 PORT_BUSY，不会被抢占。
    """
    config = prepare_product_scan(product, side=side, paths=paths, timeout=timeout, cancel=cancel)
    adapter, cancel = config["adapter"], config["cancel"]

    def assert_active() -> None:
        if cancel is not None and cancel.is_set():
            raise _cancelled()
        _assert_license("serial")
    assert_active()
    serial = _serial_module("query")
    if config["paths"] is not None:
        candidates = [(path, None) for path in config["paths"]]
    else:
        candidates = [(port.path, port.serial_number) for port in list_ports()]
    report = {"devices": [], "ports": []}
    seen = set()
    for path, serial_number in candidates:
        assert_active()
        if not isinstance(path, str) or not path.strip() or path_key(path) in seen:
            continue
        seen.add(path_key(path))
        try:
            identity = _probe_port(serial, path, config)
            assert_active()
        except ShroomError as error:
            if error.code in _ABORTING or error.stage == "license":
                raise
            report["ports"].append({"path": path, "status": "error", "error": error.to_dict()})
            continue
        if identity is None:
            report["ports"].append({"path": path, "status": "unrecognized"})
            continue
        device = {"path": path, "product": adapter.profile["product"], "label": adapter.profile["label"],
                  "baud_rate": adapter.profile["baud_rate"], **identity}
        if serial_number:
            device["serial_number"] = serial_number
        report["ports"].append({"path": path, "status": "matched", "device": device})
        if config["side"] is None or device["side"] == config["side"]:
            report["devices"].append(dict(device))
    assert_active()
    return report
