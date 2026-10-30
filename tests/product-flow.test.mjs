import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductFlow } from '../examples/product-flow.js';
import { readProduct, createWS, startRecording, stopRecording, downloadRecording } from '../quick-flow.js';
import { createFrameHub } from '../core/device.js';
import { decodeGlovePacket } from '../core/glove.js';
import { activateTestLicense } from './license-fixture.mjs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const body = code => code.replace(/^import[^\n]+\n/gm, '');

test('displayed flow snippets share a real WS connection and download the recording stopped by this client', async t => {
  await activateTestLicense();
  const directory = await mkdtemp(join(tmpdir(), 'shroom-doc-flow-'));
  const hub = createFrameHub(), logs = [], errors = [], clicks = [];
  const source = { info: { source: 'mock', product: 'handGloveFullPacket', side: 'right' },
    onData: hub.onFrame, onError: hub.onError, close: async () => hub.clear() };
  const steps = createProductFlow({ product: 'glove', side: 'right', platform: 'windows' });
  const nodeCode = steps.flatMap(step => step.blocks.filter(block => block.runtime === 'node').map(block => body(block.code))).join('\n');
  const logger = { log: (...args) => logs.push(args), error: (...args) => errors.push(args) };
  const setup = new AsyncFunction('readProduct', 'createWS', 'console', `${nodeCode}\nreturn {device, server};`);
  let server, client;
  const previousDocument = globalThis.document;
  t.after(async () => {
    await client?.close(); await server?.close(); await source.close();
    await rm(directory, { recursive: true, force: true });
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
  ({ server } = await setup(async options => {
    assert.equal(options.product, 'glove'); assert.equal(options.path, 'COM3'); assert.equal(options.side, 'right');
    hub.onFrame(options.onData); return source;
  }, (device, options) => createWS(device, { ...options, port: 0, recordingsDir: directory }), logger));
  const browserSetup = steps[1].blocks.find(block => block.runtime === 'web').code;
  const setupBrowser = new AsyncFunction('readProduct', 'startRecording', 'stopRecording', 'downloadRecording', 'console', `${body(browserSetup)}
    return { stream,
      start: async () => { ${steps[2].blocks[0].code}\n },
      stop: async () => { ${steps[3].blocks[0].code}\nreturn recording; },
      download: () => { ${steps[4].blocks[0].code}\n }
    };`);
  const browser = await setupBrowser(options => readProduct({ ...options, url: server.url }), startRecording, stopRecording, downloadRecording, logger);
  client = browser.stream;
  assert.throws(() => browser.download(), /先开始并停止/);
  await browser.start();
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('flow frame timeout')), 3000);
    const unsubscribe = client.onData(frame => { clearTimeout(timer); unsubscribe(); resolve(frame); });
  });
  hub.emit(decodeGlovePacket(Uint8Array.from({ length: 274 }, (_, index) => index & 255), { side: 'right' }));
  const frame = await received;
  const recording = await browser.stop();
  assert.equal(recording.frameCount, 1);
  assert.equal(recording.label, '本次采集');
  assert.equal(client.state, 'open', 'stopping recording keeps data connected');
  globalThis.document = {
    body: { appendChild() {} },
    createElement: () => ({ click() { clicks.push(this.href); }, remove() {} }),
  };
  browser.download();
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0], `${server.httpUrl}/recordings/${recording.id}.csv`);
  const response = await fetch(clicks[0]);
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.ok(csv.includes(recording.id));
  assert.ok(csv.includes('本次采集'));
  assert.ok(logs.some(args => args[0] === frame.fingers || args[0]?.index?.pulp), 'product callback receives parsed finger data');
  assert.equal(errors.length, 0);
});
