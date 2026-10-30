"""SDK 产品授权：校验 shroom-sdk 密钥，并用短租约管理在线权限。

离线签名校验原始 base64 负载文本，与现有授权后台保持一致；SDK 不包含旧版 AES
解密密钥。授权覆盖全部传感器类型，仍检查有效期、功能权限及配置的电脑名额。
"""

import base64
import binascii
from datetime import datetime
import ipaddress
import json
import math
import re
from threading import RLock, Timer
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import weakref

from .errors import ShroomDependencyError, ShroomLicenseError, invalid_config

PRODUCT_TYPE = "shroom-sdk"
DEFAULT_SERVER_URL = "https://shroom.jq-industries.com"
DEFAULT_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0xly+Gg/8LvoWV0VRO/k
l1dEQRt7N6yilC2yiza+W1V2aXWKoiLlkPcJa9KQmNArjcHq8nBLlEppHjwEm2u5
SrgADP/frf1n8GZpRejZo6Ab1psppUm/neVcoxsK+0z6a00B9syv8AEIt2jrN4ZZ
zz51MgJqzgXmqPaibtzGl8RFr1jYJ2JpXNes6BqFpjQng1S8hu4VgWBIljkE3jKF
fHwTP9KPtEcoH/uSPmW5X7IuwpDW2QO6sO61uv/luLI4Wx4upX4CIUepwIzDyG6B
fYx2AAZJ1oNEBW28wIUf7i5sVT0FsWRsR55Q3KUcsiqAUVduKiKTQN3dnmbyC1Fg
AQIDAQAB
-----END PUBLIC KEY-----"""
_MAX_LEASE_SECONDS = 60.0
_RECHECK_SECONDS = 30.0
_DEVICE_ID = re.compile(r"[a-f0-9]{64}\Z")
_FEATURES = frozenset(("serial", "stream", "recording", "serial.raw"))
_DENIED = frozenset(("EXPIRED", "REVOKED", "SUSPENDED", "TAMPERED", "INVALID",
                     "PRODUCT_MISMATCH", "LICENSE_INACTIVE", "DEVICE_LIMIT_REACHED",
                     "DEVICE_REVOKED", "DEVICE_ID_REQUIRED", "LICENSE_NOT_REGISTERED"))


def _failure(code: str, message: str, *, status: str | None = None) -> ShroomLicenseError:
    """生成统一的授权错误；对外诊断仅附状态，不附 SDK 密钥。"""
    return ShroomLicenseError(message, code=code, stage="license",
                              suggestion="请在同一授权后台签发或续期 shroom-sdk 产品密钥，核对有效期、功能权限和电脑名额后重新激活。",
                              details={"status": status} if status else {})


def _milliseconds(value, name: str) -> float:
    """检查后台或签名负载中的毫秒时间戳，拒绝布尔值、非有限值及非正数。"""
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise _failure("LICENSE_INVALID", f"License {name} must be a timestamp")
    try:
        valid = math.isfinite(value) and value > 0
    except OverflowError:
        valid = False
    if not valid:
        raise _failure("LICENSE_INVALID", f"License {name} must be a finite positive timestamp")
    return float(value)


def _features(value) -> tuple[str, ...]:
    """验证功能列表并去重；兼容旧 SDK 密钥的自定义串口能力标记。"""
    if not isinstance(value, list) or any(not isinstance(item, str) or item not in _FEATURES for item in value):
        raise _failure("LICENSE_INVALID", "SDK license features are missing or invalid")
    # 已验证的 SDK 密钥统一补齐自定义协议标记，兼容此策略之前签发的密钥。
    # 实际串口访问仍要求 serial 权限，其他功能也须在授权中明确列出。
    return tuple(dict.fromkeys([*value, "serial.raw"]))


def _server_url(value: str) -> str:
    """校验授权后台地址：要求 HTTPS，仅本机回环测试允许 HTTP。"""
    if not isinstance(value, str):
        raise invalid_config("server_url must be an HTTPS URL", option="server_url")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        port = parsed.port
        loopback = host == "localhost"
        if host and not loopback:
            try:
                loopback = ipaddress.ip_address(host).is_loopback
            except ValueError:
                pass
        if not host or parsed.username or parsed.password or parsed.query or parsed.fragment or (
                parsed.scheme != "https" and not (parsed.scheme == "http" and loopback)):
            raise ValueError("invalid server URL")
        if port is not None and not 0 < port < 65536:
            raise ValueError("invalid port")
    except ValueError as exc:
        raise invalid_config("server_url requires HTTPS (HTTP is allowed only on loopback)",
                             option="server_url", cause=exc) from exc
    return value.rstrip("/")


class _NoRedirect(HTTPRedirectHandler):
    """禁用授权请求的自动重定向，防止密钥被转发给其他服务。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # 返回 None 使 urllib 拒绝跟随重定向，密钥始终只发往指定后台。
        return None


def _post(url: str, body: dict) -> dict:
    """发送 JSON 授权请求；限制 5 秒等待及 1 MiB 响应，只接受对象结果。"""
    request = Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                      headers={"Content-Type": "application/json", "Accept": "application/json"})
    try:
        with build_opener(_NoRedirect()).open(request, timeout=5.0) as response:
            data = response.read(1_048_577)
        if len(data) > 1_048_576:
            raise ValueError("response too large")
        result = json.loads(data)
        if not isinstance(result, dict):
            raise ValueError("response must be an object")
        return result
    except HTTPError as exc:
        exc.close()
        raise _failure("LICENSE_UNAVAILABLE", "SDK license service is unavailable") from exc
    except (URLError, TimeoutError, OSError) as exc:
        # 对外诊断不附请求对象或密钥，只提供统一的服务不可用错误。
        raise _failure("LICENSE_UNAVAILABLE", "SDK license service is unavailable") from exc
    except (ValueError, UnicodeError) as exc:
        raise _failure("LICENSE_INVALID", "SDK license service returned an invalid response") from exc


def _offline_payload(key: str, public_key: str) -> dict:
    """用受信任 RSA 公钥验签，通过后才解码并返回离线授权负载。

    签名对象是封装中的原始 base64 文本，不是重新序列化后的 JSON；只有此路径
    才加载 cryptography，在线授权不依赖该可选库。
    """
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding, rsa
    except ImportError as exc:
        raise ShroomDependencyError("Offline activation requires python -m pip install cryptography",
                                     code="DEPENDENCY_MISSING", stage="license",
                                     suggestion="请安装 Python SDK 的 [license] 可选依赖或 cryptography。",
                                     cause=exc) from exc
    try:
        envelope = json.loads(base64.b64decode(key, validate=True))
        payload_text, signature = envelope["payload"], envelope["signature"]
        if not isinstance(payload_text, str) or not isinstance(signature, str):
            raise ValueError("invalid envelope")
        verifier = serialization.load_pem_public_key(public_key.encode("ascii"))
        if not isinstance(verifier, rsa.RSAPublicKey):
            raise ValueError("RSA public key required")
        verifier.verify(base64.b64decode(signature, validate=True), payload_text.encode("utf-8"),
                        padding.PKCS1v15(), hashes.SHA256())
        payload = json.loads(base64.b64decode(payload_text, validate=True))
        if not isinstance(payload, dict):
            raise ValueError("invalid payload")
        return payload
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, binascii.Error,
            InvalidSignature) as exc:
        raise _failure("LICENSE_INVALID", "Offline SDK license signature or payload is invalid") from exc


def _offline_grant(payload: dict) -> dict:
    """检查签名负载的产品、到期时间、电脑名额和功能，建立内存授权状态。

    初次依据系统时间计算剩余时长，后续以单调时钟计时，避免系统时钟回拨延长使用。
    """
    if payload.get("productType") != PRODUCT_TYPE:
        raise _failure("LICENSE_PRODUCT_MISMATCH", "This license does not authorize the shroom-sdk product")
    expiry = payload.get("expireDate")
    if isinstance(expiry, str):
        try:
            date = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
            if date.tzinfo is None:
                raise ValueError("timezone required")
            expiry = date.timestamp() * 1000
        except (ValueError, OverflowError) as exc:
            raise _failure("LICENSE_INVALID", "Offline license expiry is invalid") from exc
    expiry = _milliseconds(expiry, "expireDate")
    limit = payload.get("deviceLimit", 0)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 0 <= limit <= 10000:
        raise _failure("LICENSE_INVALID", "Offline license device limit is invalid")
    seconds = expiry / 1000 - time.time()
    if seconds <= 0:
        raise _failure("LICENSE_EXPIRED", "SDK license has expired")
    features = _features(payload.get("sdkFeatures"))
    return {"scope": ("all",), "features": features, "expiry": expiry, "limit": limit,
            "deadline": time.monotonic() + seconds, "status": "VALID"}


def _online_grant(response: dict, elapsed: float = 0) -> dict:
    """校验后台在线结果，把服务器时间换成最多 60 秒的本地单调时钟租约。

    elapsed 为请求耗时（秒），要从可用时长中扣除；实际期限还受密钥到期时间限制。
    """
    if response.get("productType") != PRODUCT_TYPE:
        raise _failure("LICENSE_PRODUCT_MISMATCH", "License service did not authorize the shroom-sdk product")
    status = response.get("status")
    if response.get("valid") is not True or not isinstance(status, str) or status in _DENIED:
        code = "LICENSE_DEVICE_REQUIRED" if status == "DEVICE_ID_REQUIRED" else (
            "LICENSE_EXPIRED" if status == "EXPIRED" else "LICENSE_REJECTED")
        raise _failure(code, "SDK license is inactive or access was denied", status=status if isinstance(status, str) else None)
    now = _milliseconds(response.get("time"), "time")
    expiry = _milliseconds(response.get("expireTimestamp"), "expireTimestamp")
    lease = _milliseconds(response.get("leaseExpiresAt"), "leaseExpiresAt")
    seconds = min(_MAX_LEASE_SECONDS, (lease - now) / 1000, (expiry - now) / 1000) - elapsed
    if seconds <= 0:
        raise _failure("LICENSE_EXPIRED", "SDK license or its online lease has expired")
    features = _features(response.get("sdkFeatures"))
    return {"scope": ("all",), "features": features, "expiry": expiry,
            "deadline": time.monotonic() + seconds, "status": status, "lease_expiry": min(lease, now + 60000)}


def _constrain_grant(grant: dict, signed: dict | None) -> dict:
    """把电脑登记租约限制在离线签名许可内，不允许后台回复扩展签名权限。"""
    if signed is None:
        return grant
    # 电脑登记只能提供当前可用租约，不能延长签名密钥期限或增加其功能。
    grant["expiry"] = min(grant["expiry"], signed["expiry"])
    grant["deadline"] = min(grant["deadline"], signed["deadline"])
    grant["lease_expiry"] = min(grant["lease_expiry"], signed["expiry"])
    grant["features"] = tuple(item for item in grant["features"] if item in signed["features"])
    if grant["deadline"] <= time.monotonic():
        raise _failure("LICENSE_EXPIRED", "The signed SDK license expired during device verification")
    return grant


def _fetch_grant(online: dict, body: dict) -> dict:
    """请求授权后台，扣除请求耗时，并按需收紧到离线签名允许的范围。"""
    started = time.monotonic()
    response = _post(online["url"], body)
    return _constrain_grant(_online_grant(response, max(0, time.monotonic() - started)), online["signed"])


class _LicenseManager:
    """进程内唯一授权状态：锁保护共享数据，定时器续验，设备通过弱引用订阅失效。

    generation 用于丢弃已被新激活或清除操作替代的旧网络结果。
    """

    def __init__(self):
        self._lock = RLock()
        self._generation = 0
        self._grant = self._online = self._timer = None
        self._error = None
        self._listeners: dict[int, weakref.WeakMethod] = {}
        self._listener_id = 0

    def _notify(self):
        """在锁外通知设备复核授权；已回收设备的弱引用会被清理。"""
        with self._lock:
            listeners = tuple(self._listeners.items())
        for identifier, reference in listeners:
            callback = reference()
            if callback is None:
                with self._lock:
                    self._listeners.pop(identifier, None)
            else:
                try:
                    callback()
                except Exception:
                    # 单个设备清理失败不能阻止其他设备接收通知并关闭。
                    pass

    def subscribe(self, callback):
        """订阅设备的绑定方法并返回取消订阅函数；弱引用避免管理器延长设备寿命。"""
        with self._lock:
            self._listener_id += 1
            identifier = self._listener_id
            self._listeners[identifier] = weakref.WeakMethod(callback)

        def unsubscribe():
            with self._lock:
                self._listeners.pop(identifier, None)
        return unsubscribe

    def _schedule_locked(self):
        """持锁时重排唯一计时器，优先处理租约到期或下一次在线续验。"""
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        if not self._grant:
            return
        next_at = self._grant["deadline"]
        if self._online:
            next_at = min(next_at, self._online["next_check"])
        self._timer = Timer(max(0.01, next_at - time.monotonic()), self._tick)
        self._timer.daemon = True
        self._timer.start()

    def clear(self, error=None):
        """清除授权和续验任务、作废旧请求，并通知已连接的真实设备停止使用。"""
        with self._lock:
            self._generation += 1
            self._grant = self._online = None
            self._error = error
            self._schedule_locked()
        self._notify()

    def activate(self, key, *, mode, server_url, device_id, public_key):
        """替换当前授权；离线码若限制电脑名额，验签后仍需向后台登记并定期续验。"""
        # 先清除旧授权，防止新密钥激活失败后继续沿用旧权限；现有设备也会收到失效通知。
        self.clear()
        with self._lock:
            generation = self._generation
        try:
            if not isinstance(key, str) or not key.strip() or len(key) > 8192:
                raise invalid_config("key must be a non-empty license string of at most 8192 characters", option="key")
            if mode not in ("online", "offline"):
                raise invalid_config("mode must be 'online' or 'offline'", option="mode")
            if device_id is not None and (not isinstance(device_id, str) or not _DEVICE_ID.fullmatch(device_id)):
                raise invalid_config("device_id must be 64 lowercase hexadecimal characters", option="device_id")
            if not isinstance(public_key, str) or not public_key.strip():
                raise invalid_config("public_key must be trusted RSA public-key PEM text", option="public_key")
            key, url = key.strip(), _server_url(server_url)
            online = None
            signed = None
            if mode == "offline":
                grant = _offline_grant(_offline_payload(key, public_key))
                signed = dict(grant)
                if grant["limit"]:
                    if device_id is None:
                        raise _failure("LICENSE_DEVICE_REQUIRED", "A stable device_id is required for this limited license")
                    endpoint = "/api/license/devices/check"
                else:
                    endpoint = None
            else:
                endpoint = "/licenseCheck"
            if endpoint:
                online = {"key": key, "url": url + endpoint, "device_id": device_id,
                          "next_check": time.monotonic() + _RECHECK_SECONDS, "signed": signed}
                grant = _fetch_grant(online, self._request_body(online))
            grant["mode"] = mode
            with self._lock:
                if generation != self._generation:
                    raise _failure("LICENSE_REJECTED", "License activation was replaced or cleared")
                self._grant, self._online, self._error = grant, online, None
                self._schedule_locked()
            self._notify()
            return self.status()
        except Exception as exc:
            with self._lock:
                current = generation == self._generation
            if current:
                self.clear(exc if isinstance(exc, ShroomLicenseError) else None)
            raise

    @staticmethod
    def _request_body(online):
        """按授权后台字段构造请求；deviceId 由调用方提供，不在此处自动生成。"""
        body = {"key": online["key"], "productType": PRODUCT_TYPE, "clientTime": int(time.time() * 1000)}
        if online["device_id"] is not None:
            body["deviceId"] = online["device_id"]
        return body

    def _tick(self):
        """定时检查本地期限并按需续验；临时断网只允许沿用尚未到期的当前租约。"""
        try:
            self.assert_feature()
        except ShroomLicenseError:
            return
        with self._lock:
            if not self._online or time.monotonic() < self._online["next_check"]:
                self._schedule_locked()
                return
            generation, online = self._generation, dict(self._online)
            self._online["next_check"] = time.monotonic() + _RECHECK_SECONDS
            # 网络请求在锁外进行，等待期间继续保留到期计时器，避免慢请求延长权限。
            self._schedule_locked()
        try:
            grant = _fetch_grant(online, self._request_body(online))
        except ShroomLicenseError as exc:
            with self._lock:
                current = generation == self._generation and self._grant is not None
            if current and exc.code != "LICENSE_UNAVAILABLE":
                self.clear(exc)
            return
        with self._lock:
            if generation != self._generation or self._grant is None:
                return
            grant["mode"] = self._grant["mode"]
            self._grant = grant
            self._schedule_locked()
        self._notify()

    def assert_feature(self, feature=None):
        """检查授权和可选功能权限；期限已过时清除授权并通知设备关闭。

        feature=None 只检查授权状态。serial.raw 还依赖 serial，不能仅凭兼容标记取数。
        """
        with self._lock:
            error = None
            expired = False
            if self._grant and time.monotonic() >= self._grant["deadline"]:
                self._generation += 1
                self._grant = self._online = None
                self._error = _failure("LICENSE_EXPIRED", "SDK license or its online verification lease has expired")
                self._schedule_locked()
                error = self._error
                expired = True
            elif not self._grant:
                error = self._error or _failure("LICENSE_REQUIRED", "Activate a shroom-sdk license before connecting real hardware")
            elif feature == "serial.raw" and "serial" not in self._grant["features"]:
                error = _failure("LICENSE_FEATURE_DENIED", "SDK license does not authorize serial")
            elif feature is not None and feature not in self._grant["features"]:
                error = _failure("LICENSE_FEATURE_DENIED", f"SDK license does not authorize {feature}")
        if error:
            if expired:
                self._notify()
            raise error

    def status(self):
        """复核期限并返回脱敏状态快照，不暴露密钥或授权管理器的内部可变对象。"""
        try:
            self.assert_feature()
        except ShroomLicenseError:
            pass
        with self._lock:
            grant = self._grant
            return {"valid": grant is not None, "product_type": PRODUCT_TYPE,
                    "mode": grant["mode"] if grant else None,
                    "status": grant["status"] if grant else "INACTIVE",
                    "expires_at": grant["expiry"] if grant else None,
                    "lease_expires_at": grant.get("lease_expiry") if grant else None,
                    "sensor_types": list(grant["scope"]) if grant else [],
                    "all_products": grant is not None,
                    "sdk_features": list(grant["features"]) if grant else [],
                    "error": self._error.code if self._error else None}


_manager = _LicenseManager()


def activate_license(key: str, *, mode: str = "online", server_url: str = DEFAULT_SERVER_URL,
                     device_id: str | None = None, public_key: str = DEFAULT_PUBLIC_KEY) -> dict:
    """激活 shroom-sdk 产品密钥，返回可供界面展示的授权状态快照。

    mode 选择 online/offline；server_url 为授权后台。电脑名额受限时，调用方须
    持久保存并复用 64 位小写十六进制 device_id，不能每次启动随机生成。
    public_key 必须来自应用受信任配置，不能读取密钥自带的公钥。限制电脑名额的
    离线码仍会每 30 秒在线检查电脑状态；本函数不会自动读取环境变量或保存密钥。
    """
    return _manager.activate(key, mode=mode, server_url=server_url,
                             device_id=device_id, public_key=public_key)


def get_license_status() -> dict:
    """返回当前授权的独立状态快照；包含期限、功能和错误码，不包含 SDK 密钥。"""
    return _manager.status()


def clear_license() -> None:
    """清除进程内当前授权，并通知依赖该授权的真实串口设备关闭。"""
    _manager.clear()


def _assert_license(feature="serial.raw"):
    """设备操作使用的内部授权门禁，默认检查自定义串口所需权限。"""
    _manager.assert_feature(feature)


def _subscribe_license(callback):
    """设备订阅授权变化的内部入口，返回对应的取消订阅函数。"""
    return _manager.subscribe(callback)
