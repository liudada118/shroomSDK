const path = require('path');
const { SerialPort } = require('serialport');
const { ProtocolRegistry } = require('./protocol/ProtocolRegistry');
const { CaptureStore } = require('./storage/CaptureStore');
const { CsvExporter } = require('./export/CsvExporter');
const { SensorSession } = require('./serial/SensorSession');
const { DEFAULT_SENSOR_PROFILES } = require('./profiles');
const { createProjectLineOrderRegistry } = require('./line/projectLineOrders');
const { ZeroCalibrator } = require('./processing/ZeroCalibrator');
const { ReplayService } = require('./replay/ReplayService');
const { BackendCommandRouter } = require('./backend/BackendCommandRouter');
const { LicenseService } = require('./license/LicenseService');
const { PathService } = require('./config/PathService');
const { ReportService } = require('./report/ReportService');

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

  async listPorts(options = {}) {
    const ports = await SerialPort.list();
    const summarized = ports.map(summarizePort);
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
      frameProcessor: (frame) => this.zeroCalibrator.apply(frame),
    });
    await session.open();
    return session;
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

  listCaptures(filter = {}) {
    return this.getStore().listCaptures(filter);
  }

  replay(options = {}) {
    const replayService = new ReplayService({ store: this.getStore() });
    return replayService.buildTimeline(options);
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
  ShroomSensorSDK,
  summarizePort,
  hasWchSignature,
};
