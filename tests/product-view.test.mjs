import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductView } from '../web/product-view.js';
import { decodeGlovePacket } from '../core/glove.js';
import { createProductParser } from '../core/product.js';

/** 提供可统计实际绘制点位、支持移除节点的最小 DOM/Canvas 环境。 */
function viewEnvironment(t) {
  const canvases = [];
  const documentRef = {
    createElement(tag) {
      const element = {
        tagName: tag.toUpperCase(), ownerDocument: documentRef, children: [], style: {}, attributes: {}, parentNode: null,
        textContent: '', clientWidth: 180, clientHeight: 144, width: 180, height: 144,
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) { child.remove?.(); child.parentNode = this; this.children.push(child); return child; },
        replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; for (const child of children) this.appendChild(child); },
        remove() { if (this.parentNode) { const list = this.parentNode.children; const index = list.indexOf(this); if (index >= 0) list.splice(index, 1); this.parentNode = null; } },
      };
      if (tag === 'canvas') {
        const ctx = {
          points: [], clears: 0, images: 0,
          clearRect() { this.clears += 1; },
          fillRect(...args) { this.points.push(args); },
          createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
          putImageData() { this.images += 1; },
          drawImage() {},
        };
        element.context = ctx;
        element.getContext = () => ctx;
        canvases.push(element);
      }
      return element;
    },
    querySelector(selector) { return selector === '#view' ? container : null; },
  };
  const container = documentRef.createElement('div');
  const originals = ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  globalThis.document = documentRef;
  globalThis.window = { devicePixelRatio: 1 };
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  delete globalThis.ResizeObserver;
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { container, canvases, documentRef };
}

/** 返回包含全部语义分区的官方产品帧，避免人为构造错误的模型形状。 */
function gloveFrame(side = 'left') {
  return decodeGlovePacket(Uint8Array.from({ length: 274 }, (_, index) => index % 256), { side });
}

for (const side of ['left', 'right']) {
  test(`${side} product view paints all five fingers, independent pulp and exactly 72 palm points`, (t) => {
    const { container, canvases } = viewEnvironment(t);
    const view = createProductView('#view');
    const frame = gloveFrame(side);
    view.render(frame);
    assert.equal(view.product, 'handGloveFullPacket');
    assert.equal(canvases.length, 11);
    assert.deepEqual(canvases.map((canvas) => canvas.context.points.length), [12, 1, 12, 1, 12, 1, 12, 1, 12, 1, 72]);
    assert.ok(view.element.children[0].textContent.includes(side === 'left' ? '左手' : '右手'));
    assert.ok(view.element.children[0].textContent.includes('二维'));
    assert.equal(view.element.children[1].children.length, 6);
    assert.equal(view.element.children[1].children[0].children[0].textContent, side === 'left' ? '小拇指' : '大拇指');
    assert.ok(canvases.at(-1).title.startsWith('ADC：'));
    assert.equal(frame.palm.raw.length, 72);
    view.destroy();
    assert.equal(container.children.length, 0);
    view.destroy();
  });
}

test('product view subscribes with one call and destroys only its own view', (t) => {
  const { container, documentRef } = viewEnvironment(t);
  const existing = documentRef.createElement('p');
  container.appendChild(existing);
  let handler;
  let removed = false;
  const source = { info: { product: 'handGloveFullPacket' }, onData(next) { handler = next; return () => { removed = true; handler = null; }; } };
  const view = createProductView(container, { source });
  handler(gloveFrame());
  assert.equal(view.product, 'handGloveFullPacket');
  view.destroy();
  assert.equal(removed, true);
  assert.deepEqual(container.children, [existing]);
  assert.doesNotThrow(() => view.render({ product: 'bad' }));
});

test('view rejects unsupported products, corrupt region shapes, NaN and artificial palm padding', (t) => {
  const { container } = viewEnvironment(t);
  assert.throws(() => createProductView('#missing'), { code: 'INVALID_CONFIG' });
  assert.throws(() => createProductView(container, { source: {} }), { code: 'INVALID_CONFIG' });
  assert.throws(() => createProductView(container, { product: 'unknown' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => createProductView(container, { gain: -1 }), { code: 'INVALID_CONFIG' });
  assert.equal(container.children.length, 0);
  const view = createProductView(container);
  for (const corrupt of [
    (frame) => { frame.side = 'auto'; },
    (frame) => { frame.palm.rowLengths[0] = 15; },
    (frame) => { frame.palm.raw = new Uint8Array(75); },
    (frame) => { frame.fingers.thumb.values[0] = NaN; },
    (frame) => { delete frame.fingers.index.pulp; },
  ]) {
    const frame = gloveFrame(); corrupt(frame);
    assert.throws(() => view.render(frame), { code: 'PARSE_FAILED' });
  }
  assert.throws(() => view.render({ product: 'unknown' }), { code: 'INVALID_CONFIG' });
  assert.throws(() => view.render({ product: 'hand', rows: 1, cols: 1024, values: new Float32Array(1024) }), { code: 'PARSE_FAILED' });
  view.destroy();
});

test('hand pad product view delegates 32x32 rendering to the existing heatmap', (t) => {
  const { container, canvases } = viewEnvironment(t);
  const [frame] = createProductParser('hand').push(Uint8Array.from([...new Uint8Array(1024).fill(127), 170, 85, 3, 153]));
  const view = createProductView(container, { product: 'hand' });
  view.render(frame);
  assert.equal(view.product, 'hand');
  assert.ok(view.element.children[0].textContent.includes('32 × 32'));
  assert.equal(canvases.length, 2);
  assert.ok(canvases[1].context.images > 0);
  assert.throws(() => view.render(gloveFrame()), { code: 'PARSE_FAILED' });
  view.destroy();
});

test('frame scheduling coalesces frames and destroy cancels refresh and ResizeObserver', (t) => {
  const { container, canvases } = viewEnvironment(t);
  const jobs = new Map();
  let sequence = 0;
  let disconnected = false;
  globalThis.requestAnimationFrame = (callback) => { const id = ++sequence; jobs.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = (id) => jobs.delete(id);
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { assert.equal(target, container); }
    disconnect() { disconnected = true; }
  };
  const view = createProductView(container);
  const first = gloveFrame();
  const second = gloveFrame('right');
  view.render(first); view.render(second);
  assert.equal(jobs.size, 1);
  assert.equal(canvases.length, 0);
  const callback = jobs.values().next().value; jobs.clear(); callback();
  assert.ok(view.element.children[0].textContent.includes('右手'));
  view.resize();
  assert.equal(jobs.size, 1);
  view.destroy();
  assert.equal(jobs.size, 0);
  assert.equal(disconnected, true);
  assert.equal(container.children.length, 0);
});
