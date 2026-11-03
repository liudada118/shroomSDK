/**
 * SDK 授权核心：与上位机共用密钥后台，以 shroom-sdk 产品类型隔离使用权限。
 * 本模块维护进程/页面内的授权会话、RSA 验签、在线续验及失效通知，不持久化密钥。
 * 真实串口、WS 服务和录制入口通过 assertLicense / watchLicense 接入同一会话。
 */
import { ShroomError } from './errors.js';

export const SDK_PRODUCT_TYPE = 'shroom-sdk';
export const DEFAULT_LICENSE_SERVER = 'https://shroom.jq-industries.com';
export const DEFAULT_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0xly+Gg/8LvoWV0VRO/k
l1dEQRt7N6yilC2yiza+W1V2aXWKoiLlkPcJa9KQmNArjcHq8nBLlEppHjwEm2u5
SrgADP/frf1n8GZpRejZo6Ab1psppUm/neVcoxsK+0z6a00B9syv8AEIt2jrN4ZZ
zz51MgJqzgXmqPaibtzGl8RFr1jYJ2JpXNes6BqFpjQng1S8hu4VgWBIljkE3jKF
fHwTP9KPtEcoH/uSPmW5X7IuwpDW2QO6sO61uv/luLI4Wx4upX4CIUepwIzDyG6B
fYx2AAZJ1oNEBW28wIUf7i5sVT0FsWRsR55Q3KUcsiqAUVduKiKTQN3dnmbyC1Fg
AQIDAQAB
-----END PUBLIC KEY-----`;

const sdkLicenseWatchers = new Set();
// WeakMap 将来源权限与设备实例绑定；public info 被应用修改时不会改变这份内部记录。
const sdkLicensedDevices = new WeakMap();
let sdkLicenseSession = null;
let sdkLicenseRevision = 0;
let sdkLicenseWatchTimer = null;
let sdkLicenseLastError = null;
const sdkLicenseMonotonic = () => globalThis.performance?.now() ?? Date.now();
const sdkLicenseFailure = (code, message) => new ShroomError(code, message, {
  stage: 'license', suggestion: '请在共用授权后台签发或续期 Shroom SDK 产品密钥，核对有效期、功能权限与电脑名额后重新激活。',
});

/** 在线会话用服务器时间加单调时钟增量；本地离线会话在本次运行内保留已见最大时间。 */
function sdkLicenseTime(session) {
  session.highWater = Math.max(session.highWater, Date.now(), session.localStart + Math.max(0, sdkLicenseMonotonic() - session.monotonicStart));
  return session.mode === 'offline-local' ? session.highWater
    : session.serverStart + Math.max(0, sdkLicenseMonotonic() - session.monotonicStart);
}

/** 将毫秒时间戳或可解析日期统一为毫秒，缺失或无效时间必须拒绝。 */
function sdkLicenseExpiry(value) {
  const expires = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(expires) || expires <= 0) throw sdkLicenseFailure('LICENSE_INVALID', '许可证没有有效的到期时间。');
  return expires;
}

function sdkLicenseFeatures(value) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw sdkLicenseFailure('LICENSE_INVALID', 'SDK 许可证缺少功能授权。');
  }
  // SDK 不限制设备型号，包含自定义串口路线；旧签名码无需仅为 serial.raw 重新签发。
  // 实际使用 serial.raw 时仍由 assertLicense 检查 serial 主权限，不能据此越过功能限制。
  return [...new Set([...value, 'serial.raw'])];
}

/** 返回可公开的授权状态与权限副本；无效授权返回 valid: false，不暴露密钥或请求凭据。 */
export function getLicenseStatus() {
  try { assertLicense(); } catch (error) {
    return { valid: false, productType: SDK_PRODUCT_TYPE, code: error.code, message: error.message };
  }
  const session = sdkLicenseSession;
  return {
    valid: true, productType: SDK_PRODUCT_TYPE, mode: session.mode,
    expiresAt: session.expiresAt, leaseExpiresAt: session.leaseExpiresAt,
    products: [...session.products], allProducts: session.all, features: [...session.features],
  };
}

/**
 * 同步检查有效期、在线租期和 requirement.feature；失败抛出 ShroomError。
 * 不发网络请求，便于 Web Serial 保留按钮点击所需的用户手势；型号不作为授权限制。
 */
export function assertLicense(requirement = {}) {
  const session = sdkLicenseSession;
  if (!session) throw sdkLicenseLastError ?? sdkLicenseFailure('LICENSE_REQUIRED', '连接真实设备前请先激活 SDK 产品密钥。');
  const now = sdkLicenseTime(session);
  if (now >= session.expiresAt) throw sdkLicenseFailure('LICENSE_EXPIRED', 'SDK 许可证已到期，采集已停止。');
  if (now >= session.leaseExpiresAt) throw sdkLicenseFailure('LICENSE_UNAVAILABLE', '无法续验在线授权，当前授权时限已结束。');
  if (requirement.feature === 'serial.raw' && !session.features.includes('serial')) {
    throw sdkLicenseFailure('LICENSE_FEATURE_DENIED', 'SDK 许可证未包含功能 serial。');
  }
  if (requirement.feature && !session.features.includes(requirement.feature)) {
    throw sdkLicenseFailure('LICENSE_FEATURE_DENIED', `SDK 许可证未包含功能 ${requirement.feature}。`);
  }
}

/** 按每个订阅的功能要求复查权限；失效回调只触发一次，无订阅后释放轮询定时器。 */
function sdkLicenseNotify() {
  for (const watcher of [...sdkLicenseWatchers]) {
    if (!sdkLicenseWatchers.has(watcher)) continue;
    try { assertLicense(watcher.requirement); } catch (error) {
      sdkLicenseWatchers.delete(watcher);
      try { watcher.onInvalid(error); } catch { /* 应用回调异常不能阻止其他连接收到关闭通知。 */ }
    }
  }
  if (!sdkLicenseWatchers.size && sdkLicenseWatchTimer) {
    clearInterval(sdkLicenseWatchTimer);
    sdkLicenseWatchTimer = null;
  }
}

/**
 * 订阅授权失效：到期、后台拒绝、主动清除或功能变化时通知一次，返回取消订阅函数。
 * 注册后立即检查，此后每 250 ms 复查本地会话；网络续验由独立的刷新任务负责。
 */
export function watchLicense(requirement, onInvalid) {
  const watcher = { requirement: { ...requirement }, onInvalid };
  sdkLicenseWatchers.add(watcher);
  if (!sdkLicenseWatchTimer) {
    sdkLicenseWatchTimer = setInterval(sdkLicenseNotify, 250);
    sdkLicenseWatchTimer.unref?.();
  }
  sdkLicenseNotify();
  return () => {
    sdkLicenseWatchers.delete(watcher);
    sdkLicenseNotify();
  };
}

/** 将连接时的权限要求绑定到设备实例；修改设备公开的 info 不会改变这份内部记录。 */
export function markLicensedDevice(device, requirement) {
  sdkLicensedDevices.set(device, Object.freeze({ ...requirement }));
  return device;
}

/** 返回设备权限要求的副本；未登记的外部来源返回 null，由服务层决定如何校验。 */
export function getDeviceLicenseRequirement(device) {
  const requirement = sdkLicensedDevices.get(device);
  return requirement ? { ...requirement } : null;
}

/** 清除运行期会话、取消续验并通知使用者停采；递增版本号，使尚未返回的旧请求失效。 */
export function clearLicense() {
  sdkLicenseRevision += 1;
  if (sdkLicenseSession?.refreshTimer) clearTimeout(sdkLicenseSession.refreshTimer);
  sdkLicenseSession = null;
  sdkLicenseLastError = null;
  sdkLicenseNotify();
}

/** 校验授权服务地址，禁止 URL 携带凭据、查询和片段；HTTP 仅用于本机调试。 */
function sdkLicenseServer(value) {
  let url;
  try { url = new URL(value ?? DEFAULT_LICENSE_SERVER); } catch { throw sdkLicenseFailure('INVALID_CONFIG', '授权服务地址无效。'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:'
    && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw sdkLicenseFailure('INVALID_CONFIG', '授权服务必须使用 HTTPS，本机调试可以使用 localhost HTTP。');
  }
  return url.href.replace(/\/$/, '');
}

function sdkLicenseDecodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw sdkLicenseFailure('LICENSE_INVALID', '许可证的 Base64 格式无效。');
  }
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/**
 * 先对信封内 payload 的 Base64 文本验 RSA-SHA256 签名，再解析其内容。
 * 不把“能解码 JSON”当作可信授权；浏览器与 Node 使用相同的 Web Crypto 验签规则。
 */
async function sdkLicenseVerifyOffline(key, publicKey) {
  try {
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sdkLicenseDecodeBase64(key)));
    if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') throw new Error('envelope');
    const pem = publicKey ?? DEFAULT_LICENSE_PUBLIC_KEY;
    if (typeof pem !== 'string') throw new Error('publicKey');
    const der = sdkLicenseDecodeBase64(pem.replace(/-----[A-Z ]+-----|\s/g, ''));
    const subtle = globalThis.crypto?.subtle ?? (await import('node:crypto')).webcrypto.subtle;
    const trustedKey = await subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await subtle.verify('RSASSA-PKCS1-v1_5', trustedKey, sdkLicenseDecodeBase64(envelope.signature), new TextEncoder().encode(envelope.payload))) {
      throw new Error('signature');
    }
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sdkLicenseDecodeBase64(envelope.payload)));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload');
    return payload;
  } catch {
    throw sdkLicenseFailure('LICENSE_INVALID', '离线许可证格式或 RSA 签名无效。');
  }
}

/** 共用后台仍需明确产品类型，防止把上位机密钥当作 SDK 密钥使用。 */
function sdkLicenseProduct(productType) {
  if (productType !== SDK_PRODUCT_TYPE) throw sdkLicenseFailure('LICENSE_PRODUCT_MISMATCH', '此密钥不属于 Shroom SDK；上位机密钥不能启用 SDK。');
}

/**
 * 请求后台授权并取得短租期；单次超时 5 秒，禁止缓存和重定向。
 * 租期至多 60 秒且不晚于许可证到期时间；带签名码时再与签名权限取交集。
 */
async function sdkLicenseRequest(config) {
  const controller = new AbortController();
  const requestStart = sdkLicenseMonotonic();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${config.serverUrl}${config.path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', redirect: 'error', signal: controller.signal,
      body: JSON.stringify({ key: config.key, productType: SDK_PRODUCT_TYPE, clientTime: Date.now(),
        ...(config.deviceId ? { deviceId: config.deviceId } : {}) }),
    });
    if (!response.ok) throw sdkLicenseFailure('LICENSE_UNAVAILABLE', '授权服务暂时不可用，请检查网络或联系管理员。');
    const result = await response.json();
    if (result.valid !== true) {
      const code = result.status === 'PRODUCT_MISMATCH' || result.status === 'LICENSE_PRODUCT_MISMATCH' ? 'LICENSE_PRODUCT_MISMATCH'
        : result.status === 'EXPIRED' ? 'LICENSE_EXPIRED'
          : result.status === 'DEVICE_ID_REQUIRED' ? 'LICENSE_DEVICE_REQUIRED' : 'LICENSE_REJECTED';
      throw sdkLicenseFailure(code, `授权未通过（${String(result.status ?? 'INVALID').slice(0, 64)}）。请核对产品、有效期和电脑名额。`);
    }
    sdkLicenseProduct(result.productType);
    const serverTime = sdkLicenseExpiry(result.time);
    const expiresAt = sdkLicenseExpiry(result.expireTimestamp ?? config.offlinePayload?.expireDate);
    const leaseExpiresAt = Math.min(expiresAt, serverTime + 60000, result.leaseExpiresAt == null ? Infinity : sdkLicenseExpiry(result.leaseExpiresAt));
    // 把本次请求耗时计入时间基准，避免慢请求返回后获得额外可用时长。
    const effectiveServerTime = serverTime + Math.max(0, sdkLicenseMonotonic() - requestStart);
    if (expiresAt <= effectiveServerTime || leaseExpiresAt <= effectiveServerTime) throw sdkLicenseFailure('LICENSE_EXPIRED', 'SDK 授权已过期。');
    const entitlement = { all: true, products: [], features: sdkLicenseFeatures(result.sdkFeatures),
      expiresAt, leaseExpiresAt, serverStart: effectiveServerTime };
    if (config.offlinePayload) {
      const signedExpiry = sdkLicenseExpiry(config.offlinePayload.expireDate);
      const signedFeatures = sdkLicenseFeatures(config.offlinePayload.sdkFeatures);
      entitlement.expiresAt = Math.min(signedExpiry, entitlement.expiresAt);
      entitlement.leaseExpiresAt = Math.min(signedExpiry, entitlement.leaseExpiresAt);
      entitlement.features = entitlement.features.filter((feature) => signedFeatures.includes(feature));
    }
    return entitlement;
  } catch (error) {
    if (error instanceof ShroomError) throw error;
    throw sdkLicenseFailure('LICENSE_UNAVAILABLE', '授权服务连接失败，未获得新的授权时限。');
  } finally { clearTimeout(timer); }
}

/**
 * 在剩余租期中途续验，单次间隔不超过 30 秒；版本号隔离清除或重新激活后的旧请求。
 * 暂时断网仅允许用完已有租期，后台明确拒绝则清空会话并通知使用者停止。
 */
function sdkLicenseScheduleRefresh(session, revision) {
  const remaining = session.leaseExpiresAt - sdkLicenseTime(session);
  session.refreshTimer = setTimeout(async () => {
    if (sdkLicenseRevision !== revision || sdkLicenseSession !== session) return;
    try {
      const next = await sdkLicenseRequest(session.config);
      if (sdkLicenseRevision !== revision || sdkLicenseSession !== session) return;
      Object.assign(session, next, { localStart: Date.now(), highWater: Date.now(), monotonicStart: sdkLicenseMonotonic() });
      sdkLicenseLastError = null;
      sdkLicenseNotify();
    } catch (error) {
      if (sdkLicenseRevision !== revision || sdkLicenseSession !== session) return;
      if (error.code !== 'LICENSE_UNAVAILABLE') {
        sdkLicenseSession = null;
        sdkLicenseLastError = error;
      }
      sdkLicenseNotify();
    }
    if (sdkLicenseSession === session && sdkLicenseRevision === revision && sdkLicenseTime(session) < session.leaseExpiresAt) {
      sdkLicenseScheduleRefresh(session, revision);
    }
  }, Math.max(50, Math.min(30000, remaining / 2)));
  session.refreshTimer.unref?.();
}

/**
 * 连接真实设备前激活密钥，成功返回 getLicenseStatus() 的公开状态。
 * @param {string} key SDK 在线密钥或 RSA 签名离线码，核心只在内存中使用。
 * @param {object} options mode、serverUrl、稳定 deviceId，以及可选的离线验签 publicKey。
 * offline 表示签名码格式；限定电脑数量的离线码仍须联网核验并续验名额。
 * 每次激活先清除旧会话，旧连接会收到失效通知；并发激活只接受最后一次操作的结果。
 */
export async function activateLicense(key, options = {}) {
  if (typeof key !== 'string' || !key.trim() || key.length > 16384 || !options || typeof options !== 'object' || Array.isArray(options)) {
    throw sdkLicenseFailure('INVALID_CONFIG', '请提供有效的许可证和激活参数。');
  }
  const mode = options.mode ?? 'online';
  if (!['online', 'offline'].includes(mode)) throw sdkLicenseFailure('INVALID_CONFIG', '授权方式应为 online 或 offline。');
  if (options.deviceId !== undefined && (typeof options.deviceId !== 'string' || !/^[a-f0-9]{64}$/.test(options.deviceId))) {
    throw sdkLicenseFailure('INVALID_CONFIG', 'deviceId 必须是稳定的 64 位小写十六进制电脑标识。');
  }
  clearLicense();
  const revision = sdkLicenseRevision;
  try {
    let config = null;
    let entitlement;
    if (mode === 'offline') {
      const payload = await sdkLicenseVerifyOffline(key.trim(), options.publicKey);
      sdkLicenseProduct(payload.productType);
      const expiresAt = sdkLicenseExpiry(payload.expireDate);
      const features = sdkLicenseFeatures(payload.sdkFeatures);
      if (payload.deviceLimit != null && (!Number.isInteger(payload.deviceLimit) || payload.deviceLimit < 0)) throw sdkLicenseFailure('LICENSE_INVALID', '电脑数量限制无效。');
      if (payload.deviceLimit > 0) {
        if (!options.deviceId) throw sdkLicenseFailure('LICENSE_DEVICE_REQUIRED', '此离线码限定电脑数量，请提供稳定的 deviceId 并联网激活。');
        config = { key: key.trim(), deviceId: options.deviceId, serverUrl: sdkLicenseServer(options.serverUrl), path: '/api/license/devices/check', offlinePayload: payload };
        entitlement = await sdkLicenseRequest(config);
      } else entitlement = { all: true, products: [], features, expiresAt, leaseExpiresAt: expiresAt, serverStart: Date.now() };
    } else {
      config = { key: key.trim(), deviceId: options.deviceId, serverUrl: sdkLicenseServer(options.serverUrl), path: '/licenseCheck' };
      entitlement = await sdkLicenseRequest(config);
    }
    if (revision !== sdkLicenseRevision) throw sdkLicenseFailure('LICENSE_REJECTED', '此激活请求已被后续操作取消。');
    sdkLicenseSession = { ...entitlement, config, mode: config ? (mode === 'offline' ? 'offline-device' : 'online') : 'offline-local',
      localStart: Date.now(), highWater: Date.now(), monotonicStart: sdkLicenseMonotonic() };
    assertLicense();
    if (config) sdkLicenseScheduleRefresh(sdkLicenseSession, revision);
    return getLicenseStatus();
  } catch (error) {
    if (revision === sdkLicenseRevision) {
      sdkLicenseSession = null;
      sdkLicenseLastError = error;
      sdkLicenseNotify();
    }
    throw error;
  }
}
