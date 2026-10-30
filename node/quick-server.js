/** Node 产品流服务：订阅已有设备，广播 WS 帧，并管理带标签录制与同端口 HTTP 下载。 */
import { createServer } from 'node:http';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { ShroomError } from '../core/errors.js';
import { encodeStreamFrame, STREAM_SCHEMA } from '../core/stream-codec.js';
import { createRecordingUrl } from '../core/recording-url.js';
import { createRecordingStore, recordingCsv, recordingJsonl, RECORDING_ID } from './recording.js';
import { assertLicense, watchLicense, getDeviceLicenseRequirement } from '../core/license.js';
import { isMockDevice } from '../core/mock.js';

/** WS/HTTP 只发送错误码与消息，不传内部堆栈和完整异常对象。 */
function publicError(error) {
  return { code: error?.code ?? 'SERVER_ERROR', message: error?.message ?? '服务操作失败。' };
}

/** 识别明确的本机回环地址，用于默认监听与来源校验。 */
function isLoopback(host) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host?.toLowerCase());
}

/** 在加载依赖、创建录制目录和订阅设备前校验配置，避免错误参数留下资源。 */
function serverOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ShroomError('INVALID_CONFIG', '服务配置必须是对象。');
  const { port = 19999, host = '127.0.0.1', recordingsDir = resolve('.shroom-recordings'), allowedOrigins,
    maxBufferedBytes = 1024 * 1024, maxQueueFrames = 1000 } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535 || typeof host !== 'string' || !host.trim()
    || typeof recordingsDir !== 'string' || !recordingsDir.trim()
    || !Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < 1024
    || !Number.isSafeInteger(maxQueueFrames) || maxQueueFrames < 1 || maxQueueFrames > 100000) {
    throw new ShroomError('INVALID_CONFIG', '检查端口、主机、录制目录和缓冲区限制。');
  }
  if (allowedOrigins !== undefined && (!Array.isArray(allowedOrigins) || allowedOrigins.some((origin) => {
    if (origin === 'null') return false;
    try { const parsed = new URL(origin); return !['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin; }
    catch { return true; }
  }))) throw new ShroomError('INVALID_CONFIG', 'allowedOrigins 必须是明确的 HTTP/HTTPS origin 列表，不能使用通配符。');
  if (!isLoopback(host) && !allowedOrigins?.length) {
    throw new ShroomError('INVALID_CONFIG', '非本机服务必须显式设置 allowedOrigins，限定允许接入的网页来源。');
  }
  return { port, host, recordingsDir, allowedOrigins, maxBufferedBytes, maxQueueFrames };
}

/**
 * 将已有设备发布为 WS 数据流，并在同一端口提供采集控制与 HTTP 文件下载。
 * device 需提供 onData 或 onFrame 订阅；options 指定端口、目录、来源和队列限制。
 * 默认只监听 127.0.0.1:19999；跨机监听必须显式配置 allowedOrigins。
 * 返回服务地址和采集方法；close() 关闭服务并写完记录，设备仍由调用方关闭。
 */
export async function serveDevice(device, options = {}) {
  const config = serverOptions(options);
  const subscribe = device?.onData ?? device?.onFrame;
  if (typeof subscribe !== 'function') throw new ShroomError('INVALID_CONFIG', 'serveDevice 需要一个提供 onData 或 onFrame 的设备。');
  const mockSource = isMockDevice(device);
  const sourceRequirement = getDeviceLicenseRequirement(device) ?? { feature: 'serial.raw' };
  let sourceLicenseError = null;
  /** 内置模拟源免许可；真实源同时要求设备读取权限和 stream 权限。 */
  function assertSourceLicense() {
    if (mockSource) return;
    if (sourceLicenseError) throw sourceLicenseError;
    assertLicense(sourceRequirement);
    assertLicense({ feature: 'stream' });
  }
  /** 录制在读取和流权限之外，还需要 recording 权限。 */
  function assertRecordingLicense() {
    assertSourceLicense();
    if (!mockSource) assertLicense({ feature: 'recording' });
  }
  assertSourceLicense();
  let WebSocketServer;
  try { ({ WebSocketServer } = await import('ws')); }
  catch (cause) { throw new ShroomError('DEPENDENCY_MISSING', 'WS 服务需要安装可选依赖：npm install ws', { cause, stage: 'serve' }); }
  let closed = false;
  let closing = null;
  let unsubscribeData;
  let unsubscribeError;
  let unsubscribeSourceLicense;
  let unsubscribeStreamLicense;
  let unsubscribeRecordingLicense;
  let pendingControl = Promise.resolve();
  const clients = new Set();
  const httpSockets = new Set();

  /** 解除数据和错误订阅，隔离自定义数据源的清理异常。 */
  function detachSource() {
    const subscriptions = [unsubscribeData, unsubscribeError];
    unsubscribeData = undefined; unsubscribeError = undefined;
    for (const unsubscribe of subscriptions) {
      try { unsubscribe?.(); } catch { /* 源的清理失败不妨碍服务继续释放自身资源。 */ }
    }
  }

  /** 优先采用显式网页来源白名单；默认仅允许 HTTP/HTTPS 的本机页面来源。 */
  function originAllowed(origin) {
    if (origin === undefined) return true; // 原生 Node 客户端通常不发送 Origin。
    if (config.allowedOrigins) return config.allowedOrigins.includes(origin);
    try { const parsed = new URL(origin); return ['http:', 'https:'].includes(parsed.protocol) && isLoopback(parsed.hostname); }
    catch { return false; }
  }

  /** 同时校验 Origin 与回环服务的 Host，防止外部域名绕过本机访问约束。 */
  function requestAllowed(request) {
    if (!originAllowed(request.headers.origin)) return false;
    if (!isLoopback(config.host)) return true;
    try { return isLoopback(new URL(`http://${request.headers.host}`).hostname); }
    catch { return false; }
  }

  /** 检查状态和待发送字节数；主动断开慢客户端，防止缓冲区无限增长。 */
  function send(client, message) {
    if (client.readyState !== 1) return;
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    if (client.bufferedAmount + Buffer.byteLength(data) > config.maxBufferedBytes) {
      client.close(1013, '客户端读取过慢，请重新连接');
      return;
    }
    client.send(data, (error) => { if (error) client.terminate(); });
  }

  /** 一次序列化后广播给所有客户端，避免为每个订阅者重复编码。 */
  function broadcast(message) {
    const encoded = JSON.stringify(message);
    for (const client of clients) send(client, encoded);
  }

  let recorder;
  try {
    recorder = await createRecordingStore({ directory: config.recordingsDir, maxQueueFrames: config.maxQueueFrames,
      onChange: (recording) => broadcast({ type: 'recording', recording }) });
  } catch (cause) {
    if (cause instanceof ShroomError) throw cause;
    throw new ShroomError('RECORDING_WRITE_FAILED', '无法打开录制目录，请检查目录权限和磁盘空间。', { cause, stage: 'recording' });
  }

  /** 设备或流授权失效时停止实时订阅并终止采集，保留历史文件下载能力。 */
  function sourceLicenseInvalid(error) {
    if (closed || sourceLicenseError) return;
    sourceLicenseError = error;
    detachSource();
    unsubscribeSourceLicense?.(); unsubscribeStreamLicense?.(); unsubscribeRecordingLicense?.();
    broadcast({ type: 'error', error: publicError(error) });
    void recorder.abort(error).catch((cause) => broadcast({ type: 'error', error: publicError(cause) }));
  }

  /** 单独失去录制权限时结束当前记录；获得独立授权的实时查看仍可继续。 */
  function recordingLicenseInvalid(error) {
    if (closed) return;
    unsubscribeRecordingLicense?.();
    unsubscribeRecordingLicense = undefined;
    broadcast({ type: 'error', error: publicError(error) });
    void recorder.abort(error).catch((cause) => broadcast({ type: 'error', error: publicError(cause) }));
  }

  /** 将 Node 和所有网页的采集控制放入同一队列，避免并发起停互相覆盖。 */
  function control(action) {
    const result = pendingControl.then(() => {
      if (closed) throw new ShroomError('SERVER_CLOSED', '服务已关闭。', { stage: 'serve' });
      return action();
    });
    pendingControl = result.catch(() => {});
    return result;
  }

  /** 校验权限并开始带标签采集，保存行为不依赖网页是否显示或保持连接。 */
  function startRecording(options) {
    return control(async () => {
      assertRecordingLicense();
      const result = await recorder.start({ ...options, product: device.info?.product, side: device.info?.side, source: device.info?.source });
      try {
        if (closed) throw new ShroomError('SERVER_CLOSED', '服务已关闭。', { stage: 'serve' });
        assertRecordingLicense();
      }
      catch (error) { await recorder.abort(error); throw error; }
      unsubscribeRecordingLicense?.();
      if (!mockSource) unsubscribeRecordingLicense = watchLicense({ feature: 'recording' }, recordingLicenseInvalid);
      return result;
    });
  }

  /** 等待缓冲帧和最终元信息写入后返回记录；不会停止设备或 WS 数据流。 */
  function stopRecording() {
    return control(async () => {
      const result = await recorder.stop();
      unsubscribeRecordingLicense?.(); unsubscribeRecordingLicense = undefined;
      return result;
    });
  }

  /** 查询历史及活动记录，只返回会话元信息，不暴露服务器文件路径。 */
  function listRecordings() { return control(() => recorder.list()); }

  /** HTTP 仅处理健康检查与按 UUID 下载；正在写入返回 409，未知记录返回 404。 */
  async function handleHttp(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Origin');
    if (!requestAllowed(request)) {
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { code: 'ORIGIN_DENIED', message: '网页来源或服务 Host 不允许。' } }));
      return;
    }
    if (request.headers.origin) response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS' }); response.end(); return;
    }
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET, OPTIONS' }); response.end(); return; }
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: !closed, schema: STREAM_SCHEMA, info: device.info ?? {}, recording: recorder.status() }));
      return;
    }
    const match = /^\/recordings\/([^/]+)\.(csv|jsonl)$/.exec(path);
    if (!match || !RECORDING_ID.test(match[1])) { response.writeHead(404); response.end(); return; }
    try {
      const recording = recorder.download(match[1]);
      await access(recording.path);
      const extension = match[2];
      response.writeHead(200, {
        'Content-Type': extension === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
        'Content-Disposition': `attachment; filename="shroom-${recording.meta.id}.${extension}"`,
        'Access-Control-Expose-Headers': 'Content-Disposition',
      });
      // 新记录从 SQLite 按页读取，旧 JSONL 仍可下载；HTTP 断开时 pipeline 会关闭导出迭代器。
      const source = Readable.from(extension === 'csv' ? recordingCsv(recording) : recordingJsonl(recording));
      await pipeline(source, response);
    } catch (error) {
      if (response.headersSent) { response.destroy(error); return; }
      const status = error.code === 'RECORDING_ACTIVE' ? 409
        : ['RECORDING_NOT_FOUND', 'ENOENT'].includes(error.code) ? 404 : 500;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: publicError(error) }));
    }
  }

  const server = createServer((request, response) => {
    void handleHttp(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  // WS 升级复用同一个 HTTP 服务；限制控制消息大小，帧广播不启用压缩。
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  server.on('connection', (socket) => { httpSockets.add(socket); socket.on('close', () => httpSockets.delete(socket)); });
  server.on('upgrade', (request, socket, head) => {
    if (closed || !requestAllowed(request) || !['/', '/ws'].includes(new URL(request.url, 'http://localhost').pathname)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  });
  wss.on('connection', (client) => {
    clients.add(client);
    let pendingRequests = 0;
    client.on('close', () => clients.delete(client));
    // ws 自行发送协议关闭码，例如输入超长使用 1009；监听 error 防止未处理异常。
    client.on('error', () => {});
    send(client, { type: 'ready', schema: STREAM_SCHEMA, info: device.info ?? {}, recording: recorder.status() });
    client.on('message', (data, binary) => {
      let request;
      try {
        if (binary) throw new ShroomError('INVALID_REQUEST', '控制消息必须是 JSON 文本。');
        request = JSON.parse(data.toString());
        if (!request || typeof request !== 'object' || Array.isArray(request)
          || !['string', 'number'].includes(typeof request.requestId) || String(request.requestId).length > 128) {
          throw new ShroomError('INVALID_REQUEST', '控制消息需要有效的 requestId。');
        }
      } catch (error) { send(client, { type: 'response', requestId: null, ok: false, error: publicError(error) }); return; }
      // requestId 原样带回响应，由客户端匹配各自等待中的 Promise。
      const actions = {
        'recording.start': () => startRecording({ label: request.label }),
        'recording.stop': stopRecording,
        'recording.status': () => Promise.resolve(recorder.status()),
        'recording.list': listRecordings,
      };
      const action = Object.hasOwn(actions, request.type) && actions[request.type];
      if (!action) { send(client, { type: 'response', requestId: request.requestId, ok: false,
        error: { code: 'INVALID_REQUEST', message: '不支持的控制消息。' } }); return; }
      if (pendingRequests >= 64) { client.close(1013, '控制请求过多，请等待当前操作完成'); return; }
      pendingRequests += 1;
      Promise.resolve().then(action).then(
        (result) => send(client, { type: 'response', requestId: request.requestId, ok: true, result }),
        (error) => send(client, { type: 'response', requestId: request.requestId, ok: false, error: publicError(error) }),
      ).finally(() => { pendingRequests -= 1; });
    });
  });

  try {
    assertSourceLicense();
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => { server.off('error', reject); done(); });
    });
    assertSourceLicense();
    // 保留设备方法的 this；同一份序列化帧同时交给录制器和实时广播。
    unsubscribeData = Reflect.apply(subscribe, device, [(frame) => {
      if (closed || sourceLicenseError) return;
      try { assertSourceLicense(); }
      catch (error) { sourceLicenseInvalid(error); return; }
      try {
        const wire = encodeStreamFrame(frame);
        assertSourceLicense();
        if (recorder.status()?.status === 'recording') {
          try { assertRecordingLicense(); recorder.append(wire); }
          catch (error) { recordingLicenseInvalid(error); }
        }
        broadcast({ type: 'frame', schema: STREAM_SCHEMA, frame: wire });
      } catch (error) {
        if (error?.stage === 'license') { sourceLicenseInvalid(error); return; }
        broadcast({ type: 'error', error: publicError(error) });
        void recorder.abort(error).catch((cause) => broadcast({ type: 'error', error: publicError(cause) }));
      }
    }]);
    if (typeof device.onError === 'function') unsubscribeError = device.onError((error) => {
      broadcast({ type: 'error', error: publicError(error) });
      if (!['CALLBACK_FAILED'].includes(error?.code) && recorder.status()?.status === 'recording') {
        void recorder.abort(error).catch((cause) => broadcast({ type: 'error', error: publicError(cause) }));
      }
    });
    if (!mockSource) {
      unsubscribeSourceLicense = watchLicense(sourceRequirement, sourceLicenseInvalid);
      unsubscribeStreamLicense = watchLicense({ feature: 'stream' }, sourceLicenseInvalid);
    }
    assertSourceLicense();
  } catch (error) {
    detachSource();
    unsubscribeSourceLicense?.(); unsubscribeStreamLicense?.(); unsubscribeRecordingLicense?.();
    for (const client of clients) client.terminate();
    wss.close();
    await recorder.close();
    if (server.listening) {
      const stopped = new Promise((done) => server.close(done));
      for (const socket of httpSockets) socket.destroy();
      await stopped;
    }
    if (error?.stage === 'license') throw error;
    throw new ShroomError(error.code ?? 'SERVER_START_FAILED', `无法启动 WS 服务：${error.message}`, { cause: error, stage: 'serve' });
  }
  const address = server.address();
  const hostForUrl = config.host.includes(':') ? `[${config.host.replace(/^\[|\]$/g, '')}]` : config.host;
  const port = address.port;
  const httpUrl = `http://${hostForUrl}:${port}`;
  // 采集进度按已提交到 SQLite 的帧数广播，与网页渲染帧数无关。
  const recordingTicker = setInterval(() => {
    const recording = recorder.status();
    if (!closed && recording?.status === 'recording') broadcast({ type: 'recording', recording });
  }, 1000);
  recordingTicker.unref();
  return {
    host: config.host, port, url: `ws://${hostForUrl}:${port}`, httpUrl,
    startRecording, stopRecording, listRecordings,
    /** 只返回指定记录的同源下载地址；默认 CSV，不检查记录存在性，也不发起下载。 */
    getRecordingUrl(id, downloadOptions = {}) { return createRecordingUrl(httpUrl, id, downloadOptions); },
    /** 直接读取本进程最近一次采集状态，不经过网络。 */
    getRecordingStatus() { return recorder.status(); },
    /** 幂等关闭：解除订阅、等待控制队列和文件写入、释放连接；不关闭调用方的设备。 */
    close() {
      if (closing) return closing;
      closed = true;
      clearInterval(recordingTicker);
      detachSource();
      unsubscribeSourceLicense?.(); unsubscribeStreamLicense?.(); unsubscribeRecordingLicense?.();
      closing = (async () => {
        await pendingControl;
        let persistenceError;
        try { await recorder.close(); } catch (error) { persistenceError = error; }
        for (const client of clients) client.terminate();
        await new Promise((done) => wss.close(done));
        const serverClosed = new Promise((done) => server.close(done));
        for (const socket of httpSockets) socket.destroy();
        await serverClosed;
        if (persistenceError) throw persistenceError;
      })();
      return closing;
    },
  };
}
