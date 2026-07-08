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

  async open() {
    const entries = Object.entries(this.channels).filter(([, portPath]) => !!portPath);
    if (!entries.length) {
      throw new Error('at least one channel port is required');
    }

    for (const [channel, portPath] of entries) {
      await this.openChannel(channel, portPath);
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
        this.emit('error', { channel, error });
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

  handleRawFrame(channel, rawFrame) {
    const parsedFrame = this.registry.parse(this.sensorType, rawFrame, {
      channel,
      profile: this.profile,
    });
    const frame = typeof this.frameProcessor === 'function'
      ? this.frameProcessor(parsedFrame)
      : parsedFrame;

    this.emit('rawFrame', {
      sensorType: this.sensorType,
      channel,
      rawFrame: Buffer.from(rawFrame),
    });
    this.emit('frame', frame);

    if (this.capture?.active) {
      this.capture.store.insertFrame({
        captureId: this.capture.id,
        sensorType: this.sensorType,
        channel,
        rawFrame,
        frame,
      });
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
