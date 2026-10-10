import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  SerialConnectionError,
  SerialManager,
  ShroomSensorSDK,
  detectBaudRate,
  filterSerialPorts,
  isPortBusyError,
  serializeSerialError,
  writeSerialPort,
} from '../index.js'
import { SensorSession } from '../src/serial/SensorSession.js'

class FakeParser extends EventEmitter {}

function createDetectionPortClass({ ports = [], chunks = [], openError = null } = {}) {
  return class FakeDetectionPort extends EventEmitter {
    static instances = []

    static async list() {
      return ports
    }

    constructor(options) {
      super()
      this.options = options
      this.isOpen = false
      this.closed = false
      this.constructor.instances.push(this)
    }

    open(callback) {
      if (openError) {
        callback(openError)
        return
      }
      this.isOpen = true
      callback()
      queueMicrotask(() => chunks.forEach((chunk) => this.emit('data', chunk)))
    }

    close(callback) {
      this.isOpen = false
      this.closed = true
      callback?.()
    }
  }
}

function createFakeManagedSession({ sensorType = 'test', channels = { main: 'COM1' } } = {}) {
  const session = new EventEmitter()
  session.sensorType = sensorType
  session.channels = channels
  session.getState = () => ({
    status: 'connected',
    sensorType,
    channels: Object.fromEntries(Object.entries(channels).map(([channel, portPath]) => [channel, {
      channel,
      portPath,
      baudRate: 921600,
      status: 'connected',
      online: true,
    }])),
    latestFrames: {},
    capture: null,
  })
  session.write = async (channel, data) => ({ channel, bytesWritten: Buffer.from(data).length })
  session.close = async () => { session.emit('close') }
  return session
}

test('端口筛选覆盖 WCH、CH34 和 1A86 标识', () => {
  const ports = [
    { path: 'COM1', manufacturer: 'wch.cn' },
    { path: 'COM2', friendlyName: 'USB-SERIAL CH340' },
    { path: 'COM3', vendorId: '1A86' },
    { path: 'COM4', manufacturer: 'Other' },
  ]
  assert.deepEqual(filterSerialPorts(ports, 'win32').map((port) => port.path), ['COM1', 'COM2', 'COM3'])
})

test('Access denied 归类为稳定 PORT_BUSY 错误', () => {
  assert.equal(isPortBusyError(new Error('Access denied')), true)
  const error = new SerialConnectionError('PORT_BUSY', { path: 'COM5' })
  assert.deepEqual(serializeSerialError(error), {
    success: false,
    code: 'PORT_BUSY',
    stage: 'open_port',
    message: '串口被占用，请关闭其他串口程序后重试',
    detail: '串口被占用，请关闭其他串口程序后重试',
    path: 'COM5',
    channel: undefined,
    baudRate: undefined,
  })
})

test('自动波特率通过双分隔符识别并关闭临时串口', async () => {
  const delimiter = Buffer.from([0xaa, 0x55, 0x03, 0x99])
  const Port = createDetectionPortClass({
    chunks: [Buffer.concat([delimiter, Buffer.from([1, 2, 3]), delimiter])],
  })

  const baudRate = await detectBaudRate('COM6', {
    SerialPortClass: Port,
    baudCandidates: [921600],
    timeoutMs: 50,
  })

  assert.equal(baudRate, 921600)
  assert.equal(Port.instances.length, 1)
  assert.equal(Port.instances[0].closed, true)
})

test('写串口等待 drain 并返回实际字节数', async () => {
  const writes = []
  const port = {
    isOpen: true,
    write(data, callback) {
      writes.push([...data])
      callback()
    },
    drain(callback) { callback() },
  }
  const result = await writeSerialPort(port, [1, 2, 3])
  assert.equal(result.bytesWritten, 3)
  assert.deepEqual(writes, [[1, 2, 3]])
})

test('SensorSession 打开失败后按配置重试', async () => {
  let attempts = 0
  const portOptions = []
  class RetryPort extends EventEmitter {
    constructor(options) {
      super()
      this.isOpen = false
      portOptions.push(options)
    }

    pipe(parser) { return parser }

    open(callback) {
      attempts += 1
      if (attempts < 3) callback(new Error('Access denied'))
      else {
        this.isOpen = true
        callback()
      }
    }

    close(callback) {
      this.isOpen = false
      callback?.()
    }
  }

  const session = new SensorSession({
    sensorType: 'test',
    profile: { baudRate: 921600, delimiter: Buffer.from([0xaa]) },
    registry: { parse: () => ({ data: [] }) },
    channels: { main: 'COM7' },
    SerialPortClass: RetryPort,
    DelimiterParserClass: FakeParser,
    connectionOptions: {
      retries: 3,
      retryDelayMs: 0,
      timeoutMs: 50,
      portOptions: { dataBits: 8, stopBits: 1, parity: 'none', rtscts: true },
    },
  })

  await session.open()
  assert.equal(attempts, 3)
  assert.equal(portOptions[0].rtscts, true)
  assert.equal(portOptions[0].autoOpen, false)
  assert.equal(session.getState().channels.main.status, 'connected')
  await session.close()
})

test('SensorSession 保存最新数据并识别打开但断流的串口', () => {
  let now = 1000
  const session = new SensorSession({
    sensorType: 'test',
    profile: { baudRate: 921600, delimiter: Buffer.from([0xaa]) },
    registry: { parse: (type, buffer) => ({ sensorType: type, channel: 'main', data: [...buffer] }) },
    channels: { main: 'COM8' },
    now: () => now,
    connectionOptions: { staleAfterMs: 5000 },
  })
  session.openPorts.set('main', { port: { isOpen: true }, portPath: 'COM8' })
  session.updateChannelState('main', { status: 'connected', online: true, connectedAt: now })
  session.handleRawFrame('main', Buffer.from([7]))

  assert.deepEqual(session.getState().latestFrames.main.data, [7])
  assert.equal(session.getState().channels.main.online, true)

  now += 5001
  assert.equal(session.getState().channels.main.status, 'stale')
  assert.equal(session.getState().channels.main.online, false)
})

test('SerialManager 一键连接聚合会话、最新帧和写串口', async () => {
  const delimiter = Buffer.from([0xaa, 0x55, 0x03, 0x99])
  const Port = createDetectionPortClass({
    ports: [{ path: 'COM9', manufacturer: 'wch.cn' }],
    chunks: [Buffer.concat([delimiter, Buffer.from([1]), delimiter])],
  })
  const opened = []
  const sdk = {
    options: { SerialPortClass: Port },
    registry: {
      getProfile: (sensorType, override = {}) => ({
        sensorType,
        baudRate: override.baudRate || 921600,
        delimiter,
        channels: ['main'],
      }),
    },
    async open(options) {
      opened.push(options)
      return createFakeManagedSession({ sensorType: options.sensorType, channels: options.channels })
    },
  }
  const manager = new SerialManager({ sdk, SerialPortClass: Port })

  const result = await manager.connectAuto({
    sensorType: 'hand0205',
    baudCandidates: [921600],
    baudDetectTimeoutMs: 50,
    postDetectDelayMs: 0,
    postAllDetectDelayMs: 0,
  })
  assert.equal(result.success, true)
  assert.equal(result.ports[0].path, 'COM9')
  assert.equal(opened[0].profile.baudRate, 921600)

  result.session.emit('frame', { channel: 'main', data: [9] })
  assert.deepEqual(Object.values(manager.getState().latestFrames)[0].data, [9])
  assert.equal((await manager.write(result.sessionId || result.session.sessionId, 'main', [1, 2])).bytesWritten, 2)
  assert.equal(await manager.disconnectAll(), 1)
})

test('SerialManager 串口枚举超时返回 NO_PORT', async () => {
  class HangingPort {
    static list() { return new Promise(() => {}) }
  }
  const sdk = { options: {}, registry: {} }
  const manager = new SerialManager({ sdk, SerialPortClass: HangingPort })
  await assert.rejects(
    () => manager.listPorts({ scanTimeoutMs: 10 }),
    (error) => error.code === 'NO_PORT' && error.stage === 'scan',
  )
})

test('disconnectAll 单个 close 失败仍清理其他会话', async () => {
  const sdk = { options: {}, registry: {} }
  const manager = new SerialManager({ sdk })
  let secondClosed = false
  manager.sessions.set('a', {
    sessionId: 'a',
    close: async () => { throw new Error('close failed') },
  })
  manager.sessions.set('b', {
    sessionId: 'b',
    close: async () => { secondClosed = true },
  })

  await assert.rejects(() => manager.disconnectAll(), /close failed/)
  assert.equal(secondClosed, true)
  assert.equal(manager.sessions.size, 0)
})

test('ShroomSensorSDK 暴露同一个 SerialManager 实例', () => {
  const sdk = new ShroomSensorSDK({ store: { close() {} } })
  assert.ok(sdk.serialManager instanceof SerialManager)
  assert.equal(sdk.getSerialState().status, 'idle')
})
