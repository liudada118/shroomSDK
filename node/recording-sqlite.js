/** SQLite 录制仓库：事务写入帧与进度，独立数据库锁防止同目录被多个服务同时恢复。 */
import { join } from 'node:path';
import { ShroomError } from '../core/errors.js';

export const RECORDING_DATABASE_VERSION = 1;
let databaseConstructor;

/** 将底层存储错误转成稳定错误，不把本机数据库路径写入公开消息。 */
function storageError(message, cause) {
  return new ShroomError('RECORDING_WRITE_FAILED', message, { stage: 'recording', cause });
}

/** 只在 Node 创建或读取录制仓库时加载原生 SQLite 依赖。 */
async function loadDatabase() {
  if (databaseConstructor) return databaseConstructor;
  try {
    const module = await import('better-sqlite3');
    databaseConstructor = module.default;
    return databaseConstructor;
  } catch (cause) {
    throw new ShroomError('DEPENDENCY_MISSING', 'SQLite 采集需要安装依赖：npm install better-sqlite3@^11.10.0', {
      stage: 'recording', cause,
      suggestion: '在 SDK 目录安装依赖；Electron 应为自己的运行时重建原生模块。',
    });
  }
}

/** 原生模块缺失或 ABI 不匹配属于依赖错误，权限与锁冲突属于存储错误。 */
function openingError(cause, message) {
  if (['MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'].includes(cause?.code)
    || /bindings file|NODE_MODULE_VERSION|compiled against a different Node/i.test(cause?.message ?? '')) {
    return new ShroomError('DEPENDENCY_MISSING', 'SQLite 原生依赖不可用，请在当前 Node.js 或 Electron 环境重新安装依赖。', {
      stage: 'recording', cause,
    });
  }
  return storageError(message, cause);
}

/** 把数据库行恢复为原有会话对象，保持公开字段与五步 API 一致。 */
function sessionFromRow(row) {
  return {
    id: row.id, label: row.label, startedAt: row.started_at, endedAt: row.ended_at,
    frameCount: row.frame_count, status: row.status,
    ...(row.product ? { product: row.product } : {}),
    ...(row.side ? { side: row.side } : {}),
    ...(row.source ? { source: row.source } : {}),
    ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}),
  };
}

/** 获取目录独占锁后打开主库；异常退出由 SQLite/操作系统释放锁，不删除未知锁文件。 */
export async function openRecordingDatabase(directory) {
  const Database = await loadDatabase();
  const path = join(directory, 'recordings.sqlite');
  let owner;
  let db;
  try {
    // owner 库保持独占事务，主库仍使用 WAL 供下载连接并行读取。
    owner = new Database(join(directory, 'recordings.owner.sqlite'), { timeout: 0 });
    owner.pragma('journal_mode = DELETE');
    owner.exec('BEGIN EXCLUSIVE');
    db = new Database(path, { timeout: 1000 });
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    const version = db.pragma('user_version', { simple: true });
    if (version !== 0 && version !== RECORDING_DATABASE_VERSION) {
      throw new Error('不支持的录制数据库版本。');
    }
    if (version === 0) {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length) throw new Error('未识别的数据库结构，不能覆盖。');
      db.transaction(() => {
        db.exec(`
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            frame_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK (status IN ('recording', 'stopped', 'error')),
            product TEXT,
            side TEXT,
            source TEXT,
            error_json TEXT
          );
          CREATE TABLE frames (
            session_id TEXT NOT NULL REFERENCES sessions(id),
            frame_index INTEGER NOT NULL,
            timestamp REAL NOT NULL,
            row_json TEXT NOT NULL,
            PRIMARY KEY (session_id, frame_index)
          );
          PRAGMA user_version = 1;
        `);
      })();
    }

    // 帧与 frame_count 同事务提交；异常退出只恢复已提交记录，不把队列长度当已保存帧数。
    const interrupted = JSON.stringify({ code: 'RECORDING_INTERRUPTED', message: '上次服务退出前未正常停止录制；文件可能不完整。' });
    db.transaction(() => {
      db.prepare(`UPDATE sessions SET status = 'error', ended_at = ?, error_json = ?,
        frame_count = (SELECT COUNT(*) FROM frames WHERE frames.session_id = sessions.id)
        WHERE status = 'recording'`).run(Date.now(), interrupted);
    })();

    const insertSession = db.prepare(`INSERT INTO sessions
      (id, label, started_at, ended_at, frame_count, status, product, side, source, error_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertFrame = db.prepare('INSERT INTO frames (session_id, frame_index, timestamp, row_json) VALUES (?, ?, ?, ?)');
    const addProgress = db.prepare('UPDATE sessions SET frame_count = frame_count + ? WHERE id = ?');
    const finishSession = db.prepare('UPDATE sessions SET ended_at = ?, frame_count = ?, status = ?, error_json = ? WHERE id = ?');
    const appendBatch = db.transaction((id, rows) => {
      for (const row of rows) insertFrame.run(id, row.index, row.timestamp, row.text);
      if (addProgress.run(rows.length, id).changes !== 1) throw new Error('录制会话不存在。');
    });
    let closed = false;
    return {
      path,
      /** 历史列表只读取会话元数据，不把全部帧载入内存。 */
      list() { return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all().map(sessionFromRow); },
      /** 先持久化会话，再允许向该会话追加帧。 */
      start(meta) {
        insertSession.run(meta.id, meta.label, meta.startedAt, null, 0, 'recording',
          meta.product ?? null, meta.side ?? null, meta.source ?? null, null);
      },
      /** 整批帧与帧数原子提交；任意一帧失败会回滚整批。 */
      append(id, rows) { appendBatch(id, rows); },
      /** 所有帧提交后保存最终状态，失败时由录制器保留错误快照。 */
      finish(meta) {
        if (finishSession.run(meta.endedAt, meta.frameCount, meta.status,
          meta.error ? JSON.stringify(meta.error) : null, meta.id).changes !== 1) {
          throw new Error('录制会话不存在。');
        }
      },
      /** 关闭主库并释放独占锁；主库关闭失败也继续释放锁连接。 */
      close() {
        if (closed) return;
        closed = true;
        const errors = [];
        try { db.close(); } catch (error) { errors.push(error); }
        try { if (owner.inTransaction) owner.exec('ROLLBACK'); } catch (error) { errors.push(error); }
        try { owner.close(); } catch (error) { errors.push(error); }
        if (errors.length) throw storageError('关闭录制数据库失败。', errors.length === 1 ? errors[0] : new AggregateError(errors));
      },
    };
  } catch (cause) {
    try { if (db?.open) db.close(); } catch { /* 继续释放目录锁。 */ }
    try { if (owner?.inTransaction) owner.exec('ROLLBACK'); } catch { /* close 仍会释放连接资源。 */ }
    try { if (owner?.open) owner.close(); } catch { /* 保留初始化原始错误。 */ }
    const message = ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(cause?.code)
      ? '采集目录正被其他服务使用，请关闭该服务或选择另一个目录。'
      : '无法打开录制数据库，请检查依赖、目录权限、磁盘空间和数据库版本。';
    throw openingError(cause, message);
  }
}

/** 为一次下载打开独立只读连接；生成器结束或取消时必须关闭。 */
export async function openRecordingReader(path) {
  const Database = await loadDatabase();
  let db;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true, timeout: 1000 });
    if (db.pragma('user_version', { simple: true }) !== RECORDING_DATABASE_VERSION) {
      throw new Error('不支持的录制数据库版本。');
    }
    // 下载只读取已结束、不可变的会话；逐页释放读快照，慢客户端下载不阻塞 WAL 回收。
    return db;
  } catch (cause) {
    try { if (db?.open) db.close(); } catch { /* 保留读取原始错误。 */ }
    throw openingError(cause, '无法读取录制数据库，请检查文件和权限。');
  }
}
