/**
 * backend-capture-store.test.mjs - SQLite 采集存储
 *
 * 单独成文是因为它是 `src/` 里唯一有真实磁盘 IO 的模块：建库、建表、WAL、
 * 写盘、查询。用临时目录跑，每个用例自己清理。
 *
 * 同时校验一条容易漂的性质：**`CaptureStore` 与 `MemoryCaptureStore` 的返回
 * 结构必须一致**——`CsvExporter` 和 `ReplayService` 对两者是同一套读法，
 * 字段名差一个就会静默产出空 CSV。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CaptureStore, CsvExporter, MemoryCaptureStore } from '../index.js'

/**
 * `better-sqlite3` 是原生模块，需要按当前 Node ABI 编译。CI 或干净签出里
 * 装不上构建工具时它会缺 bindings —— 这也正是 `src/` 长期没有测试的一个原因。
 *
 * 缺的时候**跳过而不是失败**，但跳过原因要写在报告里：静默通过会给人
 * 「SQLite 存储已被覆盖」的错觉。`MemoryCaptureStore` 的等价用例在
 * `backend-core.test.mjs` 里，不依赖原生模块。
 */
function probeSqlite() {
  try {
    const store = new CaptureStore({ dbDir: mkdtempSync(join(tmpdir(), 'shroom-probe-')) })
    store.close()
    return null
  } catch (error) {
    return error.message.split('\n')[0]
  }
}

const sqliteUnavailable = probeSqlite()
const skip = sqliteUnavailable
  ? `better-sqlite3 原生模块不可用：${sqliteUnavailable}`
  : false

/** 建一个临时库，跑完自动清理。 */
function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'shroom-db-'))
  const store = new CaptureStore({ dbDir: dir })
  const cleanup = () => {
    try { store.close() } catch { /* 已关就算了 */ }
    rmSync(dir, { recursive: true, force: true })
  }

  try {
    const result = run(store, dir)
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup)
    }
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

/** 一帧典型数据。 */
function sampleFrame(timestamp = 1000) {
  return {
    data: [1, 2, 3],
    timestamp,
    stats: { max: 3, min: 1, total: 6, mean: 2, point: 3, length: 3 },
    rotate: [7],
    matrix: { width: 3, height: 1 },
    extra: { packetType: 1 },
  }
}

test('建库时把文件真的写到 dbDir 下', { skip }, () => {
  withStore((store, dir) => {
    assert.ok(existsSync(join(dir, 'sdk_capture.db')))
    assert.equal(store.dbPath, join(dir, 'sdk_capture.db'))
  })
})

test('dbPath 优先于 dbDir', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'shroom-db-'))
  const custom = join(dir, 'custom.db')
  const store = new CaptureStore({ dbDir: dir, dbPath: custom })
  try {
    assert.equal(store.dbPath, custom)
    assert.ok(existsSync(custom))
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('走完采集到查询一整圈', { skip }, () => {
  withStore((store) => {
    const capture = store.createCapture({
      name: 'run1',
      sensorType: 'hand0205',
      hz: 12,
      metadata: { note: 'x' },
    })

    store.insertFrame({
      captureId: capture.id,
      sensorType: 'hand0205',
      channel: 'sit',
      rawFrame: Buffer.from([0xaa, 0x55]),
      frame: sampleFrame(),
    })
    store.finishCapture(capture.id)

    const frames = store.queryFrames({ captureId: capture.id })
    assert.equal(frames.length, 1)
    assert.equal(frames[0].capture_name, 'run1')
    assert.equal(frames[0].hz, 12)
    assert.equal(frames[0].raw_frame_hex, 'aa55')
    assert.deepEqual(JSON.parse(frames[0].data_json), [1, 2, 3])
    assert.equal(JSON.parse(frames[0].stats_json).max, 3)
    assert.deepEqual(JSON.parse(frames[0].extra_json).rotate, [7])
  })
})

test('insertFrame 缺 captureId 时抛错', { skip }, () => {
  withStore((store) => {
    assert.throws(() => store.insertFrame({ frame: sampleFrame() }), /captureId is required/)
  })
})

test('帧按时间戳升序返回，乱序写入也一样', { skip }, () => {
  withStore((store) => {
    const capture = store.createCapture({ name: 'r', sensorType: 't' })
    for (const timestamp of [3000, 1000, 2000]) {
      store.insertFrame({ captureId: capture.id, frame: sampleFrame(timestamp) })
    }

    const frames = store.queryFrames({ captureId: capture.id })
    assert.deepEqual(frames.map((row) => row.timestamp), [1000, 2000, 3000])
  })
})

test('listCaptures 按创建时间倒序并支持 sensorType 过滤', { skip }, () => {
  withStore((store) => {
    store.createCapture({ name: 'a', sensorType: 'x' })
    store.createCapture({ name: 'b', sensorType: 'y' })

    assert.equal(store.listCaptures().length, 2)
    assert.equal(store.listCaptures({ sensorType: 'x' }).length, 1)
    assert.equal(store.listCaptures({ sensorType: 'x' })[0].name, 'a')
  })
})

test('SQLite 支持分页、通道时间筛选、计数和级联删除', { skip }, () => {
  withStore((store) => {
    const capture = store.createCapture({ name: 'paged', sensorType: 'matrix' })
    for (const [channel, timestamp] of [['left', 1000], ['right', 1100], ['left', 1200]]) {
      store.insertFrame({ captureId: capture.id, channel, frame: sampleFrame(timestamp) })
    }

    assert.equal(store.countCaptures({ sensorType: 'matrix' }), 1)
    assert.equal(store.countFrames({ captureId: capture.id, channel: 'left' }), 2)
    assert.deepEqual(
      store.queryFrames({ captureId: capture.id, channel: 'left', fromTimestamp: 1100, limit: 1 })
        .map((row) => row.timestamp),
      [1200],
    )
    assert.deepEqual(store.deleteCapture({ captureId: capture.id }), {
      captureId: capture.id,
      capturesDeleted: 1,
      framesDeleted: 3,
    })
    assert.equal(store.getCapture({ captureId: capture.id }), undefined)
  })
})

test('getCapture 三种查法', { skip }, () => {
  withStore((store) => {
    const capture = store.createCapture({ name: 'dup', sensorType: 'x' })
    store.createCapture({ name: 'dup', sensorType: 'y' })

    assert.equal(store.getCapture({ captureId: capture.id }).name, 'dup')
    assert.equal(store.getCapture({ captureName: 'dup', sensorType: 'y' }).sensor_type, 'y')
    // 只给名字时取最近一条。
    assert.equal(store.getCapture({ captureName: 'dup' }).sensor_type, 'y')
    assert.equal(store.getCapture({}), null)
  })
})

test('metadata 里带不可序列化的值时不抛错', { skip }, () => {
  withStore((store) => {
    const circular = {}
    circular.self = circular

    assert.doesNotThrow(() => store.createCapture({
      name: 'r', sensorType: 't', metadata: circular,
    }))
  })
})

test('查不到采集时 queryFrames 返回空数组', { skip }, () => {
  withStore((store) => {
    assert.deepEqual(store.queryFrames({ captureId: 999 }), [])
    assert.deepEqual(store.queryFrames({}), [])
  })
})

test('两种存储的返回结构一致（CsvExporter / ReplayService 对二者同一套读法）', { skip }, () => {
  withStore((sqlite) => {
    const memory = new MemoryCaptureStore()
    const seed = (store) => {
      const capture = store.createCapture({ name: 'r', sensorType: 't', hz: 10 })
      store.insertFrame({
        captureId: capture.id,
        sensorType: 't',
        channel: 'sit',
        rawFrame: Buffer.from([1]),
        frame: sampleFrame(),
      })
      return store.queryFrames({ captureId: capture.id })[0]
    }

    const fromSqlite = seed(sqlite)
    const fromMemory = seed(memory)

    // 内存版额外带一个驼峰 sensorType，其余键必须完全一致。
    const keysOf = (row) => Object.keys(row).filter((key) => key !== 'sensorType').sort()
    assert.deepEqual(keysOf(fromMemory), keysOf(fromSqlite))

    for (const key of keysOf(fromSqlite)) {
      assert.equal(typeof fromMemory[key], typeof fromSqlite[key], `字段 ${key} 类型不一致`)
    }
  })
})

test('导出 CSV 落盘且行数正确', { skip }, () => {
  return withStore((store, dir) => {
    const capture = store.createCapture({ name: 'exp', sensorType: 'hand0205' })
    for (const timestamp of [1000, 1500]) {
      store.insertFrame({ captureId: capture.id, frame: sampleFrame(timestamp) })
    }

    const exporter = new CsvExporter({ store, exportDir: join(dir, 'out') })
    return exporter.exportCapture({ captureId: capture.id }).then((result) => {
      assert.equal(result.rows, 2)
      assert.equal(result.files.length, 1)
      assert.ok(existsSync(result.files[0]))
    })
  })
})

test('导出无帧的采集时抛错而不是产出空文件', { skip }, () => {
  return withStore((store, dir) => {
    const exporter = new CsvExporter({ store, exportDir: join(dir, 'out') })
    return assert.rejects(
      () => exporter.exportCapture({ captureId: 999 }),
      /no capture frames found/,
    )
  })
})

// 这条不碰 SQLite，任何环境都要跑。
test('CsvExporter 缺 store 时构造就抛错', () => {
  assert.throws(() => new CsvExporter({}), /store is required/)
})

test('close 之后再操作会抛错而不是静默失败', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'shroom-db-'))
  const store = new CaptureStore({ dbDir: dir })
  store.close()
  try {
    assert.throws(() => store.listCaptures())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
