/**
 * 模拟数据源：没有硬件的时候也能把整条链路跑通。
 *
 * 它生成的是「原始字节」，和真实串口走同一条解码路径，
 * 可用于验证通用帧的渲染和回调流程；模拟结果不代表真实产品的物理量或硬件验收。
 */
import { decodeFrame } from './frame.js';
import { createFrameHub } from './device.js';
import { asShroomError, ShroomError } from './errors.js';
import { validateMockOptions } from './serial-config.js';
import { serialDiagnostics } from './serial-diagnostics.js';
import { prepareProductConnection } from './product.js';

const trustedMockDevices = new WeakSet();

/** 只有 SDK 内部创建并登记的模拟实例才可走免授权演示路线，不能靠改公开 info 冒充。 */
export function isMockDevice(device) {
  return trustedMockDevices.has(device);
}

/**
 * 内部产品模拟工厂：仅接收 product / side，生成字节并经过真实产品解析器。
 * 输入不接收外部数据源；手套 IMU 保持零值，不生成虚构姿态。返回设备需显式 close。
 */
export function createProductMockDevice(options = {}) {
  const session = prepareProductConnection(options);
  if (Object.keys(options).some((field) => !['product', 'side'].includes(field))) {
    throw new ShroomError('INVALID_CONFIG', '产品模拟仅支持 product 和 side。', { stage: 'configure' });
  }
  const glove = session.info.product === 'handGloveFullPacket';
  const source = createMockDevice({ rows: glove ? 16 : 32, cols: glove ? 16 : 32 });
  const hub = createFrameHub();
  let sequence = 0;
  source.onFrame((frame) => {
    const payload = new Uint8Array(glove ? 274 : 1024);
    if (glove) {
      payload[0] = sequence++ & 255;
      payload[1] = 2;
      payload.set(frame.raw, 2);
    } else payload.set(frame.raw);
    for (const productFrame of session.parser.push(Uint8Array.from([...payload, 0xaa, 0x55, 0x03, 0x99]))) hub.emit(productFrame);
  });
  source.onError(hub.emitError);
  const device = {
    info: { ...source.info, ...session.info },
    onFrame: hub.onFrame, onData: hub.onFrame, onError: hub.onError,
    get state() { return source.state; },
    get bytesReceived() { return source.frameCount * (glove ? 274 : 1024); },
    get frameCount() { return source.frameCount; },
    get droppedCount() { return session.parser.droppedCount; },
    get frameLength() { return session.parser.frameLength; },
    getDiagnostics() {
      return serialDiagnostics({ source: 'mock', state: source.state, bytesReceived: device.bytesReceived,
        frameCount: source.frameCount, droppedCount: session.parser.droppedCount,
        frameLength: session.parser.frameLength, lastError: hub.lastError });
    },
    async close() { await source.close(); hub.clear(); },
  };
  trustedMockDevices.add(device);
  return Object.freeze(device);
}

/** 生成一帧：两个高斯亮斑绕着中心转 */
function renderBlobs(rows, cols, phase) {
  const buf = new Uint8Array(rows * cols);
  const blobs = [
    { x: 0.5 + 0.28 * Math.cos(phase), y: 0.5 + 0.28 * Math.sin(phase), r: 0.18, peak: 235 },
    { x: 0.5 + 0.22 * Math.cos(-phase * 1.7), y: 0.5 + 0.22 * Math.sin(-phase * 1.7), r: 0.12, peak: 180 },
  ];

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const nx = cols > 1 ? x / (cols - 1) : 0.5;
      const ny = rows > 1 ? y / (rows - 1) : 0.5;
      let v = 0;
      for (const b of blobs) {
        const d2 = (nx - b.x) ** 2 + (ny - b.y) ** 2;
        v += b.peak * Math.exp(-d2 / (2 * b.r * b.r));
      }
      v += 3 * Math.random(); // 一点底噪，看起来像真数据
      buf[y * cols + x] = v > 255 ? 255 : v;
    }
  }
  return buf;
}

/**
 * 创建周期性通用矩阵模拟源，经过 decodeFrame 后同步通知 onFrame 订阅。
 * @param {object} [options] 矩阵、帧率与通用解码参数。
 * @param {number} [options.rows] 默认 32
 * @param {number} [options.cols] 默认 32
 * @param {number} [options.fps]  默认 30
 * @returns {object} device：提供帧/错误订阅、诊断与 close；close 会停止定时器并清理订阅。
 */
export function createMockDevice(options = {}) {
  const decodeOptions = options;
  options = validateMockOptions(options);
  const rows = options.rows ?? 32;
  const cols = options.cols ?? 32;
  const fps = options.fps ?? 30;

  const hub = createFrameHub();
  let phase = 0;
  let state = 'open';
  let bytesReceived = 0;
  let frameCount = 0;
  let timer = setInterval(() => {
    if (state !== 'open') return;
    try {
      phase += 0.08;
      const payload = renderBlobs(rows, cols, phase);
      const frame = decodeFrame(payload, { ...decodeOptions, rows, cols });
      bytesReceived += payload.length;
      frameCount += 1;
      hub.emit(frame);
    } catch (error) {
      state = 'error';
      clearInterval(timer);
      timer = null;
      hub.emitError(asShroomError(error, { code: 'PARSE_FAILED', stage: 'parse' }));
    }
  }, Math.round(1000 / fps));

  const device = {
    info: { source: 'mock', rows, cols, fps },
    onFrame: hub.onFrame,
    onError: hub.onError,
    get state() { return state; },
    get bytesReceived() { return bytesReceived; },
    get frameCount() { return frameCount; },
    get droppedCount() { return 0; },
    get frameLength() { return frameCount ? rows * cols : 0; },
    getDiagnostics() {
      return serialDiagnostics({
        source: 'mock', state, bytesReceived, frameCount, droppedCount: 0,
        frameLength: frameCount ? rows * cols : 0, lastError: hub.lastError,
      });
    },
    async close() {
      if (timer) clearInterval(timer);
      timer = null;
      if (state !== 'error') state = 'closed';
      hub.clear();
    },
  };
  trustedMockDevices.add(device);
  return Object.freeze(device);
}
