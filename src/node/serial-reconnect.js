/** Node 串口连接管理：稳定保留订阅，在原端口上有限重试，并隔离旧连接的迟到回调。 */
import { createFrameHub } from '../core/device.js';
import { ShroomError, asShroomError } from '../core/errors.js';
import { serialDiagnostics } from '../core/serial-diagnostics.js';
import { assertLicense, watchLicense, markLicensedDevice } from '../core/license.js';

/** 检查重连策略；配置错误必须在查询或打开硬件之前返回。 */
export function reconnectOptions(options, defaultEnabled = false) {
  const invalid = (field) => { throw new ShroomError('INVALID_CONFIG', `无效的 ${field} 配置。`, { stage: 'configure', details: { field } }); };
  const policy = options.reconnect === undefined ? defaultEnabled : options.reconnect;
  if (typeof policy !== 'boolean' && (!policy || typeof policy !== 'object' || Array.isArray(policy))) invalid('reconnect');
  if (options.onStateChange !== undefined && typeof options.onStateChange !== 'function') invalid('onStateChange');
  const config = typeof policy === 'object' ? policy : {};
  for (const field of Object.keys(config)) if (!['intervalMs', 'maxAttempts'].includes(field)) invalid(`reconnect.${field}`);
  const intervalMs = config.intervalMs === undefined ? 3000 : config.intervalMs;
  const maxAttempts = config.maxAttempts === undefined ? 3 : config.maxAttempts;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 2147483647) invalid('reconnect.intervalMs');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1000) invalid('reconnect.maxAttempts');
  return { enabled: policy !== false, intervalMs, maxAttempts };
}

/** 打开一个受管理的设备；定时器参数仅供内部测试注入，不增加公开连接参数。 */
export async function connectManagedSerial({ SerialPort, path, baudRate, info, makeParser, decode,
  licenseRequirement, policy, onData, onError, onStateChange, product = false,
  openTimeoutMs = 10000, closeTimeoutMs = 3000 }) {
  const hub = createFrameHub();
  const stateListeners = new Set();
  if (onData) hub.onFrame(onData);
  if (onError) hub.onError(onError);
  if (onStateChange) stateListeners.add(onStateChange);
  let state = 'closed';
  let stateRevision = 0;
  let current = null;
  let terminal = false;
  let retryTimer;
  let retryAttempt = 0;
  let closePromise;
  let unsubscribeLicense;
  let bytesReceived = 0;
  let frameCount = 0;
  let archivedDropped = 0;

  /** 状态对象只描述当前连接，不能把尝试打开当成已收到数据。 */
  function connectionStatus() { return Object.freeze({ state, path, attempt: retryAttempt, maxAttempts: policy.maxAttempts }); }
  /** 状态回调与帧回调一样隔离异常，避免业务代码中断设备清理。 */
  function setState(next) {
    state = next;
    const revision = ++stateRevision;
    const status = connectionStatus();
    for (const callback of [...stateListeners]) {
      // 回调可能同步关闭或撤销授权；内层状态发布后不能继续广播旧快照。
      if (revision !== stateRevision) break;
      try { callback(status); }
      catch (cause) { hub.emitError(asShroomError(cause, { code: 'CALLBACK_FAILED', stage: 'callback', message: '应用的 onStateChange 回调执行失败' })); }
    }
  }
  /** 旧端口确认关闭后才移除错误监听，避免驱动迟到 error 变成未捕获异常。 */
  function detach(attempt) {
    clearTimeout(attempt.openTimer);
    attempt.port?.removeListener('data', attempt.onData);
    if (!attempt.openPending && attempt.port?.isOpen !== true) {
      attempt.port?.removeListener('error', attempt.onError);
      attempt.port?.removeListener('close', attempt.onClose);
    }
  }
  /** 关闭迟到打开的旧端口；首次关闭失败也保留错误监听。 */
  function closePort(attempt) {
    if (attempt.openPending || attempt.closePending) return;
    if (!attempt.port?.isOpen) { attempt.finishRelease?.(); detach(attempt); return; }
    attempt.closePending = true;
    try {
      attempt.port.close((cause) => {
        attempt.closePending = false;
        if (cause) attempt.closeError ??= closeError(cause);
        attempt.finishRelease?.(attempt.closeError);
        detach(attempt);
      });
    } catch (cause) {
      attempt.closePending = false;
      attempt.closeError ??= closeError(cause);
      attempt.finishRelease?.(attempt.closeError);
    }
  }
  /** 归一关闭错误，保持关闭失败与串口读失败可区分。 */
  function closeError(cause) {
    return asShroomError(cause, { code: 'CLOSE_FAILED', stage: 'close', suggestion: '关闭串口失败，请检查驱动与设备连接；确认旧连接释放后再连接。' });
  }
  /** 释放单次物理连接；打开仍在进行时等待其回调，超时后禁止再次打开。 */
  function release(attempt) {
    if (!attempt) return Promise.resolve();
    if (attempt.releasePromise) return attempt.releasePromise;
    attempt.active = false;
    clearTimeout(attempt.openTimer);
    attempt.port?.removeListener('data', attempt.onData);
    if (!attempt.archived) { archivedDropped += attempt.parser?.droppedCount ?? 0; attempt.archived = true; }
    attempt.releasePromise = new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => attempt.finishRelease(closeError(new Error('串口关闭超时。'))), closeTimeoutMs);
      attempt.finishRelease = (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          if (error) reject(error); else resolve();
        }
        detach(attempt);
      };
      closePort(attempt);
    });
    // 初次打开失败仍应立即拒绝；迟到的端口清理由本 Promise 独立观察。
    attempt.releasePromise.catch(() => {});
    return attempt.releasePromise;
  }
  /** 停止重试与许可监视；保留最后错误，供终态诊断读取。 */
  function terminate(error) {
    if (terminal) return;
    terminal = true;
    clearTimeout(retryTimer);
    unsubscribeLicense?.();
    if (current?.openPending) current.rejectOpen(error);
    setState('error');
    hub.emitError(error);
    void release(current).catch((cause) => { hub.emitError(cause); });
  }
  /** 原连接释放后再等待重连间隔，重试只沿用原 path 和产品配置。 */
  async function recover(attempt, error) {
    if (terminal || attempt !== current || !attempt.active) return;
    attempt.active = false;
    const retryable = policy.enabled && ['DISCONNECTED', 'READ_FAILED'].includes(error.code);
    if (!retryable || retryAttempt >= policy.maxAttempts) { terminate(error); return; }
    setState('reconnecting');
    if (terminal) return;
    hub.emitError(error);
    try { await release(attempt); }
    catch (cause) { terminate(cause); return; }
    scheduleRetry();
  }
  /** 单个定时器串行重试，主动 close 和授权失效可随时取消。 */
  function scheduleRetry() {
    if (terminal) return;
    if (retryAttempt >= policy.maxAttempts) { terminate(hub.lastError ?? new ShroomError('CONNECTION_FAILED', '串口重连次数已用尽。', { stage: 'connect' })); return; }
    clearTimeout(retryTimer);
    retryTimer = setTimeout(async () => {
      if (terminal) return;
      retryAttempt += 1;
      setState('reconnecting');
      if (terminal) return;
      try { await openAttempt(); }
      catch (error) {
        if (terminal) return;
        if (error.stage === 'license' || ['INVALID_CONFIG', 'PARSE_FAILED', 'PERMISSION_DENIED'].includes(error.code)) { terminate(error); return; }
        hub.emitError(error);
        try { await release(current); } catch (cause) { terminate(cause); return; }
        scheduleRetry();
      }
    }, policy.intervalMs);
  }
  /** 创建全新 parser 与物理端口；回调必须属于当前代次才可发布数据。 */
  function openAttempt() {
    assertLicense(licenseRequirement);
    const attempt = { parser: makeParser(), active: true, openPending: false, openSettled: false,
      bytesReceived: 0, frameCount: 0, port: null, archived: false, closeError: null };
    current = attempt;
    const opened = new Promise((resolve, reject) => {
      attempt.rejectOpen = (error) => {
        if (attempt.openSettled) return;
        attempt.openSettled = true;
        attempt.active = false;
        clearTimeout(attempt.openTimer);
        reject(error);
      };
      attempt.onData = (chunk) => {
        if (!attempt.active || attempt !== current || terminal || state !== 'open') return;
        bytesReceived += chunk.length;
        attempt.bytesReceived += chunk.length;
        try {
          for (const payload of attempt.parser.push(new Uint8Array(chunk))) {
            assertLicense(licenseRequirement);
            const frame = decode(payload);
            frameCount += 1; attempt.frameCount += 1;
            if (retryAttempt) { retryAttempt = 0; setState('open'); }
            if (terminal || !attempt.active) break;
            hub.emit(frame);
            if (terminal || !attempt.active) break;
          }
        } catch (cause) {
          terminate(asShroomError(cause, { code: 'PARSE_FAILED', stage: 'parse', suggestion: '请检查产品协议与数据帧配置。' }));
        }
      };
      attempt.onError = (cause) => {
        if (!attempt.active) {
          const error = closeError(cause);
          attempt.closeError ??= error;
          if (terminal && attempt === current) hub.emitError(error);
          return;
        }
        if (!attempt.openSettled) {
          attempt.rejectOpen(asShroomError(cause, { code: 'CONNECTION_FAILED', stage: 'connect' }));
        } else {
          void recover(attempt, asShroomError(cause, { code: 'READ_FAILED', stage: 'read', suggestion: '请检查设备连接。' }));
        }
      };
      attempt.onClose = () => {
        if (!attempt.active) {
          if (!attempt.closePending) attempt.finishRelease?.(attempt.closeError);
          detach(attempt);
          return;
        }
        const error = new ShroomError('DISCONNECTED', '串口设备已断开。', { stage: attempt.openSettled ? 'read' : 'connect', suggestion: '请检查设备连接，保持原串口路径后重试。' });
        if (!attempt.openSettled) attempt.rejectOpen(error);
        else void recover(attempt, error);
      };
      try {
        attempt.port = new SerialPort({ path, baudRate, autoOpen: false });
        attempt.port.on('data', attempt.onData);
        attempt.port.on('error', attempt.onError);
        attempt.port.on('close', attempt.onClose);
        attempt.openTimer = setTimeout(() => attempt.rejectOpen(new ShroomError('CONNECTION_FAILED', '串口打开超时。', { stage: 'connect' })), openTimeoutMs);
        attempt.openPending = true;
        attempt.port.open((cause) => {
          attempt.openPending = false;
          if (!attempt.active || terminal || current !== attempt) { closePort(attempt); return; }
          if (cause) { attempt.rejectOpen(asShroomError(cause, { code: 'CONNECTION_FAILED', stage: 'connect' })); return; }
          try { assertLicense(licenseRequirement); }
          catch (error) { attempt.rejectOpen(error); return; }
          attempt.openSettled = true;
          clearTimeout(attempt.openTimer);
          setState('open');
          resolve();
        });
      } catch (cause) {
        attempt.openPending = false;
        attempt.rejectOpen(asShroomError(cause, { code: 'CONNECTION_FAILED', stage: 'connect' }));
      }
    });
    return opened;
  }
  /** 公开关闭终止自动重连，重复调用始终返回同一清理 Promise。 */
  function close() {
    if (closePromise) return closePromise;
    // 先发布同一个 Promise，再通知状态；订阅者可在回调里安全地再次 close。
    closePromise = Promise.resolve().then(() => release(current)).catch((error) => {
      setState('error');
      if (hub.lastError !== error) hub.emitError(error);
      throw error;
    }).finally(() => { hub.clear(); stateListeners.clear(); });
    terminal = true;
    clearTimeout(retryTimer);
    unsubscribeLicense?.();
    if (current?.openPending) current.rejectOpen(new ShroomError('CONNECTION_FAILED', '串口连接已取消。', { stage: 'connect' }));
    if (state !== 'error') setState('closed');
    return closePromise;
  }
  const device = {
    info: { source: 'node-serial', path, baudRate, ...info },
    onFrame: hub.onFrame,
    ...(product ? { onData: hub.onFrame } : {}),
    onError: hub.onError,
    /** 订阅低频连接状态；不会重复注册数据处理回调。 */
    onStateChange(callback) {
      if (typeof callback !== 'function') throw new TypeError('onStateChange 需要传一个函数');
      stateListeners.add(callback);
      return () => stateListeners.delete(callback);
    },
    get state() { return state; },
    get bytesReceived() { return bytesReceived; },
    get frameCount() { return frameCount; },
    get frameLength() { return current?.parser?.frameLength ?? 0; },
    get droppedCount() { return archivedDropped + (current?.archived ? 0 : current?.parser?.droppedCount ?? 0); },
    /** 累计计数保留历史，本次物理连接的计数决定 waiting/streaming 状态。 */
    getDiagnostics() {
      return { ...serialDiagnostics({ source: 'node-serial', state, bytesReceived, frameCount,
        currentBytesReceived: current?.bytesReceived ?? 0, currentFrameCount: current?.frameCount ?? 0,
        frameLength: device.frameLength, droppedCount: device.droppedCount, lastError: hub.lastError }),
      reconnectAttempt: retryAttempt, reconnectMaxAttempts: policy.maxAttempts };
    },
    close,
  };
  try {
    assertLicense(licenseRequirement);
    unsubscribeLicense = watchLicense(licenseRequirement, terminate);
    await openAttempt();
    assertLicense(licenseRequirement);
    if (terminal) throw hub.lastError ?? new ShroomError('CONNECTION_FAILED', '连接在打开期间已关闭。', { stage: 'connect' });
    return markLicensedDevice(device, licenseRequirement);
  } catch (error) {
    terminal = true;
    state = 'error';
    clearTimeout(retryTimer);
    unsubscribeLicense?.();
    const cleanup = release(current);
    if (!current?.openPending) await cleanup.catch(() => {});
    hub.clear(); stateListeners.clear();
    throw error;
  }
}
