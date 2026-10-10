const {
  GLOVE_HAND_MAPPING,
  HAND_LEFT_ADC_ORDER,
  HAND_RIGHT_ADC_ORDER,
  flattenGloveHandMapping,
  validateGloveHandMapping,
} = require('./handMappingDefinition');

const HAND_MODEL_POINTS = Object.freeze([
  [6, 2], [6, 3], [6, 4], [3, 8], [3, 9], [3, 10], [3, 14], [3, 15], [3, 16], [3, 20], [3, 21], [3, 22], [10, 26], [10, 27], [10, 28],
  [7, 2], [7, 3], [7, 4], [4, 8], [4, 9], [4, 10], [4, 14], [4, 15], [4, 16], [4, 20], [4, 21], [4, 22], [11, 26], [11, 27], [11, 28],
  [8, 2], [8, 3], [8, 4], [5, 8], [5, 9], [5, 10], [5, 14], [5, 15], [5, 16], [5, 20], [5, 21], [5, 22], [12, 26], [12, 27], [12, 28],
  [9, 2], [9, 3], [9, 4], [6, 8], [6, 9], [6, 10], [6, 14], [6, 15], [6, 16], [6, 20], [6, 21], [6, 22], [13, 26], [13, 27], [13, 28],
  [13, 2], [13, 3], [13, 4], [13, 8], [13, 9], [13, 10], [13, 14], [13, 15], [13, 16], [13, 20], [13, 21], [13, 22], [17, 25], [17, 26], [17, 27],
  [17, 6], [17, 7], [17, 8], [17, 9], [17, 10], [17, 11], [17, 12], [17, 13], [17, 14], [17, 15], [17, 16], [17, 17],
  [19, 6], [19, 7], [19, 8], [19, 9], [19, 10], [19, 11], [19, 12], [19, 13], [19, 14], [19, 15], [19, 16], [19, 17], [19, 18], [19, 19], [19, 20],
  [21, 6], [21, 7], [21, 8], [21, 9], [21, 10], [21, 11], [21, 12], [21, 13], [21, 14], [21, 15], [21, 16], [21, 17], [21, 18], [21, 19], [21, 20],
  [23, 6], [23, 7], [23, 8], [23, 9], [23, 10], [23, 11], [23, 12], [23, 13], [23, 14], [23, 15], [23, 16], [23, 17], [23, 18], [23, 19], [23, 20],
  [25, 6], [25, 7], [25, 8], [25, 9], [25, 10], [25, 11], [25, 12], [25, 13], [25, 14], [25, 15], [25, 16], [25, 17], [25, 18], [25, 19], [25, 20],
]);

function readPoint(source, index) {
  const value = Number(source[index]);
  return Number.isFinite(value) ? value : 0;
}

function mapHand256To147(values, side = 'left') {
  const source = Array.from(values || []);
  const order = side === 'right' ? HAND_RIGHT_ADC_ORDER : HAND_LEFT_ADC_ORDER;
  const indexes = order.map((point) => point - 1);
  const fingers = Array.from({ length: 5 }, (_, index) => indexes.slice(index * 12, index * 12 + 12));
  const result = new Array(147).fill(0);

  for (let row = 0; row < 4; row += 1) {
    for (let finger = 0; finger < 5; finger += 1) {
      for (let column = 0; column < 3; column += 1) {
        result[row * 15 + finger * 3 + column] = readPoint(
          source,
          fingers[finger][row * 3 + column],
        );
      }
    }
  }

  indexes.slice(60, 65).forEach((sourceIndex, finger) => {
    result[61 + finger * 3] = readPoint(source, sourceIndex);
  });
  indexes.slice(65, 137).forEach((sourceIndex, index) => {
    result[75 + index] = readPoint(source, sourceIndex);
  });

  if (side === 'right') return result;

  const mirrored = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 14; column >= 0; column -= 1) {
      mirrored.push(result[row * 15 + column]);
    }
  }
  for (let index = 86; index >= 75; index -= 1) mirrored.push(result[index]);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 14; column >= 0; column -= 1) {
      mirrored.push(result[87 + row * 15 + column]);
    }
  }
  return mirrored;
}

function mapHand147To1024(values) {
  const source = Array.from(values || [], (value) => Number(value) || 0);
  while (source.length < 147) source.push(0);
  for (let index = 60; index < 75; index += 1) source[index] /= 3;

  const ordered = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 14; column >= 0; column -= 1) ordered.push(source[row * 15 + column]);
  }
  for (let index = 86; index >= 75; index -= 1) ordered.push(source[index]);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 14; column >= 0; column -= 1) ordered.push(source[87 + row * 15 + column]);
  }

  const matrix = new Array(1024).fill(0);
  HAND_MODEL_POINTS.forEach(([row, column], index) => {
    const value = ordered[index] || 0;
    matrix[(31 - row) * 32 + column] = value;
    if (index >= 75) matrix[(30 - row) * 32 + column] = value;
  });
  return matrix;
}

function handLeft256To147(values) {
  return mapHand256To147(values, 'left');
}

function handRight256To147(values) {
  return mapHand256To147(values, 'right');
}

function handLeft256To1024(values) {
  return mapHand147To1024(handLeft256To147(values));
}

function handRight256To1024(values) {
  return mapHand147To1024(handRight256To147(values));
}

module.exports = {
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
};
