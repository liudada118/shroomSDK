/** 单会话 SQLite 采集：批量事务保存完整帧，CSV/JSONL 仅在下载时导出。 */
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { ShroomError } from '../core/errors.js';
import { STREAM_SCHEMA } from '../core/stream-codec.js';
import { openRecordingDatabase, openRecordingReader } from './recording-sqlite.js';

/** 仅接受 SDK 生成的 UUID v4；下载接口不接受任意文件路径。 */
export const RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUEUE_BYTES = 16 * 1024 * 1024;
const BATCH_SIZE = 200;
const FLUSH_INTERVAL_MS = 250;
const CSV_COLUMNS = ['sessionId', 'label', 'index', 'timestamp', 'source', 'product', 'side', 'sequence', 'raw', 'pressure', 'pressureMatrix', 'fingers', 'palm', 'frame'];

/** 将底层异常归入录制阶段，公开消息不包含本机磁盘路径。 */
function recordingError(code, message, cause) {
  return new ShroomError(code, message, { stage: 'recording', cause });
}

/** 转义 CSV 引号，并给可能被表格软件当作公式的内容加前缀。 */
function csvCell(value) {
  let text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** 将旧版路径参数转换成只读 JSONL 描述符，兼容原 recordingCsv(path) 用法。 */
function recordingDescriptor(recording) {
  if (typeof recording === 'string') return { path: recording, format: 'jsonl' };
  if (!recording || typeof recording.path !== 'string' || !['sqlite', 'jsonl'].includes(recording.format)) {
    throw recordingError('INVALID_CONFIG', '请传入有效的录制下载描述符。');
  }
  if (recording.format === 'sqlite' && !RECORDING_ID.test(recording.meta?.id)) {
    throw recordingError('RECORDING_NOT_FOUND', '找不到录制记录。');
  }
  return recording;
}

/** 按序分页读取 SQLite 帧或旧 JSONL 行，下载中断后释放只读连接和文件句柄。 */
async function* recordingLines(recording) {
  const descriptor = recordingDescriptor(recording);
  if (descriptor.format === 'sqlite') {
    const db = await openRecordingReader(descriptor.path);
    try {
      const id = descriptor.meta.id;
      if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)) {
        throw recordingError('RECORDING_NOT_FOUND', '找不到录制记录。');
      }
      const query = db.prepare(`SELECT frame_index, row_json FROM frames
        WHERE session_id = ? AND frame_index > ? ORDER BY frame_index LIMIT ?`);
      let lastIndex = -1;
      for (;;) {
        const rows = query.all(id, lastIndex, BATCH_SIZE);
        if (!rows.length) break;
        for (const row of rows) yield row.row_json;
        lastIndex = rows[rows.length - 1].frame_index;
        await new Promise((done) => setImmediate(done));
      }
    } finally {
      db.close();
    }
    return;
  }
  const input = createReadStream(descriptor.path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line) yield line;
  } finally {
    lines.close();
    input.destroy();
  }
}

/** 从数据库导出完整 JSONL；旧记录直接流式读取原文件，不重写历史数据。 */
export async function* recordingJsonl(recording) {
  const descriptor = recordingDescriptor(recording);
  if (descriptor.format === 'jsonl') {
    const input = createReadStream(descriptor.path);
    try { for await (const chunk of input) yield chunk; }
    finally { input.destroy(); }
    return;
  }
  for await (const line of recordingLines(descriptor)) yield `${line}\n`;
}

/** 流式生成带 UTF-8 BOM 的 CSV；每次最多读取 200 帧，数组与分区保留为 JSON 单元格。 */
export async function* recordingCsv(recording) {
  yield `\ufeff${CSV_COLUMNS.map(csvCell).join(',')}\r\n`;
  for await (const line of recordingLines(recording)) {
    const row = JSON.parse(line);
    const frame = row.frame;
    const values = { ...row, product: frame.product, side: frame.side, sequence: frame.sequence,
      raw: frame.raw, pressure: frame.pressure, pressureMatrix: frame.pressureMatrix,
      fingers: frame.fingers, palm: frame.palm, frame };
    yield `${CSV_COLUMNS.map((key) => csvCell(values[key])).join(',')}\r\n`;
  }
}

/**
 * 创建带目录锁的 SQLite 录制器，兼容读取旧 JSONL 与元信息文件。
 * 满 200 帧、等待 250ms 或停止时事务提交；帧数只计已提交记录。
 * 待提交帧受 maxQueueFrames 与 16 MiB 限制，溢出停止接收并尽量写完已接收帧。
 * append 接收 encodeStreamFrame 的序列化结果；本模块不关闭串口设备。
 */
export async function createRecordingStore({ directory, maxQueueFrames = 1000, onChange = () => {} }) {
  if (typeof directory !== 'string' || !directory.trim() || !Number.isInteger(maxQueueFrames) || maxQueueFrames < 1) {
    throw recordingError('INVALID_CONFIG', '请提供有效的录制目录与队列帧数上限。');
  }
  const root = resolve(directory);
  let database;
  const records = new Map();
  const legacyIds = new Set();
  try {
    await mkdir(root, { recursive: true });
    database = await openRecordingDatabase(root);
    for (const meta of database.list()) records.set(meta.id, meta);
    // 旧数据只读兼容，不将未完成记录或损坏文件误报为成功，也不修改原文件。
    for (const file of await readdir(root)) {
      const id = file.replace(/\.meta\.json$/, '');
      if (!file.endsWith('.meta.json') || !RECORDING_ID.test(id) || records.has(id)) continue;
      try {
        const meta = JSON.parse(await readFile(join(root, file), 'utf8'));
        if (meta.id !== id || !['recording', 'stopped', 'error'].includes(meta.status)) continue;
        if (meta.status === 'recording') {
          meta.status = 'error';
          meta.endedAt = Date.now();
          meta.error = { code: 'RECORDING_INTERRUPTED', message: '上次服务退出前未正常停止录制；文件可能不完整。' };
        }
        records.set(id, meta);
        legacyIds.add(id);
      } catch { /* 损坏或不属于 SDK 的旧文件不进入列表。 */ }
    }
  } catch (cause) {
    try { database?.close(); } catch { /* 保留初始化原始错误。 */ }
    if (cause instanceof ShroomError) throw cause;
    throw recordingError('RECORDING_WRITE_FAILED', '无法打开录制目录，请检查目录权限和磁盘空间。', cause);
  }
  let active = null;
  let starting = false;
  let closed = false;
  let closing;

  /** 返回独立状态快照，外部修改不会影响内部会话或历史列表。 */
  function snapshot(meta = active?.meta) {
    return meta ? { ...meta, ...(meta.error ? { error: { ...meta.error } } : {}) } : null;
  }

  /** 广播快照，观察者异常不改变事务和采集生命周期。 */
  function notify(meta) {
    try { onChange(snapshot(meta)); } catch { /* 应用负责处理自己的状态回调。 */ }
  }

  /** 清除尚未触发的批量写入定时器，停止和关闭时不能留下后台任务。 */
  function clearFlush(session) {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
  }

  /** 保留最先出现的异常，停止接收新帧并等待已接收帧收尾。 */
  function fail(session, error) {
    if (session.meta.status === 'error') return;
    session.accepting = false;
    session.meta.status = 'error';
    session.meta.error = { code: error.code ?? 'RECORDING_WRITE_FAILED', message: error.message };
    notify(session.meta);
    void finish(session).catch(() => {});
  }

  /** 串行提交最多 200 帧的事务，每批之间让出事件循环；失败批次不增加帧数。 */
  function pump(session) {
    clearFlush(session);
    if (session.pumping) return session.pumping;
    session.pumping = Promise.resolve().then(async () => {
      while (session.queue.length) {
        const rows = session.queue.splice(0, BATCH_SIZE);
        try {
          database.append(session.meta.id, rows);
          session.meta.frameCount += rows.length;
          session.outstanding -= rows.length;
          session.queuedBytes -= rows.reduce((total, row) => total + row.bytes, 0);
        } catch (cause) {
          // SQLite 已回滚整个批次；剩余队列不能继续写成一条看似成功的记录。
          session.queue.length = 0;
          session.outstanding = 0;
          session.queuedBytes = 0;
          fail(session, recordingError('RECORDING_WRITE_FAILED', '录制数据库写入失败，请检查磁盘、权限和数据库状态。', cause));
          break;
        }
        if (session.queue.length) await new Promise((done) => setImmediate(done));
      }
    }).finally(() => {
      session.pumping = null;
      // append 可能在最后一批结束与 finally 之间到达，仍须安排下一次提交。
      if (session.queue.length && session.accepting) scheduleFlush(session);
    });
    return session.pumping;
  }

  /** 低频数据最多等待 250ms；达到批量阈值立即开始提交。 */
  function scheduleFlush(session) {
    if (session.pumping) return;
    if (session.queue.length >= BATCH_SIZE) {
      void pump(session);
    } else if (!session.timer) {
      session.timer = setTimeout(() => { session.timer = null; void pump(session); }, FLUSH_INTERVAL_MS);
    }
  }

  /** 幂等收尾：先关闭接收入口，再排空事务队列，最后保存状态；错误记录仍可导出已提交帧。 */
  function finish(session) {
    if (session.finishing) return session.finishing;
    session.accepting = false;
    clearFlush(session);
    session.finishing = Promise.resolve().then(async () => {
      // 等待已有 pump 后再检查队列，避免末批完成时到达的帧落在收尾之外。
      do { await pump(session); } while (session.queue.length || session.pumping);
      session.meta.endedAt = Date.now();
      if (session.meta.status !== 'error') session.meta.status = 'stopped';
      try {
        database.finish(session.meta);
      } catch (cause) {
        session.meta.status = 'error';
        session.meta.error = { code: 'RECORDING_WRITE_FAILED', message: '录制状态保存失败，重启后需检查记录是否完整。' };
        throw recordingError('RECORDING_WRITE_FAILED', session.meta.error.message, cause);
      } finally {
        session.finished = true;
        records.set(session.meta.id, snapshot(session.meta));
        notify(session.meta);
      }
    });
    return session.finishing;
  }

  return {
    /** 创建固定标签会话；上一记录收尾后才开始下一条，失败时不进入采集中状态。 */
    async start({ label, product, side, source } = {}) {
      if (closed) throw recordingError('SERVER_CLOSED', '服务已关闭。');
      if (starting || (active && !active.finishing && active.accepting)) {
        throw recordingError('RECORDING_ACTIVE', '请先停止当前录制，再开始新的标签录制。');
      }
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(label)) {
        throw recordingError('INVALID_CONFIG', '标签需要是 1–200 字符的非空文本，不能包含控制字符。');
      }
      starting = true;
      try {
        if (active?.finishing) await active.finishing;
        if (closed) throw recordingError('SERVER_CLOSED', '服务已关闭。');
        const meta = { id: randomUUID(), label: label.trim(), startedAt: Date.now(), endedAt: null, frameCount: 0, status: 'recording',
          ...(product ? { product } : {}), ...(side ? { side } : {}), ...(source ? { source } : {}) };
        database.start(meta);
        active = { meta, accepting: true, queue: [], queuedBytes: 0, outstanding: 0, nextIndex: 0,
          pumping: null, finishing: null, timer: null, finished: false };
        records.set(meta.id, snapshot(meta));
        notify(meta);
        return snapshot(meta);
      } catch (cause) {
        if (cause instanceof ShroomError) throw cause;
        throw recordingError('RECORDING_WRITE_FAILED', '无法创建录制会话，请检查数据库、目录权限和磁盘空间。', cause);
      } finally { starting = false; }
    },

    /** 将一帧加入有界 FIFO 队列；溢出明确结束记录，不静默丢帧继续采集。 */
    append(frame) {
      const session = active;
      if (!session?.accepting) return;
      let row;
      let text;
      try {
        row = { schema: STREAM_SCHEMA, sessionId: session.meta.id, label: session.meta.label,
          index: session.nextIndex, timestamp: frame.timestamp, source: session.meta.source ?? '', frame };
        text = JSON.stringify(row);
      } catch (cause) {
        fail(session, recordingError('RECORDING_WRITE_FAILED', '录制帧无法序列化，请检查产品数据。', cause));
        return;
      }
      const bytes = Buffer.byteLength(text);
      if (session.outstanding >= maxQueueFrames || session.queuedBytes + bytes > MAX_QUEUE_BYTES) {
        fail(session, recordingError('RECORDING_OVERFLOW', '磁盘写入跟不上采集，录制已停止；已接收帧会写完，请降低采集频率或使用更快磁盘。'));
        return;
      }
      session.queue.push({ index: session.nextIndex, timestamp: row.timestamp, text, bytes });
      session.nextIndex += 1;
      session.outstanding += 1;
      session.queuedBytes += bytes;
      scheduleFlush(session);
    },

    /** 停止接收并等待全部事务收尾；重复停止返回新的独立快照。 */
    async stop() {
      if (!active) throw recordingError('RECORDING_NOT_ACTIVE', '当前没有录制任务。');
      const session = active;
      await finish(session);
      return snapshot(session.meta);
    },

    /** 设备或授权异常时结束采集，尽量提交已接收帧并保留错误原因。 */
    async abort(error) {
      if (!active) return null;
      const session = active;
      if (session.accepting) fail(session, error);
      if (session.finishing) await session.finishing;
      return snapshot(session.meta);
    },

    /** 返回本次会话快照，关闭数据库后仍可查询最后结果。 */
    status() { return snapshot(); },

    /** 历史按开始时间倒序，活动记录用当前已提交帧数覆盖缓存。 */
    list() {
      const list = new Map(records);
      if (active) list.set(active.meta.id, snapshot());
      return [...list.values()].map((meta) => snapshot(meta)).sort((a, b) => b.startedAt - a.startedAt);
    },

    /** 只定位已知、完成收尾的记录；调用方按 format 选择 SQLite 导出或旧文件读取。 */
    download(id) {
      if (!RECORDING_ID.test(id)) throw recordingError('RECORDING_NOT_FOUND', '找不到录制记录。');
      const meta = active?.meta.id === id ? active.meta : records.get(id);
      if (!meta) throw recordingError('RECORDING_NOT_FOUND', '找不到录制记录。');
      if (meta.status === 'recording' || (active?.meta.id === id && !active.finished)) {
        throw recordingError('RECORDING_ACTIVE', '请先停止录制并等待事务提交完成，再下载。');
      }
      const legacy = legacyIds.has(id);
      return { meta: snapshot(meta), path: legacy ? join(root, `${id}.jsonl`) : database.path,
        format: legacy ? 'jsonl' : 'sqlite' };
    },

    /** 禁止新采集，等待事务收尾并关闭数据库；任何失败仍释放目录锁。 */
    close() {
      if (closing) return closing;
      closed = true;
      closing = Promise.resolve().then(async () => {
        const errors = [];
        try { if (active) await finish(active); } catch (error) { errors.push(error); }
        try { database.close(); } catch (error) { errors.push(error); }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, '录制收尾与数据库关闭失败。');
      });
      return closing;
    },
  };
}
