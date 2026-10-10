const { calculatePressureStats, normalizeNumericArray } = require('../utils/stats');
const { buildQuaternion } = require('../glove/imu');
const { mapGlovePressure } = require('../glove/frame');
const { createGlovePacketAssembler, parseFullGlovePacket } = require('../glove/protocol');

function readValues(buffer, valueType = 'uint8') {
  const data = Buffer.from(buffer || []);

  if (valueType === 'uint16le') {
    const values = [];
    for (let offset = 0; offset + 1 < data.length; offset += 2) {
      values.push(data.readUInt16LE(offset));
    }
    return values;
  }

  if (valueType === 'int16le') {
    const values = [];
    for (let offset = 0; offset + 1 < data.length; offset += 2) {
      values.push(data.readInt16LE(offset));
    }
    return values;
  }

  return [...data].map((value) => Number(value));
}

function inferMatrix(profile, length) {
  if (profile.matrixWidth && profile.matrixHeight) {
    return {
      width: profile.matrixWidth,
      height: profile.matrixHeight,
    };
  }

  const square = Math.sqrt(length);
  if (Number.isInteger(square)) {
    return {
      width: square,
      height: square,
    };
  }

  return {
    width: null,
    height: null,
  };
}

function buildParsedFrame({ buffer, profile, channel, values, pressureData, rotate, extra = {} }) {
  const data = normalizeNumericArray(pressureData);
  const timestamp = Date.now();
  return {
    sensorType: profile.sensorType,
    channel,
    timestamp,
    rawLength: Buffer.byteLength(buffer),
    data,
    pressureData: data,
    rotate: normalizeNumericArray(rotate),
    matrix: inferMatrix(profile, data.length),
    stats: calculatePressureStats(data, { threshold: profile.pressureThreshold }),
    extra,
    rawValues: values,
  };
}

function applyLineOrder(pressureData, profile, context = {}) {
  const lineOrder = context.lineOrder || profile.lineOrder;
  if (!lineOrder) {
    return pressureData;
  }

  if (typeof lineOrder === 'function') {
    return lineOrder([...pressureData], {
      profile,
      channel: context.channel || 'sit',
      ...(profile.lineOrderOptions || {}),
      ...(context.lineOrderOptions || {}),
    });
  }

  if (!context.lineOrders?.has?.(lineOrder)) {
    throw new Error(`line order "${lineOrder}" is not registered`);
  }

  return context.lineOrders.apply(lineOrder, pressureData, {
    profile,
    channel: context.channel || 'sit',
    ...(profile.lineOrderOptions || {}),
    ...(context.lineOrderOptions || {}),
  });
}

function parseDefaultFrame(buffer, profile, context = {}) {
  const values = readValues(buffer, profile.valueType);
  const pressureLength = Number(profile.pressureLength) > 0 ? Number(profile.pressureLength) : values.length;
  const pressureData = applyLineOrder(values.slice(0, pressureLength), profile, context);
  const rotateOffset = Number(profile.rotateOffset);
  const rotateLength = Number(profile.rotateLength);
  const rotate = Number.isFinite(rotateOffset) && rotateLength > 0
    ? values.slice(rotateOffset, rotateOffset + rotateLength)
    : [];

  return buildParsedFrame({
    buffer,
    profile,
    channel: context.channel || 'sit',
    values,
    pressureData,
    rotate,
  });
}

function parseHandGloveFullPacket(buffer, profile, context = {}) {
  const packet = parseFullGlovePacket(buffer, profile, context);
  return buildGloveParsedFrame(buffer, profile, context, packet);
}

function buildGloveParsedFrame(buffer, profile, context, packet) {
  const pressureData = applyLineOrder(packet.pressureData, profile, context);
  const imu = buildQuaternion(packet.imuBytes);
  const { mappedData, matrixData } = mapGlovePressure(
    pressureData,
    packet.handSide,
    profile.product,
  );
  const values = [...Buffer.from(buffer || [])];
  const frame = buildParsedFrame({
    buffer,
    profile,
    channel: context.channel || 'sit',
    values,
    pressureData,
    rotate: imu.values,
    extra: {
      order: packet.order,
      frameIndex: packet.frameIndex,
      packetType: packet.packetType,
      packetLengthMatched: packet.validation.ok,
      handSideSource: packet.handSideSource,
      validationWarnings: packet.validation.warnings,
    },
  });

  return {
    ...frame,
    handSide: packet.handSide,
    pressure: {
      ...profile.dataSemantics?.pressure,
      values: frame.pressureData,
    },
    imu: {
      ...profile.dataSemantics?.imu,
      values: imu.values,
      quaternion: imu,
      rawBytes: [...packet.imuBytes],
    },
    mappedData,
    matrixData,
    mapping: {
      source: 'pressureData',
      sourceLength: 256,
      mappedLength: mappedData.length,
      matrixWidth: 32,
      matrixHeight: 32,
      orientation: 'row-major',
    },
    product: { ...profile.product },
    validation: packet.validation,
  };
}

function parseHandGloveSplitPacket(buffer, profile, context = {}) {
  const assembler = context.gloveAssembler || createGlovePacketAssembler(profile);
  const packet = assembler.push(buffer, context);
  if (!packet.complete) return null;
  return buildGloveParsedFrame(buffer, profile, context, packet);
}

function parseFrame(buffer, profile, context = {}) {
  if (typeof profile.parseFrame === 'function') {
    return profile.parseFrame(buffer, profile, context);
  }

  if (profile.parser === 'handGloveFullPacket') {
    return parseHandGloveFullPacket(buffer, profile, context);
  }

  if (profile.parser === 'handGloveSplitPacket' || profile.parser === 'handGloveDoublePacket') {
    return parseHandGloveSplitPacket(buffer, profile, context);
  }

  return parseDefaultFrame(buffer, profile, context);
}

module.exports = {
  readValues,
  parseFrame,
  parseDefaultFrame,
  parseHandGloveFullPacket,
  parseHandGloveSplitPacket,
  buildGloveParsedFrame,
  applyLineOrder,
};
