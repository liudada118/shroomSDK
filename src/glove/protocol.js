const { getGloveProductProfile } = require('./catalog');

const SPLIT_FIRST_PACKET_LENGTH = 130;
const SPLIT_SECOND_PACKET_LENGTH = 146;
const FULL_PACKET_LENGTH = 274;
const DOUBLE_PACKET_SIDE = Object.freeze({ 1: 'left', 2: 'right' });

class GloveFrameError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GloveFrameError';
    this.code = code;
    this.details = details;
  }
}

function getChannelSide(channel, fallbackSide = 'left') {
  if (channel === 'right' || channel === 'back') return 'right';
  if (channel === 'left' || channel === 'sit') return 'left';
  return fallbackSide === 'right' ? 'right' : 'left';
}

function getGloveProfileMetadata(profileOrId) {
  if (typeof profileOrId === 'string') return getGloveProductProfile(profileOrId);
  if (profileOrId?.profileId && profileOrId?.protocol) return profileOrId;
  if (profileOrId?.product) return profileOrId.product;
  return getGloveProductProfile(profileOrId?.sensorType);
}

function validateGlovePacket(buffer, profileOrId) {
  const data = Buffer.from(buffer || []);
  const product = getGloveProfileMetadata(profileOrId);
  const errors = [];
  const warnings = [];
  let packetKind = null;

  if (product.protocol === 'fixed-274') {
    packetKind = 'full';
    if (data.length !== FULL_PACKET_LENGTH) {
      errors.push(`整包长度应为 ${FULL_PACKET_LENGTH}，实际为 ${data.length}`);
    }
  } else if (data.length === SPLIT_FIRST_PACKET_LENGTH) {
    packetKind = 'first';
  } else if (data.length === SPLIT_SECOND_PACKET_LENGTH) {
    packetKind = 'second';
  } else {
    errors.push(
      `分包长度应为 ${SPLIT_FIRST_PACKET_LENGTH} 或 ${SPLIT_SECOND_PACKET_LENGTH}，实际为 ${data.length}`,
    );
  }

  const packetType = data.length > 1 ? data[1] : null;
  if (product.sideResolution === 'packetType' && !DOUBLE_PACKET_SIDE[packetType]) {
    warnings.push(`未知 packetType=${packetType}，将使用串口通道作为左右手兜底`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    packetKind,
    packetType,
    rawLength: data.length,
    productModel: product.productModel,
    profileId: product.profileId,
  };
}

function resolvePacketSide(product, packetType, channel, fallbackSide) {
  const channelSide = getChannelSide(channel, fallbackSide);
  if (product.sideResolution === 'packetType') {
    return {
      side: DOUBLE_PACKET_SIDE[packetType] || channelSide,
      source: DOUBLE_PACKET_SIDE[packetType] ? 'packetType' : 'channelFallback',
    };
  }
  return { side: channelSide, source: 'channel' };
}

function createGlovePacketAssembler(profileOrId) {
  const product = getGloveProfileMetadata(profileOrId);
  if (product.protocol !== 'split-130-146') {
    throw new GloveFrameError(
      'UNSUPPORTED_ASSEMBLY',
      `profile ${product.profileId} 不是 130+146 分包协议`,
    );
  }

  const firstChunks = { left: null, right: null };

  function reset(side) {
    if (side === 'left' || side === 'right') {
      firstChunks[side] = null;
      return;
    }
    firstChunks.left = null;
    firstChunks.right = null;
  }

  function push(buffer, context = {}) {
    const data = Buffer.from(buffer || []);
    const validation = validateGlovePacket(data, product);
    if (!validation.ok) {
      throw new GloveFrameError('INVALID_PACKET_LENGTH', validation.errors.join('；'), validation);
    }

    const packetType = data[1];
    const sideResult = resolvePacketSide(
      product,
      packetType,
      context.channel,
      context.fallbackSide,
    );

    if (validation.packetKind === 'first') {
      firstChunks[sideResult.side] = [...data.slice(2)];
      return {
        complete: false,
        order: data[0],
        packetType,
        handSide: sideResult.side,
        handSideSource: sideResult.source,
        validation,
      };
    }

    const firstChunk = firstChunks[sideResult.side];
    if (!firstChunk) {
      throw new GloveFrameError(
        'MISSING_FIRST_PACKET',
        `${sideResult.side} 手收到 146 字节尾包，但此前没有对应的 130 字节首包`,
        validation,
      );
    }

    const payload = [...data.slice(2)];
    const imuBytes = payload.slice(-16);
    const pressureData = [...firstChunk, ...payload.slice(0, -16)];
    firstChunks[sideResult.side] = null;
    if (pressureData.length !== 256) {
      throw new GloveFrameError(
        'INVALID_PRESSURE_LENGTH',
        `压力点应为 256，实际为 ${pressureData.length}`,
        validation,
      );
    }

    return {
      complete: true,
      order: data[0],
      packetType,
      handSide: sideResult.side,
      handSideSource: sideResult.source,
      pressureData,
      imuBytes,
      validation,
    };
  }

  return { push, reset };
}

function parseFullGlovePacket(buffer, profileOrId, context = {}) {
  const data = Buffer.from(buffer || []);
  const product = getGloveProfileMetadata(profileOrId);
  const validation = validateGlovePacket(data, product);
  if (!validation.ok) {
    throw new GloveFrameError('INVALID_PACKET_LENGTH', validation.errors.join('；'), validation);
  }

  const sideResult = resolvePacketSide(product, data[1], context.channel, context.fallbackSide);
  return {
    complete: true,
    frameIndex: data[0],
    packetType: data[1],
    handSide: sideResult.side,
    handSideSource: sideResult.source,
    pressureData: [...data.slice(2, 258)],
    imuBytes: [...data.slice(258, 274)],
    validation,
  };
}

module.exports = {
  DOUBLE_PACKET_SIDE,
  FULL_PACKET_LENGTH,
  GloveFrameError,
  SPLIT_FIRST_PACKET_LENGTH,
  SPLIT_SECOND_PACKET_LENGTH,
  createGlovePacketAssembler,
  getChannelSide,
  parseFullGlovePacket,
  validateGlovePacket,
};
