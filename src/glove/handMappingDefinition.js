function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const GLOVE_HAND_MAPPING = deepFreeze({
  matrixType: '16x16',
  sensorCount: 256,
  btPacketSize: 128,
  indexBase: 1,
  leftHand: [
    {
      name: '小拇指',
      rows: 4,
      cols: 3,
      indices: [[31, 30, 29], [15, 14, 13], [255, 254, 253], [239, 238, 237]],
      pulpIndices: [[222]],
    },
    {
      name: '无名指',
      rows: 4,
      cols: 3,
      indices: [[28, 27, 26], [12, 11, 10], [252, 251, 250], [236, 235, 234]],
      pulpIndices: [[219]],
    },
    {
      name: '中指',
      rows: 4,
      cols: 3,
      indices: [[25, 24, 23], [9, 8, 7], [249, 248, 247], [233, 232, 231]],
      pulpIndices: [[216]],
    },
    {
      name: '食指',
      rows: 4,
      cols: 3,
      indices: [[22, 21, 20], [6, 5, 4], [246, 245, 244], [230, 229, 228]],
      pulpIndices: [[213]],
    },
    {
      name: '大拇指',
      rows: 4,
      cols: 3,
      indices: [[19, 18, 17], [3, 2, 1], [243, 242, 241], [227, 226, 225]],
      pulpIndices: [[210]],
    },
    {
      name: '手掌',
      rows: 5,
      cols: 15,
      indices: [
        [207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196],
        [191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 178, 177],
        [175, 174, 173, 172, 171, 170, 169, 168, 167, 166, 165, 164, 163, 162, 161],
        [159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 149, 148, 147, 146, 145],
        [143, 142, 141, 140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129],
      ],
    },
  ],
  rightHand: [
    {
      name: '大拇指',
      rows: 4,
      cols: 3,
      indices: [[240, 239, 238], [256, 255, 254], [16, 15, 14], [32, 31, 30]],
      pulpIndices: [[47]],
    },
    {
      name: '食指',
      rows: 4,
      cols: 3,
      indices: [[237, 236, 235], [253, 252, 251], [13, 12, 11], [29, 28, 27]],
      pulpIndices: [[44]],
    },
    {
      name: '中指',
      rows: 4,
      cols: 3,
      indices: [[234, 233, 232], [250, 249, 248], [10, 9, 8], [26, 25, 24]],
      pulpIndices: [[41]],
    },
    {
      name: '无名指',
      rows: 4,
      cols: 3,
      indices: [[231, 230, 229], [247, 246, 245], [7, 6, 5], [23, 22, 21]],
      pulpIndices: [[38]],
    },
    {
      name: '小拇指',
      rows: 4,
      cols: 3,
      indices: [[228, 227, 226], [244, 243, 242], [4, 3, 2], [20, 19, 18]],
      pulpIndices: [[35]],
    },
    {
      name: '手掌',
      rows: 5,
      cols: 15,
      indices: [
        [61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50],
        [80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66],
        [96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82],
        [112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98],
        [128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114],
      ],
    },
  ],
});

function getHandGroups(side, mapping = GLOVE_HAND_MAPPING) {
  if (side === 'left') return mapping.leftHand;
  if (side === 'right') return mapping.rightHand;
  throw new TypeError(`Unsupported hand side: ${side}`);
}

function flattenGloveHandMapping(side, mapping = GLOVE_HAND_MAPPING) {
  const groups = getHandGroups(side, mapping);
  const fingers = groups.slice(0, 5);
  const palm = groups[5];
  return [
    ...fingers.flatMap((group) => group.indices.flat()),
    ...fingers.flatMap((group) => (group.pulpIndices || []).flat()),
    ...(palm ? palm.indices.flat() : []),
  ];
}

function validateGloveHandMapping(mapping = GLOVE_HAND_MAPPING) {
  const errors = [];
  const hands = {};

  for (const side of ['left', 'right']) {
    let groups;
    try {
      groups = getHandGroups(side, mapping);
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    if (!Array.isArray(groups) || groups.length !== 6) {
      errors.push(`${side}Hand must contain five fingers and one palm group`);
      continue;
    }

    groups.slice(0, 5).forEach((group, index) => {
      if (group.rows !== 4 || group.cols !== 3 || group.indices.length !== 4
        || group.indices.some((row) => row.length !== 3)) {
        errors.push(`${side}Hand finger ${index} must be a 4x3 matrix`);
      }
      if (!Array.isArray(group.pulpIndices) || group.pulpIndices.length !== 1
        || !Array.isArray(group.pulpIndices[0]) || group.pulpIndices[0].length !== 1) {
        errors.push(`${side}Hand finger ${index} must contain one 1x1 pulp index matrix`);
      }
    });

    const palm = groups[5];
    const palmPointCount = palm?.indices?.flat().length || 0;
    if (palm?.rows !== 5 || palm?.cols !== 15 || palmPointCount !== 72) {
      errors.push(`${side}Hand palm must define 72 sensors in a logical 5x15 area`);
    }

    const indices = flattenGloveHandMapping(side, mapping);
    const outOfRange = indices.filter((index) => (
      !Number.isInteger(index) || index < mapping.indexBase
      || index >= mapping.indexBase + mapping.sensorCount
    ));
    if (indices.length !== 137) errors.push(`${side}Hand must resolve to 137 source indices`);
    if (new Set(indices).size !== indices.length) errors.push(`${side}Hand contains duplicate indices`);
    if (outOfRange.length) errors.push(`${side}Hand contains out-of-range indices`);

    hands[side] = {
      sourcePointCount: indices.length,
      uniquePointCount: new Set(indices).size,
      logicalPalmSlots: palm?.rows * palm?.cols || 0,
      palmPointCount,
      palmBlankSlots: Math.max(0, (palm?.rows * palm?.cols || 0) - palmPointCount),
    };
  }

  return { ok: errors.length === 0, errors, hands };
}

const HAND_LEFT_ADC_ORDER = Object.freeze(flattenGloveHandMapping('left'));
const HAND_RIGHT_ADC_ORDER = Object.freeze(flattenGloveHandMapping('right'));

module.exports = {
  GLOVE_HAND_MAPPING,
  HAND_LEFT_ADC_ORDER,
  HAND_RIGHT_ADC_ORDER,
  flattenGloveHandMapping,
  validateGloveHandMapping,
};
