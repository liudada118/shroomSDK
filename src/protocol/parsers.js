const { calculatePressureStats, normalizeNumericArray } = require('../utils/stats');

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
  const data = Buffer.from(buffer || []);
  const packetType = data[1];
  const pressureData = applyLineOrder([...data.slice(2, 258)].map((value) => Number(value)), profile, context);
  const rotate = [...data.slice(258, 274)].map((value) => Number(value));
  const values = [...data].map((value) => Number(value));

  return buildParsedFrame({
    buffer,
    profile,
    channel: context.channel || 'sit',
    values,
    pressureData,
    rotate,
    extra: {
      packetType,
      packetLengthMatched: data.length === profile.packetLength,
    },
  });
}

function parseFrame(buffer, profile, context = {}) {
  if (typeof profile.parseFrame === 'function') {
    return profile.parseFrame(buffer, profile, context);
  }

  if (profile.parser === 'handGloveFullPacket') {
    return parseHandGloveFullPacket(buffer, profile, context);
  }

  return parseDefaultFrame(buffer, profile, context);
}

module.exports = {
  readValues,
  parseFrame,
  parseDefaultFrame,
  parseHandGloveFullPacket,
  applyLineOrder,
};
