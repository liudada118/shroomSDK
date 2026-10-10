const GLOVE_PROFILE_IDS = Object.freeze([
  'hand0205',
  'hand0205Double',
  'handGlove115200',
  'handGloveFullPacket',
]);

const GLOVE_PRODUCT_PROFILES = Object.freeze({
  hand0205: Object.freeze({
    productModel: 'hand0205',
    displayName: '触觉手套',
    profileId: 'hand0205',
    protocol: 'split-130-146',
    baudRate: 921600,
    handMode: 'one-hand-per-port',
    sideResolution: 'channel',
  }),
  hand0205Double: Object.freeze({
    productModel: 'hand0205Double',
    displayName: '触觉手套2',
    profileId: 'hand0205Double',
    protocol: 'split-130-146',
    baudRate: 921600,
    handMode: 'packet-routed-double-hand',
    sideResolution: 'packetType',
    packetSide: Object.freeze({ 1: 'left', 2: 'right' }),
  }),
  handGlove115200: Object.freeze({
    productModel: 'handGlove115200',
    displayName: '触觉手套（115200）',
    profileId: 'handGlove115200',
    protocol: 'split-130-146',
    baudRate: 115200,
    handMode: 'one-hand-per-port',
    sideResolution: 'channel',
  }),
  handGloveFullPacket: Object.freeze({
    productModel: 'handGloveFullPacket',
    displayName: '触觉手套（整包）',
    profileId: 'handGloveFullPacket',
    protocol: 'fixed-274',
    baudRate: 921600,
    handMode: 'one-hand-per-port',
    sideResolution: 'channel',
  }),
});

const GLOVE_DATA_SEMANTICS = Object.freeze({
  pressure: Object.freeze({
    field: 'pressureData',
    encoding: 'uint8',
    unit: 'adc_count',
    range: Object.freeze([0, 255]),
    meaning: '未标定的压力传感器 ADC 响应；数值越大表示原始响应越强，不等同于 N 或 kPa。',
  }),
  imu: Object.freeze({
    field: 'imu.quaternion',
    byteLength: 16,
    encoding: 'float32le',
    order: 'xyzw',
    meaning: '四元数姿态，按 x、y、z、w 顺序传给 Three.js Quaternion。',
  }),
});

function isGloveProfile(profileId) {
  return GLOVE_PROFILE_IDS.includes(profileId);
}

function getGloveProductProfile(profileId) {
  const profile = GLOVE_PRODUCT_PROFILES[profileId];
  if (!profile) throw new Error(`unknown glove profile: ${profileId}`);
  return profile;
}

module.exports = {
  GLOVE_DATA_SEMANTICS,
  GLOVE_PRODUCT_PROFILES,
  GLOVE_PROFILE_IDS,
  getGloveProductProfile,
  isGloveProfile,
};
