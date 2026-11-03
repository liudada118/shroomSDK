/** 固定载荷 + 尾分隔协议的共用分帧器；其他协议由产品适配器提供自己的解析器。 */
import { ShroomError } from '../errors.js';

/** 找到完整尾分隔符；跨 chunk 的尾部由 pending 留到下一次输入。 */
function productTailDelimiterIndex(bytes, offset, delimiter) {
  outer: for (let i = offset; i <= bytes.length - delimiter.length; i++) {
    for (let j = 0; j < delimiter.length; j++) {
      if (bytes[i + j] !== delimiter[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * 为一个连接创建独立状态；decodePayload 只接收长度正确且复制过的载荷。
 * 配置由内置产品适配器提供，不接受用户覆盖协议；不根据帧长识别产品。
 */
export function createTailProductParser({ payloadLength, delimiter, decodePayload }) {
  if (!Number.isSafeInteger(payloadLength) || payloadLength < 1
    || (!Array.isArray(delimiter) && !(delimiter instanceof Uint8Array)) || delimiter.length === 0
    || Array.from(delimiter).some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)
    || typeof decodePayload !== 'function') {
    throw new ShroomError('INVALID_CONFIG', '产品拆帧器需要正整数载荷长度、非空字节分隔符和解码函数。', { stage: 'configure' });
  }
  delimiter = Uint8Array.from(delimiter); // 固定本连接协议，避免外部修改分隔符影响正在取数的设备。
  let pending = new Uint8Array();
  let overflowed = false;
  let dropped = 0;
  let frameLength = 0;
  return {
    /** 输入串口字节；保留半包，丢弃错误长度和溢出段，并累计诊断计数。 */
    push(chunk) {
      if (!(chunk instanceof Uint8Array)) throw new ShroomError('PARSE_FAILED', '产品输入必须是 Uint8Array 字节。', { stage: 'parse' });
      if (!chunk.length) return [];
      const bytes = new Uint8Array(pending.length + chunk.length);
      bytes.set(pending);
      bytes.set(chunk, pending.length);
      let offset = 0;
      let tail;
      const frames = [];
      while ((tail = productTailDelimiterIndex(bytes, offset, delimiter)) !== -1) {
        const size = tail - offset;
        if (!overflowed && size === payloadLength) {
          frames.push(decodePayload(bytes.slice(offset, tail)));
          frameLength = payloadLength;
        } else if (overflowed || size > 0) dropped += 1;
        overflowed = false;
        offset = tail + delimiter.length;
      }
      pending = bytes.slice(offset);
      if (pending.length > payloadLength + delimiter.length - 1) {
        // 超长段丢弃到下个帧尾；仅保留可能跨 chunk 的分隔符前缀，避免拼出伪帧。
        overflowed = true;
        pending = delimiter.length > 1 ? pending.slice(-(delimiter.length - 1)) : new Uint8Array();
      }
      return frames;
    },
    /** 重置半包及累计诊断，供同一独立解析器重新开始。 */
    reset() { pending = new Uint8Array(); overflowed = false; dropped = 0; frameLength = 0; },
    get droppedCount() { return dropped; },
    get frameLength() { return frameLength; },
  };
}
