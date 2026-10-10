const DEFAULT_CAPTURE_HZ = 12;
const MAX_CAPTURE_HZ = 200;
const DEFAULT_CAPTURE_BATCH_SIZE = 200;
const DEFAULT_CAPTURE_FLUSH_INTERVAL_MS = 250;

function normalizeCaptureFrequency(value, fallback = DEFAULT_CAPTURE_HZ) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(MAX_CAPTURE_HZ, Math.max(1, numberValue));
}

function normalizeCaptureOptions(options = {}) {
  const frequencyHz = normalizeCaptureFrequency(options.frequencyHz ?? options.hz);
  return {
    frequencyMode: options.frequencyMode === 'serial' ? 'serial' : 'custom',
    frequencyHz,
    batchSize: Math.max(1, Number(options.batchSize) || DEFAULT_CAPTURE_BATCH_SIZE),
    flushIntervalMs: Math.max(
      1,
      Number(options.flushIntervalMs) || DEFAULT_CAPTURE_FLUSH_INTERVAL_MS,
    ),
    dataField: typeof options.dataField === 'string' && options.dataField
      ? options.dataField
      : 'data',
    frameSelector: typeof options.frameSelector === 'function' ? options.frameSelector : null,
    minFreeBytes: Math.max(0, Number(options.minFreeBytes) || 0),
  };
}

function resolveCaptureData(frame, options = {}) {
  if (typeof options.frameSelector === 'function') {
    const selected = options.frameSelector(frame);
    return Array.isArray(selected) ? selected : [];
  }

  const selected = frame?.[options.dataField || 'data'];
  if (Array.isArray(selected)) return selected;
  if (Array.isArray(frame?.data)) return frame.data;
  if (Array.isArray(frame?.pressureData)) return frame.pressureData;
  return [];
}

function createCaptureError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'CaptureError';
  error.code = code;
  error.details = details;
  return error;
}

class CaptureController {
  constructor({
    store,
    sensorType,
    channels = {},
    name,
    metadata = {},
    options = {},
    onError,
    onFlush,
  } = {}) {
    if (!store) throw new Error('store is required');

    this.store = store;
    this.sensorType = sensorType || 'default';
    this.channels = { ...channels };
    this.options = normalizeCaptureOptions(options);
    this.onError = typeof onError === 'function' ? onError : null;
    this.onFlush = typeof onFlush === 'function' ? onFlush : null;
    this.queue = [];
    this.lastStoredAt = new Map();
    this.timer = null;
    this.active = true;
    this.finished = false;
    this.error = null;
    this.startedAt = Date.now();
    this.endedAt = null;
    this.lastDiskCheckAt = 0;
    this.stats = {
      receivedFrames: 0,
      queuedFrames: 0,
      storedFrames: 0,
      skippedFrames: 0,
      flushCount: 0,
    };

    const capture = store.createCapture({
      name,
      sensorType: this.sensorType,
      hz: this.options.frequencyHz,
      metadata: {
        ...metadata,
        channels: this.channels,
        captureOptions: {
          frequencyMode: this.options.frequencyMode,
          frequencyHz: this.options.frequencyHz,
          batchSize: this.options.batchSize,
          flushIntervalMs: this.options.flushIntervalMs,
          dataField: this.options.dataField,
          minFreeBytes: this.options.minFreeBytes,
        },
      },
    });

    this.id = capture.id;
    this.name = capture.name;
    this.hz = capture.hz;
    this.metadata = capture.metadata;
  }

  shouldStore(channel, timestamp) {
    if (this.options.frequencyMode === 'serial') return true;
    const previous = this.lastStoredAt.get(channel);
    if (previous != null && timestamp - previous < 1000 / this.options.frequencyHz) {
      return false;
    }
    this.lastStoredAt.set(channel, timestamp);
    return true;
  }

  checkDiskSpace(now = Date.now()) {
    const minFreeBytes = this.options.minFreeBytes;
    if (!minFreeBytes || typeof this.store.getFreeBytes !== 'function') return true;
    if (now - this.lastDiskCheckAt < 1000) return true;
    this.lastDiskCheckAt = now;

    const freeBytes = this.store.getFreeBytes();
    if (freeBytes == null || freeBytes >= minFreeBytes) return true;
    throw createCaptureError(
      'CAPTURE_DISK_LOW',
      `磁盘剩余空间不足：至少需要 ${minFreeBytes} 字节，当前 ${freeBytes} 字节`,
      { freeBytes, minFreeBytes },
    );
  }

  enqueueFrame({ channel = 'sit', rawFrame, frame } = {}) {
    if (!this.active) return false;
    this.stats.receivedFrames += 1;
    const timestampValue = Number(frame?.timestamp);
    const timestamp = Number.isFinite(timestampValue) ? timestampValue : Date.now();

    if (!this.shouldStore(channel, timestamp)) {
      this.stats.skippedFrames += 1;
      return false;
    }

    try {
      this.checkDiskSpace();
      const captureData = resolveCaptureData(frame, this.options);
      this.queue.push({
        captureId: this.id,
        sensorType: this.sensorType,
        channel,
        rawFrame,
        frame: {
          ...frame,
          timestamp,
          captureData,
        },
      });
      this.stats.queuedFrames += 1;

      if (this.queue.length >= this.options.batchSize) {
        this.flush();
      } else {
        this.ensureTimer();
      }
      return this.active;
    } catch (error) {
      this.handleStorageError(error, channel);
      return false;
    }
  }

  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.options.flushIntervalMs);
    this.timer.unref?.();
  }

  clearTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  flush() {
    if (!this.queue.length || this.error) return 0;
    const rows = this.queue.splice(0);
    try {
      if (typeof this.store.insertFrames === 'function') {
        this.store.insertFrames(rows);
      } else {
        rows.forEach((row) => this.store.insertFrame(row));
      }
      this.stats.storedFrames += rows.length;
      this.stats.flushCount += 1;
      this.onFlush?.({ count: rows.length, capture: this.getState() });
      return rows.length;
    } catch (error) {
      this.handleStorageError(error, rows[0]?.channel);
      return 0;
    }
  }

  handleStorageError(error, channel) {
    if (this.error) return;
    this.error = error instanceof Error ? error : new Error(String(error));
    this.active = false;
    this.clearTimer();
    try {
      this.finishStore();
    } catch (finishError) {
      this.error.finishError = finishError;
    }
    this.onError?.({
      channel,
      error: this.error,
      phase: 'capture',
      capture: this.getState(),
    });
  }

  finishStore() {
    if (this.finished) return;
    this.finished = true;
    this.endedAt = Date.now();
    this.store.finishCapture(this.id);
  }

  stop() {
    if (!this.finished) {
      this.flush();
      this.clearTimer();
      this.active = false;
      this.finishStore();
    }
    return this.getState();
  }

  getState() {
    return {
      id: this.id,
      name: this.name,
      sensorType: this.sensorType,
      hz: this.hz,
      metadata: this.metadata,
      channels: { ...this.channels },
      active: this.active,
      status: this.error ? 'error' : this.finished ? 'stopped' : 'recording',
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      pendingFrames: this.queue.length,
      error: this.error ? {
        name: this.error.name,
        code: this.error.code || 'CAPTURE_STORAGE_FAILED',
        message: this.error.message,
        details: this.error.details,
      } : null,
      options: {
        frequencyMode: this.options.frequencyMode,
        frequencyHz: this.options.frequencyHz,
        batchSize: this.options.batchSize,
        flushIntervalMs: this.options.flushIntervalMs,
        dataField: this.options.dataField,
        minFreeBytes: this.options.minFreeBytes,
      },
      stats: { ...this.stats },
    };
  }
}

module.exports = {
  CaptureController,
  DEFAULT_CAPTURE_BATCH_SIZE,
  DEFAULT_CAPTURE_FLUSH_INTERVAL_MS,
  DEFAULT_CAPTURE_HZ,
  MAX_CAPTURE_HZ,
  createCaptureError,
  normalizeCaptureFrequency,
  normalizeCaptureOptions,
  resolveCaptureData,
};
