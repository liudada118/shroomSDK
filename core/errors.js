/** 串口、产品数据流和录制适配器共用的稳定错误码；业务逻辑应按 code 判断而非匹配文案。 */
export const ERROR_CODES = Object.freeze(Object.fromEntries([
  'INVALID_CONFIG', 'DEPENDENCY_MISSING', 'PORT_NOT_FOUND', 'PORT_AMBIGUOUS',
  'PERMISSION_DENIED', 'PORT_BUSY', 'CONNECTION_FAILED', 'UNSUPPORTED_ENVIRONMENT',
  'USER_CANCELLED', 'DISCONNECTED', 'READ_FAILED', 'WRITE_FAILED', 'CLOSE_FAILED',
  'PARSE_FAILED', 'CALLBACK_FAILED',
  'SERVER_CLOSED', 'SERVER_ERROR', 'SERVER_START_FAILED', 'INVALID_REQUEST', 'ORIGIN_DENIED',
  'REQUEST_FAILED', 'REQUEST_TIMEOUT', 'RECORDING_ACTIVE', 'RECORDING_NOT_ACTIVE',
  'RECORDING_NOT_FOUND', 'RECORDING_INTERRUPTED', 'RECORDING_OVERFLOW', 'RECORDING_WRITE_FAILED',
  'LICENSE_REQUIRED', 'LICENSE_INVALID', 'LICENSE_EXPIRED', 'LICENSE_UNAVAILABLE',
  'LICENSE_REJECTED', 'LICENSE_PRODUCT_MISMATCH', 'LICENSE_SCOPE_DENIED', 'LICENSE_FEATURE_DENIED', 'LICENSE_DEVICE_REQUIRED',
].map((code) => [code, code])));

const serialErrorHints = {
  INVALID_CONFIG: '检查参数名称、类型与范围；设备连接前即可修正配置。',
  DEPENDENCY_MISSING: 'Node.js 串口请在 SDK 目录安装 serialport。',
  PORT_NOT_FOUND: '检查设备、USB 线与驱动，重新查询并明确指定串口。',
  PORT_AMBIGUOUS: '存在多个串口，请明确指定目标端口，不能据此自动识别传感器。',
  PERMISSION_DENIED: '检查系统串口权限、浏览器授权，以及端口是否被其他程序占用。',
  PORT_BUSY: '关闭占用此串口的上位机、终端或其他页面后重试。',
  CONNECTION_FAILED: '核对端口、驱动、权限和波特率，并查看原始错误。',
  UNSUPPORTED_ENVIRONMENT: '使用支持 Web Serial 的浏览器，并通过 HTTPS 或 localhost 打开页面。',
  USER_CANCELLED: '用户取消了端口选择；需要连接时再次由用户点击选择。',
  DISCONNECTED: '检查 USB 与设备供电；确认设备恢复后由应用显式重新连接。',
  READ_FAILED: '检查设备连接和供电；确认原因后关闭连接并重新打开。',
  WRITE_FAILED: '检查连接状态及发送字节是否符合设备协议，不自动重发指令。',
  CLOSE_FAILED: '检查原始关闭错误；连接已停止交付数据，确认端口是否释放。',
  PARSE_FAILED: '核对分隔符、帧长、矩阵尺寸、点位排列与设备协议。',
  CALLBACK_FAILED: '检查应用的数据回调；一个回调失败不会中断其他订阅。',
};

/** 统一错误对象：保留原始 cause 便于本地调试，同时提供阶段、建议与可控的诊断字段。 */
export class ShroomError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ShroomError';
    this.code = code;
    this.stage = options.stage ?? 'connect';
    this.suggestion = options.suggestion ?? serialErrorHints[code] ?? '检查原始错误与当前配置。';
    this.details = { ...(options.details ?? {}) };
  }

  /** 导出可序列化诊断快照；不包含可能携带底层资源或敏感上下文的原始 cause。 */
  toJSON() {
    return {
      name: this.name, code: this.code, stage: this.stage, message: this.message,
      suggestion: this.suggestion, details: { ...this.details },
    };
  }
}

/**
 * 将操作系统、浏览器或未知异常转换成 ShroomError；已有统一错误原样保留。
 * options 可明确失败阶段和默认错误码，原始异常仅挂在 cause 上。
 */
export function asShroomError(error, options = {}) {
  if (error instanceof ShroomError) return error;
  let code = options.code ?? 'CONNECTION_FAILED';
  const stage = options.stage ?? 'connect';
  const nativeCode = error?.code;
  const nativeName = error?.name;
  const nativeMessage = error instanceof Error || typeof error?.message === 'string'
    ? error.message : String(error ?? '未知错误');
  // 仅对底层 I/O 操作识别权限、占用和断开原因；应用回调的报错不能误归类为设备故障。
  if (['query', 'connect', 'read', 'write', 'close'].includes(stage)) {
    if (nativeCode === 'ERR_MODULE_NOT_FOUND' || nativeCode === 'MODULE_NOT_FOUND') code = 'DEPENDENCY_MISSING';
    else if (['EACCES', 'EPERM'].includes(nativeCode) || ['NotAllowedError', 'SecurityError'].includes(nativeName)
      || /permission denied|access (?:is )?denied/i.test(nativeMessage)) code = 'PERMISSION_DENIED';
    else if (['EBUSY', 'EADDRINUSE'].includes(nativeCode) || /resource busy|port.*(?:busy|in use)|cannot lock/i.test(nativeMessage)) code = 'PORT_BUSY';
    else if (nativeCode === 'ENOENT' || /no such file|port.*not found/i.test(nativeMessage)) code = 'PORT_NOT_FOUND';
    else if (['query', 'connect'].includes(stage) && ['NotFoundError', 'AbortError'].includes(nativeName)) code = 'USER_CANCELLED';
    else if (['read', 'write'].includes(stage) && (['ENODEV', 'ENXIO'].includes(nativeCode)
      || nativeName === 'NetworkError' || /disconnect|device.*removed/i.test(nativeMessage))) code = 'DISCONNECTED';
  }
  return new ShroomError(code, options.message ?? nativeMessage, { ...options, stage, cause: error });
}
