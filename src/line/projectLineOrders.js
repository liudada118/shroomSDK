const { LineOrderRegistry } = require('./LineOrderRegistry');

const LINE_ORDER_EXPORT_DENY_LIST = new Set([
  'convertTempFullBedTemperature',
  'openWeb',
  'normalizeTempFullBedPressure',
  'rotate90',
  'timeStampToDate',
  'timeStampToDateNum',
  'timeStampTo_Date',
]);

function createProjectLineOrderRegistry(extraLineOrders = {}) {
  const registry = new LineOrderRegistry();

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
