const { mapHand147To1024 } = require('./mapping');

function range(start, count) {
  return Array.from({ length: count }, (_, index) => start + index);
}

const FULL_PACKET_HAND_LAYOUTS = Object.freeze({
  left: Object.freeze({
    fingerRows: [
      [65, 66, 67, 38, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79],
      range(49, 15),
      range(33, 15),
      range(17, 15),
    ],
    fingerTips: [2, 5, 8, 11, 14],
    palmTopRows: [range(244, 12), range(228, 12)],
    palm: [129, 145, 161, 177, 193, 209].flatMap((start) => range(start, 15)),
    palmLeadingBlankCount: 3,
  }),
  right: Object.freeze({
    fingerRows: [
      [190, 191, 192, 187, 188, 189, 184, 185, 186, 181, 182, 183, 178, 179, 180],
      [206, 207, 208, 203, 204, 205, 200, 201, 202, 197, 198, 199, 194, 195, 196],
      [222, 223, 224, 219, 220, 221, 216, 217, 218, 213, 214, 215, 210, 211, 212],
      [238, 239, 240, 235, 236, 237, 232, 233, 234, 229, 230, 231, 226, 227, 228],
    ],
    fingerTips: [255, 252, 249, 246, 243],
    palmTopRows: [range(2, 12), range(18, 12)],
    palm: [114, 98, 82, 66, 50, 34].flatMap((start) => range(start, 15)),
    palmLeadingBlankCount: 0,
  }),
});

function readOneBased(values, index) {
  const value = Number(values[index - 1]);
  return Number.isFinite(value) ? value : 0;
}

function mapFullPacketPressure(values, side = 'left') {
  const source = Array.from(values || []);
  const layout = FULL_PACKET_HAND_LAYOUTS[side] || FULL_PACKET_HAND_LAYOUTS.left;
  const result = new Array(195).fill(0);

  layout.fingerRows.forEach((row, rowIndex) => {
    row.forEach((point, column) => {
      result[rowIndex * 15 + column] = readOneBased(source, point);
    });
  });
  layout.fingerTips.forEach((point, finger) => {
    result[61 + finger * 3] = readOneBased(source, point);
  });
  layout.palmTopRows.forEach((row, rowIndex) => {
    const start = 75 + rowIndex * 15 + layout.palmLeadingBlankCount;
    row.forEach((point, column) => {
      result[start + column] = readOneBased(source, point);
    });
  });
  layout.palm.forEach((point, index) => {
    result[105 + index] = readOneBased(source, point);
  });

  return result;
}

function mapFullPacketTo1024(values, side = 'left') {
  return mapHand147To1024(mapFullPacketPressure(values, side));
}

module.exports = {
  FULL_PACKET_HAND_LAYOUTS,
  mapFullPacketPressure,
  mapFullPacketTo1024,
};
