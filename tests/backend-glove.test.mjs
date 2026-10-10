import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SENSOR_PROFILES,
  GLOVE_HAND_MAPPING,
  GLOVE_PRODUCT_PROFILES,
  GloveConnectionError,
  GloveFrameError,
  ProtocolRegistry,
  ShroomSensorSDK,
  createGlovePacketAssembler,
  decodeFloat32LE,
  flattenGloveHandMapping,
  handLeft256To147,
  handLeft256To1024,
  handRight256To147,
  handRight256To1024,
  validateGloveHandMapping,
  validateGlovePacket,
} from '../index.js'
import { GLOVE_REAL_FRAME_FIXTURES as FIXTURES } from './fixtures/glove-real-frames.mjs'

test('真实产品菜单型号明确映射到四个 Profile', () => {
  assert.deepEqual(Object.keys(GLOVE_PRODUCT_PROFILES), [
    'hand0205',
    'hand0205Double',
    'handGlove115200',
    'handGloveFullPacket',
  ])
  assert.equal(GLOVE_PRODUCT_PROFILES.hand0205.protocol, 'split-130-146')
  assert.equal(GLOVE_PRODUCT_PROFILES.hand0205Double.packetSide[1], 'left')
  assert.equal(GLOVE_PRODUCT_PROFILES.handGloveFullPacket.protocol, 'fixed-274')
})

test('IMU 16 字节按 float32LE xyzw 解码', () => {
  const values = decodeFloat32LE(FIXTURES.fullLeft.subarray(258))
  assert.deepEqual(values, FIXTURES.quaternion)
})

test('左右手 Mapping 都从原始 256 点生成 147 点和 32x32', () => {
  const source = [...FIXTURES.pressure]
  const snapshot = [...source]
  const left147 = handLeft256To147(source)
  const right147 = handRight256To147(source)

  assert.equal(left147.length, 147)
  assert.equal(right147.length, 147)
  assert.equal(handLeft256To1024(source).length, 1024)
  assert.equal(handRight256To1024(source).length, 1024)
  assert.notDeepEqual(left147, right147)
  assert.deepEqual(source, snapshot)
})

test('左右手结构化 Mapping 与生产点位表逐项一致', () => {
  const validation = validateGloveHandMapping()
  assert.equal(validation.ok, true)
  assert.deepEqual(validation.errors, [])
  assert.deepEqual(validation.hands.left, {
    sourcePointCount: 137,
    uniquePointCount: 137,
    logicalPalmSlots: 75,
    palmPointCount: 72,
    palmBlankSlots: 3,
  })
  assert.deepEqual(validation.hands.right, validation.hands.left)

  assert.equal(GLOVE_HAND_MAPPING.indexBase, 1)
  assert.deepEqual(GLOVE_HAND_MAPPING.leftHand.map(({ name }) => name), [
    '小拇指', '无名指', '中指', '食指', '大拇指', '手掌',
  ])
  assert.deepEqual(GLOVE_HAND_MAPPING.rightHand.map(({ name }) => name), [
    '大拇指', '食指', '中指', '无名指', '小拇指', '手掌',
  ])
  assert.deepEqual(flattenGloveHandMapping('left').slice(0, 12), [
    31, 30, 29, 15, 14, 13, 255, 254, 253, 239, 238, 237,
  ])
  assert.deepEqual(flattenGloveHandMapping('right').slice(0, 12), [
    240, 239, 238, 256, 255, 254, 16, 15, 14, 32, 31, 30,
  ])
})

test('左右手 256 点线序按 Mapping 的首行输出', () => {
  const source = Array.from({ length: 256 }, (_, index) => index + 1)
  assert.deepEqual(handLeft256To147(source).slice(0, 15), [
    17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  ])
  assert.deepEqual(handRight256To147(source).slice(0, 15), [
    240, 239, 238, 237, 236, 235, 234, 233, 232, 231, 230, 229, 228, 227, 226,
  ])
})

test('双手分包可交错到达且按 packetType 独立组帧', () => {
  const assembler = createGlovePacketAssembler('hand0205Double')
  assert.equal(assembler.push(FIXTURES.splitLeft.first).complete, false)
  assert.equal(assembler.push(FIXTURES.splitRight.first).complete, false)

  const left = assembler.push(FIXTURES.splitLeft.second)
  const right = assembler.push(FIXTURES.splitRight.second)
  assert.equal(left.handSide, 'left')
  assert.equal(right.handSide, 'right')
  assert.equal(left.handSideSource, 'packetType')
  assert.deepEqual(left.pressureData, FIXTURES.pressure)
})

test('单手 Profile 以串口通道判定左右手', () => {
  const assembler = createGlovePacketAssembler('hand0205')
  assembler.push(FIXTURES.splitLeft.first, { channel: 'right' })
  const frame = assembler.push(FIXTURES.splitLeft.second, { channel: 'right' })

  assert.equal(frame.handSide, 'right')
  assert.equal(frame.handSideSource, 'channel')
})

test('整包解析输出原始压力、映射、矩阵和结构化 IMU', () => {
  const registry = new ProtocolRegistry(DEFAULT_SENSOR_PROFILES)
  const frame = registry.parse('handGloveFullPacket', FIXTURES.fullLeft, { channel: 'left' })

  assert.equal(frame.pressureData.length, 256)
  assert.equal(frame.mappedData.length, 195)
  assert.equal(frame.matrixData.length, 1024)
  assert.equal(frame.pressure.unit, 'adc_count')
  assert.deepEqual(frame.imu.values, FIXTURES.quaternion)
  assert.equal(frame.imu.order, 'xyzw')
  assert.equal(frame.imu.quaternion.x, FIXTURES.quaternion[0])
  assert.equal(frame.imu.quaternion.valid, true)
  assert.equal(frame.handSide, 'left')
})

test('帧校验拒绝错误长度，尾包缺首包返回明确错误码', () => {
  const validation = validateGlovePacket(Buffer.alloc(100), 'hand0205')
  assert.equal(validation.ok, false)
  assert.match(validation.errors[0], /130.*146/)

  const assembler = createGlovePacketAssembler('hand0205Double')
  assert.throws(
    () => assembler.push(FIXTURES.splitLeft.second),
    (error) => error instanceof GloveFrameError && error.code === 'MISSING_FIRST_PACKET',
  )
})

test('connectGlove 手动连接把 Profile 和端口一次性装配好', async () => {
  const sdk = new ShroomSensorSDK()
  let openOptions
  sdk.open = async (options) => {
    openOptions = options
    return {}
  }

  const session = await sdk.connectGlove({
    profileId: 'hand0205',
    leftPort: 'COM3',
  })

  assert.equal(openOptions.sensorType, 'hand0205')
  assert.deepEqual(openOptions.channels, { left: 'COM3' })
  assert.equal(session.connectionMode, 'manual')
  assert.equal(session.product.displayName, '触觉手套')
})

test('connectGlove 一键连接优先使用识别出的传感器串口', async () => {
  const sdk = new ShroomSensorSDK()
  sdk.listPorts = async () => [{ path: 'COM8', isLikelySensorPort: true }]
  sdk.open = async (options) => ({ channels: options.channels })

  const session = await sdk.connectGlove({ profileId: 'handGlove115200' })

  assert.deepEqual(session.selectedPorts, { left: 'COM8' })
  assert.equal(session.product.baudRate, 115200)
  assert.equal(session.connectionMode, 'auto')
})

test('connectGlove 没有串口时返回 NO_GLOVE_PORT', async () => {
  const sdk = new ShroomSensorSDK()
  sdk.listPorts = async () => []

  await assert.rejects(
    () => sdk.connectGlove({ profileId: 'hand0205' }),
    (error) => error instanceof GloveConnectionError && error.code === 'NO_GLOVE_PORT',
  )
})
