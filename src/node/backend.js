/** 为共享后端客户端选择 Node 可用的 WebSocket；HTTP 与协议逻辑仍复用 backend/client.js。 */
import { createRequire } from 'node:module';
import { BackendSdkClient as SharedBackendSdkClient } from '../backend/client.js';

export { DEFAULT_HTTP_BASE_URL, DEFAULT_WS_URL, DEFAULT_ROUTES, normalizeHttpResult } from '../backend/client.js';

/** 先用原生 WebSocket，再尝试可选依赖 ws；缺失时由实际建连方法报错。 */
function nodeWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try { return createRequire(import.meta.url)('ws'); }
  catch { return undefined; }
}

/** Node 后端客户端适配；调用方显式传入的 WebSocketImpl 优先于自动探测。 */
export class BackendSdkClient extends SharedBackendSdkClient {
  constructor(options = {}) {
    super({ ...options, WebSocketImpl: options.WebSocketImpl ?? nodeWebSocket() });
  }
}
