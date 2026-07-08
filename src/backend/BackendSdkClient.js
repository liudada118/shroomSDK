const { EventEmitter } = require('events');

const DEFAULT_HTTP_BASE_URL = 'http://127.0.0.1:19245';
const DEFAULT_WS_URL = 'ws://127.0.0.1:19999';

const DEFAULT_ROUTES = Object.freeze({
  channels: '/api/channels',
  wsStatus: '/api/ws/status',
  sdkContract: '/api/sdk/contract',
  displaySystems: '/api/display-systems',
  displaySystemById: '/api/display-systems/:id',
  serialPorts: '/api/serial/ports',
  serialStatus: '/api/serial/status',
  serialOpen: '/api/serial/open',
  serialClose: '/api/serial/close',
  sensorCurrent: '/api/sensor/current',
  sensorType: '/api/sensor/type',
  collectionStart: '/api/collection/start',
  collectionStop: '/api/collection/stop',
});

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function encodeQuery(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value != null) params.set(key, value);
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

function createDefaultWebSocket() {
  if (typeof WebSocket !== 'undefined') return WebSocket;
  try {
    return require('ws');
  } catch {
    return null;
  }
}

function normalizeHttpResult(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!Object.prototype.hasOwnProperty.call(payload, 'code')) return payload;
  if (payload.code !== 0) {
    throw new Error(payload.message || 'backend request failed');
  }
  return payload.data;
}

class BackendSdkClient extends EventEmitter {
  constructor({
    httpBaseUrl = DEFAULT_HTTP_BASE_URL,
    wsUrl = DEFAULT_WS_URL,
    fetchImpl = globalThis.fetch,
    WebSocketImpl = createDefaultWebSocket(),
    contract = null,
    routes = {},
  } = {}) {
    super();
    this.httpBaseUrl = trimTrailingSlash(httpBaseUrl);
    this.wsUrl = wsUrl;
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.contract = contract;
    this.routes = {
      ...DEFAULT_ROUTES,
      ...(contract?.http?.routes || {}),
      ...routes,
    };
    this.ws = null;
  }

  route(name, params = {}) {
    const template = this.routes[name] || DEFAULT_ROUTES[name];
    if (!template) throw new Error(`unknown route: ${name}`);
    return Object.entries(params).reduce(
      (route, [key, value]) => route.replace(`:${key}`, encodeURIComponent(value)),
      template,
    );
  }

  async request(routeOrName, {
    method = 'GET',
    body,
    query,
    raw = false,
    routeParams,
  } = {}) {
    if (!this.fetchImpl) throw new Error('fetch implementation is not available');
    const path = routeOrName.startsWith('/')
      ? routeOrName
      : this.route(routeOrName, routeParams);
    const response = await this.fetchImpl(`${this.httpBaseUrl}${path}${encodeQuery(query)}`, {
      method,
      headers: body == null ? undefined : { 'content-type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    }
    return raw ? payload : normalizeHttpResult(payload);
  }

  async getContract({ refresh = false } = {}) {
    if (this.contract && !refresh) return this.contract;
    const contract = await this.request('sdkContract', { raw: true });
    this.contract = contract;
    this.routes = {
      ...DEFAULT_ROUTES,
      ...(contract?.http?.routes || {}),
    };
    return contract;
  }

  getChannels() {
    return this.request('channels', { raw: true });
  }

  getWsStatus() {
    return this.request('wsStatus', { raw: true });
  }

  listDisplaySystems() {
    return this.request('displaySystems', { raw: true });
  }

  getDisplaySystem(id) {
    return this.request('displaySystemById', {
      raw: true,
      routeParams: { id },
    });
  }

  listSerialPorts() {
    return this.request('serialPorts');
  }

  getSerialStatus(role) {
    return this.request('serialStatus', { query: { role } });
  }

  getCurrentSensor() {
    return this.request('sensorCurrent');
  }

  setSensorType(type) {
    return this.request('sensorType', {
      method: 'POST',
      body: { type },
    });
  }

  openSerial({ role = 'sit', port, path, portPath } = {}) {
    return this.request('serialOpen', {
      method: 'POST',
      body: { role, port: port || path || portPath },
    });
  }

  closeSerial({ role = 'sit' } = {}) {
    return this.request('serialClose', {
      method: 'POST',
      body: { role },
    });
  }

  startCollection(options = {}) {
    return this.request('collectionStart', {
      method: 'POST',
      body: options,
    });
  }

  stopCollection() {
    return this.request('collectionStop', {
      method: 'POST',
      body: {},
    });
  }

  connectRealtime({ channels = [] } = {}) {
    if (!this.WebSocketImpl) throw new Error('WebSocket implementation is not available');
    if (this.ws && this.ws.readyState <= 1) return this.ws;

    const ws = new this.WebSocketImpl(this.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      this.emit('open');
      if (channels.length) this.subscribe(channels);
    };
    ws.onclose = (event) => this.emit('close', event);
    ws.onerror = (event) => this.emit('error', event);
    ws.onmessage = (event) => this.handleRealtimeMessage(event.data);
    return ws;
  }

  disconnectRealtime() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendRealtime(message) {
    if (!this.ws || this.ws.readyState !== 1) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  subscribe(channels) {
    const type = this.contract?.websocket?.messageTypes?.SUBSCRIBE || 'subscribe';
    this.sendRealtime({
      type,
      channels: Array.isArray(channels) ? channels : [channels],
    });
  }

  unsubscribe(channels) {
    const type = this.contract?.websocket?.messageTypes?.UNSUBSCRIBE || 'unsubscribe';
    this.sendRealtime({
      type,
      channels: Array.isArray(channels) ? channels : [channels],
    });
  }

  handleRealtimeMessage(rawMessage) {
    let message = rawMessage;
    if (typeof rawMessage === 'string') {
      try {
        message = JSON.parse(rawMessage);
      } catch {
        this.emit('raw', rawMessage);
        return;
      }
    }

    this.emit('message', message);
    if (Array.isArray(message?.frames)) {
      message.frames.forEach((frame) => this.emit('frame', frame));
    } else if (message?.channelId || message?.portId || message?.value) {
      this.emit('frame', message);
    }
  }
}

module.exports = {
  BackendSdkClient,
  DEFAULT_HTTP_BASE_URL,
  DEFAULT_ROUTES,
  DEFAULT_WS_URL,
  normalizeHttpResult,
};
