"""结构化 SDK 错误：提供错误码、发生阶段和处理建议，并兼容内置异常捕获。"""

import errno


class ShroomError(Exception):
    """SDK 错误基类；code/stage 用于判断原因，suggestion 用于提示，cause 保留原始异常。"""

    def __init__(self, message: str, *, code: str, stage: str,
                 suggestion: str, details: dict | None = None,
                 cause: BaseException | None = None):
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.suggestion = suggestion
        self.details = dict(details or {})
        self.cause = cause
        if cause is not None:
            self.__cause__ = cause

    def to_dict(self) -> dict:
        """返回可序列化的错误快照；保留诊断字段，不包含原始异常对象。"""
        return {"code": self.code, "message": str(self), "stage": self.stage,
                "suggestion": self.suggestion, "details": dict(self.details)}


class ShroomConfigError(ShroomError, ValueError):
    """调用参数无效；同时可被 ValueError 捕获。"""


class ShroomIOError(ShroomError, OSError):
    """串口查询或输入输出失败；同时可被 OSError 捕获。"""


class ShroomDependencyError(ShroomError, ImportError):
    """所需可选依赖不可用；同时可被 ImportError 捕获。"""


class ShroomStateError(ShroomIOError, RuntimeError):
    """设备已关闭；兼容早期调用方对 RuntimeError 的捕获。"""


class ShroomParseError(ShroomError, ValueError):
    """帧数据无效或解析失败；同时可被 ValueError 捕获。"""


class ShroomParseTypeError(ShroomError, TypeError):
    """输入数据类型不受支持；同时可被 TypeError 捕获。"""


class ShroomPortAmbiguousError(ShroomIOError, ValueError):
    """存在多个候选串口，必须显式指定路径；兼容早期的 ValueError 捕获。"""


class ShroomLicenseError(ShroomError, PermissionError):
    """SDK 授权缺失、失效或功能权限不足；同时可被 PermissionError 捕获。"""


def invalid_config(message: str, *, option: str | None = None,
                   cause: BaseException | None = None) -> ShroomConfigError:
    """构造配置错误；option 标识待修正的参数名，cause 保留校验失败原因。"""
    return ShroomConfigError(message, code="INVALID_CONFIG", stage="configure",
                             suggestion="请检查参数类型、取值范围和行列/线序配置后重试。",
                             details={"option": option} if option else {}, cause=cause)


def serial_error(exc: Exception, stage: str, *, path: str | None = None) -> ShroomIOError:
    """按操作阶段、系统错误码和常见驱动消息分类，无需导入 pySerial。

    path 用于定位端口；原始异常由 cause 保留，常见原因映射到稳定的 SDK 错误码。
    """
    number = getattr(exc, "errno", None)
    message = str(exc)
    lowered = message.lower()
    code = {"query": "CONNECTION_FAILED", "connect": "CONNECTION_FAILED",
            "read": "READ_FAILED", "write": "WRITE_FAILED", "close": "CLOSE_FAILED"}[stage]
    if stage != "close":
        if number in (errno.EBUSY, errno.EAGAIN) or any(text in lowered for text in (
                "resource busy", "port busy", "already open", "in use", "exclusively lock")):
            code = "PORT_BUSY"
        elif number in (errno.EACCES, errno.EPERM) or isinstance(exc, PermissionError) or any(
                text in lowered for text in ("permission denied", "access is denied", "access denied")):
            code = "PERMISSION_DENIED"
        elif stage in ("read", "write") and (number in (errno.ENODEV, errno.ENXIO, errno.EIO)
                or any(text in lowered for text in (
                    "disconnected", "unplugged", "device not connected", "clearcommerror failed",
                    "device reports readiness to read but returned no data"))):
            code = "DISCONNECTED"
        elif stage == "connect" and (number in (errno.ENOENT, errno.ENODEV, errno.ENXIO)
                or isinstance(exc, FileNotFoundError) or any(text in lowered for text in (
                    "no such file", "cannot find", "could not find", "port not found"))):
            code = "PORT_NOT_FOUND"
    suggestions = {
        "PORT_BUSY": "请关闭其他占用串口的软件，再重试连接。",
        "PERMISSION_DENIED": "请检查串口访问权限，并关闭可能占用串口的软件。",
        "PORT_NOT_FOUND": "请检查设备连接和驱动，并用 list_ports() 确认端口名称。",
        "DISCONNECTED": "设备可能已拔出；请检查线缆和供电，再显式重新连接。",
        "READ_FAILED": "请检查设备连接、串口驱动和读取参数后重试。",
        "WRITE_FAILED": "请检查设备连接，以及待发送数据和设备协议后重试。",
        "CLOSE_FAILED": "关闭串口失败；请检查驱动及操作系统中的端口占用状态。",
        "CONNECTION_FAILED": "请检查设备、驱动、端口名称和串口配置后重试。",
    }
    details = {"path": path} if path is not None else {}
    if number is not None:
        details["errno"] = number
    winerror = getattr(exc, "winerror", None)
    if winerror is not None:
        details["winerror"] = winerror
    return ShroomIOError(message or f"Serial {stage} failed", code=code, stage=stage,
                         suggestion=suggestions[code], details=details, cause=exc)


# 与 JavaScript SDK 的 ERROR_CODES 一致；业务逻辑应按 code 判断，而不是匹配文案。
ERROR_CODES = (
    "INVALID_CONFIG", "DEPENDENCY_MISSING", "PORT_NOT_FOUND", "PORT_AMBIGUOUS",
    "PERMISSION_DENIED", "PORT_BUSY", "CONNECTION_FAILED", "UNSUPPORTED_ENVIRONMENT",
    "USER_CANCELLED", "DISCONNECTED", "READ_FAILED", "WRITE_FAILED", "CLOSE_FAILED",
    "PARSE_FAILED", "CALLBACK_FAILED",
    "SERVER_CLOSED", "SERVER_ERROR", "SERVER_START_FAILED", "INVALID_REQUEST", "ORIGIN_DENIED",
    "REQUEST_FAILED", "REQUEST_TIMEOUT", "RECORDING_ACTIVE", "RECORDING_NOT_ACTIVE",
    "RECORDING_NOT_FOUND", "RECORDING_INTERRUPTED", "RECORDING_OVERFLOW", "RECORDING_WRITE_FAILED",
    "LICENSE_REQUIRED", "LICENSE_INVALID", "LICENSE_EXPIRED", "LICENSE_UNAVAILABLE",
    "LICENSE_REJECTED", "LICENSE_PRODUCT_MISMATCH", "LICENSE_SCOPE_DENIED", "LICENSE_FEATURE_DENIED",
    "LICENSE_DEVICE_REQUIRED",
)

_HINTS = {
    "INVALID_CONFIG": "检查参数名称、类型与范围；设备连接前即可修正配置。",
    "DEPENDENCY_MISSING": "请运行 python -m pip install pyserial 安装串口依赖。",
    "PORT_NOT_FOUND": "检查设备、USB 线与驱动，重新查询并明确指定串口。",
    "PORT_AMBIGUOUS": "存在多个串口，请明确指定目标端口，不能据此自动识别传感器。",
    "PERMISSION_DENIED": "检查系统串口权限，以及端口是否被其他程序占用。",
    "PORT_BUSY": "关闭占用此串口的上位机、终端或其他程序后重试。",
    "CONNECTION_FAILED": "核对端口、驱动、权限和波特率，并查看原始错误。",
    "DISCONNECTED": "检查 USB 与设备供电；确认设备恢复后由应用显式重新连接。",
    "READ_FAILED": "检查设备连接和供电；确认原因后关闭连接并重新打开。",
    "WRITE_FAILED": "检查连接状态及发送字节是否符合设备协议，不自动重发指令。",
    "CLOSE_FAILED": "检查原始关闭错误；连接已停止交付数据，确认端口是否释放。",
    "PARSE_FAILED": "核对分隔符、帧长、矩阵尺寸、点位排列与设备协议。",
    "CALLBACK_FAILED": "检查应用的数据回调；一个回调失败不会中断其他订阅。",
}
_IO_CODES = frozenset(("PORT_NOT_FOUND", "PERMISSION_DENIED", "PORT_BUSY", "CONNECTION_FAILED",
                       "DISCONNECTED", "READ_FAILED", "WRITE_FAILED", "CLOSE_FAILED"))


def make_error(code: str, message: str, *, stage: str, suggestion: str | None = None,
               details: dict | None = None, cause: BaseException | None = None) -> ShroomError:
    """按错误码选择兼容内置异常的子类；产品、数据流和录制模块共用此入口。

    配置错误兼容 ValueError，I/O 类兼容 OSError，授权类兼容 PermissionError；
    服务、请求和录制状态类使用 ShroomError 基类。suggestion 省略时取该错误码的默认建议。
    """
    if code == "INVALID_CONFIG":
        kind = ShroomConfigError
    elif code == "PARSE_FAILED":
        kind = ShroomParseError
    elif code == "DEPENDENCY_MISSING":
        kind = ShroomDependencyError
    elif code == "PORT_AMBIGUOUS":
        kind = ShroomPortAmbiguousError
    elif code in _IO_CODES:
        kind = ShroomIOError
    elif code.startswith("LICENSE_"):
        kind = ShroomLicenseError
    else:
        kind = ShroomError
    return kind(message, code=code, stage=stage,
                suggestion=suggestion or _HINTS.get(code, "检查原始错误与当前配置。"),
                details=details, cause=cause)


def as_shroom_error(error: BaseException, *, code: str = "CONNECTION_FAILED", stage: str = "connect",
                    message: str | None = None, suggestion: str | None = None) -> ShroomError:
    """把未知异常转换为 ShroomError；已有的 SDK 错误原样返回，原始异常保留在 cause。"""
    if isinstance(error, ShroomError):
        return error
    return make_error(code, message or str(error) or type(error).__name__, stage=stage,
                      suggestion=suggestion, cause=error)
