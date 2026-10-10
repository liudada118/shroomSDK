/**
 * backend-line-orders.test.mjs - 内置线序与 profile 可解析性
 *
 * 这份测试守的是一条曾经被破坏过的性质：**每个内置 profile 都能解析出一帧**。
 *
 * 2026-08-24 之前，`hand` / `handSinglePoint` / `smallBed12B` 三个 profile 声明了
 * 线序名，但注册表是空的（上游从主项目根目录 require 线序，抽包时那两条
 * require 被去掉了），于是首帧就抛 `line order "..." is not registered`，
 * 抛点在串口 data 回调里，终止进程。
 *
 * 没有这份测试，同类回归（再加一个声明了线序的 profile 却忘了实现）不会被发现。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SENSOR_PROFILES,
  PROJECT_LINE_ORDER_NAMES,
  ProtocolRegistry,
  createGlovePacketAssembler,
  createProjectLineOrderRegistry,
} from '../index.js'
import { GLOVE_REAL_FRAME_FIXTURES as GLOVE_FIXTURES } from './fixtures/glove-real-frames.mjs'

import { handSinglePoint, jqbed } from '../src/line/builtinLineOrders.js'

/** 造一帧可区分的数据：值等于下标，重排后能逐点验证去向。 */
function indexFrame(length) {
  return Array.from({ length }, (_, index) => index)
}

test('内置线序已注册', () => {
  assert.deepEqual(PROJECT_LINE_ORDER_NAMES, ['handSinglePoint', 'jqbed'])
})

test('每个内置 profile 都能解析出一帧', () => {
  const registry = new ProtocolRegistry(DEFAULT_SENSOR_PROFILES)
  const buffer = Buffer.alloc(2048, 7)

  for (const sensorType of Object.keys(DEFAULT_SENSOR_PROFILES)) {
    const profile = DEFAULT_SENSOR_PROFILES[sensorType]
    const parseProfileFrame = () => {
      if (profile.parser === 'handGloveFullPacket') {
        return registry.parse(sensorType, GLOVE_FIXTURES.fullLeft, { channel: 'left' })
      }
      if (profile.parser === 'handGloveSplitPacket' || profile.parser === 'handGloveDoublePacket') {
        const gloveAssembler = createGlovePacketAssembler(sensorType)
        registry.parse(sensorType, GLOVE_FIXTURES.splitLeft.first, { channel: 'left', gloveAssembler })
        return registry.parse(sensorType, GLOVE_FIXTURES.splitLeft.second, { channel: 'left', gloveAssembler })
      }
      return registry.parse(sensorType, buffer, { channel: 'sit' })
    }

    assert.doesNotThrow(
      parseProfileFrame,
      `profile ${sensorType} 解析抛错`,
    )
    const frame = parseProfileFrame()
    assert.ok(frame.data.length > 0, `profile ${sensorType} 解析出空数据`)
  }
})

test('声明了线序名的 profile，那个名字必须真的注册过', () => {
  // 这条是防回归的核心：加 profile 时写了线序名却没写实现，在这里就被拦下，
  // 而不是等到客户接上设备的第一帧。
  const registry = createProjectLineOrderRegistry()

  for (const [sensorType, profile] of Object.entries(DEFAULT_SENSOR_PROFILES)) {
    if (typeof profile.lineOrder !== 'string') continue
    assert.ok(
      registry.has(profile.lineOrder),
      `profile ${sensorType} 声明了线序 "${profile.lineOrder}"，但没有注册实现`,
    )
  }
})

test('使用方的同名线序覆盖内置实现', () => {
  // 设备批次差异导致走线不同时，使用方要能就地替换而不改 SDK。
  const registry = createProjectLineOrderRegistry({
    jqbed: () => ['replaced'],
  })

  assert.deepEqual(registry.apply('jqbed', [1, 2, 3]), ['replaced'])
})

test('jqbed 保长度且是纯重排（不增删不改值）', () => {
  const source = indexFrame(1024)
  const result = jqbed(source)

  assert.equal(result.length, 1024)
  assert.deepEqual([...result].sort((a, b) => a - b), source)
})

test('jqbed 不修改入参', () => {
  const source = indexFrame(1024)
  const snapshot = [...source]
  jqbed(source)

  assert.deepEqual(source, snapshot)
})

test('jqbed 把前 15 行上下翻转后整体挪到末尾', () => {
  const source = indexFrame(1024)
  const result = jqbed(source)

  // 翻转后的第 0 行是原第 14 行；整体后移 17 行，所以它落在末尾往前数第 15 行。
  const tailStart = (32 - 15) * 32
  assert.equal(result[tailStart], 14 * 32)
  // 原第 15 行（未参与翻转的第一行）前移到开头。
  assert.equal(result[0], 15 * 32)
})

test('jqbed 第 7 行居中不参与翻转', () => {
  // 0↔14、1↔13 …… 6↔8，7 自己和自己换。
  const source = indexFrame(1024)
  const result = jqbed(source)
  const tailStart = (32 - 15) * 32

  assert.equal(result[tailStart + 7 * 32], 7 * 32)
})

test('handSinglePoint 保长度且是纯重排', () => {
  const source = indexFrame(1024)
  const result = handSinglePoint(source)

  assert.equal(result.length, 1024)
  assert.deepEqual([...result].sort((a, b) => a - b), source)
})

test('handSinglePoint 不修改入参', () => {
  const source = indexFrame(1024)
  const snapshot = [...source]
  handSinglePoint(source)

  assert.deepEqual(source, snapshot)
})

test('handSinglePoint 三段拼接的边界正确', () => {
  const source = indexFrame(1024)
  const result = handSinglePoint(source)

  // 第 1 段从 1-based 的 481 起，即下标 480。
  assert.equal(result[0], 480)
  // 第 1 段共 (992-481+1)=512 点，第 2 段从 1-based 449 起（下标 448）。
  assert.equal(result[512], 448)
  // 第 2 段共 (449-1)/32+1=15 行 ×32=480 点，第 3 段从 1-based 993 起（下标 992）。
  assert.equal(result[512 + 480], 992)
})

test('handSinglePoint 越界读数落成 0（与原实现一致）', () => {
  // 原件用 `arr[point - 1] || 0`，短数组会得到 0 而不是 undefined。
  const result = handSinglePoint([1, 2, 3])

  assert.equal(result.length, 1024)
  assert.ok(result.every((value) => Number.isFinite(value)))
})

test('走 hand profile 时线序真的生效', () => {
  // 端到端：profile 声明 jqbed，解析结果应当与直接调 jqbed 一致。
  const registry = new ProtocolRegistry(DEFAULT_SENSOR_PROFILES)
  const buffer = Buffer.from(indexFrame(1024).map((value) => value % 256))
  const frame = registry.parse('hand', buffer, { channel: 'sit' })

  assert.deepEqual(frame.data, jqbed([...buffer]))
})
