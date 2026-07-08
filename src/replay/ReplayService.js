function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

class ReplayService {
  constructor({ store }) {
    if (!store) {
      throw new Error('store is required');
    }
    this.store = store;
  }

  listCaptures(filter = {}) {
    return this.store.listCaptures(filter);
  }

  getFrames(options = {}) {
    return this.store.queryFrames(options).map((row) => ({
      id: row.id,
      captureId: row.capture_id,
      captureName: row.capture_name,
      sensorType: row.sensor_type,
      channel: row.channel,
      timestamp: row.timestamp,
      data: parseJson(row.data_json, []),
      stats: parseJson(row.stats_json, {}),
      extra: parseJson(row.extra_json, {}),
    }));
  }

  buildTimeline(options = {}) {
    const frames = this.getFrames(options);
    if (!frames.length) {
      return {
        length: 0,
        time: [],
        frames: [],
      };
    }

    const baseTimestamp = frames[0].timestamp;
    return {
      length: frames.length,
      time: frames.map((frame) => frame.timestamp),
      seconds: frames.map((frame) => ((frame.timestamp - baseTimestamp) / 1000).toFixed(3)),
      frames,
    };
  }
}

module.exports = {
  ReplayService,
};
