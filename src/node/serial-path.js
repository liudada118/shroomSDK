/** 扫描与正式连接共用串口预约，避免断线重连的间隙被其他操作抢占。 */
import { ShroomError } from '../core/errors.js';

const reservations = new Map();
const pathKey = path => process.platform === 'win32' ? path.trim().toLowerCase() : path.trim();

/** 同一进程中已被扫描、连接或迟到清理占用的路径不能再次打开。 */
export function assertSerialPathAvailable(path) {
  if (reservations.has(pathKey(path))) throw new ShroomError('PORT_BUSY', '此串口正在被连接或扫描占用。', {
    stage: 'query', details: { path }, suggestion: '关闭已有设备连接，或等待上次扫描完成串口释放后重试。',
  });
}

/** 预约返回幂等释放函数；旧连接的迟到释放不能解除后来同路径的新预约。 */
export function reserveSerialPath(path) {
  assertSerialPathAvailable(path);
  const key = pathKey(path), token = Symbol();
  reservations.set(key, token);
  return () => { if (reservations.get(key) === token) reservations.delete(key); };
}
