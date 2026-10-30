// The existing JS implementation is the reference; this file is not a second decoder.
import { readFileSync } from 'node:fs';
import { decodeFrame } from '../../core/frame.js';
import { createFramer } from '../../core/framer.js';

const cases = JSON.parse(readFileSync(0, 'utf8'));
const result = cases.map((item) => {
  if (item.kind === 'frame') {
    const frame = decodeFrame(Uint8Array.from(item.payload), item.options);
    return { ...frame, raw: Array.from(frame.raw), values: Array.from(frame.values), timestamp: 0 };
  }
  const framer = createFramer(item.options);
  return item.chunks.map((chunk) => ({
    frames: framer.push(Uint8Array.from(chunk)).map((frame) => Array.from(frame)),
    droppedCount: framer.droppedCount,
    frameLength: framer.frameLength,
  }));
});
process.stdout.write(JSON.stringify(result));
