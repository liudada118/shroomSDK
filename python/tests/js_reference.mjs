// The existing JS implementation is the reference; this file is not a second decoder.
import { readFileSync } from 'node:fs';
import { decodeFrame } from '../../src/core/frame.js';
import { createFramer } from '../../src/core/framer.js';
import { LAYOUTS, getLayout, listLayouts, listProducts } from '../../src/core/layout.js';
import { COLORMAPS, getColormap } from '../../src/core/colormap.js';
import { createProductParser, listDeviceProducts } from '../../src/core/product.js';
import { encodeStreamFrame, decodeStreamFrame } from '../../src/core/stream-codec.js';

const wire = (frame) => ({ ...encodeStreamFrame(frame), timestamp: 0 });
const cases = JSON.parse(readFileSync(0, 'utf8'));
const result = cases.map((item) => {
  if (item.kind === 'frame') {
    const frame = decodeFrame(Uint8Array.from(item.payload), item.options);
    return { ...frame, raw: Array.from(frame.raw), values: Array.from(frame.values), timestamp: 0 };
  }
  if (item.kind === 'layouts') {
    const layouts = Object.fromEntries(Object.keys(LAYOUTS).map((name) => {
      const layout = getLayout(name);
      return [name, { rows: layout.rows, cols: layout.cols, perm: Array.from(layout.perm) }];
    }));
    return { layouts, list: listLayouts(), products: listProducts(), deviceProducts: listDeviceProducts() };
  }
  if (item.kind === 'colormap') {
    return Object.fromEntries(Object.keys(COLORMAPS).map((name) => [name, item.values.map(getColormap(name))]));
  }
  if (item.kind === 'product') {
    // 每个数据块之后的帧与诊断计数都要一致，才能证明半包和重同步行为相同。
    const parser = createProductParser(item.product, item.options);
    return item.chunks.map((chunk) => ({
      frames: parser.push(Uint8Array.from(chunk)).map(wire),
      droppedCount: parser.droppedCount,
      frameLength: parser.frameLength,
    }));
  }
  if (item.kind === 'codec') {
    // 接收 Python 编码的帧：JS 解码成功后再编码，结果应与输入逐字段一致。
    return item.frames.map((frame) => {
      try { return { ok: true, frame: encodeStreamFrame(decodeStreamFrame(frame)) }; }
      catch (error) { return { ok: false, code: error.code, field: error.details?.field ?? null }; }
    });
  }
  const framer = createFramer(item.options);
  return item.chunks.map((chunk) => ({
    frames: framer.push(Uint8Array.from(chunk)).map((frame) => Array.from(frame)),
    droppedCount: framer.droppedCount,
    frameLength: framer.frameLength,
  }));
});
process.stdout.write(JSON.stringify(result));
