/**
 * 连接已有主项目后端的 HTTP/WebSocket 客户端，改编自 E:/ShroomSDK 的 BackendSdkClient。
 * 不直接读取串口或数据库，也不依赖 Node 专属模块；后端帧按原样交给调用方。
 * 使用主项目的通道订阅协议，与 serveDevice 的独立产品流协议不同。
 */
export const DEFAULT_HTTP_BASE_URL = 'http://127.0.0.1:19245';
export const DEFAULT_WS_URL = 'ws://127.0.0.1:19999';
/** 默认接口表；契约中的路由可覆盖默认值，调用方的 routes 优先级最高。 */
export const DEFAULT_ROUTES = Object.freeze({
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

/** 解开后端的 { code, data } 包装；非零 code 抛错，没有包装的数据按原样返回。 */
export function normalizeHttpResult(payload) {
  if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'code')) return payload;
  if (payload.code !== 0) throw new Error(payload.message || payload.error || `Backend error ${payload.code}`);
  return payload.data;
}

/** 校验后端地址协议，拒绝夹带凭据、查询参数或片段，统一去掉尾部斜线。 */
function backendUrl(value, protocols) {
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError(`Invalid backend URL: use ${protocols.join(' or ')} without credentials, query or fragment`);
  }
  return url.href.replace(/\/$/, '');
}

/** HTTP 请求与 WS 建连共用正毫秒数校验。 */
function backendTimeout(value) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError('timeoutMs must be a positive number');
  return value;
}

/** 将单通道或通道数组统一为去重列表；仅校验名称，不自动改变通道标识。 */
function backendChannels(value) {
  const channels = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(channels) || channels.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new TypeError('channels must be a string or an array of non-empty strings');
  }
  return [...new Set(channels)];
}

/**
 * 后端客户端：HTTP 负责查询/控制，WS 负责通道订阅及原始帧事件。
 * 构造时不连接网络；主动调用 request/getContract/connectRealtime 等方法才发起请求。
 */
export class BackendSdkClient {
  /** 可注入 fetch/WebSocket；headers 用于 HTTP，contract/routes 适配已有后端路由。 */
  constructor({
    httpBaseUrl = DEFAULT_HTTP_BASE_URL, wsUrl = DEFAULT_WS_URL,
    fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket,
    contract = null, routes = {}, headers = {}, timeoutMs = 10000,
  } = {}) {
    this.httpBaseUrl = backendUrl(httpBaseUrl, ['http:', 'https:']);
    this.wsUrl = backendUrl(wsUrl, ['ws:', 'wss:']);
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.timeoutMs = backendTimeout(timeoutMs);
    this.headers = headers;
    this.contract = contract;
    this.routeOverrides = { ...routes };
    this.routes = { ...DEFAULT_ROUTES, ...contract?.http?.routes, ...this.routeOverrides };
    this.ws = null;
    this.listeners = new Map();
    this.pendingChannels = [];
    this.connectionTimer = null;
  }

  // 跨浏览器事件分发器：没有 error 监听器时不会按 node:events 规则抛错。
  // 应用仍应监听 error；业务监听器自身抛出的异常不会在这里被吞掉。
  on(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('event handler must be a function');
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return this;
  }

  /** 移除指定监听器，也支持通过原处理函数移除 once 包装。 */
  off(event, handler) {
    for (const listener of this.listeners.get(event) || []) {
      if (listener === handler || listener.original === handler) this.listeners.get(event).delete(listener);
    }
    return this;
  }

  /** 只触发一次；调用用户处理函数前先移除，避免重入时重复执行。 */
  once(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('event handler must be a function');
    const once = (...args) => { this.off(event, once); handler(...args); };
    once.original = handler;
    return this.on(event, once);
  }

  /** 传事件名只清理该事件；省略参数清理所有事件监听。 */
  removeAllListeners(event) {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
    return this;
  }

  /** 基于当前监听器快照分发，回调期间增删监听不影响这一轮遍历。 */
  emit(event, ...args) {
    for (const handler of [...(this.listeners.get(event) || [])]) handler(...args);
  }

  /** 查找命名路由并编码替换 :id 等路径参数，缺少参数时立即抛错。 */
  route(name, params = {}) {
    const template = this.routes[name];
    if (typeof template !== 'string') throw new Error(`Unknown backend route: ${name}`);
    return template.replace(/:([A-Za-z_][\w]*)/g, (_, key) => {
      if (params[key] == null) throw new Error(`Missing route parameter: ${key}`);
      return encodeURIComponent(params[key]);
    });
  }

  /**
   * 请求命名路由或根相对路径；body 自动编码为 JSON，query 添加到查询串。
   * 默认返回解包后的 data；raw 为 true 时仍校验业务错误，但保留完整响应对象。
   * 支持调用方 AbortSignal 和超时，结束时清理计时器及取消监听。
   */
  async request(routeOrName, { method = 'GET', body, query = {}, raw = false,
    routeParams, headers, signal, timeoutMs = this.timeoutMs } = {}) {
    if (typeof this.fetchImpl !== 'function') throw new Error('fetch is unavailable; use Node.js 18+ or inject fetchImpl');
    const path = routeOrName.startsWith('/') ? routeOrName : this.route(routeOrName, routeParams);
    // 包括后端契约提供的路由，也必须是配置后端上的根相对路径。
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
      throw new TypeError('Backend routes must be root-relative paths');
    }
    const url = new URL(`${this.httpBaseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) if (value != null) url.searchParams.set(key, String(value));
    backendTimeout(timeoutMs);
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Backend HTTP request timed out')), timeoutMs);
    try {
      const requestHeaders = new Headers(this.headers);
      new Headers(headers).forEach((value, key) => requestHeaders.set(key, value));
      if (body !== undefined) requestHeaders.set('content-type', 'application/json');
      const response = await this.fetchImpl(url.href, {
        method, headers: requestHeaders, signal: controller.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : null; }
      catch { throw new Error(response.ok ? 'Backend returned invalid JSON' : `HTTP ${response.status}: backend returned non-JSON data`); }
      if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      const data = normalizeHttpResult(payload);
      return raw ? payload : data;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  /** 获取并缓存后端契约；refresh 强制刷新，显式 routes 配置仍保持最高优先级。 */
  async getContract({ refresh = false } = {}) {
    if (this.contract && !refresh) return this.contract;
    const contract = await this.request('sdkContract');
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) throw new Error('Invalid backend contract');
    this.contract = contract;
    this.routes = { ...DEFAULT_ROUTES, ...contract.http?.routes, ...this.routeOverrides };
    return contract;
  }

  /** 查询通道配置，保留后端完整响应格式。 */
  getChannels() { return this.request('channels', { raw: true }); }
  /** 查询后端 WS 服务状态，保留完整响应格式。 */
  getWsStatus() { return this.request('wsStatus', { raw: true }); }
  /** 列出已有展示系统，保留完整响应格式。 */
  listDisplaySystems() { return this.request('displaySystems', { raw: true }); }
  /** 按 ID 读取展示系统；ID 会经过 URL 路径编码。 */
  getDisplaySystem(id) { return this.request('displaySystemById', { raw: true, routeParams: { id } }); }
  /** 查询运行后端的电脑上的串口，不是当前网页所在电脑的串口。 */
  listSerialPorts() { return this.request('serialPorts'); }
  /** 查询指定角色的串口状态；省略 role 时交由后端决定查询范围。 */
  getSerialStatus(role) { return this.request('serialStatus', { query: { role } }); }
  /** 获取后端当前传感器类型。 */
  getCurrentSensor() { return this.request('sensorCurrent'); }
  /** 显式请求后端切换传感器类型，会改变后端配置。 */
  setSensorType(type) { return this.request('sensorType', { method: 'POST', body: { type } }); }
  /** 请求后端打开角色对应串口；兼容 port/path/portPath，优先使用 port。 */
  openSerial({ role = 'sit', port, path, portPath } = {}) {
    const selectedPort = port || path || portPath;
    if (!selectedPort) throw new TypeError('openSerial requires a port');
    return this.request('serialOpen', { method: 'POST', body: { role, port: selectedPort } });
  }
  /** 请求后端关闭指定角色的串口，默认角色为 sit。 */
  closeSerial({ role = 'sit' } = {}) { return this.request('serialClose', { method: 'POST', body: { role } }); }
  /** 调用主项目的采集接口，options 按其契约原样发送；不同于独立流的 startRecording。 */
  startCollection(options = {}) { return this.request('collectionStart', { method: 'POST', body: options }); }
  /** 请求主项目停止采集；具体返回结果由该后端定义。 */
  stopCollection() { return this.request('collectionStop', { method: 'POST', body: {} }); }

  /**
   * 建立或复用 WS，返回连接对象而非等待连接完成的 Promise。
   * channels 在连接成功后订阅；通过 open/error/close 事件观察连接结果。
   * 此操作不会自动打开后端串口，也不会自动调用 startCollection。
   */
  connectRealtime({ channels = [], timeoutMs = this.timeoutMs, protocols } = {}) {
    const requested = backendChannels(channels);
    backendTimeout(timeoutMs);
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket is unavailable; on Node.js 18/20 install ws, or inject WebSocketImpl');
    if (this.ws && this.ws.readyState <= 1) {
      if (this.ws.readyState === 1 && requested.length) this.subscribe(requested);
      else this.pendingChannels = backendChannels([...this.pendingChannels, ...requested]);
      return this.ws;
    }
    if (this.ws) this.disconnectRealtime();
    const ws = protocols === undefined ? new this.WebSocketImpl(this.wsUrl) : new this.WebSocketImpl(this.wsUrl, protocols);
    this.ws = ws;
    this.pendingChannels = requested;
    this.connectionTimer = setTimeout(() => {
      if (this.ws !== ws || ws.readyState !== 0) return;
      this.disconnectRealtime();
      this.emit('error', new Error('Backend WebSocket connection timed out'));
    }, timeoutMs);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      clearTimeout(this.connectionTimer);
      // 先完成排队订阅再通知 open，避免 open 回调主动断开后继续使用旧连接。
      if (this.pendingChannels.length) this.subscribe(this.pendingChannels);
      this.pendingChannels = [];
      this.emit('open');
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.releaseSocket(ws);
      this.emit('close', event);
    };
    ws.onerror = (event) => {
      if (this.ws !== ws) return;
      this.emit('error', event.error || new Error(event.message || 'Backend WebSocket connection failed'));
    };
    ws.onmessage = (event) => {
      if (this.ws === ws) this.handleRealtimeMessage(event.data);
    };
    return ws;
  }

  /** 解除旧连接回调与超时状态，避免迟到事件影响下一条连接。 */
  releaseSocket(ws) {
    clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
    this.pendingChannels = [];
    ws.onopen = ws.onclose = ws.onmessage = null;
    // Node 的 ws 在握手期间关闭时可能继续报错，保留空监听以完成清理。
    ws.onerror = () => {};
    if (this.ws === ws) this.ws = null;
  }

  /** 关闭本客户端的订阅连接；不向后端发送关闭串口或停止采集指令。 */
  disconnectRealtime() {
    const ws = this.ws;
    if (!ws) return;
    this.releaseSocket(ws);
    if (ws.readyState < 2) ws.close();
    this.emit('close', { code: 1000, reason: 'client disconnect', wasClean: false });
  }

  /** 仅在连接已打开时发送 JSON；连接中或已关闭时同步抛错。 */
  sendRealtime(message) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('WebSocket is not connected');
    this.ws.send(JSON.stringify(message));
  }
  /** 订阅通道；消息类型优先使用后端契约中的 SUBSCRIBE。 */
  subscribe(channels) {
    this.sendRealtime({ type: this.contract?.websocket?.messageTypes?.SUBSCRIBE || 'subscribe', channels: backendChannels(channels) });
  }
  /** 取消通道订阅，不关闭 WS，也不停止后端采集。 */
  unsubscribe(channels) {
    this.sendRealtime({ type: this.contract?.websocket?.messageTypes?.UNSUBSCRIBE || 'unsubscribe', channels: backendChannels(channels) });
  }

  /** 分发完整 message 与逐帧 frame；无法解析的文本进入 raw 事件，帧内容不做 SDK 映射。 */
  handleRealtimeMessage(rawMessage) {
    let message = rawMessage;
    if (typeof rawMessage === 'string') {
      try { message = JSON.parse(rawMessage); }
      catch { this.emit('raw', rawMessage); return; }
    }
    this.emit('message', message);
    if (Array.isArray(message?.frames)) {
      for (const frame of message.frames) this.emit('frame', frame);
    } else if (message && typeof message === 'object' &&
      ['channelId', 'portId', 'value'].some((key) => Object.hasOwn(message, key))) {
      this.emit('frame', message);
    }
  }
}
