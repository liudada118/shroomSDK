/**
 * backend-core.test.mjs - 后端核心模块的基线覆盖
 *
 * `src/` 曾经**零测试**：528 个测试全在 `UI/frontend`，`tests/` 里没有一个文件
 * import 过 `src/`。而协议解析、线序、清零、存储恰恰是最容易回归、最难手动
 * 验证的部分——出问题时使用方无法通过「跑一下测试」判断是自己用错还是 SDK 的锅。
 *
 * 这份文件覆盖纯函数与本地 IO 那几个模块。串口会话在
 * `backend-sensor-session.test.mjs`，线序在 `backend-line-orders.test.mjs`。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  MemoryCaptureStore,
  ProtocolRegistry,
  ReplayService,
  ZeroCalibrator,
  DEFAULT_SENSOR_PROFILES,
  STANDARD_FRAME_DELIMITER,
  getDefaultBaudRate,
} from '../index.js'

import { calculatePressureStats, normalizeNumericArray, toFiniteNumber } from '../src/utils/stats.js'
import { readValues, parseFrame } from '../src/protocol/parsers.js'
import { resolveProfile } from '../src/profiles.js'
import { sanitizeFilename } from '../src/config/PathService.js'
import { parseMessage } from '../src/backend/BackendCommandRouter.js'
import { GLOVE_REAL_FRAME_FIXTURES as GLOVE_FIXTURES } from './fixtures/glove-real-frames.mjs'

/* ─── utils/stats ───────────────────────────────────────────────────── */

test('toFiniteNumber 把不可用值归零', () => {
  assert.equal(toFiniteNumber(5), 5)
  assert.equal(toFiniteNumber('5'), 5)
  for (const value of [NaN, Infinity, -Infinity, undefined, null, 'abc', {}]) {
    assert.equal(toFiniteNumber(value), 0, `${String(value)} 未归零`)
  }
})

test('normalizeNumericArray 对非数组返回空数组', () => {
  assert.deepEqual(normalizeNumericArray(null), [])
  assert.deepEqual(normalizeNumericArray('abc'), [])
  assert.deepEqual(normalizeNumericArray([1, 'x', 3]), [1, 0, 3])
})

test('calculatePressureStats 空输入返回全零而不是 NaN', () => {
  // -Infinity / NaN 泄漏到 max/mean 会一路污染到侧栏读数和 CSV。
  assert.deepEqual(calculatePressureStats([]), {
    max: 0, min: 0, total: 0, mean: 0, point: 0, length: 0,
  })
})

test('calculatePressureStats 逐项算对', () => {
  const stats = calculatePressureStats([1, 2, 3, 4])

  assert.equal(stats.max, 4)
  assert.equal(stats.min, 1)
  assert.equal(stats.total, 10)
  assert.equal(stats.mean, 2.5)
  assert.equal(stats.length, 4)
})

test('calculatePressureStats 的 point 是严格大于阈值的点数', () => {
  // 边界值不计入：阈值 2 时值等于 2 的点不算受压。
  assert.equal(calculatePressureStats([1, 2, 3], { threshold: 2 }).point, 1)
  assert.equal(calculatePressureStats([1, 2, 3]).point, 3)
})

/* ─── profiles ──────────────────────────────────────────────────────── */

test('getDefaultBaudRate 按传感器类型分档', () => {
  assert.equal(getDefaultBaudRate('handGlove115200'), 115200)
  assert.equal(getDefaultBaudRate('hand0205'), 921600)
  assert.equal(getDefaultBaudRate('smallBed12B'), 1500000)
  assert.equal(getDefaultBaudRate('bed4096'), 3000000)
  assert.equal(getDefaultBaudRate('unknownSensor'), 1000000)
  // 名字里带 robot 的走 921600（子串匹配，不是白名单）。
  assert.equal(getDefaultBaudRate('robotSY'), 921600)
})

test('resolveProfile 的 sensorType 始终被键名覆盖', () => {
  const profile = resolveProfile('hand0205', { sensorType: 'somethingElse' })
  assert.equal(profile.sensorType, 'hand0205')
})

test('resolveProfile 的 delimiter 每次是新 Buffer，不共享引用', () => {
  // 共享的话使用方改一个 profile 会影响其他所有 profile。
  const a = resolveProfile('hand0205')
  const b = resolveProfile('hand0205')

  assert.notEqual(a.delimiter, b.delimiter)
  assert.deepEqual([...a.delimiter], [...STANDARD_FRAME_DELIMITER])
})

test('resolveProfile 未知类型回落到 default', () => {
  const profile = resolveProfile('neverHeardOfIt')
  assert.equal(profile.valueType, 'uint8')
  assert.equal(profile.baudRate, 1000000)
})

/* ─── protocol/parsers ──────────────────────────────────────────────── */

test('readValues 按 valueType 解字节', () => {
  const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04])

  assert.deepEqual(readValues(buffer, 'uint8'), [1, 2, 3, 4])
  assert.deepEqual(readValues(buffer, 'uint16le'), [0x0201, 0x0403])
  assert.deepEqual(readValues(Buffer.from([0xff, 0xff]), 'int16le'), [-1])
})

test('readValues 忽略末尾不足一个宽度的字节', () => {
  assert.deepEqual(readValues(Buffer.from([1, 2, 3]), 'uint16le'), [0x0201])
})

test('readValues 空输入返回空数组', () => {
  assert.deepEqual(readValues(null, 'uint8'), [])
})

test('parseFrame 无显式矩阵时按完全平方数推方阵', () => {
  const profile = resolveProfile('default')
  const frame = parseFrame(Buffer.alloc(1024, 1), profile, { channel: 'sit' })

  assert.deepEqual(frame.matrix, { width: 32, height: 32 })
})

test('parseFrame 长度不是完全平方数时矩阵为 null', () => {
  const profile = resolveProfile('default')
  const frame = parseFrame(Buffer.alloc(1000, 1), profile, { channel: 'sit' })

  assert.deepEqual(frame.matrix, { width: null, height: null })
})

test('parseFrame 的 data 与 pressureData 是同一个数组', () => {
  // 两个名字是历史别名，任何一个变了另一个必须跟着变。
  const frame = parseFrame(Buffer.alloc(16, 3), resolveProfile('default'), {})

  assert.equal(frame.data, frame.pressureData)
})

test('parseFrame 按 pressureLength 截断压力段', () => {
  const frame = parseFrame(
    Buffer.alloc(300, 5),
    resolveProfile('default', { pressureLength: 256 }),
    {},
  )

  assert.equal(frame.data.length, 256)
})

test('parseFrame 取出姿态段', () => {
  const buffer = Buffer.alloc(300, 5)
  buffer[256] = 9
  const frame = parseFrame(
    buffer,
    resolveProfile('default', { pressureLength: 256, rotateOffset: 256, rotateLength: 4 }),
    {},
  )

  assert.equal(frame.rotate.length, 4)
  assert.equal(frame.rotate[0], 9)
})

test('parseFrame 未声明姿态段时 rotate 为空数组', () => {
  const frame = parseFrame(Buffer.alloc(16, 1), resolveProfile('default'), {})

  assert.deepEqual(frame.rotate, [])
})

test('profile.parseFrame 优先级最高', () => {
  const profile = resolveProfile('default', {
    parseFrame: () => ({ custom: true }),
  })

  assert.deepEqual(parseFrame(Buffer.alloc(4), profile, {}), { custom: true })
})

test('handGloveFullPacket 解析器填 extra 字段', () => {
  const profile = resolveProfile('handGloveFullPacket')
  const frame = parseFrame(GLOVE_FIXTURES.fullLeft, profile, {})

  assert.equal(frame.extra.packetType, 1)
  assert.equal(frame.extra.packetLengthMatched, true)
})

test('未注册的线序名抛错（由会话层捕获）', () => {
  const profile = resolveProfile('default', { lineOrder: 'nonexistent' })
  const registry = new ProtocolRegistry({})

  assert.throws(
    () => registry.parse('default', Buffer.alloc(16), { channel: 'sit', profile }),
    /is not registered/,
  )
})

test('profile 里直接给线序函数可绕过注册表', () => {
  const profile = resolveProfile('default', { lineOrder: (data) => data.map(() => 42) })
  const frame = parseFrame(Buffer.alloc(4, 1), profile, {})

  assert.deepEqual(frame.data, [42, 42, 42, 42])
})

/* ─── processing/ZeroCalibrator ─────────────────────────────────────── */

test('无基线时 apply 原样返回同一个 frame 对象', () => {
  const calibrator = new ZeroCalibrator()
  const frame = { sensorType: 'a', channel: 'sit', data: [1, 2] }

  assert.equal(calibrator.apply(frame), frame)
})

test('清零后逐点相减，负值钳到 0', () => {
  const calibrator = new ZeroCalibrator()
  calibrator.setBaseline('a', 'sit', [5, 5, 5])
  const result = calibrator.apply({ sensorType: 'a', channel: 'sit', data: [10, 5, 1] })

  assert.deepEqual(result.data, [5, 0, 0])
  assert.deepEqual(result.zeroFrame, [5, 5, 5])
})

test('清零结果同步写入 data 与 pressureData', () => {
  const calibrator = new ZeroCalibrator()
  calibrator.setBaseline('a', 'sit', [1])
  const result = calibrator.apply({ sensorType: 'a', channel: 'sit', data: [5] })

  assert.deepEqual(result.pressureData, result.data)
})

test('基线按 sensorType:channel 分键，互不影响', () => {
  const calibrator = new ZeroCalibrator()
  calibrator.setBaseline('a', 'sit', [10])
  const other = calibrator.apply({ sensorType: 'a', channel: 'back', data: [7] })

  assert.deepEqual(other.data, [7])
})

test('captureBaseline 用当前帧做基线', () => {
  const calibrator = new ZeroCalibrator()
  calibrator.captureBaseline({ sensorType: 'a', channel: 'sit', data: [3, 4] })
  const result = calibrator.apply({ sensorType: 'a', channel: 'sit', data: [5, 4] })

  assert.deepEqual(result.data, [2, 0])
})

test('clearBaseline 三种粒度', () => {
  const calibrator = new ZeroCalibrator()
  const seed = () => {
    calibrator.setBaseline('a', 'sit', [1])
    calibrator.setBaseline('a', 'back', [1])
    calibrator.setBaseline('b', 'sit', [1])
  }
  const isZeroed = (type, channel) => Boolean(
    calibrator.apply({ sensorType: type, channel, data: [5] }).zeroFrame,
  )

  seed()
  calibrator.clearBaseline('a', 'sit')
  assert.equal(isZeroed('a', 'sit'), false)
  assert.equal(isZeroed('a', 'back'), true)

  seed()
  calibrator.clearBaseline('a')
  assert.equal(isZeroed('a', 'back'), false)
  assert.equal(isZeroed('b', 'sit'), true)

  seed()
  calibrator.clearBaseline()
  assert.equal(isZeroed('b', 'sit'), false)
})

/* ─── storage/MemoryCaptureStore ────────────────────────────────────── */

test('MemoryCaptureStore 走完采集到回放一整圈', () => {
  const store = new MemoryCaptureStore()
  const capture = store.createCapture({ name: 'run1', sensorType: 'hand0205', hz: 12 })

  store.insertFrame({
    captureId: capture.id,
    sensorType: 'hand0205',
    channel: 'sit',
    rawFrame: Buffer.from([1, 2]),
    frame: { data: [1, 2], timestamp: 1000, stats: { max: 2 } },
  })
  store.finishCapture(capture.id)

  const frames = store.queryFrames({ captureId: capture.id })
  assert.equal(frames.length, 1)
  assert.equal(frames[0].capture_name, 'run1')
  assert.equal(frames[0].raw_frame_hex, '0102')
  assert.deepEqual(JSON.parse(frames[0].data_json), [1, 2])
})

test('createCapture 缺名字时按 sensorType_时间戳 生成', () => {
  const store = new MemoryCaptureStore()
  const capture = store.createCapture({ sensorType: 'hand' })

  assert.match(capture.name, /^hand_\d+$/)
})

test('listCaptures 按 sensorType 过滤', () => {
  const store = new MemoryCaptureStore()
  store.createCapture({ name: 'a', sensorType: 'x' })
  store.createCapture({ name: 'b', sensorType: 'y' })

  assert.equal(store.listCaptures({ sensorType: 'x' }).length, 1)
  assert.equal(store.listCaptures().length, 2)
})

test('queryFrames 查不到采集时返回空数组而不抛错', () => {
  const store = new MemoryCaptureStore()

  assert.deepEqual(store.queryFrames({ captureId: 999 }), [])
  assert.deepEqual(store.queryFrames({}), [])
})

test('insertFrame 优先取 pressureData', () => {
  const store = new MemoryCaptureStore()
  const capture = store.createCapture({ name: 'r', sensorType: 't' })
  store.insertFrame({
    captureId: capture.id,
    frame: { data: [9], pressureData: [1, 2], timestamp: 1 },
  })

  assert.deepEqual(JSON.parse(store.queryFrames({ captureId: capture.id })[0].data_json), [1, 2])
})

/* ─── replay/ReplayService ──────────────────────────────────────────── */

test('ReplayService 缺 store 时构造就抛错', () => {
  assert.throws(() => new ReplayService({}), /store is required/)
})

test('buildTimeline 空结果不含 seconds 字段', () => {
  const replay = new ReplayService({ store: new MemoryCaptureStore() })
  const timeline = replay.buildTimeline({ captureId: 1 })

  assert.equal(timeline.length, 0)
  assert.deepEqual(timeline.frames, [])
  assert.equal('seconds' in timeline, false)
})

test('buildTimeline 的 seconds 相对首帧、保留三位小数', () => {
  const store = new MemoryCaptureStore()
  const capture = store.createCapture({ name: 'r', sensorType: 't' })
  for (const timestamp of [1000, 1500, 2250]) {
    store.insertFrame({ captureId: capture.id, frame: { data: [1], timestamp } })
  }

  const timeline = new ReplayService({ store }).buildTimeline({ captureId: capture.id })

  assert.equal(timeline.length, 3)
  assert.deepEqual(timeline.seconds, ['0.000', '0.500', '1.250'])
})

test('getFrames 输出驼峰字段并解开 JSON', () => {
  const store = new MemoryCaptureStore()
  const capture = store.createCapture({ name: 'r', sensorType: 't' })
  store.insertFrame({
    captureId: capture.id,
    frame: { data: [4], timestamp: 1, stats: { max: 4 }, rotate: [1] },
  })

  const [frame] = new ReplayService({ store }).getFrames({ captureId: capture.id })

  assert.equal(frame.captureName, 'r')
  assert.deepEqual(frame.data, [4])
  assert.deepEqual(frame.stats, { max: 4 })
  assert.deepEqual(frame.extra.rotate, [1])
})

/* ─── config/PathService ────────────────────────────────────────────── */

test('sanitizeFilename 去掉路径分隔符与非法字符', () => {
  assert.equal(sanitizeFilename('a/b\\c'), 'abc')
  assert.equal(sanitizeFilename('a<b>c:d"e|f?g*h'), 'abcdefgh')
  assert.equal(sanitizeFilename('  name.  '), 'name')
  assert.equal(sanitizeFilename(123), '')
})

test('PathService 真的把目录建出来', async () => {
  const { PathService } = await import('../index.js')
  const base = mkdtempSync(join(tmpdir(), 'shroom-path-'))
  try {
    const paths = new PathService({
      dbDir: join(base, 'db'),
      exportDir: join(base, 'data'),
      imageDir: join(base, 'img'),
      reportDir: join(base, 'pdf'),
    })
    const dirs = paths.ensureRuntimeDirs()

    assert.equal(paths.validateWritableDirectory(dirs.exportDir).ok, true)
    assert.match(paths.getExportPath('a/b.csv'), /ab\.csv$/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('validateWritableDirectory 对空目录名返回 ok:false 而不抛错', async () => {
  const { PathService } = await import('../index.js')
  const paths = new PathService({})

  assert.deepEqual(paths.validateWritableDirectory(''), { ok: false, error: 'directory is empty' })
  assert.equal(paths.validateWritableDirectory(null).ok, false)
})

/* ─── backend/BackendCommandRouter ──────────────────────────────────── */

test('parseMessage 接受 Buffer、字符串和对象', () => {
  assert.deepEqual(parseMessage(Buffer.from('{"a":1}')), { a: 1 })
  assert.deepEqual(parseMessage('{"a":1}'), { a: 1 })
  assert.deepEqual(parseMessage({ a: 1 }), { a: 1 })
  assert.deepEqual(parseMessage(null), {})
})

test('内置 profile 表覆盖 11 种传感器', () => {
  assert.equal(Object.keys(DEFAULT_SENSOR_PROFILES).length, 11)
})
