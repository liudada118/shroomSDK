const { EventEmitter } = require('events');
const {
  createSerialError,
  normalizeSerialError,
  serializeSerialError,
} = require('./errors');
const {
  DEFAULT_BAUD_DEVICE_MAP,
  detectBaudRate,
  listDevicePorts,
  listSerialPorts,
  sleep,
  withTimeout,
} = require('./serialTools');

const DEFAULT_CONNECTION_LOCK_TIMEOUT_MS = 20000;
const DEFAULT_CONNECTION_LOCK_MAX_AGE_MS = 25000;
const DEFAULT_POST_DETECT_DELAY_MS = 500;
const DEFAULT_POST_ALL_DETECT_DELAY_MS = 1000;
const DEFAULT_SCAN_TIMEOUT_MS = 3000;

function normalizeManualChannels(options = {}) {
  if (options.channels && typeof options.channels === 'object') {
    return Object.fromEntries(Object.entries(options.channels).filter(([, path]) => !!path));
  }
  if (options.port || options.path || options.portPath) {
    return { [options.channel || 'main']: options.port || options.path || options.portPath };
  }
  if (Array.isArray(options.ports)) {
    const names = options.channelNames || [];
    return Object.fromEntries(
      options.ports
        .map((port, index) => [names[index] || `channel${index + 1}`, port?.path || port])
        .filter(([, path]) => !!path),
    );
  }
  return {};
}

function pickConnectionErrorCode(failedPorts = []) {
  const priority = ['PORT_BUSY', 'PORT_NOT_FOUND', 'BAUD_FAIL', 'OPEN_FAIL', 'CONNECT_TIMEOUT'];
  const codes = new Set(failedPorts.map((item) => item.code));
  return priority.find((code) => codes.has(code)) || 'OPEN_FAIL';
}

class SerialManager extends EventEmitter {
  constructor({ sdk, ...options } = {}) {
    super();
    if (!sdk) throw new TypeError('sdk is required');
    this.sdk = sdk;
    this.options = options;
    this.sessions = new Map();
    this.latestFrames = new Map();
    this.connectionTask = null;
    this.connectionTaskStartedAt = 0;
    this.connectionMode = null;
    this.lastConnectionError = null;
    this.nextSessionId = 1;
    this.sleep = options.sleep || sleep;
    this.now = options.now || (() => Date.now());
  }

  getSerialOptions(options = {}) {
    return {
      SerialPortClass: options.SerialPortClass
        || this.options.SerialPortClass
        || this.sdk.options?.SerialPortClass,
      platform: options.platform || this.options.platform,
      ...this.options.serial,
      ...options.serial,
    };
  }

  async listPorts(options = {}) {
    const serialOptions = this.getSerialOptions(options);
    const scan = options.onlyLikelySensorPorts
      ? listDevicePorts(serialOptions)
      : listSerialPorts(serialOptions);
    const timeoutMs = Number(options.scanTimeoutMs || this.options.scanTimeoutMs || DEFAULT_SCAN_TIMEOUT_MS);
    const ports = await withTimeout(
      scan,
      timeoutMs,
      createSerialError('NO_PORT', { stage: 'scan', detail: `SerialPort.list timeout after ${timeoutMs}ms` }),
    );
    return ports;
  }

  async runWithConnectionLock(mode, task) {
    const now = this.now();
    const maxAgeMs = Number(
      this.options.connectionLockMaxAgeMs || DEFAULT_CONNECTION_LOCK_MAX_AGE_MS,
    );
    if (this.connectionTask && now - this.connectionTaskStartedAt < maxAgeMs) {
      throw createSerialError('CONN_BUSY');
    }

    const timeoutMs = Number(this.options.connectionTimeoutMs || DEFAULT_CONNECTION_LOCK_TIMEOUT_MS);
    const currentTask = Promise.resolve().then(task);
    this.connectionTask = currentTask;
    this.connectionTaskStartedAt = now;
    this.connectionMode = mode;
    this.lastConnectionError = null;

    let timer;
    try {
      return await Promise.race([
        currentTask,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(createSerialError('CONNECT_TIMEOUT')), timeoutMs);
        }),
      ]);
    } catch (error) {
      const normalized = normalizeSerialError(error);
      this.lastConnectionError = {
        ...serializeSerialError(normalized),
        at: this.now(),
      };
      this.emit('connectionError', this.lastConnectionError);
      throw normalized;
    } finally {
      if (timer) clearTimeout(timer);
      if (this.connectionTask === currentTask) {
        this.connectionTask = null;
        this.connectionTaskStartedAt = 0;
        this.connectionMode = null;
      }
    }
  }

  connect(options = {}) {
    const channels = normalizeManualChannels(options);
    return Object.keys(channels).length
      ? this.connectManual({ ...options, channels })
      : this.connectAuto(options);
  }

  connectManual(options = {}) {
    return this.runWithConnectionLock('manual', () => this.connectManualUnlocked(options));
  }

  async connectManualUnlocked(options = {}) {
    const channels = normalizeManualChannels(options);
    if (!Object.keys(channels).length) throw createSerialError('NO_PORT');
    this.emit('connectProgress', { stage: 'connecting', mode: 'manual', channels });

    try {
      const profile = {
        ...(typeof options.profile === 'object' ? options.profile : options.profileOverride),
      };
      if (options.baudRate) profile.baudRate = Number(options.baudRate);
      const session = await this.sdk.open({
        ...options,
        profile,
        channels,
        connectionOptions: {
          ...this.options.connectionOptions,
          ...options.connectionOptions,
        },
      });
      const sessionId = this.registerSession(session, 'manual');
      const result = this.createConnectResult([session], [], 'manual');
      result.sessionId = sessionId;
      this.emit('connectResult', result);
      return result;
    } catch (error) {
      const normalized = normalizeSerialError(error, 'OPEN_FAIL');
      this.emit('connectResult', serializeSerialError(normalized));
      throw normalized;
    }
  }

  connectAuto(options = {}) {
    return this.runWithConnectionLock('auto', () => this.connectAutoUnlocked(options));
  }

  async connectAutoUnlocked(options = {}) {
    this.emit('connectProgress', { stage: 'scanning', mode: 'auto' });
    let ports = options.ports;
    if (!ports) {
      ports = await this.listPorts({ ...options, onlyLikelySensorPorts: true });
      if (!ports.length) {
        if (options.fallbackToAllPorts === false) throw createSerialError('NO_SENSOR_PORT');
        ports = await this.listPorts({ ...options, onlyLikelySensorPorts: false });
      }
    }
    if (!Array.isArray(ports)) ports = [ports];
    ports = (ports || []).map((port) => (typeof port === 'string' ? { path: port } : port));
    if (!ports.length) throw createSerialError('NO_PORT');

    const requestedCount = Math.max(1, Number(options.maxPorts || options.portCount || ports.length));
    const selectedPorts = ports.slice(0, requestedCount);
    const detected = [];
    const failedPorts = [];
    const detectEnabled = options.detectBaudRate !== false && !options.baudRate;

    for (const portInfo of selectedPorts) {
      const path = portInfo.path || portInfo.comName;
      this.emit('connectProgress', { path, stage: 'detecting_baud' });
      try {
        const baudRate = options.baudRate || (detectEnabled
          ? await detectBaudRate(path, {
            ...this.getSerialOptions(options),
            delimiter: options.delimiter,
            baudCandidates: options.baudCandidates,
            timeoutMs: options.baudDetectTimeoutMs,
            validFrameLengths: options.validFrameLengths,
            allowUnknownFrameLength: options.allowUnknownFrameLength,
          })
          : this.sdk.registry.getProfile(options.sensorType || 'default', options.profile || {}).baudRate);
        detected.push({ portInfo, path, baudRate });
        if (detectEnabled) {
          await this.sleep(Number(options.postDetectDelayMs ?? DEFAULT_POST_DETECT_DELAY_MS));
        }
      } catch (error) {
        const normalized = normalizeSerialError(error, 'BAUD_FAIL', { path });
        failedPorts.push({ path, ...serializeSerialError(normalized) });
      }
    }

    if (!detected.length) {
      throw createSerialError(pickConnectionErrorCode(failedPorts), {
        detail: failedPorts.map((item) => `${item.path}: ${item.detail}`).join('; '),
      });
    }
    if (detectEnabled) {
      await this.sleep(Number(options.postAllDetectDelayMs ?? DEFAULT_POST_ALL_DETECT_DELAY_MS));
    }

    const groups = new Map();
    for (const item of detected) {
      const resolved = await options.resolveDevice?.({
        ...item,
        deviceClass: (options.baudDeviceMap || DEFAULT_BAUD_DEVICE_MAP)[item.baudRate] || 'unknown',
      });
      const sensorType = resolved?.sensorType || options.sensorType || 'default';
      const groupKey = `${sensorType}:${item.baudRate}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { sensorType, baudRate: item.baudRate, items: [] });
      groups.get(groupKey).items.push({ ...item, resolved });
    }

    const sessions = [];
    for (const group of groups.values()) {
      const profile = this.sdk.registry.getProfile(group.sensorType, {
        ...(typeof options.profile === 'object' ? options.profile : options.profileOverride),
        baudRate: group.baudRate,
      });
      const preferredNames = options.channelNames || profile.channels || [];
      const channels = Object.fromEntries(group.items.map((item, index) => [
        item.resolved?.channel || preferredNames[index] || `channel${index + 1}`,
        item.path,
      ]));
      this.emit('connectProgress', {
        stage: 'connecting',
        sensorType: group.sensorType,
        baudRate: group.baudRate,
        channels,
      });

      try {
        const session = await this.sdk.open({
          ...options,
          sensorType: group.sensorType,
          profile,
          channels,
          connectionOptions: {
            ...this.options.connectionOptions,
            ...options.connectionOptions,
          },
        });
        this.registerSession(session, 'auto');
        sessions.push(session);
      } catch (error) {
        const normalized = normalizeSerialError(error, 'OPEN_FAIL');
        for (const item of group.items) {
          failedPorts.push({ path: item.path, ...serializeSerialError(normalized) });
        }
      }
    }

    if (!sessions.length) {
      throw createSerialError(pickConnectionErrorCode(failedPorts), {
        detail: failedPorts.map((item) => `${item.path}: ${item.detail}`).join('; '),
      });
    }

    const result = this.createConnectResult(sessions, failedPorts, 'auto');
    this.emit('connectResult', result);
    return result;
  }

  registerSession(session, mode) {
    const sessionId = session.sessionId || `serial-${this.nextSessionId++}`;
    session.sessionId = sessionId;
    session.connectionMode = mode;
    this.sessions.set(sessionId, session);

    for (const [key, frame] of session.latestFrames || []) {
      this.latestFrames.set(`${sessionId}:${key}`, frame);
    }

    session.on('frame', (frame) => {
      const key = frame.handSide || frame.channel || frame.sensorType || sessionId;
      this.latestFrames.set(`${sessionId}:${key}`, frame);
      this.emit('frame', { sessionId, frame });
    });
    session.on('channelState', (state) => this.emit('channelState', { sessionId, ...state }));
    session.on('channelStale', (state) => this.emit('channelStale', { sessionId, ...state }));
    session.on('error', (payload) => this.emit('sessionError', { sessionId, ...payload }));
    session.on('close', () => this.emit('sessionClose', { sessionId }));
    return sessionId;
  }

  createConnectResult(sessions, failedPorts, mode) {
    const ports = sessions.flatMap((session) => Object.values(session.getState().channels).map((state) => ({
      sessionId: session.sessionId,
      sensorType: session.sensorType,
      path: state.portPath,
      channel: state.channel,
      baudRate: state.baudRate,
      status: state.status,
    })));
    return {
      success: true,
      mode,
      session: sessions.length === 1 ? sessions[0] : undefined,
      sessions,
      ports,
      failedPorts,
    };
  }

  async rescan(options = {}) {
    try {
      return await this.runWithConnectionLock('rescan', async () => {
        this.emit('rescanProgress', { stage: 'cleaning' });
        const disconnected = await this.disconnectAllUnlocked();
        await this.sleep(Number(options.cleanupDelayMs ?? 1000));
        this.emit('rescanProgress', { stage: 'reconnecting', disconnected });
        const result = await this.connectAutoUnlocked(options);
        this.emit('rescanProgress', { stage: 'done', result });
        return result;
      });
    } catch (error) {
      this.emit('rescanProgress', { stage: 'failed', error: serializeSerialError(error) });
      throw error;
    }
  }

  resolveSession(target) {
    if (target && typeof target === 'object' && typeof target.getState === 'function') return target;
    return this.sessions.get(target);
  }

  async write(target, channel, data, options = {}) {
    const session = this.resolveSession(target);
    if (!session) throw createSerialError('PORT_OFFLINE', { channel });
    return session.write(channel, data, options);
  }

  async disconnect(target) {
    const session = this.resolveSession(target);
    if (!session) return false;
    await session.close();
    this.removeSession(session);
    return true;
  }

  removeSession(session) {
    this.sessions.delete(session.sessionId);
    const prefix = `${session.sessionId}:`;
    for (const key of this.latestFrames.keys()) {
      if (key.startsWith(prefix)) this.latestFrames.delete(key);
    }
  }

  async disconnectAllUnlocked() {
    let disconnected = 0;
    let firstError = null;
    const sessions = [...this.sessions.values()];
    for (const session of sessions) {
      try {
        await session.close();
      } catch (error) {
        firstError ||= error;
      } finally {
        this.removeSession(session);
        disconnected += 1;
      }
    }
    if (firstError) throw firstError;
    return disconnected;
  }

  disconnectAll() {
    return this.disconnectAllUnlocked();
  }

  getState() {
    return {
      status: this.connectionTask ? 'connecting' : 'idle',
      connectionMode: this.connectionMode,
      lastConnectionError: this.lastConnectionError,
      sessions: Object.fromEntries(
        [...this.sessions.entries()].map(([sessionId, session]) => [sessionId, session.getState()]),
      ),
      latestFrames: Object.fromEntries(this.latestFrames),
    };
  }

  close() {
    return this.disconnectAll();
  }
}

module.exports = {
  DEFAULT_CONNECTION_LOCK_MAX_AGE_MS,
  DEFAULT_CONNECTION_LOCK_TIMEOUT_MS,
  DEFAULT_POST_ALL_DETECT_DELAY_MS,
  DEFAULT_POST_DETECT_DELAY_MS,
  DEFAULT_SCAN_TIMEOUT_MS,
  SerialManager,
  normalizeManualChannels,
  pickConnectionErrorCode,
};
