const { calculatePressureStats, normalizeNumericArray } = require('../utils/stats');

class ZeroCalibrator {
  constructor() {
    this.baselines = new Map();
  }

  getKey(sensorType, channel = 'sit') {
    return `${sensorType || 'default'}:${channel || 'sit'}`;
  }

  setBaseline(sensorType, channel, data) {
    this.baselines.set(this.getKey(sensorType, channel), normalizeNumericArray(data));
  }

  clearBaseline(sensorType, channel) {
    if (sensorType && channel) {
      this.baselines.delete(this.getKey(sensorType, channel));
      return;
    }

    if (sensorType) {
      [...this.baselines.keys()]
        .filter((key) => key.startsWith(`${sensorType}:`))
        .forEach((key) => this.baselines.delete(key));
      return;
    }

    this.baselines.clear();
  }

  captureBaseline(frame) {
    this.setBaseline(frame.sensorType, frame.channel, frame.pressureData || frame.data || []);
  }

  apply(frame) {
    const key = this.getKey(frame.sensorType, frame.channel);
    const baseline = this.baselines.get(key);
    const source = normalizeNumericArray(frame.pressureData || frame.data || []);

    if (!baseline?.length) {
      return frame;
    }

    const pressureData = source.map((value, index) => {
      const nextValue = value - (baseline[index] || 0);
      return nextValue > 0 ? nextValue : 0;
    });

    return {
      ...frame,
      data: pressureData,
      pressureData,
      zeroFrame: baseline,
      stats: calculatePressureStats(pressureData),
    };
  }
}

module.exports = {
  ZeroCalibrator,
};
