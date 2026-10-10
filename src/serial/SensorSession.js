const { EventEmitter } = require('events');
const { DelimiterParser } = require('@serialport/parser-delimiter');
const { SerialPort } = require('serialport');
const { createGlovePacketAssembler } = require('../glove/protocol');
const { CaptureController } = require('../capture/CaptureController');
const {
  createSerialError,
  normalizeSerialError,
  serializeSerialError,
} = require('./errors');
const { sleep, writeSerialPort } = require('./serialTools');

const DEFAULT_CONNECT_TIMEOUT_MS = 2000;
const DEFAULT_CONNECT_RETRIES = 3;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 500;
const DEFAULT_STALE_AFTER_MS = 5000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 1000;

class SensorSession extends EventEmitter {
  constructor({
    sensorType,
    profile,
    registry,
    channels = {},
    frameProcessor = null,
    connectionOptions = {},
    SerialPortClass = SerialPort,
    DelimiterParserClass = DelimiterParser,
    now = () => Date.now(),
  }) {
    super();
    this.sensorType = sensorType;
    this.profile = profile;
    this.registry = registry;
    this.channels = channels;
    this.frameProcessor = frameProcessor;
    this.connectionOptions = {
      timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
      retries: DEFAULT_CONNECT_RETRIES,
      retryDelayMs: DEFAULT_CONNECT_RETRY_DELAY_MS,
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      healthCheckIntervalMs: DEFAULT_HEALTH_CHECK_INTERVAL_MS,
      ...connectionOptions,
    };
    this.SerialPortClass = SerialPortClass;
    this.DelimiterParserClass = DelimiterParserClass;
    this.now = now;
    this.openPorts = new Map();
    this.capture = null;
    this.latestFrames = new Map();
    this.channelStates = new Map();
    this.connectionState = 'idle';
    this.healthTimer = null;
    this.gloveAssembler = (
      profile?.parser === 'handGloveSplitPacket' || profile?.parser === 'handGloveDoublePacket'
    ) ? createGlovePacketAssembler(profile) : null;

    Object.entries(channels).forEach(([channel, portPath]) => {
      if (portPath) this.channelStates.set(channel, this.createChannelState(channel, portPath));
    });
  }

  createChannelState(channel, portPath) {
    return {
      channel,
      portPath,
      baudRate: this.profile?.baudRate || null,
      status: 'idle',
      online: false,
      connectedAt: null,
      disconnectedAt: null,
      lastDataAt: null,
      lastFrameAt: null,
      receivedFrames: 0,
      goodFrames: 0,
      badFrames: 0,
      consecutiveBadFrames: 0,
      dataQuality: 'unknown',
      lastError: null,
    };
  }

  getChannelState(channel, portPath = this.channels[channel]) {
    if (!this.channelStates.has(channel)) {
      this.channelStates.set(channel, this.createChannelState(channel, portPath));
    }
    return this.channelStates.get(channel);
  }

  updateChannelState(channel, patch) {
    const state = this.getChannelState(channel);
    Object.assign(state, patch);
    this.emit('channelState', { ...state });
    return state;
  }

  /**
   * 安全地发出 `error`。
   *
   * `error` 是 `EventEmitter` 的保留事件名：**没有监听者时 Node 会直接抛出**，
   * 而串口错误和解析错误都发生在 I/O 回调里，抛出去就是进程退出。SDK 不该把
   * 「使用方忘了挂监听」变成「整个采集程序挂掉」。
   *
   * 所以这里先查有没有监听者：有就正常发，没有就降级成一次 `console.error`。
   * 不静默丢弃 —— 那会让故障完全不可见，比崩溃更难排查。
   *
   * @param {object} payload 错误载荷，至少含 `error`。
   * @returns {void}
   */
  emitError(payload) {
    if (this.listenerCount('error') > 0) {
      this.emit('error', payload);
      return;
    }

    const { channel, error } = payload || {};
    const detail = error?.message || error;
    // eslint-disable-next-line no-console
    console.error(
      `[SensorSession] 未监听的错误（sensorType=${this.sensorType}, channel=${channel}）：${detail}`
      + ' —— 请挂上 session.on(\'error\', ...) 以自行处理。',
    );
  }

  async open() {
    this.connectionState = 'connecting';
    const entries = Object.entries(this.channels).filter(([, portPath]) => !!portPath);
    if (!entries.length) {
      this.connectionState = 'error';
      throw new Error('at least one channel port is required');
    }

    // 多通道是串行打开的，中途失败必须把已开的口关掉再抛。
    // 不回滚的话调用方拿到一个 rejected promise，却有一个端口在后台开着 ——
    // 既占用设备（下次打开报 Access denied），也无法通过 session 关闭。
    for (const [channel, portPath] of entries) {
      try {
        await this.openChannel(channel, portPath);
      } catch (error) {
        try {
          await this.close();
        } catch (cleanupError) {
          this.emitError({ channel, error: cleanupError, phase: 'cleanup' });
        }
        this.connectionState = 'error';
        throw error;
      }
    }

    this.connectionState = 'connected';
    this.startHealthMonitor();
    this.emit('open', {
      sensorType: this.sensorType,
      channels: [...this.openPorts.keys()],
    });
    return this;
  }

  async openChannel(channel, portPath) {
    const retries = Math.max(1, Number(this.connectionOptions.retries) || 1);
    const retryDelayMs = Math.max(0, Number(this.connectionOptions.retryDelayMs) || 0);
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      this.updateChannelState(channel, {
        portPath,
        status: 'connecting',
        online: false,
        lastError: null,
      });
      this.emit('channelConnectAttempt', { channel, portPath, attempt, retries });
      try {
        return await this.openChannelOnce(channel, portPath, attempt);
      } catch (error) {
        lastError = normalizeSerialError(error, 'OPEN_FAIL', {
          channel,
          path: portPath,
          baudRate: this.profile?.baudRate,
          attempt,
        });
        this.updateChannelState(channel, {
          status: 'error',
          online: false,
          lastError: serializeSerialError(lastError),
        });
        if (attempt < retries) await sleep(retryDelayMs);
      }
    }

    throw lastError;
  }

  openChannelOnce(channel, portPath, attempt = 1) {
    return new Promise((resolve, reject) => {
      const timeoutMs = Math.max(1, Number(this.connectionOptions.timeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS);
      const port = new this.SerialPortClass({
        ...(this.connectionOptions.portOptions || {}),
        path: portPath,
        baudRate: this.profile.baudRate,
        autoOpen: false,
      });
      const parser = port.pipe(new this.DelimiterParserClass({ delimiter: this.profile.delimiter }));
      let settled = false;
      const rejectOpen = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        parser.removeAllListeners?.();
        port.removeAllListeners?.();
        reject(error);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        try {
          parser.removeAllListeners?.();
          port.removeAllListeners?.();
          if (port.isOpen) port.close(() => {});
        } catch {
          // The timeout error below is the actionable result.
        }
        rejectOpen(createSerialError('CONNECT_TIMEOUT', {
          channel,
          path: portPath,
          baudRate: this.profile.baudRate,
          attempt,
        }));
      }, timeoutMs);

      parser.on('data', (data) => {
        this.handleRawFrame(channel, data);
      });
      port.on('error', (error) => {
        const normalized = normalizeSerialError(error, 'OPEN_FAIL', {
          channel,
          path: portPath,
          baudRate: this.profile.baudRate,
        });
        if (!settled) {
          rejectOpen(normalized);
          return;
        }
        this.updateChannelState(channel, {
          status: 'error',
          online: false,
          lastError: serializeSerialError(normalized),
        });
        this.emitError({ channel, error: normalized, phase: 'serial' });
      });
      port.on('close', () => {
        this.openPorts.delete(channel);
        this.updateChannelState(channel, {
          status: 'offline',
          online: false,
          disconnectedAt: this.now(),
        });
        this.emit('channelClose', { channel, portPath });
      });

      port.open((error) => {
        if (settled) return;
        if (error) {
          rejectOpen(normalizeSerialError(error, 'OPEN_FAIL', {
            channel,
            path: portPath,
            baudRate: this.profile.baudRate,
            attempt,
          }));
          return;
        }

        settled = true;
        clearTimeout(timer);

        this.openPorts.set(channel, { port, parser, portPath });
        const connectedAt = this.now();
        this.updateChannelState(channel, {
          status: 'connected',
          online: true,
          connectedAt,
          disconnectedAt: null,
          lastDataAt: null,
          lastError: null,
        });
        this.emit('channelOpen', { channel, portPath });
        resolve();
      });
    });
  }

  recordRawFrame(channel, rawFrame) {
    const state = this.getChannelState(channel);
    state.receivedFrames += 1;
    state.lastDataAt = this.now();
    state.online = true;
    if (state.status === 'stale' || state.status === 'offline') state.status = 'connected';
    this.emit('channelData', {
      channel,
      portPath: state.portPath,
      receivedAt: state.lastDataAt,
      rawLength: rawFrame.length,
    });
  }

  recordGoodFrame(channel) {
    const state = this.getChannelState(channel);
    state.goodFrames += 1;
    state.consecutiveBadFrames = 0;
    state.lastFrameAt = this.now();
    const badFrameRate = state.receivedFrames ? state.badFrames / state.receivedFrames : 0;
    state.dataQuality = badFrameRate > 0.1 ? 'degraded' : 'ok';
    state.status = state.dataQuality === 'degraded' ? 'degraded' : 'connected';
    state.online = true;
  }

  recordBadFrame(channel, error) {
    const state = this.getChannelState(channel);
    state.badFrames += 1;
    state.consecutiveBadFrames += 1;
    state.lastError = {
      code: error?.code || 'FRAME_PARSE_FAILED',
      message: error?.message || String(error),
      at: this.now(),
    };
    const badFrameRate = state.receivedFrames ? state.badFrames / state.receivedFrames : 0;
    if (state.consecutiveBadFrames >= 10) state.dataQuality = 'device_error';
    else if (badFrameRate > 0.1) state.dataQuality = 'degraded';
    else state.dataQuality = 'ok';
    state.status = state.dataQuality;
  }

  refreshChannelHealth({ emit = true } = {}) {
    const now = this.now();
    const staleAfterMs = Math.max(1, Number(this.connectionOptions.staleAfterMs) || DEFAULT_STALE_AFTER_MS);
    for (const [channel, state] of this.channelStates) {
      const entry = this.openPorts.get(channel);
      if (!entry?.port?.isOpen) continue;
      const activityAt = state.lastDataAt || state.connectedAt;
      if (!activityAt || now - activityAt <= staleAfterMs || state.status === 'stale') continue;
      state.status = 'stale';
      state.online = false;
      state.lastError = serializeSerialError(createSerialError('STALE_CONNECTION', {
        channel,
        path: state.portPath,
      }));
      if (emit) this.emit('channelStale', { ...state });
    }
  }

  startHealthMonitor() {
    this.stopHealthMonitor();
    const intervalMs = Math.max(
      50,
      Number(this.connectionOptions.healthCheckIntervalMs) || DEFAULT_HEALTH_CHECK_INTERVAL_MS,
    );
    this.healthTimer = setInterval(() => this.refreshChannelHealth(), intervalMs);
    this.healthTimer.unref?.();
  }

  stopHealthMonitor() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  /**
   * 处理一个分帧后的原始帧。
   *
   * ⚠️ **整段包在 try/catch 里，这不是防御性编程的习惯问题，是必需的。**
   * 本方法由 serialport 的 `data` 事件驱动，抛出去没人接 —— 一帧脏数据、一个
   * 未注册的线序名、或者使用方 `frame` 监听器里的一个笔误，都会终止整个进程。
   * 采集程序跑到一半因为一帧数据而退出是不可接受的。
   *
   * `rawFrame` 事件在解析**之前**发，所以即使解析失败，需要原始字节的使用方
   * （抓包排障、协议逆向）仍然收得到。
   *
   * @param {string} channel 来源通道。
   * @param {Buffer} rawFrame 分帧后的原始字节。
   * @returns {void}
   */
  handleRawFrame(channel, rawFrame) {
    const rawBuffer = Buffer.from(rawFrame);
    this.recordRawFrame(channel, rawBuffer);
    // 先发原始帧：解析失败时它是唯一的排障线索。
    try {
      this.emit('rawFrame', {
        sensorType: this.sensorType,
        channel,
        rawFrame: rawBuffer,
      });
    } catch (error) {
      this.emitError({ channel, error, phase: 'rawFrame' });
    }

    let frame;
    try {
      const parsedFrame = this.registry.parse(this.sensorType, rawBuffer, {
        channel,
        profile: this.profile,
        gloveAssembler: this.gloveAssembler,
      });
      if (!parsedFrame) {
        this.emit('packetPending', { sensorType: this.sensorType, channel });
        return;
      }
      frame = typeof this.frameProcessor === 'function'
        ? this.frameProcessor(parsedFrame)
        : parsedFrame;
    } catch (error) {
      this.recordBadFrame(channel, error);
      // 解析失败就丢这一帧。下一帧仍然会被处理 —— 脏帧通常是偶发的
      // （上电瞬间、拔插抖动），整条链路不该因此停摆。
      this.emitError({ channel, error, phase: 'parse' });
      return;
    }

    this.recordGoodFrame(channel);
    this.latestFrames.set(frame.handSide || channel, frame);

    try {
      this.emit('frame', frame);
    } catch (error) {
      // 使用方监听器里的异常不该影响入库。
      this.emitError({ channel, error, phase: 'frame' });
    }

    if (this.capture?.active) {
      try {
        if (typeof this.capture.enqueueFrame === 'function') {
          this.capture.enqueueFrame({ channel, rawFrame, frame });
        } else {
          this.capture.store.insertFrame({
            captureId: this.capture.id,
            sensorType: this.sensorType,
            channel,
            rawFrame,
            frame,
          });
        }
      } catch (error) {
        this.emitError({ channel, error, phase: 'capture' });
      }
    }
  }

  async write(channel, data, options = {}) {
    const entry = this.openPorts.get(channel);
    if (!entry?.port?.isOpen) {
      throw createSerialError('PORT_OFFLINE', {
        channel,
        path: entry?.portPath || this.channels[channel],
      });
    }

    try {
      const result = await writeSerialPort(entry.port, data, {
        ...options,
        channel,
        path: entry.portPath,
      });
      const payload = { channel, portPath: entry.portPath, ...result };
      this.emit('write', payload);
      return payload;
    } catch (error) {
      const normalized = normalizeSerialError(error, 'WRITE_FAIL', {
        channel,
        path: entry.portPath,
      });
      this.emitError({ channel, error: normalized, phase: 'write' });
      throw normalized;
    }
  }

  async writeAll(data, options = {}) {
    const results = [];
    for (const channel of this.openPorts.keys()) {
      results.push(await this.write(channel, data, options));
    }
    return results;
  }

  async reconnectChannel(channel) {
    const portPath = this.channels[channel];
    if (!portPath) throw createSerialError('PORT_NOT_FOUND', { channel });
    await this.closeChannel(channel);
    await this.openChannel(channel, portPath);
    return { ...this.getChannelState(channel) };
  }

  closeChannel(channel) {
    const entry = this.openPorts.get(channel);
    if (!entry) {
      this.updateChannelState(channel, {
        status: 'offline',
        online: false,
        disconnectedAt: this.now(),
      });
      return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      const finish = (error) => {
        this.openPorts.delete(channel);
        this.updateChannelState(channel, {
          status: error ? 'error' : 'offline',
          online: false,
          disconnectedAt: this.now(),
          lastError: error ? serializeSerialError(error, 'CLEANUP_FAIL') : null,
        });
        this.emit('channelClose', { channel, portPath: entry.portPath });
        if (error) reject(error);
        else resolve(true);
      };

      try {
        entry.parser?.removeAllListeners?.();
        entry.port?.removeAllListeners?.();
        if (entry.port?.isOpen) {
          entry.port.close((closeError) => {
            finish(closeError
              ? normalizeSerialError(closeError, 'CLEANUP_FAIL', {
                channel,
                path: entry.portPath,
              })
              : null);
          });
          return;
        }
        finish(null);
      } catch (error) {
        finish(normalizeSerialError(error, 'CLEANUP_FAIL', {
          channel,
          path: entry.portPath,
        }));
      }
    });
  }

  startCapture({ store, name, hz, frequencyHz, frequencyMode, metadata = {}, ...options }) {
    if (!store) {
      throw new Error('store is required');
    }

    if (this.capture?.active) {
      throw new Error('capture is already active');
    }

    this.capture = new CaptureController({
      store,
      sensorType: this.sensorType,
      channels: this.channels,
      name,
      metadata: {
        ...metadata,
        profile: {
          sensorType: this.sensorType,
          baudRate: this.profile?.baudRate,
          parser: this.profile?.parser,
          valueType: this.profile?.valueType,
          lineOrder: this.profile?.lineOrder,
          matrixWidth: this.profile?.matrixWidth,
          matrixHeight: this.profile?.matrixHeight,
        },
      },
      options: {
        ...options,
        hz,
        frequencyHz,
        frequencyMode,
        dataField: options.dataField || this.profile?.captureDataField || 'data',
      },
      onError: (payload) => {
        this.emit('captureError', payload);
        this.emitError(payload);
      },
      onFlush: (payload) => this.emit('captureFlush', payload),
    });
    const capture = this.capture.getState();
    this.emit('captureStart', capture);
    return capture;
  }

  stopCapture() {
    if (!this.capture) {
      return null;
    }

    if (!this.capture.active) {
      return this.capture.getState?.() || null;
    }

    const capture = typeof this.capture.stop === 'function'
      ? this.capture.stop()
      : { ...this.capture, active: false };
    this.capture.active = false;
    this.emit('captureStop', capture);
    return capture;
  }

  async close() {
    if (this.capture?.active) this.stopCapture();
    this.stopHealthMonitor();
    const entries = [...this.openPorts.entries()];
    const errors = [];
    for (const [channel] of entries) {
      try {
        await this.closeChannel(channel);
      } catch (error) {
        errors.push(error);
      }
    }

    this.connectionState = errors.length ? 'error' : 'closed';
    this.emit('close');
    if (errors.length) throw errors[0];
  }

  getState() {
    this.refreshChannelHealth({ emit: false });
    return {
      status: this.connectionState,
      sensorType: this.sensorType,
      channels: Object.fromEntries(
        Object.entries(this.channels).map(([channel, portPath]) => {
          const state = this.getChannelState(channel, portPath);
          return [channel, {
            ...state,
            open: !!this.openPorts.get(channel)?.port?.isOpen,
            badFrameRate: state.receivedFrames ? state.badFrames / state.receivedFrames : 0,
          }];
        }),
      ),
      latestFrames: Object.fromEntries(this.latestFrames),
      capture: this.capture?.getState?.() || null,
    };
  }
}

module.exports = {
  SensorSession,
};
