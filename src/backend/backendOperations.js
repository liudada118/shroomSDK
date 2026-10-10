const BACKEND_OPERATIONS = [
  {
    domain: 'license',
    commands: ['date'],
    sdk: ['license.parseKey', 'license.getDefaultFile', 'license.getSelectFlag'],
    description: '授权密钥解密、到期时间判断、可用系统类型下发。',
  },
  {
    domain: 'system',
    commands: ['file', 'baudRate'],
    sdk: ['registry.getProfile', 'registry.registerProfile'],
    description: '系统类型切换、波特率选择、协议 profile 选择。',
  },
  {
    domain: 'serial',
    commands: ['serialReset', 'sitPort', 'backPort', 'headPort', 'sitClose', 'backClose', 'headClose'],
    sdk: ['listPorts', 'open', 'session.close'],
    description: '串口枚举、串口打开、关闭、通道绑定和连接生命周期管理。',
  },
  {
    domain: 'realtime',
    commands: [],
    sdk: ['session.on("rawFrame")', 'session.on("frame")', 'registry.parse'],
    description: '原始帧读取、协议解析、标准 frame 输出。',
  },
  {
    domain: 'zero',
    commands: ['resetZero'],
    sdk: ['zeroCalibrator.captureBaseline', 'zeroCalibrator.clearBaseline', 'zeroCalibrator.apply'],
    description: '清零帧记录、清零后压力矩阵计算。',
  },
  {
    domain: 'capture',
    commands: ['flag', 'colName', 'time', 'colHZ'],
    sdk: ['startCapture', 'stopCapture', 'CaptureStore.insertFrame'],
    description: '采集开始/停止、采集名称、采样频率、SQLite 入库。',
  },
  {
    domain: 'replay',
    commands: ['getTime', 'local', 'play', 'value', 'speed', 'history'],
    sdk: ['ReplayService.listCaptures', 'ReplayService.buildTimeline'],
    description: '历史数据查询、回放时间轴、回放帧输出。',
  },
  {
    domain: 'export',
    commands: ['download', 'downloadOptions'],
    sdk: ['exportCsv', 'CsvExporter.exportCapture'],
    description: 'CSV 导出目录校验、表头生成、按采集记录导出。',
  },
  {
    domain: 'algorithm',
    commands: [],
    sdk: ['registerAlgorithm', 'processAlgorithms', 'AlgorithmChannel.process'],
    description: '同步轻量算法注册、实时帧处理、历史帧复算和算法结果持久化。',
  },
  {
    domain: 'report',
    commands: ['getDbHeatmap', 'uploadCanvas'],
    sdk: ['ReportService.getDbHeatmap', 'ReportService.generateFootPressureReport', 'PathService'],
    description: '足压报告、热力图、图片上传和 PDF 生成，通过注入 pythonClient 适配运行时算法。',
  },
];

function listBackendOperations() {
  return BACKEND_OPERATIONS.map((operation) => ({ ...operation }));
}

module.exports = {
  BACKEND_OPERATIONS,
  listBackendOperations,
};
