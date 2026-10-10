const { buildStoredFrameRow } = require('./frameRecord');

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
    return this.insertFrames([{ captureId, sensorType, channel, rawFrame, frame }]);
  }

  insertFrames(frames = []) {
    if (!Array.isArray(frames) || !frames.length) return 0;
    frames.forEach((frame) => {
      this.frames.push({
        id: this.frameId++,
        ...buildStoredFrameRow(frame),
      });
    });
    return frames.length;
  }

  listCaptures(filter = {}) {
    const offset = normalizeOffset(filter.offset);
    const limit = normalizeLimit(filter.limit);
    const rows = this.captures
      .filter((capture) => !filter.sensorType || capture.sensor_type === filter.sensorType)
      .filter((capture) => !(filter.captureName || filter.name) || capture.name === (filter.captureName || filter.name))
      .filter((capture) => !Number.isFinite(Number(filter.createdFrom)) || capture.created_at >= Number(filter.createdFrom))
      .filter((capture) => !Number.isFinite(Number(filter.createdTo)) || capture.created_at <= Number(filter.createdTo))
      .slice()
      .sort((a, b) => b.created_at - a.created_at || b.id - a.id);
    return rows.slice(offset, limit == null ? undefined : offset + limit);
  }

  countCaptures(filter = {}) {
    return this.listCaptures({ ...filter, limit: undefined, offset: undefined }).length;
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

    const offset = normalizeOffset(options.offset);
    const limit = normalizeLimit(options.limit);
    const rows = this.frames
      .filter((frame) => frame.capture_id === capture.id)
      .filter((frame) => !options.channel || frame.channel === options.channel)
      .filter((frame) => !Number.isFinite(Number(options.fromTimestamp)) || frame.timestamp >= Number(options.fromTimestamp))
      .filter((frame) => !Number.isFinite(Number(options.toTimestamp)) || frame.timestamp <= Number(options.toTimestamp))
      .map((frame) => ({
        ...frame,
        capture_name: capture.name,
        hz: capture.hz,
      }))
      .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
    return rows.slice(offset, limit == null ? undefined : offset + limit);
  }

  countFrames(options = {}) {
    return this.queryFrames({ ...options, limit: undefined, offset: undefined }).length;
  }

  deleteCapture(options = {}) {
    const capture = this.getCapture(options);
    if (!capture) return { captureId: null, capturesDeleted: 0, framesDeleted: 0 };
    const before = this.frames.length;
    this.frames = this.frames.filter((frame) => frame.capture_id !== capture.id);
    this.captures = this.captures.filter((item) => item.id !== capture.id);
    return {
      captureId: capture.id,
      capturesDeleted: 1,
      framesDeleted: before - this.frames.length,
    };
  }

  close() {}
}

function normalizeLimit(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeOffset(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : 0;
}

module.exports = {
  MemoryCaptureStore,
};
