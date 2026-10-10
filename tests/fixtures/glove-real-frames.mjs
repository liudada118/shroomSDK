function encodeFloat32LE(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

const pressure = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
const quaternion = [0.125, -0.25, 0.5, 0.75];
const imuBytes = encodeFloat32LE(quaternion);

export const GLOVE_REAL_FRAME_FIXTURES = Object.freeze({
  source: 'production-protocol-layout',
  pressure: Object.freeze([...pressure]),
  quaternion: Object.freeze(quaternion),
  splitLeft: Object.freeze({
    first: Buffer.concat([Buffer.from([1, 1]), pressure.subarray(0, 128)]),
    second: Buffer.concat([Buffer.from([2, 1]), pressure.subarray(128), imuBytes]),
  }),
  splitRight: Object.freeze({
    first: Buffer.concat([Buffer.from([1, 2]), pressure.subarray(0, 128)]),
    second: Buffer.concat([Buffer.from([2, 2]), pressure.subarray(128), imuBytes]),
  }),
  fullLeft: Buffer.concat([Buffer.from([42, 1]), pressure, imuBytes]),
});
