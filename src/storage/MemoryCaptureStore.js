class MemoryCaptureStore {
  constructor() {
    this.captureId = 1;
    this.frameId = 1;
    this.captures = [];
    this.frames = [];
  }

  createCapture({ name, sensorType, hz = null, metadata = {} }) {
    const capture = {
      id: this.captureId++,
      name: name || `${sensorType}_${Date.now()}`,
      sensor_type: sensorType,
      sensorType,
      hz,
      metadata: JSON.stringify(metadata),
      created_at: Date.now(),
      ended_at: null,
    };
    this.captures.push(capture);
    return {
      id: capture.id,
      name: capture.name,
      sensorType,
      hz,
      metadata,
    };
  }

  finishCapture(captureId) {
    const capture = this.captures.find((item) => item.id === captureId);
    if (capture) {
      capture.ended_at = Date.now();
    }
  }

  insertFrame({ captureId, sensorType, channel = 'sit', rawFrame, frame }) {
    const data = Array.isArray(frame?.pressureData)
      ? frame.pressureData
      : Array.isArray(frame?.data)
        ? frame.data
        : [];
    this.frames.push({
      id: this.frameId++,
      capture_id: captureId,
      sensor_type: sensorType || frame?.sensorType || '',
      channel: channel || frame?.channel || 'sit',
      timestamp: frame?.timestamp || Date.now(),
      raw_frame_hex: rawFrame ? Buffer.from(rawFrame).toString('hex') : null,
      data_json: JSON.stringify(data),
      stats_json: JSON.stringify(frame?.stats || {}),
      extra_json: JSON.stringify({
        rotate: frame?.rotate || [],
        matrix: frame?.matrix || {},
        extra: frame?.extra || {},
      }),
    });
  }

  listCaptures(filter = {}) {
    return this.captures
      .filter((capture) => !filter.sensorType || capture.sensor_type === filter.sensorType)
      .slice()
      .sort((a, b) => b.created_at - a.created_at);
  }

  getCapture({ captureId, captureName, sensorType } = {}) {
    const captures = this.listCaptures({ sensorType });
    if (captureId) {
      return captures.find((capture) => capture.id === captureId) || null;
    }
    if (captureName) {
      return captures.find((capture) => capture.name === captureName) || null;
    }
    return null;
  }

  queryFrames(options = {}) {
    const capture = this.getCapture(options);
    if (!capture) {
      return [];
    }

    return this.frames
      .filter((frame) => frame.capture_id === capture.id)
      .map((frame) => ({
        ...frame,
        capture_name: capture.name,
        hz: capture.hz,
      }))
      .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
  }

  close() {}
}

module.exports = {
  MemoryCaptureStore,
};
