const fs = require('fs');
const path = require('path');

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

function safeJson(value, fallback = {}) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
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
    this.ensureSchema();
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
    if (!captureId) {
      throw new Error('captureId is required');
    }

    const data = Array.isArray(frame?.pressureData)
      ? frame.pressureData
      : Array.isArray(frame?.data)
        ? frame.data
        : [];

    this.db.prepare(`
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
    `).run(
      captureId,
      sensorType || frame?.sensorType || '',
      channel || frame?.channel || 'sit',
      frame?.timestamp || Date.now(),
      rawFrame ? Buffer.from(rawFrame).toString('hex') : null,
      safeJson(data, []),
      safeJson(frame?.stats, {}),
      safeJson({
        rotate: frame?.rotate || [],
        matrix: frame?.matrix || {},
        extra: frame?.extra || {},
      }),
    );
  }

  listCaptures(filter = {}) {
    if (filter.sensorType) {
      return this.db.prepare(`
        SELECT * FROM captures
        WHERE sensor_type = ?
        ORDER BY created_at DESC
      `).all(filter.sensorType);
    }

    return this.db.prepare('SELECT * FROM captures ORDER BY created_at DESC').all();
  }

  getCapture({ captureId, captureName, sensorType } = {}) {
    if (captureId) {
      return this.db.prepare('SELECT * FROM captures WHERE id = ?').get(captureId);
    }

    if (captureName && sensorType) {
      return this.db.prepare(`
        SELECT * FROM captures
        WHERE name = ? AND sensor_type = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(captureName, sensorType);
    }

    if (captureName) {
      return this.db.prepare(`
        SELECT * FROM captures
        WHERE name = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(captureName);
    }

    return null;
  }

  queryFrames({ captureId, captureName, sensorType } = {}) {
    const capture = this.getCapture({ captureId, captureName, sensorType });
    if (!capture) {
      return [];
    }

    return this.db.prepare(`
      SELECT frames.*, captures.name AS capture_name, captures.hz
      FROM frames
      JOIN captures ON captures.id = frames.capture_id
      WHERE frames.capture_id = ?
      ORDER BY frames.timestamp ASC, frames.id ASC
    `).all(capture.id);
  }

  close() {
    this.db.close();
  }
}

module.exports = {
  CaptureStore,
};
