const CONNECTION_ERROR_META = Object.freeze({
  CONN_BUSY: { stage: 'lock', message: '正在连接中，请稍后再试' },
  NO_PORT: { stage: 'scan', message: '未检测到串口设备，请检查 USB 连接' },
  NO_SENSOR_PORT: { stage: 'filter', message: '未检测到 WCH / CH34 类传感器串口' },
  BAUD_FAIL: { stage: 'detect_baud', message: '设备波特率识别失败' },
  PORT_BUSY: { stage: 'open_port', message: '串口被占用，请关闭其他串口程序后重试' },
  PORT_NOT_FOUND: { stage: 'open_port', message: '串口不存在或已被移除' },
  OPEN_FAIL: { stage: 'open_port', message: '串口打开失败' },
  CONNECT_TIMEOUT: { stage: 'timeout', message: '串口连接超时' },
  PORT_OFFLINE: { stage: 'write', message: '串口未连接，无法写入' },
  WRITE_FAIL: { stage: 'write', message: '串口写入失败' },
  STALE_CONNECTION: { stage: 'health', message: '串口已断流，请重新扫描连接' },
  CLEANUP_FAIL: { stage: 'cleanup', message: '串口资源释放失败' },
});

class SerialConnectionError extends Error {
  constructor(code, details = {}, cause) {
    const normalizedCode = Object.prototype.hasOwnProperty.call(CONNECTION_ERROR_META, code)
      ? code
      : 'OPEN_FAIL';
    const meta = CONNECTION_ERROR_META[normalizedCode];
    super(details.detail || details.message || meta.message, cause ? { cause } : undefined);
    this.name = 'SerialConnectionError';
    this.code = normalizedCode;
    this.stage = details.stage || meta.stage;
    this.userMessage = details.userMessage || meta.message;
    if (details.path) this.path = details.path;
    if (details.channel) this.channel = details.channel;
    if (details.baudRate) this.baudRate = details.baudRate;
    if (details.attempt) this.attempt = details.attempt;
  }
}

function isPortBusyError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('busy')
    || message.includes('access denied')
    || message.includes('permission')
    || message.includes('denied')
    || message.includes('already open')
    || message.includes('cannot lock')
    || message.includes('占用');
}

function isPortNotFoundError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('cannot find')
    || message.includes('not found')
    || message.includes('no such file')
    || message.includes('file not found')
    || message.includes('不存在');
}

function classifySerialError(error, fallbackCode = 'OPEN_FAIL') {
  if (error?.code && CONNECTION_ERROR_META[error.code]) return error.code;
  if (isPortBusyError(error)) return 'PORT_BUSY';
  if (isPortNotFoundError(error)) return 'PORT_NOT_FOUND';
  return fallbackCode;
}

function createSerialError(code, details = {}, cause) {
  return new SerialConnectionError(code, details, cause);
}

function normalizeSerialError(error, fallbackCode = 'OPEN_FAIL', details = {}) {
  if (error instanceof SerialConnectionError) return error;
  const code = classifySerialError(error, fallbackCode);
  return createSerialError(code, {
    ...details,
    detail: error?.message || details.detail,
  }, error);
}

function serializeSerialError(error, fallbackCode = 'OPEN_FAIL') {
  const normalized = normalizeSerialError(error, fallbackCode);
  return {
    success: false,
    code: normalized.code,
    stage: normalized.stage,
    message: normalized.userMessage,
    detail: normalized.message,
    path: normalized.path,
    channel: normalized.channel,
    baudRate: normalized.baudRate,
  };
}

module.exports = {
  CONNECTION_ERROR_META,
  SerialConnectionError,
  classifySerialError,
  createSerialError,
  isPortBusyError,
  isPortNotFoundError,
  normalizeSerialError,
  serializeSerialError,
};
