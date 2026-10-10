import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  AlgorithmChannel,
  CsvExporter,
  MemoryCaptureStore,
  ReplayPlayer,
  ReplayService,
  ShroomSensorSDK,
  createPressureStatsAlgorithm,
} from '../index.js'

function seedCapture(store) {
  const capture = store.createCapture({ name: 'capability-run', sensorType: 'matrix', hz: 10 })
  const frames = [
    { channel: 'left', timestamp: 1000, data: [1, 2, 3] },
    { channel: 'right', timestamp: 1100, data: [4, 5, 6] },
    { channel: 'left', timestamp: 1200, data: [7, 8, 9] },
  ]
  frames.forEach((frame) => store.insertFrame({
    captureId: capture.id,
    sensorType: 'matrix',
    channel: frame.channel,
    frame,
  }))
  return capture
}

test('MemoryCaptureStore 支持分页、通道时间筛选、计数和级联删除', () => {
  const store = new MemoryCaptureStore()
  const capture = seedCapture(store)
  store.createCapture({ name: 'second', sensorType: 'matrix' })

  assert.equal(store.countCaptures({ sensorType: 'matrix' }), 2)
  assert.equal(store.listCaptures({ limit: 1 }).length, 1)
  assert.equal(store.listCaptures({ limit: 1, offset: 1 }).length, 1)
  assert.equal(store.countFrames({ captureId: capture.id, channel: 'left' }), 2)
  assert.deepEqual(
    store.queryFrames({
      captureId: capture.id,
      channel: 'left',
      fromTimestamp: 1100,
      limit: 1,
    }).map((row) => row.timestamp),
    [1200],
  )

  assert.deepEqual(store.deleteCapture({ captureId: capture.id }), {
    captureId: capture.id,
    capturesDeleted: 1,
    framesDeleted: 3,
  })
  assert.equal(store.countFrames({ captureId: capture.id }), 0)
})

test('AlgorithmChannel 按注册顺序计算并隔离算法异常', () => {
  const channel = new AlgorithmChannel()
  const errors = []
  channel.on('algorithmError', (payload) => errors.push(payload))
  channel.register('stats', createPressureStatsAlgorithm({ threshold: 1 }))
  channel.register('peakIndex', (data) => data.indexOf(Math.max(...data)))
  channel.register('broken', () => { throw new Error('bad algorithm') })

  const source = { data: [1, 5, 2] }
  const output = channel.process(source, { source: 'test' })
  assert.notEqual(output, source)
  assert.equal(source.algorithmResults, undefined)
  assert.equal(output.algorithmResults.stats.max, 5)
  assert.equal(output.algorithmResults.stats.point, 2)
  assert.equal(output.algorithmResults.peakIndex, 1)
  assert.deepEqual(output.algorithmResults.broken, { ok: false, error: 'bad algorithm' })
  assert.equal(errors.length, 1)

  channel.enable('peakIndex', false)
  assert.equal(channel.process(source).algorithmResults.peakIndex, undefined)
  assert.equal(channel.unregister('peakIndex'), true)
})

test('回放可复用算法通道，并支持播放、倍速、定位和逐帧', () => {
  const store = new MemoryCaptureStore()
  const capture = seedCapture(store)
  const algorithms = new AlgorithmChannel({ algorithms: {
    total: (data) => data.reduce((sum, value) => sum + value, 0),
  } })
  const replay = new ReplayService({ store, algorithmChannel: algorithms })
  const timeline = replay.buildTimeline({ captureId: capture.id, applyAlgorithms: true })
  assert.equal(timeline.frames[0].algorithmResults.total, 6)

  let scheduled = null
  const emitted = []
  const player = new ReplayPlayer({
    timeline,
    speed: 2,
    setTimeoutFn: (callback, delay) => {
      scheduled = { callback, delay }
      return 1
    },
    clearTimeoutFn: () => { scheduled = null },
  })
  player.on('frame', (frame) => emitted.push(frame.timestamp))
  player.play()
  assert.deepEqual(emitted, [1000])
  assert.equal(scheduled.delay, 50)
  scheduled.callback()
  assert.deepEqual(emitted, [1000, 1100])
  scheduled.callback()
  assert.equal(player.getState().ended, true)
  player.play()
  assert.equal(player.getState().index, 0)
  assert.deepEqual(emitted.slice(-1), [1000])
  player.seek(2)
  assert.equal(player.getState().index, 2)
  player.step(-1)
  assert.equal(player.getState().index, 1)
  player.stop()
  assert.equal(player.getState().index, 0)
})

test('SDK 门面暴露存储、算法、回放和删除接口', () => {
  const store = new MemoryCaptureStore()
  const capture = seedCapture(store)
  const sdk = new ShroomSensorSDK({ store })
  sdk.registerAlgorithm('sum', (data) => data.reduce((total, value) => total + value, 0))

  assert.equal(sdk.processAlgorithms({ data: [2, 3] }).algorithmResults.sum, 5)
  assert.equal(sdk.countCaptures(), 1)
  assert.equal(sdk.getCaptureFrames({ captureId: capture.id, limit: 1 }).length, 1)
  assert.equal(sdk.countCaptureFrames({ captureId: capture.id }), 3)
  assert.ok(sdk.createReplay({ captureId: capture.id }) instanceof ReplayPlayer)
  assert.equal(sdk.deleteCapture({ captureId: capture.id }).framesDeleted, 3)
})

test('CSV 包含算法结果列', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shroom-capabilities-'))
  try {
    const store = new MemoryCaptureStore()
    const capture = store.createCapture({ name: 'algorithm', sensorType: 'matrix' })
    store.insertFrame({
      captureId: capture.id,
      frame: { timestamp: 1000, data: [1], algorithmResults: { score: 9 } },
    })
    const result = await new CsvExporter({ store, exportDir: dir }).exportCapture({ captureId: capture.id })
    const csv = readFileSync(result.files[0], 'utf8')
    assert.match(csv, /算法结果/)
    assert.match(csv, /score/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
