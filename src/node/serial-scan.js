/** Node 产品发现：逐口只读采样，确认协议与身份，释放端口后才返回结果。 */
import { ShroomError, asShroomError } from '../core/errors.js';
import { assertLicense, watchLicense } from '../core/license.js';
import { getDeviceProductAdapter } from '../core/products/registry.js';
import { reserveSerialPath } from './serial-path.js';

const pathKey = path => process.platform === 'win32' ? path.trim().toLowerCase() : path.trim();
const cancelled = () => new ShroomError('USER_CANCELLED', '串口自动识别已取消。', { stage: 'query' });

export { assertSerialPathAvailable } from './serial-path.js';

/** 在加载驱动和访问硬件之前验证公开扫描配置。产品判断由注册表钩子提供。 */
export function prepareProductScan(options = {}) {
  const invalid = field => { throw new ShroomError('INVALID_CONFIG', `无效的扫描参数 ${field}。`, {
    stage: 'configure', details: { field },
  }); };
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('options');
  for (const key of Object.keys(options)) if (!['product', 'side', 'paths', 'timeoutMs', 'signal'].includes(key)) invalid(key);
  const adapter = getDeviceProductAdapter(options.product ?? 'glove');
  if (!adapter?.discovery) invalid('product');
  if (options.side !== undefined && !['left', 'right'].includes(options.side)) invalid('side');
  const timeoutMs = options.timeoutMs ?? 1200;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) invalid('timeoutMs');
  const { signal } = options;
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) invalid('signal');
  if (options.paths !== undefined && (!Array.isArray(options.paths) || !options.paths.length
    || options.paths.some(path => typeof path !== 'string' || !path.trim()))) invalid('paths');
  const paths = options.paths === undefined ? undefined : [...new Map(options.paths.map(path => [pathKey(path), path.trim()])).values()];
  return { adapter, timeoutMs, paths, side: options.side, signal };
}

/** 单口有界采样。迟到 open 仍会关闭；无法确认释放则保留路径锁并终止本轮扫描。 */
function probePort(SerialPort, path, config, { openTimeoutMs = 5000, closeTimeoutMs = 3000 }) {
  const { adapter, timeoutMs, signal } = config;
  const requirement = { product: adapter.profile.product, feature: 'serial' };
  assertLicense(requirement);
  if (signal?.aborted) throw cancelled();
  const parser = adapter.discovery.createParser();
  const releasePath = reserveSerialPath(path);
  return new Promise((resolve, reject) => {
    let port, opening = false, closing = false, released = false, settled = false;
    let phase = 'opening', failure, identity, identityKey, mixed = false, count = 0, bytes = 0;
    let openTimer, readTimer, closeTimer, unwatch;
    function settle(error, value) {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(value);
    }
    function release() {
      if (released || opening || port?.isOpen === true) return;
      released = true;
      clearTimeout(closeTimer);
      port?.removeListener('data', onData);
      port?.removeListener('error', onError);
      port?.removeListener('close', onClose);
      releasePath();
      settle(failure, !mixed && count >= 3 ? identity : null);
    }
    function cleanupFailure(cause) {
      clearTimeout(closeTimer);
      settle(new ShroomError('CLOSE_FAILED', '扫描串口尚未确认释放，已停止继续扫描。', {
        stage: 'close', cause, details: { path },
        suggestion: '等待驱动完成关闭，或检查设备连接；不能重开仍占用的串口。',
      }));
      // 不移除 error/close 监听、不解除路径锁；迟到打开/关闭仍需清理。
    }
    function closePort() {
      if (opening || closing || released) return;
      if (!port || port.isOpen !== true) { release(); return; }
      closing = true;
      try {
        port.close(cause => {
          closing = false;
          if (released) return;
          if (port.isOpen !== true) release();
          else cleanupFailure(cause ?? new Error('驱动仍持有串口。'));
        });
      } catch (cause) {
        closing = false;
        if (port.isOpen !== true) release(); else cleanupFailure(cause);
      }
    }
    function finish(error) {
      if (phase === 'closing') return;
      phase = 'closing';
      failure = error;
      clearTimeout(openTimer); clearTimeout(readTimer);
      signal?.removeEventListener('abort', onAbort);
      unwatch?.();
      port?.removeListener('data', onData);
      closeTimer = setTimeout(() => cleanupFailure(new Error('串口关闭超时。')), closeTimeoutMs);
      closePort();
    }
    function onAbort() { finish(cancelled()); }
    function onError(cause) {
      if (phase === 'closing') { if (!released) cleanupFailure(cause); return; }
      finish(asShroomError(cause, { code: phase === 'opening' ? 'CONNECTION_FAILED' : 'READ_FAILED',
        stage: phase === 'opening' ? 'connect' : 'read' }));
    }
    function onClose() {
      if (phase === 'closing') { release(); return; }
      finish(new ShroomError('DISCONNECTED', '扫描期间串口断开。', { stage: 'read', details: { path } }));
    }
    function onData(chunk) {
      if (phase !== 'reading') return;
      try {
        assertLicense(requirement);
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) {
          finish(new ShroomError('PARSE_FAILED', '扫描数据超过单口采样上限。', { stage: 'parse', details: { path } }));
          return;
        }
        for (const frame of parser.push(new Uint8Array(chunk))) {
          const next = adapter.discovery.identify(frame);
          const nextKey = JSON.stringify(next);
          if (identityKey !== undefined && nextKey !== identityKey) mixed = true;
          identity ??= next; identityKey ??= nextKey;
          count += 1;
        }
      } catch (cause) { finish(asShroomError(cause, { code: 'PARSE_FAILED', stage: 'parse' })); }
    }
    try {
      port = new SerialPort({ path, baudRate: adapter.profile.baudRate, autoOpen: false });
      port.on('data', onData); port.on('error', onError); port.on('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });
      unwatch = watchLicense(requirement, error => finish(error));
      if (signal?.aborted) { onAbort(); return; }
      assertLicense(requirement);
      if (phase === 'closing') return;
      opening = true;
      openTimer = setTimeout(() => finish(new ShroomError('CONNECTION_FAILED', '扫描串口打开超时。', {
        stage: 'connect', details: { path },
      })), openTimeoutMs);
      port.open(cause => {
        opening = false;
        if (phase === 'closing') { closePort(); return; }
        if (cause) { onError(cause); return; }
        clearTimeout(openTimer);
        phase = 'reading';
        readTimer = setTimeout(() => finish(), timeoutMs);
      });
    } catch (cause) {
      opening = false;
      finish(asShroomError(cause, { code: 'CONNECTION_FAILED', stage: 'connect' }));
    }
  });
}

/** 内部可注入串口驱动和生命周期超时，测试无需接触真实设备。 */
export async function scanProductPortsWith(SerialPort, options = {}, timings = {}) {
  const config = prepareProductScan(options);
  const { adapter, signal } = config;
  const requirement = { product: adapter.profile.product, feature: 'serial' };
  const assertActive = () => { if (signal?.aborted) throw cancelled(); assertLicense(requirement); };
  assertActive();
  let candidates;
  try {
    candidates = config.paths ? config.paths.map(path => ({ path })) : await SerialPort.list();
  } catch (cause) { throw asShroomError(cause, { code: 'CONNECTION_FAILED', stage: 'query' }); }
  const report = { devices: [], ports: [] };
  const seen = new Set();
  for (const port of candidates) {
    assertActive();
    if (typeof port.path !== 'string' || !port.path.trim() || seen.has(pathKey(port.path))) continue;
    seen.add(pathKey(port.path));
    const path = port.path;
    try {
      const identity = await probePort(SerialPort, path, config, timings);
      assertActive();
      if (!identity) { report.ports.push({ path, status: 'unrecognized' }); continue; }
      const device = { path, product: adapter.profile.product, label: adapter.profile.label,
        baudRate: adapter.profile.baudRate, ...identity,
        ...(port.serialNumber ? { serialNumber: port.serialNumber } : {}) };
      report.ports.push({ path, status: 'matched', device });
      if (config.side === undefined || device.side === config.side) report.devices.push(device);
    } catch (cause) {
      const error = asShroomError(cause, { code: 'CONNECTION_FAILED', stage: 'query' });
      if (['CLOSE_FAILED', 'USER_CANCELLED'].includes(error.code) || error.code.startsWith('LICENSE_')) throw error;
      report.ports.push({ path, status: 'error', error });
    }
  }
  assertActive();
  return report;
}
