import test from 'node:test';
import { beforeEach } from 'node:test';
import { activateTestLicense } from './license-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { get } from 'node:http';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { serveDevice } from '../node/quick-server.js';
import { createFrameHub } from '../core/device.js';
import { decodeGlovePacket } from '../core/glove.js';

beforeEach(() => activateTestLicense());

/** Build an explicit product source whose frames and failures tests can deliver deterministically. */
function fixture() {
  const hub = createFrameHub();
  let deviceClosed = false;
  return { info: { product: 'handGloveFullPacket', side: 'left', source: 'test' },
    onData: hub.onFrame, onError: hub.onError, emit: hub.emit, emitError: hub.emitError,
    get listenerCount() { return hub.count; }, get deviceClosed() { return deviceClosed; },
    async close() { deviceClosed = true; hub.clear(); } };
}

/** Produce one valid full-packet glove frame with recognizable scan-order bytes. */
function frame(sequence = 3) {
  const packet = new Uint8Array(274);
  packet[0] = sequence;
  packet.set(Uint8Array.from({ length: 256 }, (_, index) => index), 2);
  return decodeGlovePacket(packet, { side: 'left' });
}

/** Own test-specific files and sockets and clean up even after assertions fail. */
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'shroom-quick-'));
  const device = fixture();
  let relay = await serveDevice(device, { port: 0, recordingsDir: directory, ...options });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await relay.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { device, directory, get relay() { return relay; },
    async restart() { await relay.close(); relay = await serveDevice(device, { port: 0, recordingsDir: directory, ...options }); },
    async connect(origin = 'http://localhost:5178') {
      const socket = new WebSocket(relay.url, origin === undefined ? {} : { origin });
      sockets.push(socket);
      const messages = [];
      const waiters = [];
      socket.on('message', (data) => {
        const value = JSON.parse(data.toString());
        const index = waiters.findIndex((waiter) => waiter.test(value));
        if (index >= 0) { const [waiter] = waiters.splice(index, 1); waiter.resolve(value); }
        else messages.push(value);
      });
      await once(socket, 'open');
      /** Wait for a matching WS message without dropping other response/broadcast messages. */
      async function message(predicate) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        return Promise.race([new Promise((resolve) => waiters.push({ test: predicate, resolve })),
          new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('WS message timeout')), 3000); timer.unref(); })]);
      }
      await message((data) => data.type === 'ready');
      return { socket, message,
        async request(type, options = {}) {
          const requestId = `${Math.random()}`;
          socket.send(JSON.stringify({ type, requestId, ...options }));
          return message((data) => data.type === 'response' && data.requestId === requestId);
        } };
    } };
}

test('WS relay preserves anatomy and starts/stops labelled persistent sessions with HTTP downloads', async (t) => {
  const context = await setup(t);
  const client = await context.connect();
  assert.equal(context.device.listenerCount, 1);
  const started = await client.request('recording.start', { label: '握拳 "标签",中文' });
  assert.equal(started.ok, true);
  assert.equal(started.result.frameCount, 0);
  context.device.emit(frame());
  context.device.emit(frame(4));
  const wire = await client.message((data) => data.type === 'frame');
  assert.equal(wire.schema, 'shroom.frame.v1');
  assert.deepEqual(wire.frame.fingers.index.pulp.raw, [212]);
  const activeDownload = await fetch(`${context.relay.httpUrl}/recordings/${started.result.id}.csv`);
  assert.equal(activeDownload.status, 409);
  const stopped = await client.request('recording.stop');
  assert.equal(stopped.ok, true);
  assert.equal(stopped.result.status, 'stopped');
  assert.equal(stopped.result.frameCount, 2);
  assert.ok(stopped.result.endedAt >= stopped.result.startedAt);
  const header = await readFile(join(context.directory, 'recordings.sqlite'));
  assert.equal(header.subarray(0, 16).toString(), 'SQLite format 3\0', '新采集实际持久化为 SQLite');
  const disk = await fetch(`${context.relay.httpUrl}/recordings/${started.result.id}.jsonl`).then(response => response.text());
  const rows = disk.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, '握拳 "标签",中文');
  assert.equal(rows[1].index, 1);
  assert.equal(rows[1].frame.sequence, 4);
  const csvResponse = await fetch(`${context.relay.httpUrl}/recordings/${started.result.id}.csv`, { headers: { Origin: 'http://localhost:5178' } });
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get('content-disposition'), /attachment; filename="shroom-/);
  assert.equal(csvResponse.headers.get('access-control-allow-origin'), 'http://localhost:5178');
  const csv = await csvResponse.text();
  assert.match(csv, /握拳 ""标签"",中文/);
  assert.match(csv, /"fingers","palm","frame"/);
  const jsonlResponse = await fetch(`${context.relay.httpUrl}/recordings/${started.result.id}.jsonl`);
  assert.equal(await jsonlResponse.text(), disk);
  const list = await client.request('recording.list');
  assert.equal(list.result.length, 1);
  assert.equal(list.result[0].id, started.result.id);
  await context.restart();
  assert.equal((await context.relay.listRecordings())[0].frameCount, 2);
  assert.equal((await fetch(`${context.relay.httpUrl}/recordings/${started.result.id}.jsonl`)).status, 200);
});

test('download selects only the exact recording ID, never the latest session or matching label', async (t) => {
  const context = await setup(t);
  const sessions = [];
  for (const sequence of [21, 42]) {
    await context.relay.startRecording({ label: '同一个标签' });
    context.device.emit(frame(sequence));
    sessions.push(await context.relay.stopRecording());
  }
  assert.notEqual(sessions[0].id, sessions[1].id);
  for (const [index, session] of sessions.entries()) {
    const response = await fetch(`${context.relay.httpUrl}/recordings/${session.id}.jsonl`);
    assert.equal(response.status, 200);
    const row = JSON.parse((await response.text()).trim());
    assert.equal(row.sessionId, session.id);
    assert.equal(row.frame.sequence, index === 0 ? 21 : 42);
  }
  for (const id of ['', 'latest', '同一个标签', '00000000-0000-4000-8000-000000000000']) {
    const response = await fetch(`${context.relay.httpUrl}/recordings/${encodeURIComponent(id)}.csv`);
    assert.equal(response.status, 404);
  }
});

test('recording keeps running when a viewer disconnects; close flushes and does not own the device', async (t) => {
  const context = await setup(t);
  const client = await context.connect();
  await context.relay.startRecording({ label: '按压' });
  client.socket.close();
  await once(client.socket, 'close');
  context.device.emit(frame());
  await context.relay.close();
  const result = context.relay.getRecordingStatus();
  assert.equal(result.status, 'stopped');
  assert.equal(result.frameCount, 1);
  assert.equal(context.device.listenerCount, 0);
  assert.equal(context.device.deviceClosed, false);
  await assert.rejects(context.relay.startRecording({ label: 'new' }), { code: 'SERVER_CLOSED' });
  await context.restart();
  const lines = await fetch(`${context.relay.httpUrl}/recordings/${result.id}.jsonl`).then(response => response.text());
  assert.equal(lines.trim().split('\n').length, 1);
});

test('bounded disk queues fail explicitly and preserve accepted frames; source errors are not successful stops', async (t) => {
  const context = await setup(t, { maxQueueFrames: 1 });
  await context.relay.startRecording({ label: 'overflow' });
  context.device.emit(frame(1));
  context.device.emit(frame(2));
  const result = await context.relay.stopRecording();
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'RECORDING_OVERFLOW');
  assert.equal(result.frameCount, 1);
  await context.relay.startRecording({ label: 'disconnect' });
  context.device.emit(frame());
  context.device.emitError({ code: 'DISCONNECTED', message: '设备已断开' });
  const failed = await context.relay.stopRecording();
  assert.equal(failed.status, 'error');
  assert.equal(failed.error.code, 'DISCONNECTED');
  assert.equal(failed.frameCount, 1);
});

test('origin/Host restrictions reject remote pages, file origins and path traversal', async (t) => {
  const context = await setup(t);
  for (const origin of ['https://evil.example', 'null']) {
    const response = await fetch(`${context.relay.httpUrl}/health`, { headers: { Origin: origin } });
    assert.equal(response.status, 403);
    const socket = new WebSocket(context.relay.url, { origin });
    socket.on('error', () => {});
    const [request, upgrade] = await once(socket, 'unexpected-response');
    assert.equal(upgrade.statusCode, 403);
    request.destroy(); socket.terminate();
  }
  const hostStatus = await new Promise((resolve, reject) => {
    get(`${context.relay.httpUrl}/health`, { headers: { Host: 'evil.example' } }, (response) => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  for (const path of ['/recordings/../../package.json', '/recordings/%2e%2e%2fpackage.json.csv', '/recordings/not-a-uuid.csv']) {
    assert.equal((await fetch(`${context.relay.httpUrl}${path}`)).status, 404);
  }
  assert.equal((await fetch(`${context.relay.httpUrl}/health`)).status, 200);
});

test('labels, concurrent sessions, JSON controls and formula-safe CSV are validated', async (t) => {
  const context = await setup(t);
  const client = await context.connect();
  for (const label of ['', '  ', 'x\ny', 'x'.repeat(201)]) {
    assert.equal((await client.request('recording.start', { label })).error.code, 'INVALID_CONFIG');
  }
  await assert.rejects(context.relay.stopRecording(), { code: 'RECORDING_NOT_ACTIVE' });
  const started = await context.relay.startRecording({ label: '=HYPERLINK("bad")' });
  await assert.rejects(context.relay.startRecording({ label: 'another' }), { code: 'RECORDING_ACTIVE' });
  context.device.emit(frame());
  await context.relay.stopRecording();
  const csv = await (await fetch(`${context.relay.httpUrl}/recordings/${started.id}.csv`)).text();
  assert.match(csv, /'\=HYPERLINK\(""bad""\)/);
  assert.equal((await client.request('not-a-command')).error.code, 'INVALID_REQUEST');
  client.socket.send('{bad');
  assert.equal((await client.message((data) => data.type === 'response' && data.requestId === null)).ok, false);
});

test('server validates exposure and numeric limits before any side effects', async () => {
  const device = fixture();
  for (const options of [{ port: -1 }, { port: 65536 }, { host: '0.0.0.0' }, { maxQueueFrames: 0 },
    { maxBufferedBytes: 1 }, { allowedOrigins: ['*'] }, { allowedOrigins: ['https://example.com/path'] }]) {
    await assert.rejects(serveDevice(device, options), { code: 'INVALID_CONFIG' });
  }
  await assert.rejects(serveDevice({}, { port: 0 }), { code: 'INVALID_CONFIG' });
});

test('explicit origins, slow-viewer buffering and maximum inbound WS sizes are enforced', async (t) => {
  const context = await setup(t, { allowedOrigins: ['https://trusted.example'], maxBufferedBytes: 1024 });
  assert.equal((await fetch(`${context.relay.httpUrl}/health`, { headers: { Origin: 'http://localhost:5178' } })).status, 403);
  const viewer = await context.connect('https://trusted.example');
  const closed = once(viewer.socket, 'close');
  context.device.emit(frame());
  const [code] = await closed;
  assert.equal(code, 1013);
  const large = await context.connect('https://trusted.example');
  const largeClosed = once(large.socket, 'close');
  large.socket.send('x'.repeat(64 * 1024 + 1));
  assert.equal((await largeClosed)[0], 1009);
});

test('recording controls are serialized across callers and labels remain immutable', async (t) => {
  const context = await setup(t);
  const [first, second] = await Promise.allSettled([
    context.relay.startRecording({ label: '  first  ' }), context.relay.startRecording({ label: 'second' }),
  ]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(first.value.label, 'first');
  assert.equal(second.status, 'rejected');
  assert.equal(second.reason.code, 'RECORDING_ACTIVE');
  context.device.emit(frame());
  const [stopped, next] = await Promise.all([context.relay.stopRecording(), context.relay.startRecording({ label: 'second' })]);
  assert.equal(stopped.label, 'first');
  assert.equal(stopped.frameCount, 1);
  assert.notEqual(next.id, stopped.id);
  assert.equal(context.relay.getRecordingStatus().label, 'second');
});

test('restart marks an unclean previous recording as incomplete rather than successful', async (t) => {
  const context = await setup(t);
  const id = '12345678-1234-4234-8234-123456789abc';
  await writeFile(join(context.directory, `${id}.meta.json`), JSON.stringify({ id, label: 'unclean', status: 'recording',
    startedAt: 1, endedAt: null, frameCount: 0 }), 'utf8');
  await writeFile(join(context.directory, `${id}.jsonl`), '', 'utf8');
  await context.restart();
  const session = (await context.relay.listRecordings())[0];
  assert.equal(session.status, 'error');
  assert.equal(session.error.code, 'RECORDING_INTERRUPTED');
  assert.equal((await fetch(`${context.relay.httpUrl}/recordings/${id}.jsonl`)).status, 200);
});

test('SQLite failures return a stable recording error without leaking local directory paths', async (t) => {
  const context = await setup(t);
  const database = new Database(join(context.directory, 'recordings.sqlite'));
  try {
    database.exec("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test write failure'); END");
    await assert.rejects(context.relay.startRecording({ label: 'database failure' }), (error) => {
      assert.equal(error.code, 'RECORDING_WRITE_FAILED');
      assert.ok(!error.message.includes(context.directory));
      return true;
    });
  } finally { database.close(); }
});
