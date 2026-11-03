/**
 * 产品连接适配层：将产品名转换成固定串口配置，再把字节流解析成产品帧。
 * Node / Web 串口入口共用此层；本模块不打开端口，也不自动识别设备或手侧。
 */
import { ShroomError } from './errors.js';
import { deviceProductAdapters, getDeviceProductAdapter } from './products/registry.js';

/** 列出已封装连接协议的产品；不等于通用线序/展示产品清单。 */
export function listDeviceProducts() {
  return deviceProductAdapters.map((adapter) => ({ ...adapter.profile }));
}

/**
 * 在打开端口前验证产品与回调，不允许调用方覆盖产品固有协议。
 * @param {object} options 产品名、串口路径/浏览器端口、手侧和 onData / onError 回调。
 * @returns {object} 串口入口使用的配置、独立解析器、产品信息与原回调；不会连接设备。
 */
export function prepareProductConnection(options = {}) {
  const invalid = (field, message) => {
    throw new ShroomError('INVALID_CONFIG', message, { stage: 'configure', details: { field } });
  };
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('options', '产品连接参数必须是一个对象。');
  const adapter = getDeviceProductAdapter(options.product);
  if (!adapter) {
    const supported = deviceProductAdapters.map(({ profile }) => `${profile.product}（${profile.label}）`).join(' 或 ');
    invalid('product', `请选择已支持的产品：${supported}。`);
  }
  const profile = adapter.profile;
  const allowed = new Set(['product', 'path', 'port', 'filters', 'onData', 'onError', ...adapter.optionFields]);
  for (const field of Object.keys(options)) {
    if (!allowed.has(field)) invalid(field, `产品接口不接受 ${field}；波特率、分帧和线序已经内置。自定义协议请使用 connect()。`);
  }
  for (const field of ['onData', 'onError']) {
    if (options[field] !== undefined && typeof options[field] !== 'function') invalid(field, `${field} 必须是函数。`);
  }
  adapter.validateOptions(options, invalid);
  const serialOptions = {
    baudRate: profile.baudRate, rows: profile.rows, cols: profile.cols,
    ...(options.path === undefined ? {} : { path: options.path }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.filters === undefined ? {} : { filters: options.filters }),
  };
  return {
    serialOptions,
    parser: adapter.createParser(options),
    info: {
      product: profile.product, label: profile.label, rows: profile.rows, cols: profile.cols,
      ...adapter.connectionInfo(options),
    },
    onData: options.onData, onError: options.onError,
  };
}

/**
 * 从注册表创建产品自己的解析器；不靠帧长推测型号或手侧。
 * @param {string} product 已注册的规范产品名或连接别名，未知产品一律拒绝。
 * @param {object} options 产品解析选项；手套必须明确传入 side: left/right。
 * @returns {object} 带 push / reset 和累计诊断计数的解析器；每个连接应各建一个。
 */
export function createProductParser(product, options = {}) {
  const adapter = getDeviceProductAdapter(product);
  if (!adapter) {
    throw new ShroomError('INVALID_CONFIG', '请选择有效的产品及手套手侧。', { stage: 'configure' });
  }
  return adapter.createParser(options);
}
