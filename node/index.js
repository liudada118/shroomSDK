/**
 * Shroom SDK · Node 入口：集中导出串口、产品、WS 录制、授权与共享数据处理接口。
 *
 *   // 从 SDK 根目录中的 .mjs 文件导入；真实设备须先完成 SDK 授权。
 *   import { Shroom } from './node/index.js'
 *
 *   const device = await Shroom.connectGlove({ path: 'COM3', side: 'left' })
 *   device.onData(data => console.log(data.fingers, data.palm))
 *
 * 无硬件时 Shroom.mock() 提供通用矩阵帧；它共用 onFrame/close，不模拟手套专用字段。
 */
export { connectSerial, listPorts, connectProduct, connectGlove, connectHandPad } from './serial.js';
export { listDeviceProducts } from '../core/product.js';
export { renderAscii } from './ascii.js';
export { serveDevice } from './quick-server.js';
export { encodeStreamFrame, decodeStreamFrame, STREAM_SCHEMA } from '../core/stream-codec.js';
export { createMockDevice } from '../core/mock.js';
export { createFramer, DEFAULT_DELIMITER } from '../core/framer.js';
export { decodeFrame, resolveShape } from '../core/frame.js';
export { shroom, jet, jetWhite, grey, COLORMAPS, getColormap } from '../core/colormap.js';
export { LAYOUTS, getLayout, listLayouts, PRODUCTS, getProduct, listProducts } from '../core/layout.js';
export { BackendSdkClient } from './backend.js';
export { ShroomError, ERROR_CODES, asShroomError } from '../core/errors.js';
export { activateLicense, getLicenseStatus, clearLicense, SDK_PRODUCT_TYPE } from '../core/license.js';

import { connectSerial, listPorts, connectProduct, connectGlove, connectHandPad } from './serial.js';
import { listDeviceProducts } from '../core/product.js';
import { renderAscii } from './ascii.js';
import { serveDevice } from './quick-server.js';
import { encodeStreamFrame, decodeStreamFrame, STREAM_SCHEMA } from '../core/stream-codec.js';
import { createMockDevice } from '../core/mock.js';
import { ShroomError, ERROR_CODES, asShroomError } from '../core/errors.js';
import { activateLicense, getLicenseStatus, clearLicense } from '../core/license.js';
import { SDK_VERSION } from '../core/version.js';

/** 便捷命名空间，与上面的具名导出复用同一实现，调用方可按项目风格选一种方式。 */
export const Shroom = {
  activateLicense,
  getLicenseStatus,
  clearLicense,
  ShroomError,
  ERROR_CODES,
  asShroomError,
  /** 选产品即可收取已解析数据 */
  connectProduct,
  connectGlove,
  connectHandPad,
  listDeviceProducts,
  /** 将已有设备广播为 WS 数据源，并提供持久化标签录制与下载。 */
  serveDevice,
  encodeStreamFrame,
  decodeStreamFrame,
  STREAM_SCHEMA,
  /** 通用串口读取，需要自行提供协议参数；已支持产品优先使用 connectGlove/connectHandPad。 */
  connect: connectSerial,
  /** 列出可用串口 */
  listPorts,
  /** 模拟矩阵设备，共用通用 Frame 订阅与关闭接口。 */
  mock: createMockDevice,
  /** 把一帧画成终端里的字符热力图 */
  renderAscii,
  version: SDK_VERSION,
};

export default Shroom;
