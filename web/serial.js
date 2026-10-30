/** 浏览器串口：基于 Web Serial API，需在安全上下文中由用户手势触发。 */
import { createFramer } from '../core/framer.js';
import { decodeFrame } from '../core/frame.js';
import { createFrameHub } from '../core/device.js';
import { ShroomError, asShroomError } from '../core/errors.js';
import { validateSerialOptions } from '../core/serial-config.js';
import { serialDiagnostics } from '../core/serial-diagnostics.js';
import { prepareProductConnection } from '../core/product.js';
import { assertLicense, watchLicense, markLicensedDevice } from '../core/license.js';

/** 当前环境能不能用浏览器串口 */
export function isSerialSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.serial?.requestPort === 'function';
}

/** 检查浏览器专用的已授权端口和 USB 筛选器，避免弹出选择框后才发现配置错误。 */
function validateWebOptions(options) {
  const invalid = (field, message) => {
    throw new ShroomError('INVALID_CONFIG', message, { stage: 'configure', details: { field } });
  };
  if (options.port !== undefined && (!options.port || typeof options.port.open !== 'function'
    || typeof options.port.close !== 'function')) {
    invalid('port', 'port 必须是具有 open 和 close 方法的已授权串口对象。');
  }
  if (options.filters !== undefined) {
    if (!Array.isArray(options.filters)) invalid('filters', 'filters 必须是串口筛选对象数组。');
    for (const filter of options.filters) {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
        invalid('filters', 'filters 每一项必须是串口筛选对象。');
      }
      for (const field of ['usbVendorId', 'usbProductId']) {
        if (filter[field] !== undefined && (!Number.isInteger(filter[field]) || filter[field] < 0 || filter[field] > 65535)) {
          invalid(`filters.${field}`, `${field} 必须是 0 到 65535 的整数。`);
        }
      }
      if (filter.usbProductId !== undefined && filter.usbVendorId === undefined) {
        invalid('filters.usbProductId', '指定 usbProductId 时必须同时指定 usbVendorId。');
      }
    }
  }
}

/**
 * 通用串口入口：根据分隔符/帧长拆包，按矩阵参数解码，通过 onFrame 订阅。
 * 必须先完成 SDK 授权，再在点击等用户手势里调用；options.port 可复用已授权端口。
 * 返回 Promise<Device>；打开前失败会拒绝，读取期间的错误通过 onError 交付。
 */
export async function connectSerial(options = {}) {
  return connectSerialDevice(options);
}

/** 按产品内置协议选择设备，直接接收产品数据；仍需用户手势授权。 */
export async function connectProduct(options = {}) {
  const session = prepareProductConnection(options);
  return connectSerialDevice(session.serialOptions, session);
}

/**
 * 使用整包手套协议连接；options.side 必填 left/right，不自动识别实物手侧。
 * 可在 options.onData 中直接读取 fingers、palm 和 imu；连接前注册可避免遗漏首帧。
 */
export async function connectGlove(options = {}) {
  return connectProduct(productOptionsFor(options, 'handGloveFullPacket'));
}

/** 使用手部检测垫内置协议连接；onData 返回已映射的 32×32 数据，无需配置 side。 */
export async function connectHandPad(options = {}) {
  return connectProduct(productOptionsFor(options, 'hand'));
}

/** 校验便捷入口参数，再固定产品，避免空值被对象展开静默忽略。 */
function productOptionsFor(options, product) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new ShroomError('INVALID_CONFIG', '产品连接参数必须是对象。', {
      stage: 'configure', details: { field: 'options' },
    });
  }
  return { ...options, product };
}

/** 复用浏览器串口生命周期，产品层只替换解析器和预订阅。 */
async function connectSerialDevice(options, productSession = null) {
  // 示例允许在连接期间修改矩阵/排列；传输参数固定，解码参数仍逐帧读取原对象。
  const decodeOptions = options;
  options = validateSerialOptions(options);
  validateWebOptions(options);
  if (!isSerialSupported()) {
    let message = '当前浏览器没有 Web Serial API，请改用 Chrome 或 Edge。';
    if (typeof location !== 'undefined' && location.protocol === 'file:') {
      message = '页面是用 file:// 打开的，浏览器不会开放串口。请用本地服务器打开（SDK 目录里执行 node start.mjs）。';
    } else if (typeof window !== 'undefined' && !window.isSecureContext) {
      message = `当前地址 ${typeof location !== 'undefined' ? location.origin : ''} 不是安全上下文，浏览器不会开放串口。请改用 https 或 localhost。`;
    }
    throw new ShroomError('UNSUPPORTED_ENVIRONMENT', message, {
      stage: 'query', suggestion: '请使用 Chrome 或 Edge，通过 https 或 localhost 打开页面，并从点击事件连接。',
    });
  }

  const licenseRequirement = Object.freeze(productSession
    ? { product: productSession.info.product, feature: 'serial' }
    : { feature: 'serial.raw' });
  // 授权应在调用前完成；这里同步检查，避免异步激活耗掉浏览器串口选择所需的用户手势。
  assertLicense(licenseRequirement);
  const hub = createFrameHub();
  const framer = productSession?.parser ?? createFramer(options);
  if (productSession?.onData) hub.onFrame(productSession.onData);
  if (productSession?.onError) hub.onError(productSession.onError);
  let port;
  try {
    port = options.port ?? await navigator.serial.requestPort(options.filters ? { filters: options.filters } : {});
  } catch (error) {
    throw asShroomError(error, {
      code: 'CONNECTION_FAILED', stage: 'query',
      suggestion: '请从点击事件重新选择串口，并检查浏览器的串口访问权限。',
    });
  }
  const baudRate = options.baudRate ?? 1000000;
  const hadStreams = Boolean(port.readable || port.writable);
  try {
    assertLicense(licenseRequirement);
    await port.open({ baudRate });
    assertLicense(licenseRequirement);
  } catch (error) {
    // 只释放本次打开产生的流；已打开的授权端口可能属于调用方的另一个连接。
    if (!hadStreams && (port.readable || port.writable)) {
      try { await port.close(); } catch { /* 保留最初的打开错误。 */ }
    }
    throw asShroomError(error, {
      code: 'CONNECTION_FAILED', stage: 'connect',
      suggestion: '请检查设备连接、串口访问权限，以及端口是否被其他程序占用。',
    });
  }

  let state = 'open';
  let closing = false;
  let reader = null;
  let readTask;
  let closePromise = null;
  let bytesReceived = 0;
  let frameCount = 0;
  let unsubscribeLicense;

  /** 记录错误状态后通知订阅者；后续清理不把失败状态伪装为正常关闭。 */
  function report(error) {
    state = 'error';
    hub.emitError(error);
  }

  function fail(error) {
    if (closing) return;
    report(error);
    // 后台失败必须被观察到，也必须释放端口；不产生未处理的 Promise rejection。
    void close().catch(() => {});
  }

  const onDisconnect = () => fail(new ShroomError('DISCONNECTED', '串口设备已断开。', {
    stage: 'read', suggestion: '请检查设备连接，重新连接串口。',
  }));
  port.addEventListener?.('disconnect', onDisconnect);

  /** 单个 reader 持续读字节；分帧器承接半包/粘包，最终只交付完整的产品帧或通用帧。 */
  async function readLoop() {
    if (closing) return;
    let activeReader = null;
    let failure = null;
    try {
      if (!port.readable) {
        throw new ShroomError('DISCONNECTED', '串口没有可读取的数据流。', {
          stage: 'read', suggestion: '请检查设备连接，重新连接串口。',
        });
      }
      activeReader = port.readable.getReader();
      reader = activeReader;
      while (!closing) {
        const { value, done } = await activeReader.read();
        if (closing) break;
        if (done) {
          throw new ShroomError('DISCONNECTED', '串口数据流已结束。', {
            stage: 'read', suggestion: '请检查设备是否断开，重新连接串口。',
          });
        }
        if (!value) continue;
        bytesReceived += value.byteLength ?? value.length;
        try {
          for (const payload of framer.push(value)) {
            assertLicense(licenseRequirement);
            const frame = productSession ? payload : decodeFrame(payload, decodeOptions);
            frameCount += 1;
            hub.emit(frame);
            if (closing) break;
          }
        } catch (error) {
          throw asShroomError(error, {
            code: 'PARSE_FAILED', stage: 'parse',
            suggestion: '请检查帧分隔符、帧长、矩阵行列和点位排列配置。',
          });
        }
      }
    } catch (error) {
      if (!closing) failure = asShroomError(error, {
        code: 'READ_FAILED', stage: 'read',
        suggestion: '请检查设备连接和串口权限，重新连接串口。',
      });
    } finally {
      try { activeReader?.releaseLock(); } catch { /* 取消或断开时可能已经释放。 */ }
      if (reader === activeReader) reader = null;
    }
    if (failure) fail(failure);
  }

  /**
   * 幂等关闭：重复调用返回同一个 Promise。
   * 先取消读取并释放锁，再关闭端口、清除订阅，防止关闭与未完成的 read 互相等待。
   */
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    unsubscribeLicense?.();
    if (state !== 'error') state = 'closed';
    port.removeEventListener?.('disconnect', onDisconnect);
    closePromise = Promise.resolve().then(async () => {
      let closeError = null;
      const observeCloseError = (error) => {
        const normalized = asShroomError(error, {
          code: 'CLOSE_FAILED', stage: 'close',
          suggestion: '关闭串口失败；请检查设备连接，并关闭其他占用串口的程序。',
        });
        closeError ??= normalized;
        report(normalized);
      };
      let cancelled = true;
      if (reader) {
        const activeReader = reader;
        try {
          await activeReader.cancel();
        } catch (error) {
          cancelled = false;
          observeCloseError(error);
          // cancel 失败时仍尝试释放锁，避免一直等待无法结束的 read。
          try { activeReader.releaseLock(); } catch { /* port.close 仍会被尝试。 */ }
          if (reader === activeReader) reader = null;
        }
      }
      if (cancelled) await readTask;
      try {
        await port.close();
      } catch (error) {
        observeCloseError(error);
      } finally {
        hub.clear();
      }
      if (closeError) throw closeError;
    });
    return closePromise;
  }

  unsubscribeLicense = watchLicense(licenseRequirement, fail);
  readTask = Promise.resolve().then(readLoop);
  const device = {
    info: { source: 'web-serial', baudRate, rows: options.rows ?? null, cols: options.cols ?? null, ...productSession?.info },
    onFrame: hub.onFrame,
    ...(productSession ? { onData: hub.onFrame } : {}),
    onError: hub.onError,
    get state() { return state; },
    get droppedCount() { return framer.droppedCount; },
    get bytesReceived() { return bytesReceived; },
    get frameCount() { return frameCount; },
    get frameLength() { return framer.frameLength; },
    getDiagnostics() {
      return serialDiagnostics({
        source: 'web-serial', state, bytesReceived, frameCount,
        droppedCount: framer.droppedCount, frameLength: framer.frameLength, lastError: hub.lastError,
      });
    },
    close,
  };
  markLicensedDevice(device, licenseRequirement);
  return device;
}
