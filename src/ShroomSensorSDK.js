const path = require('path');
const { SerialPort } = require('serialport');
const { ProtocolRegistry } = require('./protocol/ProtocolRegistry');
const { CaptureStore } = require('./storage/CaptureStore');
const { CsvExporter } = require('./export/CsvExporter');
const { SensorSession } = require('./serial/SensorSession');
const { SerialManager } = require('./serial/SerialManager');
const { listSerialPorts } = require('./serial/serialTools');
const { DEFAULT_SENSOR_PROFILES } = require('./profiles');
const { createProjectLineOrderRegistry } = require('./line/projectLineOrders');
const { ZeroCalibrator } = require('./processing/ZeroCalibrator');
const { ReplayService } = require('./replay/ReplayService');
const { BackendCommandRouter } = require('./backend/BackendCommandRouter');
const { LicenseService } = require('./license/LicenseService');
const { PathService } = require('./config/PathService');
const { ReportService } = require('./report/ReportService');
const { getGloveProductProfile, isGloveProfile } = require('./glove/catalog');
const { remapGloveFrame } = require('./glove/frame');
const { AlgorithmChannel } = require('./algorithm/AlgorithmChannel');

class GloveConnectionError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GloveConnectionError';
    this.code = code;
  }
}

function attachSessionCallbacks(session, options = {}) {
  const callbacks = {
    frame: options.onFrame,
    error: options.onError,
    rawFrame: options.onRawFrame,
    open: options.onOpen,
    close: options.onClose,
    channelOpen: options.onChannelOpen,
    channelClose: options.onChannelClose,
    channelState: options.onChannelState,
    channelStale: options.onChannelStale,
    write: options.onWrite,
  };
  Object.entries(callbacks).forEach(([event, handler]) => {
    if (typeof handler === 'function') session.on(event, handler);
  });
}

function normalizeGloveChannels(options = {}) {
  if (options.channels && Object.values(options.channels).some(Boolean)) {
    return { ...options.channels };
  }
  if (options.leftPort || options.rightPort) {
    return { left: options.leftPort, right: options.rightPort };
  }
  if (Array.isArray(options.ports) && options.ports.length) {
    return { left: options.ports[0], right: options.ports[1] };
  }
  if (options.ports && typeof options.ports === 'object') {
    return {
      left: options.ports.left || options.ports.sit,
      right: options.ports.right || options.ports.back,
    };
  }
  if (options.port) {
    return { [options.side === 'right' ? 'right' : 'left']: options.port };
  }
  return null;
}

function classifyOpenError(error) {
  const message = String(error?.message || error || '');
  if (/access denied|resource busy|cannot lock|占用/i.test(message)) return 'PORT_BUSY';
  if (/cannot find|not found|no such file|不存在/i.test(message)) return 'PORT_NOT_FOUND';
  return 'OPEN_FAILED';
}

function hasWchSignature(port = {}) {
  const source = [
    port.path,
    port.manufacturer,
    port.friendlyName,
    port.pnpId,
    port.vendorId,
    port.productId,
  ].filter(Boolean).join(' ').toUpperCase();

  return source.includes('WCH') ||
    source.includes('CH34') ||
    source.includes('USB-SERIAL') ||
    source.includes('USB-ENHANCED-SERIAL') ||
    source.includes('1A86');
}

function summarizePort(port = {}) {
  return {
    path: port.path || '',
    manufacturer: port.manufacturer || '',
    serialNumber: port.serialNumber || '',
    pnpId: port.pnpId || '',
    vendorId: port.vendorId || '',
    productId: port.productId || '',
    friendlyName: port.friendlyName || '',
    locationId: port.locationId || '',
    isLikelySensorPort: hasWchSignature(port),
  };
}

class ShroomSensorSDK {
  constructor(options = {}) {
    this.options = options;
    this.dbDir = options.dbDir || path.join(process.cwd(), 'db');
    this.exportDir = options.exportDir || path.join(process.cwd(), 'data');
    this.registry = new ProtocolRegistry({
      ...DEFAULT_SENSOR_PROFILES,
      ...(options.profiles || {}),
    }, {
      lineOrders: options.lineOrders || createProjectLineOrderRegistry(options.extraLineOrders || {}),
    });
    this.store = options.store || null;
    this.exporter = options.exporter || null;
    this.zeroCalibrator = options.zeroCalibrator || new ZeroCalibrator();
    this.algorithmChannel = options.algorithmChannel || new AlgorithmChannel({
      algorithms: options.algorithms || {},
      errorMode: options.algorithmErrorMode,
    });
    this.pathService = options.pathService || new PathService({
      dbDir: this.dbDir,
      exportDir: this.exportDir,
      imageDir: options.imageDir,
      reportDir: options.reportDir,
    });
    this.licenseService = options.licenseService || new LicenseService(options.license || {});
    this.commandRouter = options.commandRouter || new BackendCommandRouter();
    this.reportService = options.reportService || new ReportService({
      store: this.store,
      pythonClient: options.pythonClient,
    });
    this.serialManager = options.serialManager || new SerialManager({
      sdk: this,
      SerialPortClass: options.SerialPortClass,
      ...(options.serialManagerOptions || {}),
    });
  }

  getStore() {
    if (!this.store) {
      this.store = new CaptureStore({
        dbDir: this.dbDir,
        dbPath: this.options.dbPath,
      });
      if (this.reportService && !this.reportService.store) {
        this.reportService.store = this.store;
      }
    }
    return this.store;
  }

  getExporter() {
    if (!this.exporter) {
      this.exporter = new CsvExporter({
        store: this.getStore(),
        exportDir: this.exportDir,
      });
    }
    return this.exporter;
  }

  registerProfile(sensorType, profile) {
    return this.registry.registerProfile(sensorType, profile);
  }

  registerLineOrder(name, handler) {
    return this.registry.lineOrders.register(name, handler);
  }

  listLineOrders() {
    return this.registry.lineOrders.list();
  }

  applyLineOrder(name, data, context = {}) {
    return this.registry.lineOrders.apply(name, data, context);
  }

  registerAlgorithm(name, handler, options = {}) {
    this.algorithmChannel.register(name, handler, options);
    return this;
  }

  unregisterAlgorithm(name) {
    return this.algorithmChannel.unregister(name);
  }

  processAlgorithms(frame, context = {}) {
    return this.algorithmChannel.process(frame, context);
  }

  async listPorts(options = {}) {
    const summarized = await listSerialPorts({
      SerialPortClass: options.SerialPortClass || this.options.SerialPortClass || SerialPort,
    });
    if (options.onlyLikelySensorPorts) {
      return summarized.filter((port) => port.isLikelySensorPort);
    }
    return summarized;
  }

  async open(options = {}) {
    const sensorType = options.sensorType || 'default';
    const profile = this.registry.getProfile(sensorType, options.profile || {});
    const channels = options.channels || {};
    const session = new SensorSession({
      sensorType,
      profile,
      registry: this.registry,
      channels,
      frameProcessor: (frame) => {
        const normalized = remapGloveFrame(this.zeroCalibrator.apply(frame));
        return this.algorithmChannel.process(normalized, {
          source: 'serial',
          sensorType,
          channel: normalized.channel,
        });
      },
      connectionOptions: {
        ...(this.options.connectionOptions || {}),
        ...(options.connectionOptions || {}),
      },
      SerialPortClass: options.SerialPortClass || this.options.SerialPortClass || SerialPort,
      DelimiterParserClass: options.DelimiterParserClass || this.options.DelimiterParserClass,
    });
    attachSessionCallbacks(session, options);
    await session.open();
    return session;
  }

  async connectGlove(options = {}) {
    const requestedProfile = options.profileId
      || options.model
      || (typeof options.profile === 'string' ? options.profile : null)
      || 'hand0205';
    if (!isGloveProfile(requestedProfile)) {
      throw new GloveConnectionError(
        'UNSUPPORTED_PROFILE',
        `不支持的手套 Profile：${requestedProfile}`,
      );
    }

    const product = getGloveProductProfile(requestedProfile);
    let channels = normalizeGloveChannels(options);
    let connectionMode = channels ? 'manual' : 'auto';

    if (!channels) {
      let ports = await this.listPorts({ onlyLikelySensorPorts: true });
      if (!ports.length) ports = await this.listPorts();
      const paths = ports.map((port) => port.path).filter(Boolean);
      if (!paths.length) {
        throw new GloveConnectionError('NO_GLOVE_PORT', '没有找到可用串口');
      }

      const connectBoth = options.hands === 'both' || requestedProfile === 'hand0205Double';
      channels = connectBoth
        ? { left: paths[0], right: paths[1] }
        : { [options.side === 'right' ? 'right' : 'left']: paths[0] };
    }

    channels = Object.fromEntries(Object.entries(channels).filter(([, portPath]) => !!portPath));
    if (!Object.keys(channels).length) {
      throw new GloveConnectionError('NO_GLOVE_PORT', '没有提供可连接的手套串口');
    }

    try {
      const session = await this.open({
        ...options,
        sensorType: requestedProfile,
        profile: typeof options.profile === 'object' ? options.profile : options.profileOverride,
        channels,
      });
      session.product = { ...product };
      session.profileId = requestedProfile;
      session.connectionMode = connectionMode;
      session.selectedPorts = { ...channels };
      return session;
    } catch (error) {
      if (error instanceof GloveConnectionError) throw error;
      const code = classifyOpenError(error);
      throw new GloveConnectionError(
        code,
        `手套连接失败（${Object.values(channels).join(', ')}）：${error.message || error}`,
        error,
      );
    }
  }

  startCapture(session, options = {}) {
    return session.startCapture({
      store: this.getStore(),
      ...options,
    });
  }

  stopCapture(session) {
    return session.stopCapture();
  }

  connectSerial(options = {}) {
    return this.serialManager.connect(options);
  }

  rescanSerial(options = {}) {
    return this.serialManager.rescan(options);
  }

  writeSerial(target, channel, data, options = {}) {
    return this.serialManager.write(target, channel, data, options);
  }

  disconnectSerial(target) {
    return target ? this.serialManager.disconnect(target) : this.serialManager.disconnectAll();
  }

  getSerialState() {
    return this.serialManager.getState();
  }

  listCaptures(filter = {}) {
    return this.getStore().listCaptures(filter);
  }

  countCaptures(filter = {}) {
    return this.getStore().countCaptures(filter);
  }

  getCapture(options = {}) {
    return this.getStore().getCapture(options);
  }

  getCaptureFrames(options = {}) {
    return this.getStore().queryFrames(options);
  }

  countCaptureFrames(options = {}) {
    return this.getStore().countFrames(options);
  }

  deleteCapture(options = {}) {
    return this.getStore().deleteCapture(options);
  }

  replay(options = {}) {
    const replayService = new ReplayService({
      store: this.getStore(),
      algorithmChannel: this.algorithmChannel,
    });
    return replayService.buildTimeline(options);
  }

  createReplay(options = {}) {
    const replayService = new ReplayService({
      store: this.getStore(),
      algorithmChannel: this.algorithmChannel,
    });
    return replayService.createPlayer(options);
  }

  exportCsv(options = {}) {
    return this.getExporter().exportCapture(options);
  }

  close() {
    if (this.store) {
      this.store.close();
    }
  }
}

module.exports = {
  GloveConnectionError,
  ShroomSensorSDK,
  attachSessionCallbacks,
  classifyOpenError,
  normalizeGloveChannels,
  summarizePort,
  hasWchSignature,
};
