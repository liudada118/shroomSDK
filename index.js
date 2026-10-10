const { GloveConnectionError, ShroomSensorSDK } = require('./src/ShroomSensorSDK');
const { ProtocolRegistry } = require('./src/protocol/ProtocolRegistry');
const { CaptureStore } = require('./src/storage/CaptureStore');
const { MemoryCaptureStore } = require('./src/storage/MemoryCaptureStore');
const { CsvExporter } = require('./src/export/CsvExporter');
const {
  CaptureController,
  normalizeCaptureFrequency,
  normalizeCaptureOptions,
  resolveCaptureData,
} = require('./src/capture/CaptureController');
const { ZeroCalibrator } = require('./src/processing/ZeroCalibrator');
const { ReplayPlayer, ReplayService, normalizeSpeed } = require('./src/replay/ReplayService');
const { BackendCommandRouter } = require('./src/backend/BackendCommandRouter');
const { BackendSdkClient } = require('./src/backend/BackendSdkClient');
const { LicenseService } = require('./src/license/LicenseService');
const { PathService } = require('./src/config/PathService');
const { ReportService } = require('./src/report/ReportService');
const {
  AlgorithmChannel,
  createPressureStatsAlgorithm,
  selectFrameData,
} = require('./src/algorithm/AlgorithmChannel');
const { SensorSession } = require('./src/serial/SensorSession');
const { SerialManager } = require('./src/serial/SerialManager');
const {
  CONNECTION_ERROR_META,
  SerialConnectionError,
  classifySerialError,
  createSerialError,
  isPortBusyError,
  isPortNotFoundError,
  normalizeSerialError,
  serializeSerialError,
} = require('./src/serial/errors');
const {
  DEFAULT_BAUD_CANDIDATES,
  DEFAULT_BAUD_DEVICE_MAP,
  VALID_FRAME_LENGTHS,
  detectBaudRate,
  filterSerialPorts,
  listDevicePorts,
  listSerialPorts,
  tryBaudRate,
  writeSerialPort,
} = require('./src/serial/serialTools');
const { LineOrderRegistry } = require('./src/line/LineOrderRegistry');
const { createProjectLineOrderRegistry, PROJECT_LINE_ORDER_NAMES } = require('./src/line/projectLineOrders');
const { listBackendOperations, BACKEND_OPERATIONS } = require('./src/backend/backendOperations');
const {
  DEFAULT_SENSOR_PROFILES,
  STANDARD_FRAME_DELIMITER,
  SMALL_BED_12B_FRAME_TAIL,
  getDefaultBaudRate,
} = require('./src/profiles');
const {
  GLOVE_DATA_SEMANTICS,
  GLOVE_PRODUCT_PROFILES,
  GLOVE_PROFILE_IDS,
  getGloveProductProfile,
  isGloveProfile,
} = require('./src/glove/catalog');
const { buildQuaternion, decodeFloat32LE } = require('./src/glove/imu');
const { mapGlovePressure, remapGloveFrame } = require('./src/glove/frame');
const {
  GLOVE_HAND_MAPPING,
  HAND_LEFT_ADC_ORDER,
  HAND_MODEL_POINTS,
  HAND_RIGHT_ADC_ORDER,
  flattenGloveHandMapping,
  handLeft256To147,
  handLeft256To1024,
  handRight256To147,
  handRight256To1024,
  mapHand147To1024,
  mapHand256To147,
  validateGloveHandMapping,
} = require('./src/glove/mapping');
const {
  FULL_PACKET_HAND_LAYOUTS,
  mapFullPacketPressure,
  mapFullPacketTo1024,
} = require('./src/glove/fullPacketMapping');
const {
  GloveFrameError,
  createGlovePacketAssembler,
  parseFullGlovePacket,
  validateGlovePacket,
} = require('./src/glove/protocol');

async function connectGlove(options = {}) {
  const sdk = options.sdk || new ShroomSensorSDK(options.sdkOptions || {});
  const session = await sdk.connectGlove(options);
  session.sdk = sdk;
  return session;
}

async function connectSerial(options = {}) {
  const sdk = options.sdk || new ShroomSensorSDK(options.sdkOptions || {});
  const result = await sdk.connectSerial(options);
  result.sdk = sdk;
  return result;
}

module.exports = {
  ShroomSensorSDK,
  connectGlove,
  connectSerial,
  GloveConnectionError,
  GloveFrameError,
  ProtocolRegistry,
  CaptureStore,
  MemoryCaptureStore,
  CsvExporter,
  CaptureController,
  normalizeCaptureFrequency,
  normalizeCaptureOptions,
  resolveCaptureData,
  ZeroCalibrator,
  ReplayService,
  ReplayPlayer,
  normalizeSpeed,
  BackendCommandRouter,
  BackendSdkClient,
  LicenseService,
  PathService,
  ReportService,
  AlgorithmChannel,
  createPressureStatsAlgorithm,
  selectFrameData,
  SensorSession,
  SerialManager,
  CONNECTION_ERROR_META,
  SerialConnectionError,
  classifySerialError,
  createSerialError,
  isPortBusyError,
  isPortNotFoundError,
  normalizeSerialError,
  serializeSerialError,
  DEFAULT_BAUD_CANDIDATES,
  DEFAULT_BAUD_DEVICE_MAP,
  VALID_FRAME_LENGTHS,
  detectBaudRate,
  filterSerialPorts,
  listDevicePorts,
  listSerialPorts,
  tryBaudRate,
  writeSerialPort,
  LineOrderRegistry,
  createProjectLineOrderRegistry,
  PROJECT_LINE_ORDER_NAMES,
  BACKEND_OPERATIONS,
  listBackendOperations,
  DEFAULT_SENSOR_PROFILES,
  STANDARD_FRAME_DELIMITER,
  SMALL_BED_12B_FRAME_TAIL,
  getDefaultBaudRate,
  GLOVE_DATA_SEMANTICS,
  GLOVE_PRODUCT_PROFILES,
  GLOVE_PROFILE_IDS,
  getGloveProductProfile,
  isGloveProfile,
  buildQuaternion,
  decodeFloat32LE,
  mapGlovePressure,
  remapGloveFrame,
  GLOVE_HAND_MAPPING,
  HAND_LEFT_ADC_ORDER,
  HAND_MODEL_POINTS,
  HAND_RIGHT_ADC_ORDER,
  flattenGloveHandMapping,
  handLeft256To147,
  handLeft256To1024,
  handRight256To147,
  handRight256To1024,
  mapHand147To1024,
  mapHand256To147,
  validateGloveHandMapping,
  FULL_PACKET_HAND_LAYOUTS,
  mapFullPacketPressure,
  mapFullPacketTo1024,
  createGlovePacketAssembler,
  parseFullGlovePacket,
  validateGlovePacket,
};
