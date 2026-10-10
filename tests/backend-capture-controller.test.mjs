import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CaptureController,
  MemoryCaptureStore,
  normalizeCaptureFrequency,
  normalizeCaptureOptions,
} from '../index.js'

function frame(timestamp, value, extra = {}) {
  return {
    timestamp,
    data: [value],
    pressureData: [value + 100],
    matrixData: [value + 200],
    ...extra,
  }
}

test('采集频率沿用 shroom1 的 1..200Hz 边界和 12Hz 默认值', () => {
  assert.equal(normalizeCaptureFrequency(undefined), 12)
  assert.equal(normalizeCaptureFrequency(0), 12)
  assert.equal(normalizeCaptureFrequency(0.5), 1)
  assert.equal(normalizeCaptureFrequency(500), 200)
  assert.deepEqual(normalizeCaptureOptions({ frequencyMode: 'serial', hz: 60 }), {
    frequencyMode: 'serial',
    frequencyHz: 60,
    batchSize: 200,
    flushIntervalMs: 250,
    dataField: 'data',
    frameSelector: null,
    minFreeBytes: 0,
  })
})

test('自定义频率按通道独立采样，停止时落盘剩余批次', () => {
  const store = new MemoryCaptureStore()
  const capture = new CaptureController({
    store,
    sensorType: 'hand0205',
    channels: { left: 'COM1', right: 'COM2' },
    options: { frequencyHz: 10, batchSize: 100, flushIntervalMs: 60000 },
  })

  assert.equal(capture.enqueueFrame({ channel: 'left', frame: frame(1000, 1) }), true)
  assert.equal(capture.enqueueFrame({ channel: 'left', frame: frame(1050, 2) }), false)
  assert.equal(capture.enqueueFrame({ channel: 'right', frame: frame(1050, 3) }), true)
  assert.equal(capture.enqueueFrame({ channel: 'left', frame: frame(1100, 4) }), true)

  const stopped = capture.stop()
  const rows = store.queryFrames({ captureId: capture.id })
  assert.equal(stopped.status, 'stopped')
  assert.deepEqual(stopped.channels, { left: 'COM1', right: 'COM2' })
  assert.equal(stopped.metadata.captureOptions.frequencyHz, 10)
  assert.equal(stopped.stats.receivedFrames, 4)
  assert.equal(stopped.stats.skippedFrames, 1)
  assert.equal(stopped.stats.storedFrames, 3)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(({ channel }) => channel), ['left', 'right', 'left'])
})

test('serial 模式保存每个有效串口帧', () => {
  const store = new MemoryCaptureStore()
  const capture = new CaptureController({
    store,
    sensorType: 'fast1024',
    options: { frequencyMode: 'serial', batchSize: 2 },
  })

  capture.enqueueFrame({ frame: frame(1000, 1) })
  capture.enqueueFrame({ frame: frame(1001, 2) })
  capture.enqueueFrame({ frame: frame(1002, 3) })
  capture.stop()

  assert.equal(store.queryFrames({ captureId: capture.id }).length, 3)
  assert.equal(capture.getState().stats.flushCount, 2)
})

test('dataField 明确选择线序后或映射后的采集数据', () => {
  const store = new MemoryCaptureStore()
  const capture = new CaptureController({
    store,
    sensorType: 'hand0205',
    options: { frequencyMode: 'serial', dataField: 'matrixData' },
  })

  capture.enqueueFrame({ frame: frame(1000, 5) })
  capture.stop()
  const [row] = store.queryFrames({ captureId: capture.id })
  assert.deepEqual(JSON.parse(row.data_json), [205])
})

test('批量入库失败会停止采集并输出稳定错误状态', () => {
  let finished = 0
  const errors = []
  const store = {
    createCapture: () => ({ id: 7, name: 'broken', sensorType: 'test', hz: 12, metadata: {} }),
    insertFrames: () => { throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' }) },
    finishCapture: () => { finished += 1 },
  }
  const capture = new CaptureController({
    store,
    sensorType: 'test',
    options: { frequencyMode: 'serial', batchSize: 1 },
    onError: (payload) => errors.push(payload),
  })

  assert.equal(capture.enqueueFrame({ frame: frame(1000, 1) }), false)
  assert.equal(capture.getState().status, 'error')
  assert.equal(capture.getState().error.code, 'SQLITE_FULL')
  assert.equal(errors.length, 1)
  assert.equal(finished, 1)
  assert.equal(capture.enqueueFrame({ frame: frame(1001, 2) }), false)
})

test('可选磁盘余量保护在低空间时停止采集', () => {
  const errors = []
  const store = new MemoryCaptureStore()
  store.getFreeBytes = () => 100
  const capture = new CaptureController({
    store,
    sensorType: 'test',
    options: { minFreeBytes: 200 },
    onError: (payload) => errors.push(payload),
  })

  assert.equal(capture.enqueueFrame({ frame: frame(1000, 1) }), false)
  assert.equal(capture.getState().error.code, 'CAPTURE_DISK_LOW')
  assert.equal(errors.length, 1)
})
