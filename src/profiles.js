const STANDARD_FRAME_DELIMITER = Buffer.from([0xaa, 0x55, 0x03, 0x99]);
const SMALL_BED_12B_FRAME_TAIL = Buffer.from([0xaa, 0x00, 0x55, 0x00, 0x03, 0x00, 0x99, 0x00]);
const { GLOVE_DATA_SEMANTICS, GLOVE_PRODUCT_PROFILES } = require('./glove/catalog');

const HAND_GLOVE_TYPES = ['hand0205', 'hand0205Double', 'handGlove115200', 'handGloveFullPacket'];

function getDefaultBaudRate(sensorType = '') {
  if (sensorType === 'handGlove115200') {
    return 115200;
  }

  if (
    HAND_GLOVE_TYPES.includes(sensorType) ||
    ['footVideo', 'eye', 'daliegu', 'smallSample'].includes(sensorType) ||
    String(sensorType).includes('robot')
  ) {
    return 921600;
  }

  if (['bed4096', 'bed4096num'].includes(sensorType)) {
    return 3000000;
  }

  if (sensorType === 'smallBed12B') {
    return 1500000;
  }

  return 1000000;
}

const DEFAULT_SENSOR_PROFILES = {
  default: {
    sensorType: 'default',
    baudRate: 1000000,
    delimiter: STANDARD_FRAME_DELIMITER,
    valueType: 'uint8',
  },
  hand0205: {
    sensorType: 'hand0205',
    baudRate: getDefaultBaudRate('hand0205'),
    delimiter: STANDARD_FRAME_DELIMITER,
    parser: 'handGloveSplitPacket',
    valueType: 'uint8',
    pressureLength: 256,
    packetLengths: [130, 146],
    imuByteLength: 16,
    product: GLOVE_PRODUCT_PROFILES.hand0205,
    dataSemantics: GLOVE_DATA_SEMANTICS,
    channels: ['sit', 'back'],
  },
  hand0205Double: {
    sensorType: 'hand0205Double',
    baudRate: getDefaultBaudRate('hand0205Double'),
    delimiter: STANDARD_FRAME_DELIMITER,
    parser: 'handGloveDoublePacket',
    valueType: 'uint8',
    pressureLength: 256,
    packetLengths: [130, 146],
    imuByteLength: 16,
    product: GLOVE_PRODUCT_PROFILES.hand0205Double,
    dataSemantics: GLOVE_DATA_SEMANTICS,
    channels: ['sit', 'back'],
  },
  handGlove115200: {
    sensorType: 'handGlove115200',
    baudRate: getDefaultBaudRate('handGlove115200'),
    delimiter: STANDARD_FRAME_DELIMITER,
    parser: 'handGloveSplitPacket',
    valueType: 'uint8',
    pressureLength: 256,
    packetLengths: [130, 146],
    imuByteLength: 16,
    product: GLOVE_PRODUCT_PROFILES.handGlove115200,
    dataSemantics: GLOVE_DATA_SEMANTICS,
    channels: ['sit', 'back'],
  },
  handGloveFullPacket: {
    sensorType: 'handGloveFullPacket',
    baudRate: getDefaultBaudRate('handGloveFullPacket'),
    delimiter: STANDARD_FRAME_DELIMITER,
    parser: 'handGloveFullPacket',
    valueType: 'uint8',
    packetLength: 274,
    pressureLength: 256,
    imuByteLength: 16,
    product: GLOVE_PRODUCT_PROFILES.handGloveFullPacket,
    dataSemantics: GLOVE_DATA_SEMANTICS,
    channels: ['sit', 'back'],
  },
  hand: {
    sensorType: 'hand',
    baudRate: getDefaultBaudRate('hand'),
    delimiter: STANDARD_FRAME_DELIMITER,
    valueType: 'uint8',
    pressureLength: 1024,
    matrixWidth: 32,
    matrixHeight: 32,
    lineOrder: 'jqbed',
  },
  handSinglePoint: {
    sensorType: 'handSinglePoint',
    baudRate: getDefaultBaudRate('handSinglePoint'),
    delimiter: STANDARD_FRAME_DELIMITER,
    valueType: 'uint8',
    pressureLength: 1024,
    matrixWidth: 32,
    matrixHeight: 32,
    lineOrder: 'handSinglePoint',
  },
  fast1024: {
    sensorType: 'fast1024',
    baudRate: getDefaultBaudRate('fast1024'),
    delimiter: STANDARD_FRAME_DELIMITER,
    valueType: 'uint8',
    pressureLength: 1024,
    matrixWidth: 32,
    matrixHeight: 32,
  },
  smallBed12B: {
    sensorType: 'smallBed12B',
    baudRate: getDefaultBaudRate('smallBed12B'),
    delimiter: SMALL_BED_12B_FRAME_TAIL,
    valueType: 'uint16le',
    pressureLength: 1024,
    matrixWidth: 32,
    matrixHeight: 32,
    lineOrder: 'jqbed',
  },
  bed4096: {
    sensorType: 'bed4096',
    baudRate: getDefaultBaudRate('bed4096'),
    delimiter: STANDARD_FRAME_DELIMITER,
    valueType: 'uint8',
    pressureLength: 4096,
    matrixWidth: 64,
    matrixHeight: 64,
  },
  bed4096num: {
    sensorType: 'bed4096num',
    baudRate: getDefaultBaudRate('bed4096num'),
    delimiter: STANDARD_FRAME_DELIMITER,
    valueType: 'uint8',
    pressureLength: 4096,
    matrixWidth: 64,
    matrixHeight: 64,
  },
};

function cloneProfile(profile) {
  return {
    ...profile,
    delimiter: Buffer.from(profile.delimiter || STANDARD_FRAME_DELIMITER),
    channels: Array.isArray(profile.channels) ? [...profile.channels] : undefined,
    packetLengths: Array.isArray(profile.packetLengths) ? [...profile.packetLengths] : undefined,
    product: profile.product ? { ...profile.product } : undefined,
    dataSemantics: profile.dataSemantics ? {
      pressure: { ...profile.dataSemantics.pressure },
      imu: { ...profile.dataSemantics.imu },
    } : undefined,
  };
}

function resolveProfile(sensorType = 'default', override = {}) {
  const base = DEFAULT_SENSOR_PROFILES[sensorType] || DEFAULT_SENSOR_PROFILES.default;
  const merged = {
    ...cloneProfile(base),
    ...override,
    sensorType,
  };
  merged.delimiter = Buffer.from(override.delimiter || base.delimiter || STANDARD_FRAME_DELIMITER);
  merged.baudRate = Number(override.baudRate || base.baudRate || getDefaultBaudRate(sensorType));
  return merged;
}

module.exports = {
  DEFAULT_SENSOR_PROFILES,
  STANDARD_FRAME_DELIMITER,
  SMALL_BED_12B_FRAME_TAIL,
  getDefaultBaudRate,
  resolveProfile,
};
