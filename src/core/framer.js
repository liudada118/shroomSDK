/**
 * 切帧器：把串口过来的字节流切成一帧一帧。
 *
 * 协议约定（可通过 options 覆盖）：
 *   先找到分隔符 AA 55 03 99，再把两个分隔符之间的字节作为一帧。
 *   首个分隔符前的数据不接收；产品接口另有固定载荷 + 尾分隔符解析器（product.js）。
 *
 * 用法：
 *   const framer = createFramer()
 *   const frames = framer.push(chunk)   // chunk 是 Uint8Array，返回本次切出的若干帧
 */

import { ShroomError } from './errors.js';
import { validateFramerOptions } from './serial-config.js';

export const DEFAULT_DELIMITER = [0xaa, 0x55, 0x03, 0x99];

/** 在 haystack 中从 from 开始找 needle，找不到返回 -1 */
function indexOfBytes(haystack, needle, from) {
  const limit = haystack.length - needle.length;
  outer: for (let i = from; i <= limit; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** 合并未消费的缓冲区与新字节，创建独立数组，避免上游复用 chunk 时改写半包。 */
function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * @param {object} [options] 通用分帧配置，每个独立字节流应创建自己的切帧器。
 * @param {number[]} [options.delimiter]  帧分隔符，默认 [0xAA,0x55,0x03,0x99]
 * @param {number}   [options.minLength]  小于这个长度的帧当作脏帧丢弃
 * @param {number}   [options.maxLength]  大于这个长度的帧当作脏帧丢弃
 * @param {boolean}  [options.lockLength] 锁定帧长，默认 true，见下面 LOCK_AFTER 处的说明
 * @returns {object} push 返回本次完整载荷数组；reset 清理半包、锁长状态与累计丢帧数。
 */
export function createFramer(options = {}) {
  options = validateFramerOptions(options);
  const delimiter = Uint8Array.from(options.delimiter ?? DEFAULT_DELIMITER);
  const minLength = options.minLength ?? 8;
  const maxLength = options.maxLength ?? 8192;
  const lockLength = options.lockLength !== false;
  // 缓冲区上限：超过后只保留末尾 maxLength 字节，避免一直收不到下个分隔符时无限增长。
  const bufferLimit = maxLength * 4;

  // 帧长锁定。分隔符只有 4 个字节，数据里迟早会撞出一个一模一样的，
  // 于是切出一个长度不对的短帧。这种帧长度多半不是完全平方数，解码时会退化成
  // 1×N 一条横线，画面就在方阵和横线之间狂闪——这不是渲染的问题，是脏帧混进来了。
  // 所以：连着几帧长度一致就把它锁死，之后长度对不上的一律当脏帧丢掉。
  // 万一锁错了（比如第一帧本身就是残的），另一个长度连着来够多次就改锁它，能自己纠回来。
  const LOCK_AFTER = 3;
  const RELOCK_AFTER = 12;
  let locked = 0;
  let runLength = 0;
  let runCount = 0;

  let buffer = new Uint8Array(0);
  let dropped = 0;

  /** 返回这一帧要不要收下 */
  function accept(len) {
    if (!lockLength) return true;
    if (len === runLength) runCount += 1;
    else {
      runLength = len;
      runCount = 1;
    }
    if (!locked) {
      if (runCount >= LOCK_AFTER) locked = len;
      return true; // 还没锁上，先全收下，免得开头几帧被白丢
    }
    if (len === locked) return true;
    if (runCount >= RELOCK_AFTER) {
      locked = len; // 锁错了，改锁这个
      return true;
    }
    return false;
  }

  /** 输入一个字节块，可能返回零帧或多帧；末尾缺少分隔符的载荷留到下次继续拼接。 */
  function push(chunk) {
    if (!chunk || chunk.length === 0) return [];
    if (!(chunk instanceof Uint8Array) && (!Array.isArray(chunk)
      || !chunk.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255))) {
      throw new ShroomError('PARSE_FAILED', '输入数据必须是字节数组', { stage: 'parse' });
    }
    buffer = concat(buffer, chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk));

    const frames = [];
    let start = indexOfBytes(buffer, delimiter, 0);

    if (start < 0) {
      // 还没对上分隔符，只保留末尾几个字节（分隔符可能被切断在两个 chunk 之间）
      if (buffer.length > delimiter.length) {
        buffer = buffer.slice(buffer.length - delimiter.length + 1);
      }
      return frames;
    }

    for (;;) {
      const next = indexOfBytes(buffer, delimiter, start + delimiter.length);
      if (next < 0) break;
      const payload = buffer.slice(start + delimiter.length, next);
      if (payload.length >= minLength && payload.length <= maxLength && accept(payload.length)) {
        frames.push(payload);
      } else {
        dropped += 1;
      }
      start = next;
    }

    buffer = buffer.slice(start);
    if (buffer.length > bufferLimit) buffer = buffer.slice(-maxLength);
    return frames;
  }

  /** 供连接重新开始时调用；不能把前一个设备的半包或锁定长度带到新字节流中。 */
  function reset() {
    buffer = new Uint8Array(0);
    dropped = 0;
    locked = 0;
    runLength = 0;
    runCount = 0;
  }

  return {
    push,
    reset,
    /** 被丢弃的脏帧数量，用来判断协议参数是不是配错了 */
    get droppedCount() {
      return dropped;
    },
    /** 锁定下来的帧长（字节）。还没锁上是 0 */
    get frameLength() {
      return locked;
    },
  };
}
