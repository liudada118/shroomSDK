function toFiniteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeNumericArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map(toFiniteNumber);
}

function calculatePressureStats(values, options = {}) {
  const data = normalizeNumericArray(values);
  const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 0;

  if (!data.length) {
    return {
      max: 0,
      min: 0,
      total: 0,
      mean: 0,
      point: 0,
      length: 0,
    };
  }

  let max = -Infinity;
  let min = Infinity;
  let total = 0;
  let point = 0;

  data.forEach((value) => {
    if (value > max) max = value;
    if (value < min) min = value;
    total += value;
    if (value > threshold) point += 1;
  });

  return {
    max,
    min,
    total,
    mean: total / data.length,
    point,
    length: data.length,
  };
}

module.exports = {
  toFiniteNumber,
  normalizeNumericArray,
  calculatePressureStats,
};
