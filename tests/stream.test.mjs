import test from 'node:test';
import assert from 'node:assert/strict';
import { connectStream } from '../web/stream.js';
import { decodeGlovePacket } from '../core/glove.js';
import { encodeStreamFrame, STREAM_SCHEMA } from '../core/stream-codec.js';

const recordingId = '12345678-1234-4234-8234-123456789abc';

/** 为每个测试创建可主动发送消息的浏览器 WebSocket 替身。 */
function socketFixture() {
  class Socket extends EventTarget {
    static instances = [];
    constructor(url) { super(); this.url = url; this.sent = []; this.closed = false; this.readyState = 0; Socket.instances.push(this); }
    send(message) { this.sent.push(JSON.parse(message)); this.onSend?.(this.sent.at(-1)); }
    close() { this.closed = true; this.readyState = 3; this.dispatchEvent(new Event('close')); }
    message(value) { this.dispatchEvent(new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
    ready() { this.readyState = 1; this.message({ type: 'ready', schema: STREAM_SCHEMA, info: { product: 'handGloveFullPacket', side: 'left' }, recording: null }); }
    respond(result, ok = true) { this.message({ type: 'response', requestId: this.sent.at(-1).requestId, ok, ...(ok ? { result } : { error: result }) }); }
  }
  return Socket;
}

/** 完成握手，测试不涉及真实端口、设备或文件服务。 */
async function connected(t, options = {}) {
  const Socket = socketFixture();
  const errors = [];
  const pending = connectStream({ WebSocketImpl: Socket, onError: (error) => errors.push(error), ...options });
  const socket = Socket.instances[0];
  socket.ready();
  const client = await pending;
  t.after(() => client.close());
  return { socket, client, errors };
}

test('stream validates options before constructing a socket', async () => {
  const Socket = socketFixture();
  for (const options of [null, false, [], { port: 0 }, { port: 65536 }, { port: 1.5 }, { port: true }, { port: ' 20' },
    { host: 'localhost/path' }, { host: '' }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { onData: 3 }, { onError: true },
    { url: 'http://localhost:19999' }, { url: 'ws://user:secret@localhost:19999' }, { url: 'ws://localhost:19999/#secret' }]) {
    await assert.rejects(connectStream(options && !Array.isArray(options) && typeof options === 'object'
      ? { ...options, WebSocketImpl: Socket } : options), { code: 'INVALID_CONFIG' });
  }
  assert.equal(Socket.instances.length, 0);
});

test('stream waits for ready and delivers the first immediate frame through onData', async (t) => {
  const Socket = socketFixture();
  const frames = [];
  const pending = connectStream({ WebSocketImpl: Socket, port: '19999', onData: (frame) => frames.push(frame) });
  const socket = Socket.instances[0];
  const original = decodeGlovePacket(Uint8Array.from({ length: 274 }, (_, i) => i % 256), { side: 'left' });
  socket.ready();
  socket.message({ type: 'frame', schema: STREAM_SCHEMA, frame: encodeStreamFrame(original) });
  const client = await pending;
  t.after(() => client.close());
  assert.equal(client.state, 'open');
  assert.equal(client.info.side, 'left');
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], original);
  assert.ok(frames[0].fingers.thumb.raw instanceof Uint8Array);
  assert.ok(frames[0].palm.values instanceof Float32Array);
});

test('stream isolates data and recording callback failures and survives malformed messages', async (t) => {
  const { socket, client, errors } = await connected(t);
  let received = 0;
  client.onData(() => { throw new Error('application failure'); });
  const off = client.onFrame(() => { received += 1; });
  client.onRecording(() => { throw new Error('recording callback failure'); });
  let status;
  client.onRecording((value) => { status = value; });
  socket.message('{bad-json');
  socket.message({ type: 'frame', schema: 'old', frame: {} });
  socket.message({ type: 'frame', schema: STREAM_SCHEMA, frame: {} });
  const frame = decodeGlovePacket(new Uint8Array(274), { side: 'left' });
  socket.message({ type: 'frame', schema: STREAM_SCHEMA, frame: encodeStreamFrame(frame) });
  socket.message({ type: 'recording', recording: { id: recordingId, status: 'recording' } });
  off();
  socket.message({ type: 'frame', schema: STREAM_SCHEMA, frame: encodeStreamFrame(frame) });
  assert.equal(received, 1);
  assert.equal(status.id, recordingId);
  assert.ok(errors.filter((error) => error.code === 'PARSE_FAILED').length >= 3);
  assert.ok(errors.some((error) => error.code === 'CALLBACK_FAILED'));
  assert.equal(client.state, 'open');
});

test('recording control correlates requests, trims labels, returns files and updates status', async (t) => {
  const { socket, client } = await connected(t);
  for (const options of [null, false, []]) await assert.rejects(client.startRecording(options), { code: 'INVALID_CONFIG' });
  for (const label of ['', '   ', false, 'a'.repeat(201)]) await assert.rejects(client.startRecording({ label }), { code: 'INVALID_CONFIG' });
  const start = client.startRecording({ label: ' 握拳 ' });
  assert.equal(socket.sent.at(-1).type, 'recording.start');
  assert.equal(socket.sent.at(-1).label, '握拳');
  socket.respond({ id: recordingId, label: '握拳', status: 'recording', frameCount: 0 });
  assert.equal((await start).status, 'recording');
  const stop = client.stopRecording();
  socket.respond({ id: recordingId, label: '握拳', status: 'stopped', frameCount: 3 });
  assert.equal((await stop).frameCount, 3);
  const list = client.listRecordings(); socket.respond([{ id: recordingId }]);
  assert.deepEqual(await list, [{ id: recordingId }]);
  assert.equal(client.recording.status, 'stopped');
  const query = client.getRecordingStatus(); socket.respond(null);
  assert.equal(await query, null);
  assert.equal(client.recording, null);
});

test('server request errors and unknown response IDs do not destroy the stream', async (t) => {
  const { socket, client } = await connected(t);
  const pending = client.startRecording({ label: '握拳' });
  socket.message({ type: 'response', requestId: 'unrelated', ok: true, result: null });
  socket.respond({ code: 'RECORDING_ACTIVE', message: '已有正在进行的采集' }, false);
  await assert.rejects(pending, { code: 'RECORDING_ACTIVE', message: '已有正在进行的采集' });
  assert.equal(client.state, 'open');
});

test('closing rejects in-flight requests and never pretends to stop backend recording', async (t) => {
  const { socket, client } = await connected(t);
  socket.message({ type: 'recording', recording: { id: recordingId, status: 'recording' } });
  const pending = client.getRecordingStatus();
  const rejected = assert.rejects(pending, { code: 'DISCONNECTED' });
  await client.close();
  await rejected;
  assert.equal(client.recording.status, 'recording');
  assert.equal(socket.sent.some((message) => message.type === 'recording.stop'), false);
  assert.equal(client.state, 'closed');
  await assert.rejects(client.listRecordings(), { code: 'DISCONNECTED' });
});

test('disconnect rejects pending requests, removes socket listeners and reports state', async (t) => {
  const { socket, client, errors } = await connected(t);
  const pending = client.stopRecording();
  const rejected = assert.rejects(pending, { code: 'DISCONNECTED' });
  socket.dispatchEvent(new Event('close'));
  await rejected;
  assert.equal(client.state, 'closed');
  assert.equal(errors.at(-1).code, 'DISCONNECTED');
  socket.message({ type: 'recording', recording: { status: 'stopped' } });
  assert.equal(client.recording, null);
});

test('request timeout allows status re-query without blindly retrying start', async (t) => {
  const { socket, client } = await connected(t, { timeoutMs: 15 });
  await assert.rejects(client.startRecording({ label: '握拳' }), { code: 'REQUEST_TIMEOUT' });
  const pending = client.getRecordingStatus(); socket.respond({ status: 'recording' });
  assert.equal((await pending).status, 'recording');
  assert.equal(socket.sent.filter((message) => message.type === 'recording.start').length, 1);
});

test('handshake timeout, early close and protocol mismatch reject connection', async () => {
  let Socket = socketFixture();
  await assert.rejects(connectStream({ WebSocketImpl: Socket, timeoutMs: 10, onError() {} }), { code: 'CONNECTION_FAILED' });
  assert.equal(Socket.instances[0].closed, true);
  Socket = socketFixture();
  let pending = connectStream({ WebSocketImpl: Socket, onError() {} });
  Socket.instances[0].dispatchEvent(new Event('close'));
  await assert.rejects(pending, { code: 'DISCONNECTED' });
  Socket = socketFixture();
  pending = connectStream({ WebSocketImpl: Socket, onError() {} });
  Socket.instances[0].message({ type: 'ready', schema: 'old', info: {} });
  await assert.rejects(pending, { code: 'PARSE_FAILED' });
});

test('recording download URL follows secure scheme, service port and validates IDs', async (t) => {
  const { client } = await connected(t, { url: 'wss://localhost:20999/live?mode=frames' });
  assert.equal(client.getRecordingUrl(recordingId), `https://localhost:20999/recordings/${recordingId}.csv`);
  assert.equal(client.getRecordingUrl(recordingId, { format: 'jsonl' }), `https://localhost:20999/recordings/${recordingId}.jsonl`);
  for (const id of ['../secret', '', false, 'a.csv']) assert.throws(() => client.getRecordingUrl(id), { code: 'INVALID_CONFIG' });
  assert.throws(() => client.getRecordingUrl(recordingId, { format: 'html' }), { code: 'INVALID_CONFIG' });
});

test('download uses a navigation anchor without allocating Blob or reading the file', async (t) => {
  const { client } = await connected(t);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let clicked = 0;
  let removed = 0;
  const anchor = { click() { clicked += 1; }, remove() { removed += 1; } };
  globalThis.document = { body: { appendChild(value) { assert.equal(value, anchor); } }, createElement(tag) { assert.equal(tag, 'a'); return anchor; } };
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document; });
  assert.equal(client.downloadRecording(recordingId), `http://127.0.0.1:19999/recordings/${recordingId}.csv`);
  assert.equal(clicked, 1);
  assert.equal(removed, 1);
  assert.equal(anchor.referrerPolicy, 'no-referrer');
});

test('download requires an explicit recording ID before touching the browser', async (t) => {
  const { client } = await connected(t);
  for (const id of [undefined, null, '', '握拳', 19999, 'handGloveFullPacket', {}, []]) {
    assert.throws(() => client.downloadRecording(id), { code: 'INVALID_CONFIG' });
  }
  assert.throws(() => client.getRecordingUrl(), { code: 'INVALID_CONFIG' });
});
