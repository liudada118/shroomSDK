const { EventEmitter } = require('events');

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

class ReplayPlayer extends EventEmitter {
  constructor({
    timeline,
    speed = 1,
    loop = false,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    super();
    this.timeline = timeline || { length: 0, time: [], frames: [] };
    this.frames = this.timeline.frames || [];
    this.index = 0;
    this.playing = false;
    this.ended = false;
    this.loop = Boolean(loop);
    this.speed = normalizeSpeed(speed);
    this.timer = null;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
  }

  get currentFrame() {
    return this.frames[this.index] || null;
  }

  getState() {
    return {
      index: this.index,
      length: this.frames.length,
      playing: this.playing,
      ended: this.ended,
      speed: this.speed,
      loop: this.loop,
      frame: this.currentFrame,
    };
  }

  emitState() {
    const state = this.getState();
    this.emit('state', state);
    return state;
  }

  setSpeed(speed) {
    this.speed = normalizeSpeed(speed);
    if (this.playing) {
      this.clearTimer();
      this.scheduleNext();
    }
    return this.emitState();
  }

  setLoop(loop) {
    this.loop = Boolean(loop);
    return this.emitState();
  }

  seek(index, options = {}) {
    if (!this.frames.length) {
      this.index = 0;
      return this.emitState();
    }
    this.index = Math.min(this.frames.length - 1, Math.max(0, Math.trunc(Number(index) || 0)));
    this.ended = false;
    if (options.emitFrame !== false) this.emit('frame', this.currentFrame, this.getState());
    if (this.playing) {
      this.clearTimer();
      this.scheduleNext();
    }
    return this.emitState();
  }

  step(count = 1) {
    this.pause();
    return this.seek(this.index + Math.trunc(Number(count) || 1));
  }

  play() {
    if (this.playing) return this.getState();
    if (!this.frames.length) {
      this.ended = true;
      this.emit('end', this.getState());
      return this.getState();
    }
    if (this.ended) this.index = 0;
    this.ended = false;
    this.playing = true;
    this.emit('frame', this.currentFrame, this.getState());
    this.emitState();
    this.scheduleNext();
    return this.getState();
  }

  pause() {
    this.clearTimer();
    this.playing = false;
    return this.emitState();
  }

  stop() {
    this.clearTimer();
    this.playing = false;
    this.index = 0;
    this.ended = false;
    return this.emitState();
  }

  scheduleNext() {
    if (!this.playing) return;
    if (this.index >= this.frames.length - 1) {
      if (this.loop && this.frames.length) {
        const first = this.frames[0];
        const second = this.frames[1] || first;
        const delay = Math.max(0, Number(second.timestamp) - Number(first.timestamp));
        this.timer = this.setTimeoutFn(() => this.advanceTo(0), delay / this.speed);
      } else {
        this.playing = false;
        this.ended = true;
        this.emitState();
        this.emit('end', this.getState());
      }
      return;
    }
    const current = this.frames[this.index];
    const next = this.frames[this.index + 1];
    const delay = Math.max(0, Number(next.timestamp) - Number(current.timestamp));
    this.timer = this.setTimeoutFn(() => this.advanceTo(this.index + 1), delay / this.speed);
  }

  advanceTo(index) {
    this.timer = null;
    if (!this.playing) return;
    this.index = index;
    this.ended = false;
    this.emit('frame', this.currentFrame, this.getState());
    this.emitState();
    this.scheduleNext();
  }

  clearTimer() {
    if (this.timer != null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
  }
}

function normalizeSpeed(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 1;
}

class ReplayService {
  constructor({ store, algorithmChannel } = {}) {
    if (!store) {
      throw new Error('store is required');
    }
    this.store = store;
    this.algorithmChannel = algorithmChannel || null;
  }

  listCaptures(filter = {}) {
    return this.store.listCaptures(filter);
  }

  getFrames(options = {}) {
    return this.store.queryFrames(options).map((row) => {
      const extra = parseJson(row.extra_json, {});
      const frame = {
        id: row.id,
        captureId: row.capture_id,
        captureName: row.capture_name,
        sensorType: row.sensor_type,
        channel: row.channel,
        timestamp: row.timestamp,
        data: parseJson(row.data_json, []),
        stats: parseJson(row.stats_json, {}),
        extra,
        algorithmResults: extra.algorithmResults || {},
      };
      if (options.applyAlgorithms && this.algorithmChannel) {
        return this.algorithmChannel.process(frame, {
          source: 'replay',
          captureId: frame.captureId,
          channel: frame.channel,
        });
      }
      return frame;
    });
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

  createPlayer(options = {}) {
    return new ReplayPlayer({
      ...options,
      timeline: this.buildTimeline(options),
    });
  }
}

module.exports = {
  ReplayPlayer,
  ReplayService,
  normalizeSpeed,
};
