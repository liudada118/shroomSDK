function decodeFloat32LE(bytes) {
  const data = Buffer.from(bytes || []);
  const values = [];

  for (let offset = 0; offset + 3 < data.length; offset += 4) {
    const value = data.readFloatLE(offset);
    values.push(Number.isFinite(value) ? value : 0);
  }

  return values;
}

function buildQuaternion(imuBytes) {
  const values = decodeFloat32LE(imuBytes).slice(0, 4);
  while (values.length < 4) values.push(0);

  const [x, y, z, w] = values;
  const norm = Math.hypot(x, y, z, w);
  return {
    encoding: 'float32le',
    order: 'xyzw',
    values,
    x,
    y,
    z,
    w,
    norm,
    valid: values.every(Number.isFinite) && norm > 0,
  };
}

module.exports = {
  buildQuaternion,
  decodeFloat32LE,
};
