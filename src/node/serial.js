/** Node 串口：按需加载驱动，产品连接复用统一的有限重连管理器。 */
import { createFramer } from '../core/framer.js';
import { decodeFrame } from '../core/frame.js';
import { ShroomError, asShroomError } from '../core/errors.js';
import { validateSerialOptions } from '../core/serial-config.js';
import { prepareProductConnection } from '../core/product.js';
import { getDeviceProductAdapter } from '../core/products/registry.js';
import { assertLicense } from '../core/license.js';
import { connectManagedSerial, reconnectOptions } from './serial-reconnect.js';
import { assertSerialPathAvailable, prepareProductScan, scanProductPortsWith } from './serial-scan.js';

/** 按需导入可选依赖，把安装缺失转换为含阶段和建议的 SDK 错误。 */
async function loadSerialPort(stage) {
  try { return await import('serialport'); }
  catch (cause) {
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
    throw asShroomError(error, { code: 'CONNECTION_FAILED', stage: 'query',
      suggestion: '请检查串口驱动、设备连接和当前用户的串口访问权限。' });
  }
}

/** 自动识别会临时打开串口读取完整协议帧；全部关闭后返回左右手候选与各口诊断。 */
export async function scanProductPorts(options = {}) {
  const { adapter, signal } = prepareProductScan(options);
  assertLicense({ product: adapter.profile.product, feature: 'serial' });
  if (signal?.aborted) throw new ShroomError('USER_CANCELLED', '串口自动识别已取消。', { stage: 'query' });
  const { SerialPort } = await loadSerialPort('query');
  return scanProductPortsWith(SerialPort, options);
}

/** 通用串口使用调用方协议；自动重连默认关闭，可通过 reconnect 显式启用。 */
export async function connectSerial(options = {}) { return connectSerialDevice(options); }

/** 产品串口固定协议与映射，默认意外断线后重连原路径，回调与设备句柄保持稳定。 */
export async function connectProduct(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) prepareProductConnection(options, 'node');
  const adapter = getDeviceProductAdapter(options?.product);
  if (!adapter?.discovery) {
    const session = prepareProductConnection(options, 'node');
    return connectSerialDevice(session.serialOptions, session);
  }
  const { scan, ...connection } = options;
  const automatic = connection.path === undefined || connection.side === undefined || connection.side === 'auto' || scan !== undefined;
  const session = prepareProductConnection({ ...connection, side: connection.side ?? 'auto' }, 'node');
  validateSerialOptions(session.serialOptions);
  reconnectOptions(session.serialOptions, true);
  if (automatic) {
    if (scan !== undefined && (!scan || typeof scan !== 'object' || Array.isArray(scan)
      || Object.keys(scan).some(key => !['paths', 'timeoutMs', 'signal'].includes(key)))) {
      throw new ShroomError('INVALID_CONFIG', 'scan 仅支持 paths、timeoutMs、signal。', { stage: 'configure', details: { field: 'scan' } });
    }
    if (connection.path !== undefined && scan?.paths !== undefined) {
      throw new ShroomError('INVALID_CONFIG', '指定 path 后不应再提供 scan.paths。', { stage: 'configure', details: { field: 'scan.paths' } });
    }
    const result = await scanProductPorts({ ...scan, product: connection.product,
      ...(connection.path === undefined ? {} : { paths: [connection.path] }),
      ...(['left', 'right'].includes(connection.side) ? { side: connection.side } : {}),
    });
    if (result.devices.length !== 1) {
      const multiple = result.devices.length > 1;
      throw new ShroomError(multiple ? 'PORT_AMBIGUOUS' : 'PORT_NOT_FOUND',
        multiple ? '识别到多个符合条件的手套，请按候选列表指定串口。' : '没有识别到符合条件的手套。', {
          stage: 'query', details: { scan: result },
          suggestion: multiple ? '指定 side 筛选左/右手；同侧有多只手套时指定 path。' : '检查驱动、供电、端口占用与手侧；可查看 details.scan 的逐口结果。',
        });
    }
    const selected = result.devices[0];
    session.serialOptions.path = selected.path;
    Object.assign(session.info, { side: selected.side, packetType: selected.packetType });
    const parser = adapter.discovery.createParser();
    // 正式连接与后续重连仍校验发现的身份，不能把换接的另一只手映射成原手侧。
    session.parser = {
      push(chunk) {
        const frames = parser.push(chunk);
        for (const frame of frames) {
          const identity = adapter.discovery.identify(frame);
          if (identity.side !== selected.side || identity.packetType !== selected.packetType) {
            throw new ShroomError('PARSE_FAILED', '串口中的手套手侧与自动识别结果不一致。', {
              stage: 'parse', details: { path: selected.path, expectedSide: selected.side, actualSide: identity.side },
              suggestion: '关闭连接后重新扫描；一只手套应独占一个串口。',
            });
          }
        }
        return frames;
      },
      reset: () => parser.reset(),
      get droppedCount() { return parser.droppedCount; },
      get frameLength() { return parser.frameLength; },
    };
  }
  return connectSerialDevice(session.serialOptions, session);
}

/** 连接分包手套；path+side 为手动模式，省略端口/手侧时按协议自动识别。 */
export async function connectGlove(options = {}) { return connectProduct(productOptionsFor(options, 'handGloveSegmented')); }

/** 连接手部检测垫；无需 side，onData 返回映射后的 32×32 矩阵。 */
export async function connectHandPad(options = {}) { return connectProduct(productOptionsFor(options, 'hand')); }

/** 校验便捷入口参数，再固定产品，避免空值被对象展开静默忽略。 */
function productOptionsFor(options, product) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new ShroomError('INVALID_CONFIG', '产品连接参数必须是对象。', { stage: 'configure', details: { field: 'options' } });
  }
  return { ...options, product };
}

/** 首次解析端口选择；后续重连固定使用此路径，不重新枚举并猜测设备。 */
async function connectSerialDevice(options, productSession = null) {
  const decodeOptions = options;
  options = validateSerialOptions(options);
  const policy = reconnectOptions(options, Boolean(productSession));
  const licenseRequirement = Object.freeze(productSession
    ? { product: productSession.info.product, feature: 'serial' } : { feature: 'serial.raw' });
  assertLicense(licenseRequirement);
  const { SerialPort } = await loadSerialPort('connect');
  let path = options.path;
  if (!path) {
    const ports = await listPorts();
    if (!ports.length) throw new ShroomError('PORT_NOT_FOUND', '没有检测到串口设备。', {
      stage: 'query', suggestion: '请连接设备并安装对应的串口驱动，再重新查询。',
    });
    if (productSession && ports.length > 1) throw new ShroomError('PORT_AMBIGUOUS', '检测到多个串口，请指定产品使用的 path。', {
      stage: 'query', suggestion: '调用 listPorts() 查看端口，再用 path 指定设备；SDK 不会根据串口顺序猜测产品。',
      details: { paths: ports.map((entry) => entry.path) },
    });
    path = ports[0].path;
  }
  assertSerialPathAvailable(path);
  return connectManagedSerial({ SerialPort, path, baudRate: options.baudRate ?? 1000000,
    info: { rows: options.rows ?? null, cols: options.cols ?? null, ...productSession?.info },
    makeParser: () => {
      if (!productSession) return createFramer(options);
      productSession.parser.reset();
      return productSession.parser;
    },
    decode: productSession ? (frame) => frame : (payload) => decodeFrame(payload, decodeOptions),
    licenseRequirement, policy, product: Boolean(productSession),
    onData: productSession?.onData, onError: productSession?.onError, onStateChange: options.onStateChange });
}
