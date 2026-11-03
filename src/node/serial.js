/** Node 串口：serialport 按需加载，不影响 core 和模拟设备。 */
import { createFramer } from '../core/framer.js';
import { decodeFrame } from '../core/frame.js';
import { createFrameHub } from '../core/device.js';
import { ShroomError, asShroomError } from '../core/errors.js';
import { validateSerialOptions } from '../core/serial-config.js';
import { serialDiagnostics } from '../core/serial-diagnostics.js';
import { prepareProductConnection } from '../core/product.js';
import { assertLicense, watchLicense, markLicensedDevice } from '../core/license.js';

/** 按需导入可选依赖，把安装缺失转换为含阶段和建议的 SDK 错误。 */
async function loadSerialPort(stage) {
  try {
    return await import('serialport');
  } catch (cause) {
    throw new ShroomError('DEPENDENCY_MISSING', '没找到 serialport，请先运行：npm i serialport', {
      stage, suggestion: '请在使用 Node 串口的项目中运行 npm i serialport。', cause,
    });
  }
}

/** 列出当前机器上的串口及驱动元信息，不打开端口，也不要求先激活授权。 */
export async function listPorts() {
  try {
    const { SerialPort } = await loadSerialPort('query');
    return await SerialPort.list();
  } catch (error) {
    throw asShroomError(error, {
      code: 'CONNECTION_FAILED', stage: 'query',
      suggestion: '请检查串口驱动、设备连接和当前用户的串口访问权限。',
    });
  }
}

/**
 * 通用串口入口：options 提供 path、波特率、帧边界、矩阵和点位配置。
 * 需 serial.raw 授权；未指定 path 时选择首个端口，产品入口则拒绝多端口歧义。
 * Promise 在串口打开后返回 Device；数据与后续异常分别通过 onFrame/onError 订阅。
 */
export async function connectSerial(options = {}) {
  return connectSerialDevice(options);
}

/**
 * 按 options.product 的内置协议连接，直接通过 onData 交付解析后的产品帧。
 * 产品层固定协议参数；手套还须明确 side，业务无需重复拆帧或重排点位。
 */
export async function connectProduct(options = {}) {
  const session = prepareProductConnection(options);
  return connectSerialDevice(session.serialOptions, session);
}

/** 连接整包手套；options.side 必须为 left/right，返回含五指、指腹、手掌和原始 IMU 的产品设备。 */
export async function connectGlove(options = {}) {
  return connectProduct(productOptionsFor(options, 'handGloveFullPacket'));
}

/** 连接手部检测垫；无需 side，onData 返回已经映射的 32×32 矩阵及相对归一化值。 */
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

/** 复用通用串口生命周期，产品层只替换解析器和预订阅。 */
async function connectSerialDevice(options, productSession = null) {
  const decodeOptions = options;
  options = validateSerialOptions(options);
  const licenseRequirement = Object.freeze(productSession
    ? { product: productSession.info.product, feature: 'serial' }
    : { feature: 'serial.raw' });
  assertLicense(licenseRequirement);
  const { SerialPort } = await loadSerialPort('connect');
  let path = options.path;
  if (!path) {
    const ports = await listPorts();
    if (ports.length === 0) {
      throw new ShroomError('PORT_NOT_FOUND', '没有检测到串口设备。', {
        stage: 'query', suggestion: '请连接设备并安装对应的串口驱动，再重新查询。',
      });
    }
    if (productSession && ports.length > 1) {
      throw new ShroomError('PORT_AMBIGUOUS', '检测到多个串口，请指定产品使用的 path。', {
        stage: 'query',
        suggestion: '调用 listPorts() 查看端口，再用 path 指定设备；SDK 不会根据串口顺序猜测产品。',
        details: { paths: ports.map((entry) => entry.path) },
      });
    }
    path = ports[0].path;
  }

  const baudRate = options.baudRate ?? 1000000;
  const hub = createFrameHub();
  const framer = productSession?.parser ?? createFramer(options);
  if (productSession?.onData) hub.onFrame(productSession.onData);
  if (productSession?.onError) hub.onError(productSession.onError);
  let bytesReceived = 0;
  let frameCount = 0;
  let state = 'closed';
  let opening = true;
  let closing = false;
  let closePromise = null;
  let closingError = null;
  let closeFinished = false;
  let rejectOpen = null;
  let port = null;
  let unsubscribeLicense;

  /** 保留错误状态并通知订阅者，供诊断快照读取最近一次错误。 */
  function report(error) {
    state = 'error';
    hub.emitError(error);
  }

  /** 读取/解析/授权的致命错误进入统一关闭路径，保留最初错误供调用方排查。 */
  function fail(error) {
    if (closing) return;
    report(error);
    void close().catch(() => {});
  }

  /** 字节块先累计拆帧；产品解析器直接产出产品帧，通用解析器还需 decodeFrame。 */
  function onData(chunk) {
    if (closing || state !== 'open') return;
    bytesReceived += chunk.length;
    try {
      for (const payload of framer.push(new Uint8Array(chunk))) {
        // 每帧校验权限，避免后台续验或到期后仍向应用持续交付数据。
        assertLicense(licenseRequirement);
        const frame = productSession ? payload : decodeFrame(payload, decodeOptions);
        frameCount += 1;
        hub.emit(frame);
        if (closing) break;
      }
    } catch (error) {
      fail(asShroomError(error, {
        code: 'PARSE_FAILED', stage: 'parse',
        suggestion: '请检查帧分隔符、帧长、矩阵行列和点位排列配置。',
      }));
    }
  }

  /** 按打开、读取、关闭阶段区分驱动错误，让 Promise 或订阅回调收到对应错误。 */
  function onPortError(error) {
    if (opening) {
      rejectOpen?.(asShroomError(error, {
        code: 'CONNECTION_FAILED', stage: 'connect',
        suggestion: '请检查设备连接、串口权限，以及端口是否被其他程序占用。',
      }));
    } else if (closing) {
      closingError ??= asShroomError(error, {
        code: 'CLOSE_FAILED', stage: 'close',
        suggestion: '关闭串口失败；请检查设备连接，并关闭其他占用串口的程序。',
      });
      report(closingError);
    } else {
      fail(asShroomError(error, {
        code: 'READ_FAILED', stage: 'read',
        suggestion: '请检查设备连接，重新连接串口。',
      }));
    }
  }

  /** 区分主动关闭与拔线等意外断开；打开期间断开要拒绝连接 Promise。 */
  function onPortClose() {
    if (closing) {
      if (closeFinished) detachPortEvents();
      return;
    }
    const error = new ShroomError('DISCONNECTED', '串口设备已断开。', {
      stage: opening ? 'connect' : 'read', suggestion: '请检查设备连接，重新连接串口。',
    });
    if (opening) rejectOpen?.(error);
    else fail(error);
  }

  function detachPortEvents() {
    port?.removeListener('error', onPortError);
    port?.removeListener('close', onPortClose);
  }

  /** 幂等释放串口与订阅：并发关闭复用同一 Promise，关闭失败仍保留必要错误监听。 */
  function close() {
    if (closePromise) return closePromise;
    closing = true;
    unsubscribeLicense?.();
    if (state !== 'error') state = 'closed';
    closePromise = Promise.resolve().then(async () => {
      try {
        if (port && port.isOpen !== false) {
          await new Promise((resolve, reject) => {
            port.close((error) => error ? reject(error) : resolve());
          });
        }
        if (closingError) throw closingError;
      } catch (error) {
        const normalized = asShroomError(error, {
          code: 'CLOSE_FAILED', stage: 'close',
          suggestion: '关闭串口失败；请检查设备连接，并关闭其他占用串口的程序。',
        });
        closingError ??= normalized;
        if (hub.lastError !== normalized) report(normalized);
        throw normalized;
      } finally {
        closeFinished = true;
        port?.removeListener('data', onData);
        // close 失败时驱动可能仍在发 error；保留监听直到端口实际关闭，避免进程崩溃。
        if (!closingError || port?.isOpen === false) detachPortEvents();
        hub.clear();
      }
    });
    return closePromise;
  }

  try {
    assertLicense(licenseRequirement);
    port = new SerialPort({ path, baudRate, autoOpen: false });
    port.on('error', onPortError);
    port.on('close', onPortClose);
    port.on('data', onData);
    await new Promise((resolve, reject) => {
      rejectOpen = reject;
      port.open((error) => {
        if (error) return reject(error);
        // 打开阶段若先收到 error，迟到的成功回调也不能留下一个打开的端口。
        if (closing) {
          if (port.isOpen) {
            port.on('error', onPortError);
            port.on('close', onPortClose);
            try {
              port.close((closeError) => {
                if (closeError) onPortError(closeError);
                else detachPortEvents();
              });
            } catch (closeError) {
              onPortError(closeError);
            }
          }
          return;
        }
        opening = false;
        state = 'open';
        resolve();
      });
    });
    assertLicense(licenseRequirement);
    unsubscribeLicense = watchLicense(licenseRequirement, fail);
  } catch (error) {
    opening = false;
    state = 'error';
    await close().catch(() => {});
    throw asShroomError(error, {
      code: 'CONNECTION_FAILED', stage: 'connect',
      suggestion: '请检查设备连接、串口权限，以及端口是否被其他程序占用。',
    });
  }

  const device = {
    info: { source: 'node-serial', path, baudRate, rows: options.rows ?? null, cols: options.cols ?? null, ...productSession?.info },
    onFrame: hub.onFrame,
    ...(productSession ? { onData: hub.onFrame } : {}),
    onError: hub.onError,
    get state() { return state; },
    get droppedCount() { return framer.droppedCount; },
    get bytesReceived() { return bytesReceived; },
    get frameCount() { return frameCount; },
    get frameLength() { return framer.frameLength; },
    /** 返回累计字节/有效帧/丢帧与最后错误，不额外探测或控制硬件。 */
    getDiagnostics() {
      return serialDiagnostics({
        source: 'node-serial', state, bytesReceived, frameCount,
        droppedCount: framer.droppedCount, frameLength: framer.frameLength, lastError: hub.lastError,
      });
    },
    close,
  };
  // 记录真实源的权限要求，后续 serveDevice 可沿用同一设备授权边界。
  markLicensedDevice(device, licenseRequirement);
  return device;
}
