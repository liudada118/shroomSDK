import { asShroomError } from './errors.js';

/**
 * 帧订阅中心：设备适配器共用这套实现，每次创建的订阅集合彼此独立。
 *
 * 帧率可能到 100Hz，回调里别做重活；一个回调抛错不影响其他回调。
 */
export function createFrameHub() {
  const listeners = new Set();
  const errorListeners = new Set();
  let lastError = null;

  /** 缓存最近错误并通知错误订阅；订阅自身抛错时记录日志，避免递归派发。 */
  function emitError(error) {
    lastError = error;
    if (!errorListeners.size) console.error('[shroom]', error);
    for (const handler of [...errorListeners]) {
      try { handler(error); }
      catch (callbackError) { console.error('[shroom] onError 回调出错：', callbackError); }
    }
  }

  return {
    /** 订阅每一帧，返回取消订阅的函数 */
    onFrame(handler) {
      if (typeof handler !== 'function') {
        throw new TypeError('onFrame 需要传一个函数');
      }
      listeners.add(handler);
      return () => listeners.delete(handler);
    },

    /** 订阅运行期错误，返回取消订阅函数；不会立即重放此前的 lastError。 */
    onError(handler) {
      if (typeof handler !== 'function') throw new TypeError('onError 需要传一个函数');
      errorListeners.add(handler);
      return () => errorListeners.delete(handler);
    },

    emitError,

    get lastError() { return lastError; },

    /** 同步分发同一帧对象；复制订阅名单，避免回调内新增订阅影响本轮遍历。 */
    emit(frame) {
      for (const handler of [...listeners]) {
        try {
          handler(frame);
        } catch (err) {
          emitError(asShroomError(err, { code: 'CALLBACK_FAILED', stage: 'callback', message: '应用的 onFrame 回调执行失败' }));
        }
      }
    },

    /** 连接关闭时释放全部回调引用；最近错误仍可由 lastError 读取。 */
    clear() {
      listeners.clear();
      errorListeners.clear();
    },

    get count() {
      return listeners.size;
    },
  };
}
