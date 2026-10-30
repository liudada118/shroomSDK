import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { Shroom, ShroomError, ERROR_CODES, asShroomError } from '../web/index.js';
import { Shroom as NodeShroom } from '../node/index.js';
import { createFramer } from '../core/framer.js';
import { decodeFrame, resolveShape } from '../core/frame.js';
import { createFrameHub } from '../core/device.js';
import { serialDiagnostics } from '../core/serial-diagnostics.js';
import { validateSerialOptions } from '../core/serial-config.js';

const invalid = (fn, field) => assert.throws(fn, (error) =>
  error instanceof ShroomError && error.code === 'INVALID_CONFIG'
  && error.stage === 'configure' && (!field || error.details.field === field));

test('serial error exports, native classification, cause and safe JSON', () => {
  assert.equal(NodeShroom.ShroomError, ShroomError);
  assert.equal(Shroom.ERROR_CODES, ERROR_CODES);
  assert.ok(Object.isFrozen(ERROR_CODES));
  for (const [native, stage, code] of [
    [{ code: 'EBUSY' }, 'connect', 'PORT_BUSY'],
    [{ code: 'EACCES' }, 'query', 'PERMISSION_DENIED'],
    [{ code: 'ENOENT' }, 'connect', 'PORT_NOT_FOUND'],
    [{ name: 'NotFoundError' }, 'query', 'USER_CANCELLED'],
    [{ name: 'NetworkError' }, 'read', 'DISCONNECTED'],
    [{ code: 'ERR_MODULE_NOT_FOUND' }, 'connect', 'DEPENDENCY_MISSING'],
  ]) {
    const error = asShroomError(native, { stage });
    assert.equal(error.code, code);
    assert.equal(error.cause, native);
    assert.equal(error.toJSON().stage, stage);
    assert.ok(error.suggestion.length > 0);
    assert.ok(!('cause' in error.toJSON()));
    assert.equal(asShroomError(error), error);
  }
  const callback = asShroomError(new Error('permission denied'), { code: 'CALLBACK_FAILED', stage: 'callback' });
  assert.equal(callback.code, 'CALLBACK_FAILED');
});

test('configuration fails before I/O or large allocations and snapshots delimiter', () => {
  for (const options of [null, [], { baudRate: 0 }, { baudRate: NaN }, { baudRate: '9600' },
    { path: '' }, { rows: 2 }, { rows: 2, cols: -1 }, { rows: 1048576, cols: 2 },
    { points: -1 }, { fullScale: 0 }, { threshold: Infinity }, { minLength: 20, maxLength: 10 },
    { delimiter: [] }, { delimiter: [256] }, { delimiter: new Uint8Array(65) }, { lockLength: 'false' }]) {
    invalid(() => validateSerialOptions(options));
  }
  invalid(() => Shroom.mock({ fps: 0 }), 'fps');
  invalid(() => Shroom.mock({ fps: 1e-300 }), 'fps');
  invalid(() => createFramer({ maxLength: 1048577 }), 'maxLength');
  invalid(() => resolveShape(1048577), 'points');
  const delimiter = [250, 251];
  const options = validateSerialOptions({ delimiter });
  delimiter[0] = 0;
  assert.deepEqual(options.delimiter, [250, 251]);
});

test('framer handles chunked delimiters, length lock, relock and reset', () => {
  const framer = createFramer({ delimiter: [250, 251], minLength: 1, maxLength: 16 });
  assert.deepEqual(framer.push(Uint8Array.of(12, 250)), []);
  assert.deepEqual(framer.push(Uint8Array.of(251, 1, 2, 250)), []);
  assert.deepEqual(framer.push(Uint8Array.of(251)).map((payload) => Array.from(payload)), [[1, 2]]);
  for (let i = 0; i < 2; i++) framer.push(Uint8Array.of(1, 2, 250, 251));
  assert.equal(framer.frameLength, 2);
  assert.equal(framer.push(Uint8Array.of(1, 2, 3, 250, 251)).length, 0);
  assert.equal(framer.droppedCount, 1);
  for (let i = 0; i < 11; i++) framer.push(Uint8Array.of(1, 2, 3, 250, 251));
  assert.equal(framer.frameLength, 3);
  assert.equal(framer.droppedCount, 11);
  framer.reset();
  assert.equal(framer.frameLength, 0);
  assert.equal(framer.droppedCount, 0);
  assert.throws(() => framer.push('not bytes'), { code: 'PARSE_FAILED', stage: 'parse' });
});

test('decode retains raw/shape/statistics and empty-frame compatibility', () => {
  const frame = decodeFrame(Uint8Array.of(0, 255, 128, 0), { rows: 2, cols: 2 });
  assert.equal(frame.rows, 2);
  assert.equal(frame.cols, 2);
  assert.equal(frame.max, 1);
  assert.equal(frame.min, 0);
  assert.equal(frame.area, 2);
  assert.ok(Math.abs(frame.avg - (1 + 128 / 255) / 4) < 1e-10);
  assert.deepEqual([...frame.raw], [0, 255, 128, 0]);
  assert.equal(decodeFrame(new Uint8Array()).values.length, 0);
  assert.deepEqual(resolveShape(6), { rows: 1, cols: 6 });
  assert.deepEqual([...decodeFrame(Uint8Array.of(1, 2), { layout: 'legacy-name' }).values], [...decodeFrame(Uint8Array.of(1, 2)).values]);
  assert.throws(() => decodeFrame([1, 2]), { code: 'PARSE_FAILED' });
  invalid(() => decodeFrame(Uint8Array.of(1), { fullScale: -1 }));
});

test('frame and error callbacks are isolated and unsubscribe safely', () => {
  const hub = createFrameHub();
  const received = [];
  const errors = [];
  const unsubscribe = hub.onFrame(() => { throw new Error('application bug'); });
  hub.onFrame((frame) => received.push(frame));
  const offError = hub.onError((error) => errors.push(error));
  hub.emit(123);
  assert.deepEqual(received, [123]);
  assert.equal(errors[0].code, 'CALLBACK_FAILED');
  unsubscribe();
  hub.emit(456);
  assert.equal(errors.length, 1);
  offError();
  hub.clear();
  assert.equal(hub.count, 0);
  assert.throws(() => hub.onError(null), TypeError);
});

test('diagnostics distinguish waiting bytes/frames, streaming, errors and closed snapshots', () => {
  const base = { source: 'node-serial', state: 'open', bytesReceived: 0, frameCount: 0, droppedCount: 0, frameLength: 0 };
  assert.equal(serialDiagnostics(base).status, 'waiting-data');
  assert.equal(serialDiagnostics({ ...base, bytesReceived: 12 }).status, 'waiting-frame');
  assert.equal(serialDiagnostics({ ...base, frameCount: 1 }).status, 'streaming');
  const error = new ShroomError('READ_FAILED', 'read failed', { stage: 'read', details: { port: 'COM3' } });
  const diagnostic = serialDiagnostics({ ...base, state: 'error', lastError: error });
  assert.equal(diagnostic.status, 'error');
  assert.equal(diagnostic.lastError.code, 'READ_FAILED');
  diagnostic.lastError.details.port = 'changed';
  assert.equal(error.details.port, 'COM3');
  assert.equal(serialDiagnostics({ ...base, state: 'closed' }).status, 'closed');
});

test('mock shares diagnostics/error interface, counters and idempotent close', async (t) => {
  let tick;
  let cleared = 0;
  t.mock.method(globalThis, 'setInterval', (fn) => { tick = fn; return 123; });
  t.mock.method(globalThis, 'clearInterval', () => { cleared++; });
  const device = Shroom.mock({ rows: 2, cols: 2 });
  const errors = [];
  device.onError((error) => errors.push(error));
  device.onFrame(() => { throw new Error('UI callback'); });
  assert.equal(device.state, 'open');
  assert.equal(device.getDiagnostics().status, 'waiting-data');
  tick();
  assert.equal(device.frameCount, 1);
  assert.equal(device.bytesReceived, 4);
  assert.equal(device.frameLength, 4);
  assert.equal(device.droppedCount, 0);
  assert.equal(device.state, 'open');
  assert.equal(errors[0].code, 'CALLBACK_FAILED');
  await device.close();
  await device.close();
  tick();
  assert.equal(cleared, 1);
  assert.equal(device.frameCount, 1);
  assert.equal(device.state, 'closed');
  assert.equal(device.getDiagnostics().status, 'closed');
});

test('classic bundle has the same error and mock contract without Node globals', async () => {
  const source = await readFile(new URL('../web/shroom.bundle.js', import.meta.url), 'utf8');
  let tick;
  const browser = { console, setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => {} };
  runInNewContext(source, browser);
  assert.equal(typeof browser.Shroom.ShroomError, 'function');
  const device = browser.Shroom.mock({ rows: 2, cols: 2 });
  tick();
  assert.equal(device.frameCount, 1);
  assert.equal(device.getDiagnostics().status, 'streaming');
  await device.close();
  assert.equal(device.state, 'closed');
});

test('mock retains live decode options and stops safely if they become invalid', async (t) => {
  let tick;
  t.mock.method(globalThis, 'setInterval', (fn) => { tick = fn; return 123; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const options = { rows: 2, cols: 2, threshold: 1000 };
  const device = Shroom.mock(options);
  const frames = [];
  const errors = [];
  device.onFrame((frame) => frames.push(frame));
  device.onError((error) => errors.push(error));
  tick();
  assert.equal(frames[0].area, 0);
  options.threshold = 0;
  tick();
  assert.ok(frames[1].area > 0);
  options.fullScale = 0;
  tick();
  assert.equal(errors[0].code, 'INVALID_CONFIG');
  assert.equal(device.state, 'error');
  assert.equal(device.frameCount, 2);
  await device.close();
  assert.equal(device.state, 'error');
});
