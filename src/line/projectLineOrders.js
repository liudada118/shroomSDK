const { LineOrderRegistry } = require('./LineOrderRegistry');
const { BUILTIN_LINE_ORDERS } = require('./builtinLineOrders');

/**
 * 从主项目导出面搬运线序时要跳过的名字。
 *
 * 上游版本（`shroom1/sdk/src/line/projectLineOrders.js`）是把 `openWeb.js` 的
 * 整个导出面遍历进注册表的，里面混着一些不是线序的工具函数（时间格式化、
 * 打开网页），所以有这份拒绝清单。本包改为显式注册 `BUILTIN_LINE_ORDERS`，
 * 已经不需要它了 —— 保留是因为它记录了「哪些名字不是线序」这个事实，
 * 将来若再从主项目批量搬运仍然用得上。
 */
const LINE_ORDER_EXPORT_DENY_LIST = new Set([
  'convertTempFullBedTemperature',
  'openWeb',
  'normalizeTempFullBedPressure',
  'rotate90',
  'timeStampToDate',
  'timeStampToDateNum',
  'timeStampTo_Date',
]);

/**
 * 建一个带内置线序的注册表。
 *
 * 内置的那几个先注册，`extraLineOrders` 后注册 —— **同名时使用方的实现覆盖
 * 内置的**。这个方向是有意的：设备批次差异导致走线不同时，使用方要能就地
 * 替换而不必改 SDK。
 *
 * @param {Object<string, Function>} [extraLineOrders] 额外线序，`{ 名字: 处理函数 }`。
 * @returns {LineOrderRegistry} 注册表。
 */
function createProjectLineOrderRegistry(extraLineOrders = {}) {
  const registry = new LineOrderRegistry();

  Object.entries(BUILTIN_LINE_ORDERS).forEach(([name, handler]) => {
    registry.register(name, handler);
  });

  Object.entries(extraLineOrders).forEach(([name, handler]) => {
    registry.register(name, handler);
  });

  return registry;
}

const PROJECT_LINE_ORDER_NAMES = createProjectLineOrderRegistry().list();

module.exports = {
  LINE_ORDER_EXPORT_DENY_LIST,
  PROJECT_LINE_ORDER_NAMES,
  createProjectLineOrderRegistry,
};
