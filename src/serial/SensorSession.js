const { EventEmitter } = require('events');
const { DelimiterParser } = require('@serialport/parser-delimiter');
const { SerialPort } = require('serialport');

class SensorSession extends EventEmitter {
  constructor({ sensorType, profile, registry, channels = {}, frameProcessor = null }) {
    super();
    this.sensorType = sensorType;
    this.profile = profile;
    this.registry = registry;
    this.channels = channels;
    this.frameProcessor = frameProcessor;
    this.openPorts = new Map();
    this.capture = null;
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
    const entries = Object.entries(this.channels).filter(([, portPath]) => !!portPath);
    if (!entries.length) {
      throw new Error('at least one channel port is required');
    }

    // 多通道是串行打开的，中途失败必须把已开的口关掉再抛。
    // 不回滚的话调用方拿到一个 rejected promise，却有一个端口在后台开着 ——
    // 既占用设备（下次打开报 Access denied），也无法通过 session 关闭。
    for (const [channel, portPath] of entries) {
      try {
        await this.openChannel(channel, portPath);
      } catch (error) {
        await this.close();
        throw error;
      }
    }

    this.emit('open', {
      sensorType: this.sensorType,
      channels: [...this.openPorts.keys()],
    });
    return this;
  }

  openChannel(channel, portPath) {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({
        path: portPath,
        baudRate: this.profile.baudRate,
        autoOpen: false,
      });
      const parser = port.pipe(new DelimiterParser({ delimiter: this.profile.delimiter }));

      parser.on('data', (data) => {
        this.handleRawFrame(channel, data);
      });
      port.on('error', (error) => {
        this.emitError({ channel, error });
      });
      port.on('close', () => {
        this.emit('channelClose', { channel, portPath });
      });

      port.open((error) => {
        if (error) {
          reject(error);
          return;
        }

        this.openPorts.set(channel, { port, parser, portPath });
        this.emit('channelOpen', { channel, portPath });
        resolve();
      });
    });
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
    // 先发原始帧：解析失败时它是唯一的排障线索。
    try {
      this.emit('rawFrame', {
        sensorType: this.sensorType,
        channel,
        rawFrame: Buffer.from(rawFrame),
      });
    } catch (error) {
      this.emitError({ channel, error, phase: 'rawFrame' });
    }

    let frame;
    try {
      const parsedFrame = this.registry.parse(this.sensorType, rawFrame, {
        channel,
        profile: this.profile,
      });
      frame = typeof this.frameProcessor === 'function'
        ? this.frameProcessor(parsedFrame)
        : parsedFrame;
    } catch (error) {
      // 解析失败就丢这一帧。下一帧仍然会被处理 —— 脏帧通常是偶发的
      // （上电瞬间、拔插抖动），整条链路不该因此停摆。
      this.emitError({ channel, error, phase: 'parse' });
      return;
    }

    try {
      this.emit('frame', frame);
    } catch (error) {
      // 使用方监听器里的异常不该影响入库。
      this.emitError({ channel, error, phase: 'frame' });
    }

    if (this.capture?.active) {
      try {
        this.capture.store.insertFrame({
          captureId: this.capture.id,
          sensorType: this.sensorType,
          channel,
          rawFrame,
          frame,
        });
      } catch (error) {
        this.emitError({ channel, error, phase: 'capture' });
      }
    }
  }

  startCapture({ store, name, hz, metadata = {} }) {
    if (!store) {
      throw new Error('store is required');
    }

    const capture = store.createCapture({
      name,
      sensorType: this.sensorType,
      hz,
      metadata: {
        ...metadata,
        channels: this.channels,
      },
    });

    this.capture = {
      ...capture,
      store,
      active: true,
    };
    this.emit('captureStart', capture);
    return capture;
  }

  stopCapture() {
    if (!this.capture?.active) {
      return null;
    }

    this.capture.store.finishCapture(this.capture.id);
    const capture = { ...this.capture, active: false };
    this.capture.active = false;
    this.emit('captureStop', capture);
    return capture;
  }

  async close() {
    const entries = [...this.openPorts.entries()];
    for (const [channel, entry] of entries) {
      await new Promise((resolve) => {
        if (!entry.port?.isOpen) {
          resolve();
          return;
        }
        entry.port.close(() => resolve());
      });
      this.openPorts.delete(channel);
    }

    this.emit('close');
  }
}

module.exports = {
  SensorSession,
};
