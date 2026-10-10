const fs = require('fs');
const path = require('path');
const { buildStoredFrameRow, safeJson } = require('./frameRecord');

let Database;

function loadDatabase() {
  if (!Database) {
    Database = require('better-sqlite3');
  }
  return Database;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class CaptureStore {
  constructor(options = {}) {
    const dbDir = options.dbDir || path.join(process.cwd(), 'db');
    ensureDir(dbDir);
    this.dbPath = options.dbPath || path.join(dbDir, 'sdk_capture.db');
    const BetterSqlite3 = loadDatabase();
    this.db = new BetterSqlite3(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000');
    this.db.pragma('temp_store = MEMORY');
    this.ensureSchema();
    this.prepareStatements();
  }

  prepareStatements() {
    this.insertFrameStatement = this.db.prepare(`
      INSERT INTO frames (
        capture_id,
        sensor_type,
        channel,
        timestamp,
        raw_frame_hex,
        data_json,
        stats_json,
        extra_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertFramesTransaction = this.db.transaction((rows) => {
      rows.forEach((row) => this.insertFrameStatement.run(
        row.capture_id,
        row.sensor_type,
        row.channel,
        row.timestamp,
        row.raw_frame_hex,
        row.data_json,
        row.stats_json,
        row.extra_json,
      ));
    });
    this.deleteCaptureTransaction = this.db.transaction((captureId) => {
      const framesDeleted = this.db.prepare('DELETE FROM frames WHERE capture_id = ?').run(captureId).changes;
      const capturesDeleted = this.db.prepare('DELETE FROM captures WHERE id = ?').run(captureId).changes;
      return { captureId, capturesDeleted, framesDeleted };
    });
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sensor_type TEXT NOT NULL,
        hz REAL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        ended_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_captures_name_sensor
        ON captures(name, sensor_type);

      CREATE TABLE IF NOT EXISTS frames (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        capture_id INTEGER NOT NULL,
        sensor_type TEXT NOT NULL,
        channel TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        raw_frame_hex TEXT,
        data_json TEXT NOT NULL,
        stats_json TEXT,
        extra_json TEXT,
        FOREIGN KEY(capture_id) REFERENCES captures(id)
      );

      CREATE INDEX IF NOT EXISTS idx_frames_capture_time
        ON frames(capture_id, timestamp);
    `);
  }

  createCapture({ name, sensorType, hz = null, metadata = {} }) {
    const captureName = name || `${sensorType}_${Date.now()}`;
    const result = this.db.prepare(`
      INSERT INTO captures (name, sensor_type, hz, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(captureName, sensorType, hz, safeJson(metadata), Date.now());

    return {
      id: Number(result.lastInsertRowid),
      name: captureName,
      sensorType,
      hz,
      metadata,
    };
  }

  finishCapture(captureId) {
    this.db.prepare('UPDATE captures SET ended_at = ? WHERE id = ?').run(Date.now(), captureId);
  }

  insertFrame({ captureId, sensorType, channel = 'sit', rawFrame, frame }) {
    return this.insertFrames([{ captureId, sensorType, channel, rawFrame, frame }]);
  }

  insertFrames(frames = []) {
    if (!Array.isArray(frames) || !frames.length) return 0;
    const rows = frames.map(buildStoredFrameRow);
    this.insertFramesTransaction(rows);
    return rows.length;
  }

  getFreeBytes() {
    if (typeof fs.statfsSync !== 'function') return null;
    try {
      const stat = fs.statfsSync(path.dirname(this.dbPath));
      return Number(stat.bavail ?? stat.bfree ?? 0) * Number(stat.bsize || 0);
    } catch {
      return null;
    }
  }

  listCaptures(filter = {}) {
    const where = [];
    const values = [];
    if (filter.sensorType) {
      where.push('sensor_type = ?');
      values.push(filter.sensorType);
    }
    if (filter.captureName || filter.name) {
      where.push('name = ?');
      values.push(filter.captureName || filter.name);
    }
    if (Number.isFinite(Number(filter.createdFrom))) {
      where.push('created_at >= ?');
      values.push(Number(filter.createdFrom));
    }
    if (Number.isFinite(Number(filter.createdTo))) {
      where.push('created_at <= ?');
      values.push(Number(filter.createdTo));
    }

    let sql = `SELECT * FROM captures${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC`;
    const limit = normalizeLimit(filter.limit);
    const offset = normalizeOffset(filter.offset);
    if (limit != null) {
      sql += ' LIMIT ? OFFSET ?';
      values.push(limit, offset);
    } else if (offset) {
      sql += ' LIMIT -1 OFFSET ?';
      values.push(offset);
    }
    return this.db.prepare(sql).all(...values);
  }

  countCaptures(filter = {}) {
    const where = [];
    const values = [];
    if (filter.sensorType) {
      where.push('sensor_type = ?');
      values.push(filter.sensorType);
    }
    if (filter.captureName || filter.name) {
      where.push('name = ?');
      values.push(filter.captureName || filter.name);
    }
    if (Number.isFinite(Number(filter.createdFrom))) {
      where.push('created_at >= ?');
      values.push(Number(filter.createdFrom));
    }
    if (Number.isFinite(Number(filter.createdTo))) {
      where.push('created_at <= ?');
      values.push(Number(filter.createdTo));
    }
    const sql = `SELECT COUNT(*) AS count FROM captures${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    return Number(this.db.prepare(sql).get(...values).count);
  }

  getCapture({ captureId, captureName, sensorType } = {}) {
    if (captureId) {
      return this.db.prepare('SELECT * FROM captures WHERE id = ?').get(captureId);
    }

    if (captureName && sensorType) {
      return this.db.prepare(`
        SELECT * FROM captures
        WHERE name = ? AND sensor_type = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).get(captureName, sensorType);
    }

    if (captureName) {
      return this.db.prepare(`
        SELECT * FROM captures
        WHERE name = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `).get(captureName);
    }

    return null;
  }

  queryFrames(options = {}) {
    const { captureId, captureName, sensorType } = options;
    const capture = this.getCapture({ captureId, captureName, sensorType });
    if (!capture) {
      return [];
    }

    const where = ['frames.capture_id = ?'];
    const values = [capture.id];
    if (options.channel) {
      where.push('frames.channel = ?');
      values.push(options.channel);
    }
    if (Number.isFinite(Number(options.fromTimestamp))) {
      where.push('frames.timestamp >= ?');
      values.push(Number(options.fromTimestamp));
    }
    if (Number.isFinite(Number(options.toTimestamp))) {
      where.push('frames.timestamp <= ?');
      values.push(Number(options.toTimestamp));
    }

    let sql = `
      SELECT frames.*, captures.name AS capture_name, captures.hz
      FROM frames
      JOIN captures ON captures.id = frames.capture_id
      WHERE ${where.join(' AND ')}
      ORDER BY frames.timestamp ASC, frames.id ASC
    `;
    const limit = normalizeLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    if (limit != null) {
      sql += ' LIMIT ? OFFSET ?';
      values.push(limit, offset);
    } else if (offset) {
      sql += ' LIMIT -1 OFFSET ?';
      values.push(offset);
    }
    return this.db.prepare(sql).all(...values);
  }

  countFrames(options = {}) {
    const capture = this.getCapture(options);
    if (!capture) return 0;
    const where = ['capture_id = ?'];
    const values = [capture.id];
    if (options.channel) {
      where.push('channel = ?');
      values.push(options.channel);
    }
    if (Number.isFinite(Number(options.fromTimestamp))) {
      where.push('timestamp >= ?');
      values.push(Number(options.fromTimestamp));
    }
    if (Number.isFinite(Number(options.toTimestamp))) {
      where.push('timestamp <= ?');
      values.push(Number(options.toTimestamp));
    }
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM frames WHERE ${where.join(' AND ')}`).get(...values);
    return Number(row.count);
  }

  deleteCapture(options = {}) {
    const capture = this.getCapture(options);
    if (!capture) return { captureId: null, capturesDeleted: 0, framesDeleted: 0 };
    return this.deleteCaptureTransaction(capture.id);
  }

  close() {
    this.db.close();
  }
}

function normalizeLimit(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeOffset(value) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : 0;
}

module.exports = {
  CaptureStore,
};
