/** 整包手套解码：拆出序号、压力和 IMU，再按明确手侧生成五指与手掌分区。 */
import { decodeFrame } from './frame.js';
import { ShroomError } from './errors.js';
import { createGloveRegions } from './glove-regions.js';

// 沿用 handGloveFullPacket 旧展示的点位表，仅用于兼容矩阵；不是五指/手掌的标准分区表。
const gloveFullPacketLayouts = {
  left: {
    fingerRows: [
      [65, 66, 67, 38, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79],
      [49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63],
      [33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47],
      [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
    ],
    fingerTips: [2, 5, 8, 11, 14],
    palm: [
      129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143,
      145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159,
      161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175,
      177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191,
      193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207,
      209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223,
    ],
    palmLeadingBlankCount: 3,
    palmTopRows: [
      [244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255],
      [228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239],
    ],
  },
  right: {
    fingerRows: [
      [190, 191, 192, 187, 188, 189, 184, 185, 186, 181, 182, 183, 178, 179, 180],
      [206, 207, 208, 203, 204, 205, 200, 201, 202, 197, 198, 199, 194, 195, 196],
      [222, 223, 224, 219, 220, 221, 216, 217, 218, 213, 214, 215, 210, 211, 212],
      [238, 239, 240, 235, 236, 237, 232, 233, 234, 229, 230, 231, 226, 227, 228],
    ],
    fingerTips: [255, 252, 249, 246, 243],
    palm: [
      114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128,
      98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112,
      82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96,
      66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80,
      50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
      34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
    ],
    palmTopRows: [
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
    ],
  },
};

/** 将 256 个扫描通道映射到旧版 13×15 展示轮廓；未填位置为 0，仅保留兼容用途。 */
function gloveMapPressure(pressure, side) {
  const layout = gloveFullPacketLayouts[side];
  const result = new Uint8Array(195);
  layout.fingerRows.forEach((row, rowIndex) => {
    row.forEach((point, col) => { result[rowIndex * 15 + col] = pressure[point - 1]; });
  });
  layout.fingerTips.forEach((point, finger) => { result[61 + finger * 3] = pressure[point - 1]; });
  layout.palmTopRows.forEach((row, rowIndex) => {
    const start = 75 + rowIndex * 15 + (layout.palmLeadingBlankCount || 0);
    row.forEach((point, col) => { result[start + col] = pressure[point - 1]; });
  });
  layout.palm.forEach((point, index) => { result[105 + index] = pressure[point - 1]; });
  return result;
}

/**
 * 解码一份 274 字节的手套整包载荷，不含串口尾分隔符。
 * 必须显式设置 side：当前接入不能可靠地通过 packetType 判断左右手。
 * IMU 仅保留 16 字节原始数据，不猜测轴序、四元数语义、角度或单位。
 * @param {Uint8Array} payload 1 字节序号 + 1 字节包类型 + 256 字节压力 + 16 字节 IMU。
 * @param {{side:'left'|'right',fullScale?:number,threshold?:number}} options 实物手侧、归一化满量程和有效点阈值。
 * @returns {object} 产品帧：pressure / raw 是同一份原始压力快照，fingers / palm 为独立分区。
 * pressureMatrix / values / rows / cols 保留旧展示兼容数据；新业务读取 fingers 与 palm。
 */
export function decodeGlovePacket(payload, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || !['left', 'right'].includes(options.side)) {
    throw new ShroomError('INVALID_CONFIG', '手套需要明确指定 side 为 left 或 right', {
      stage: 'configure', details: { field: 'side' },
      suggestion: '按实际连接的左手或右手设置 side；不能根据包类型或串口顺序猜测。',
    });
  }
  if (!(payload instanceof Uint8Array) || payload.length !== 274) {
    throw new ShroomError('PARSE_FAILED', '整包手套需要 274 字节载荷（不含串口分隔符）', {
      stage: 'parse', details: { expectedLength: 274, actualLength: payload?.length ?? null },
      suggestion: '确认设备为 handGloveFullPacket 整包协议；双包或旧版手套不能使用此解析器。',
    });
  }
  const pressure = Uint8Array.from(payload.subarray(2, 258));
  const pressureMatrix = gloveMapPressure(pressure, options.side);
  const frame = decodeFrame(pressureMatrix, {
    rows: 13, cols: 15, fullScale: options.fullScale, threshold: options.threshold,
  });
  // 五指/手掌直接从原始扫描压力取值，不经过旧展示的 195 格兼容矩阵，避免重复映射。
  const regions = createGloveRegions(pressure, { side: options.side, fullScale: options.fullScale });
  return {
    ...frame,
    raw: pressure,
    product: 'handGloveFullPacket',
    side: options.side,
    sequence: payload[0],
    packetType: payload[1],
    pressure,
    pressureMatrix,
    fingers: regions.fingers,
    palm: regions.palm,
    imu: { raw: Uint8Array.from(payload.subarray(258, 274)) },
  };
}
