/**
 * Shroom SDK · 浏览器入口
 *
 * 这是浏览器侧的统一导出入口，具体实现位于 serial.js、stream.js 和渲染模块。
 * 直连产品：先激活 SDK，再从点击事件调用 connectGlove / connectHandPad。
 * 连接 Node 服务：connectStream 返回订阅、开始/停止录制和下载接口，记录保存在 Node 端。
 *
 *   import { Shroom } from './sdk/web/index.js'
 *
 *   const device  = await Shroom.connect()                    // 已激活；必须在点击里调用
 *   const heatmap = Shroom.createHeatmap('#view')
 *   device.onFrame(frame => heatmap.render(frame))
 *
 * 没有硬件时可用 Shroom.mock() 调试通用矩阵视图；模拟帧不等于真实产品帧。
 */
export { connectSerial, isSerialSupported, connectProduct, connectGlove, connectHandPad } from './serial.js';
export { listDeviceProducts } from '../core/product.js';
export { createHeatmap } from './heatmap.js';
export { connectStream } from './stream.js';
export { createProductView } from './product-view.js';
export { encodeStreamFrame, decodeStreamFrame, STREAM_SCHEMA } from '../core/stream-codec.js';
export { createMockDevice } from '../core/mock.js';
export { createFramer, DEFAULT_DELIMITER } from '../core/framer.js';
export { decodeFrame, resolveShape } from '../core/frame.js';
export { shroom, jet, jetWhite, grey, COLORMAPS, getColormap } from '../core/colormap.js';
export { LAYOUTS, getLayout, listLayouts, PRODUCTS, getProduct, listProducts } from '../core/layout.js';
export { BackendSdkClient } from '../backend/client.js';
export { ShroomError, ERROR_CODES, asShroomError } from '../core/errors.js';
export { activateLicense, getLicenseStatus, clearLicense, SDK_PRODUCT_TYPE } from '../core/license.js';

import { connectSerial, isSerialSupported, connectProduct, connectGlove, connectHandPad } from './serial.js';
import { listDeviceProducts } from '../core/product.js';
import { createHeatmap } from './heatmap.js';
import { connectStream } from './stream.js';
import { createProductView } from './product-view.js';
import { encodeStreamFrame, decodeStreamFrame, STREAM_SCHEMA } from '../core/stream-codec.js';
import { createMockDevice } from '../core/mock.js';
import { ShroomError, ERROR_CODES, asShroomError } from '../core/errors.js';
import { activateLicense, getLicenseStatus, clearLicense } from '../core/license.js';
import { SDK_VERSION } from '../core/version.js';

/** 同一批具名导出的便捷命名空间；应用可按需导入单个函数。 */
export const Shroom = {
  activateLicense,
  getLicenseStatus,
  clearLicense,
  ShroomError,
  ERROR_CODES,
  asShroomError,
  /** 用户点击后选择产品端口，直接收取已解析数据 */
  connectProduct,
  connectGlove,
  connectHandPad,
  listDeviceProducts,
  /** 连接独立产品数据服务；录制保存在服务端。 */
  connectStream,
  /** 自动订阅并渲染手套分区或手部检测垫。 */
  createProductView,
  encodeStreamFrame,
  decodeStreamFrame,
  STREAM_SCHEMA,
  /** 连接真实设备，必须在用户点击等手势里调用 */
  connect: connectSerial,
  /** 模拟设备，接口和 connect() 完全一致，用来没硬件时调界面 */
  mock: createMockDevice,
  /** 在 canvas 上创建热力图 */
  createHeatmap,
  /** 当前浏览器是否支持串口 */
  isSupported: isSerialSupported,
  version: SDK_VERSION,
};

export default Shroom;
