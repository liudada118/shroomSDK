/**
 * backend-sensor-session.test.mjs - 串口会话的容错行为
 *
 * 守的是一条性质：**一帧脏数据、一个坏监听器、一次入库失败，都不该终止进程。**
 *
 * `handleRawFrame` 由 serialport 的 `data` 事件驱动，`emitError` 走的是
 * `EventEmitter` 的保留事件名 —— 这两处任何未捕获的异常都直接是采集程序退出。
 * 2026-08-24 之前两处都没有保护。
 *
 * 这里不 mock serialport：被测的是 `handleRawFrame` 的容错和 `open()` 的编排，
 * 两者都能脱离真实端口直接驱动。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { SensorSession } from '../src/serial/SensorSession.js'
import { MemoryCaptureStore } from '../src/storage/MemoryCaptureStore.js'

/** 造一个最小可用的 session；`parse` 决定解析行为。 */
function createSession({ parse, frameProcessor = null } = {}) {
  return new SensorSession({
    sensorType: 'test',
    profile: { baudRate: 1000000, delimiter: Buffer.from([0xaa]) },
    registry: { parse: parse || ((type, buffer) => ({ data: [...buffer] })) },
    channels: { sit: 'COM_TEST' },
    frameProcessor,
  })
}

/** 暂时吞掉 console.error，返回收集到的消息。 */
function captureConsoleError(run) {
  const messages = []
  const original = console.error
  console.error = (...args) => messages.push(args.join(' '))
  try {
    run()
  } finally {
    console.error = original
  }
  return messages
}

test('解析抛错不会冒泡出 handleRawFrame', () => {
  const session = createSession({
    parse: () => { throw new Error('line order "jqbed" is not registered') },
  })
  const errors = []
  session.on('error', (payload) => errors.push(payload))

  // 这一行在修复前会直接抛，进而终止进程。
  assert.doesNotThrow(() => session.handleRawFrame('sit', Buffer.from([1, 2, 3])))
  assert.equal(errors.length, 1)
  assert.equal(errors[0].phase, 'parse')
  assert.equal(errors[0].channel, 'sit')
  assert.match(errors[0].error.message, /is not registered/)
})

test('解析失败仍然发出 rawFrame：它是唯一的排障线索', () => {
  const session = createSession({ parse: () => { throw new Error('bad frame') } })
  const raw = []
  session.on('error', () => {})
  session.on('rawFrame', (payload) => raw.push(payload))

  session.handleRawFrame('sit', Buffer.from([9, 8, 7]))

  assert.equal(raw.length, 1)
  assert.deepEqual([...raw[0].rawFrame], [9, 8, 7])
})

test('解析失败时不发 frame', () => {
  const session = createSession({ parse: () => { throw new Error('bad frame') } })
  let frames = 0
  session.on('error', () => {})
  session.on('frame', () => { frames += 1 })

  session.handleRawFrame('sit', Buffer.from([1]))

  assert.equal(frames, 0)
})

test('丢掉脏帧之后还能继续处理下一帧', () => {
  // 脏帧通常是偶发的（上电瞬间、拔插抖动），整条链路不该因此停摆。
  let shouldThrow = true
  const session = createSession({
    parse: (type, buffer) => {
      if (shouldThrow) throw new Error('transient')
      return { data: [...buffer] }
    },
  })
  const frames = []
  session.on('error', () => {})
  session.on('frame', (frame) => frames.push(frame))

  session.handleRawFrame('sit', Buffer.from([1]))
  shouldThrow = false
  session.handleRawFrame('sit', Buffer.from([2]))

  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0].data, [2])
})

test('没有 error 监听者时不抛出，降级为 console.error', () => {
  // EventEmitter 的 'error' 没有监听者时会直接 throw ——
  // SDK 不该把「使用方忘了挂监听」变成「进程退出」。
  const session = createSession({ parse: () => { throw new Error('boom') } })

  const messages = captureConsoleError(() => {
    assert.doesNotThrow(() => session.handleRawFrame('sit', Buffer.from([1])))
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0], /未监听的错误/)
  // 提示里要写清怎么自己接管，否则用户只知道出错不知道下一步。
  assert.match(messages[0], /session\.on\('error'/)
})

test('不静默丢弃错误：故障必须可见', () => {
  const session = createSession({ parse: () => { throw new Error('boom') } })
  const messages = captureConsoleError(() => session.handleRawFrame('sit', Buffer.from([1])))

  assert.ok(messages.length > 0, '错误被静默吞掉了，比崩溃更难排查')
})

test('frame 监听器抛错不影响入库', () => {
  const inserted = []
  const session = createSession()
  session.on('error', () => {})
  session.on('frame', () => { throw new Error('consumer bug') })
  session.capture = {
    active: true,
    id: 1,
    store: { insertFrame: (row) => inserted.push(row) },
  }

  assert.doesNotThrow(() => session.handleRawFrame('sit', Buffer.from([5])))
  assert.equal(inserted.length, 1)
})

test('入库失败不会终止链路', () => {
  const session = createSession()
  const errors = []
  session.on('error', (payload) => errors.push(payload))
  session.capture = {
    active: true,
    id: 1,
    store: { insertFrame: () => { throw new Error('SQLITE_FULL') } },
  }

  assert.doesNotThrow(() => session.handleRawFrame('sit', Buffer.from([5])))
  assert.equal(errors[0].phase, 'capture')
})

test('frameProcessor 抛错按解析失败处理', () => {
  // 清零计算也在这条链路上，它出错同样不该崩进程。
  const session = createSession({
    frameProcessor: () => { throw new Error('zero calibration failed') },
  })
  const errors = []
  session.on('error', (payload) => errors.push(payload))

  assert.doesNotThrow(() => session.handleRawFrame('sit', Buffer.from([1])))
  assert.equal(errors[0].phase, 'parse')
})

test('正常帧的行为没有被容错改动', () => {
  const session = createSession()
  const frames = []
  const raw = []
  session.on('frame', (frame) => frames.push(frame))
  session.on('rawFrame', (payload) => raw.push(payload))

  session.handleRawFrame('sit', Buffer.from([1, 2]))

  assert.equal(raw.length, 1)
  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0].data, [1, 2])
})

test('open() 在没有可用通道时抛错', () => {
  const session = new SensorSession({
    sensorType: 'test',
    profile: {},
    registry: { parse: () => ({}) },
    channels: { sit: '', back: null },
  })

  return assert.rejects(() => session.open(), /at least one channel port is required/)
})

test('多通道中途失败时回滚已打开的端口', async () => {
  // 不回滚的话调用方拿到 rejected promise，却有一个端口在后台开着 ——
  // 既占用设备，也无法通过 session 关闭。
  const session = new SensorSession({
    sensorType: 'test',
    profile: {},
    registry: { parse: () => ({}) },
    channels: { sit: 'COM1', back: 'COM2' },
  })

  const opened = []
  let closed = 0
  session.openChannel = async (channel) => {
    if (channel === 'back') throw new Error('Access denied')
    opened.push(channel)
  }
  session.close = async () => { closed += 1 }

  await assert.rejects(() => session.open(), /Access denied/)
  assert.deepEqual(opened, ['sit'])
  assert.equal(closed, 1, '第二个通道失败后没有回滚第一个')
})

test('全部通道成功时不触发回滚', async () => {
  const session = new SensorSession({
    sensorType: 'test',
    profile: {},
    registry: { parse: () => ({}) },
    channels: { sit: 'COM1' },
  })

  let closed = 0
  session.openChannel = async () => {}
  session.close = async () => { closed += 1 }

  const openEvents = []
  session.on('open', (payload) => openEvents.push(payload))

  await session.open()

  assert.equal(closed, 0)
  assert.equal(openEvents.length, 1)
})

test('SensorSession 采集支持全帧模式和 dataField', () => {
  const store = new MemoryCaptureStore()
  const session = createSession({
    parse: (type, buffer) => ({
      sensorType: type,
      timestamp: buffer[0],
      data: [buffer[1]],
      pressureData: [buffer[1] + 10],
      mappedData: [buffer[1] + 20],
    }),
  })

  const started = session.startCapture({
    store,
    name: 'session-capture',
    frequencyMode: 'serial',
    dataField: 'mappedData',
    batchSize: 100,
    flushIntervalMs: 60000,
  })
  session.handleRawFrame('sit', Buffer.from([1, 2]))
  session.handleRawFrame('sit', Buffer.from([2, 3]))
  const stopped = session.stopCapture()

  assert.equal(started.status, 'recording')
  assert.equal(stopped.stats.storedFrames, 2)
  assert.deepEqual(
    store.queryFrames({ captureId: started.id }).map((row) => JSON.parse(row.data_json)),
    [[22], [23]],
  )
})

test('关闭串口会话前自动停止采集并 flush', async () => {
  const store = new MemoryCaptureStore()
  const session = createSession()
  const started = session.startCapture({
    store,
    frequencyMode: 'serial',
    batchSize: 100,
    flushIntervalMs: 60000,
  })
  session.handleRawFrame('sit', Buffer.from([9]))

  await session.close()

  assert.equal(session.getState().capture.status, 'stopped')
  assert.equal(store.queryFrames({ captureId: started.id }).length, 1)
})

test('同一会话不能同时开始两次采集', () => {
  const session = createSession()
  const store = new MemoryCaptureStore()
  session.startCapture({ store })
  assert.throws(() => session.startCapture({ store }), /already active/)
  session.stopCapture()
})

test('存储错误后 stopCapture 仍返回最后错误状态', () => {
  const session = createSession()
  const store = {
    createCapture: () => ({ id: 1, name: 'x', sensorType: 'test', hz: 12, metadata: {} }),
    insertFrames: () => { throw Object.assign(new Error('full'), { code: 'SQLITE_FULL' }) },
    finishCapture: () => {},
  }
  session.on('error', () => {})
  session.startCapture({ store, frequencyMode: 'serial', batchSize: 1 })
  session.handleRawFrame('sit', Buffer.from([1]))

  assert.equal(session.stopCapture().status, 'error')
  assert.equal(session.stopCapture().error.code, 'SQLITE_FULL')
})
