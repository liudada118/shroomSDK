import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { BackendSdkClient, normalizeHttpResult } from '../backend/client.js';
import { BackendSdkClient as NodeClient } from '../node/index.js';
import { BackendSdkClient as WebClient } from '../web/index.js';

class FakeSocket {
  constructor(url, protocols) { this.url = url; this.protocols = protocols; this.readyState = 0; this.sent = []; }
  open() { this.readyState = 1; this.onopen?.({}); }
  send(text) { this.sent.push(JSON.parse(text)); }
  receive(data) { this.onmessage?.({ data }); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('browser and Node entries expose the client without loading serial hardware', () => {
  assert.equal(WebClient, BackendSdkClient);
  assert.ok(new NodeClient({ WebSocketImpl: FakeSocket }) instanceof BackendSdkClient);
});

test('HTTP methods preserve legacy control payloads and raw metadata responses', async () => {
  const calls = [];
  const client = new BackendSdkClient({ fetchImpl: async (url, options) => {
    calls.push({ path: new URL(url).pathname + new URL(url).search, method: options.method, body: options.body && JSON.parse(options.body) });
    return json({ code: 0, data: ['ok'] });
  } });
  assert.deepEqual(await client.listSerialPorts(), ['ok']);
  await client.getSerialStatus('left hand');
  await client.getCurrentSensor();
  await client.setSensorType('hand0205');
  await client.openSerial({ path: 'COM3' });
  await client.closeSerial();
  await client.startCollection({ name: 'manual', frequencyHz: 12 });
  await client.stopCollection();
  assert.deepEqual(await client.getChannels(), { code: 0, data: ['ok'] });
  await client.getWsStatus();
  await client.listDisplaySystems();
  await client.getDisplaySystem('hand/one');
  assert.deepEqual(calls.map((c) => c.path), ['/api/serial/ports', '/api/serial/status?role=left+hand', '/api/sensor/current', '/api/sensor/type', '/api/serial/open', '/api/serial/close', '/api/collection/start', '/api/collection/stop', '/api/channels', '/api/ws/status', '/api/display-systems', '/api/display-systems/hand%2Fone']);
  assert.deepEqual(calls.slice(3, 8).map((c) => [c.method, c.body]), [
    ['POST', { type: 'hand0205' }], ['POST', { role: 'sit', port: 'COM3' }],
    ['POST', { role: 'sit' }], ['POST', { name: 'manual', frequencyHz: 12 }], ['POST', {}],
  ]);
  assert.throws(() => client.openSerial(), /requires a port/);
});

test('contract supports raw/enveloped responses, cache, refresh and explicit route overrides', async () => {
  let count = 0;
  const contract = { contractVersion: '1', http: { routes: { serialStatus: '/new/status', serialPorts: '/new/ports' } } };
  const client = new BackendSdkClient({ routes: { serialPorts: '/custom/ports' }, fetchImpl: async () => {
    count += 1;
    return json(count === 1 ? { code: 0, data: contract } : contract);
  } });
  assert.deepEqual(await client.getContract(), contract);
  assert.deepEqual(await client.getContract(), contract);
  assert.equal(count, 1);
  await client.getContract({ refresh: true });
  assert.equal(count, 2);
  assert.equal(client.route('serialPorts'), '/custom/ports');
  assert.equal(client.route('serialStatus'), '/new/status');
});

test('HTTP failures, business errors, empty responses and malformed JSON are explicit', async () => {
  for (const [response, expected] of [
    [json({ message: 'denied' }, 403), /denied/],
    [json({ code: 5, message: 'device busy' }), /device busy/],
    [new Response('<html>', { status: 502 }), /HTTP 502/],
    [new Response('invalid'), /invalid JSON/],
  ]) {
    const client = new BackendSdkClient({ fetchImpl: async () => response });
    await assert.rejects(client.request('/status', { raw: true }), expected);
  }
  const client = new BackendSdkClient({ fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.equal(await client.stopCollection(), null);
  await assert.rejects(client.getContract(), /Invalid backend contract/);
  assert.equal(normalizeHttpResult(42), 42);
});

test('HTTP timeout and caller cancellation abort the actual fetch', async () => {
  const fetchImpl = (_, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const client = new BackendSdkClient({ fetchImpl, timeoutMs: 10 });
  await assert.rejects(client.getChannels(), /timed out/);
  const controller = new AbortController();
  const request = client.request('/status', { signal: controller.signal });
  controller.abort(new Error('cancelled by caller'));
  await assert.rejects(request, /cancelled by caller/);
  await assert.rejects(client.request('/status', { signal: controller.signal }), /cancelled by caller/);
});

test('real HTTP server receives encoded queries, headers and JSON body', async (t) => {
  const received = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ url: req.url, header: req.headers['x-test'], body: JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ code: 0, data: { ok: true } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new BackendSdkClient({ httpBaseUrl: `http://127.0.0.1:${server.address().port}/prefix/`, headers: { 'x-test': 'base' } });
  assert.deepEqual(await client.request('/command?keep=1', { method: 'POST', body: { a: 1 }, query: { label: '手套 A', absent: null }, headers: { 'x-test': 'request' } }), { ok: true });
  assert.deepEqual(received, [{ url: '/prefix/command?keep=1&label=%E6%89%8B%E5%A5%97+A', header: 'request', body: { a: 1 } }]);
});

test('configuration and route validation fail before networking', async () => {
  assert.throws(() => new BackendSdkClient({ httpBaseUrl: 'file:///tmp' }), /Invalid backend URL/);
  assert.throws(() => new BackendSdkClient({ timeoutMs: 0 }), /positive/);
  const client = new BackendSdkClient({ fetchImpl: () => { throw new Error('must not fetch'); }, routes: { unsafe: '//other.test/' } });
  assert.throws(() => client.route('missing'), /Unknown backend route/);
  assert.throws(() => client.route('displaySystemById'), /Missing route parameter/);
  await assert.rejects(client.request('unsafe'), /root-relative/);
  await assert.rejects(client.request('/\\other.test/'), /root-relative/);
});

test('WebSocket subscriptions use contract message types and deduplicate opening connections', (t) => {
  const client = new BackendSdkClient({ WebSocketImpl: FakeSocket, contract: { websocket: { messageTypes: { SUBSCRIBE: 'sub', UNSUBSCRIBE: 'unsub' } } } });
  t.after(() => client.disconnectRealtime());
  const ws = client.connectRealtime({ channels: 'sit' });
  assert.equal(client.connectRealtime({ channels: ['sit', 'back'] }), ws);
  ws.open();
  assert.deepEqual(ws.sent, [{ type: 'sub', channels: ['sit', 'back'] }]);
  client.unsubscribe('sit');
  client.connectRealtime({ channels: ['left'] });
  assert.deepEqual(ws.sent.slice(1), [{ type: 'unsub', channels: ['sit'] }, { type: 'sub', channels: ['left'] }]);
});

test('WebSocket preserves frames, batches, zero-valued frames, metadata and raw text', (t) => {
  const client = new BackendSdkClient({ WebSocketImpl: FakeSocket });
  t.after(() => client.disconnectRealtime());
  const frames = [], messages = [], raw = [];
  client.on('frame', (frame) => frames.push(frame)).on('message', (message) => messages.push(message)).on('raw', (text) => raw.push(text));
  const ws = client.connectRealtime();
  ws.open();
  ws.receive(JSON.stringify({ frames: [{ channelId: 'sit', value: [300.5], imu: [0, 0, 0, 1] }, { portId: 'back', value: [1] }] }));
  ws.receive('{"value":0}');
  ws.receive('{"type":"subscribed"}');
  ws.receive('not json');
  assert.equal(frames.length, 3);
  assert.equal(frames[0].value[0], 300.5); // No uint8 clipping, normalization or second mapping.
  assert.deepEqual(frames[0].imu, [0, 0, 0, 1]);
  assert.equal(messages.length, 3);
  assert.deepEqual(raw, ['not json']);
});

test('disconnect clears opening timers and ignores stale socket events after reconnect', async () => {
  const client = new BackendSdkClient({ WebSocketImpl: FakeSocket, timeoutMs: 10 });
  const frames = [], errors = [];
  client.on('frame', (f) => frames.push(f)).on('error', (e) => errors.push(e));
  const old = client.connectRealtime();
  const staleMessage = old.onmessage, staleClose = old.onclose;
  client.disconnectRealtime();
  const current = client.connectRealtime();
  current.open();
  staleMessage({ data: '{"value":1}' });
  staleClose({});
  assert.equal(client.ws, current);
  client.disconnectRealtime();
  client.disconnectRealtime();
  await sleep(20);
  assert.equal(client.ws, null);
  assert.deepEqual(frames, []);
  assert.deepEqual(errors, []);
  assert.throws(() => client.subscribe('sit'), /not connected/);
});

test('failed opening times out, reports error and allows retry', async () => {
  const client = new BackendSdkClient({ WebSocketImpl: FakeSocket, timeoutMs: 5 });
  const errors = [];
  client.on('error', (error) => errors.push(error.message));
  client.connectRealtime();
  await sleep(20);
  assert.equal(client.ws, null);
  assert.match(errors[0], /timed out/);
  const ws = client.connectRealtime();
  ws.open();
  ws.close();
  assert.equal(client.ws, null);
});

test('event once/off/removal, safe error event and validation', () => {
  const client = new BackendSdkClient({ WebSocketImpl: FakeSocket });
  let count = 0;
  const handler = () => count++;
  client.once('open', handler).off('open', handler);
  client.emit('open');
  client.once('open', handler);
  client.emit('open'); client.emit('open');
  assert.equal(count, 1);
  client.on('open', handler).removeAllListeners('open').emit('open');
  client.emit('error', new Error('no listener'));
  assert.throws(() => client.connectRealtime({ channels: [null] }), /channels/);
  assert.throws(() => new BackendSdkClient({ WebSocketImpl: null }).connectRealtime(), /WebSocket is unavailable/);
});

test('real WebSocket server interoperates with native and Node ws clients', async (t) => {
  let Ws, WebSocketServer;
  try { ({ default: Ws, WebSocketServer } = await import('ws')); }
  catch { t.skip('install optional ws to run the local WebSocket server test'); return; }
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(() => { for (const socket of server.clients) socket.terminate(); server.close(); });
  server.on('connection', (socket) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'subscribe') {
        socket.send(JSON.stringify({ frames: [{ channelId: message.channels[0], value: [1.5, 256], timestamp: 123 }] }));
      }
    });
  });
  for (const WebSocketImpl of [Ws, globalThis.WebSocket].filter(Boolean)) {
    const client = new NodeClient({ WebSocketImpl, wsUrl: `ws://127.0.0.1:${server.address().port}` });
    let timer;
    try {
      const frame = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('missing real WebSocket frame')), 3000);
        client.once('frame', resolve).once('error', reject);
      });
      client.connectRealtime({ channels: ['sit'] });
      assert.deepEqual(await frame, { channelId: 'sit', value: [1.5, 256], timestamp: 123 });
    } finally { clearTimeout(timer); client.disconnectRealtime(); }
  }
});

test('Node entry falls back to ws when a global WebSocket is unavailable', async (t) => {
  let Ws;
  try { ({ default: Ws } = await import('ws')); }
  catch { t.skip('optional ws is not installed'); return; }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  try {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: undefined });
    assert.equal(new NodeClient().WebSocketImpl, Ws);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'WebSocket', descriptor);
    else delete globalThis.WebSocket;
  }
});

test('classic browser bundle exposes the backend client without require or Node globals', async () => {
  const source = await readFile(new URL('../web/shroom.bundle.js', import.meta.url), 'utf8');
  const browser = { URL, Headers, AbortController, setTimeout, clearTimeout, console };
  runInNewContext(source, browser);
  assert.equal(typeof browser.Shroom.BackendSdkClient, 'function');
  const client = new browser.Shroom.BackendSdkClient({ WebSocketImpl: FakeSocket });
  const frames = [];
  client.on('frame', (frame) => frames.push(frame));
  const socket = client.connectRealtime({ channels: ['sit'] });
  socket.open();
  socket.receive('{"channelId":"sit","value":[1,2]}');
  assert.equal(frames[0].channelId, 'sit');
  client.disconnectRealtime();
});
