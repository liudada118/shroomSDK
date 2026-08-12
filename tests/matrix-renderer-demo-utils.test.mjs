import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createRendererFrame,
  createSequentialFrame,
  parseParamsJson,
} from '../docs/.vitepress/theme/components/MatrixRendererDemoUtils.mjs'

test('creates a one-based sequential frame', () => {
  assert.deepEqual(createSequentialFrame(5), [1, 2, 3, 4, 5])
  assert.deepEqual(createSequentialFrame(0), [])
})

test('accepts only a JSON params object', () => {
  assert.deepEqual(parseParamsJson('{"gridWidth": 8}'), { gridWidth: 8 })
  assert.throws(() => parseParamsJson('[1, 2]'), /params 必须是 JSON 对象/)
  assert.throws(() => parseParamsJson('{bad json}'), /JSON/)
})

test('derives sequential frame length from applied renderer params', () => {
  assert.equal(createRendererFrame('NumMatrixRenderer', { gridWidth: 3, gridHeight: 2 }).length, 6)
  assert.equal(createRendererFrame('PointGridRenderer', { sit: { num1: 4, num2: 3 } }).length, 12)
  assert.equal(createRendererFrame('HandPointsRenderer', { sit: { num1: 5, num2: 4 } }).length, 20)
  assert.equal(createRendererFrame('WebglHeatmapRenderer', { dataWidth: 6, dataHeight: 5 }).length, 30)
  assert.equal(createRendererFrame('BlobHeatmapRenderer', { dataWidth: 7, dataHeight: 6 }).length, 42)
  assert.equal(createRendererFrame('TerrainMap', { rows: 8, columns: 6 }).length, 48)
})

test('all five demos expose a params JSON editor and no live generated frame', () => {
  const source = readFileSync(
    new URL('../docs/.vitepress/theme/components/MatrixRendererDemos.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /function ParamsEditor/)
  assert.match(source, /应用参数/)
  assert.match(source, /Ctrl\+Enter/)
  assert.equal((source.match(/<ParamsEditor/g) || []).length, 5)
  assert.doesNotMatch(source, /useLiveFrame|setInterval|createMatrixFrame/)
})

test('terrain demo exposes the shared params editor and sequential input', () => {
  const source = readFileSync(
    new URL('../docs/.vitepress/theme/components/ComponentDemo.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /ParamsEditor/)
  assert.match(source, /createRendererFrame\('TerrainMap', params\)/)
  assert.match(source, /defaultParams=\{TERRAIN_MAP_DEFAULTS\}/)
  assert.doesNotMatch(source, /createTerrainDemoFrame/)
})

test('renderer demo defaults expose common public tuning fields', () => {
  const source = readFileSync(
    new URL('../docs/.vitepress/theme/components/MatrixRendererDemos.jsx', import.meta.url),
    'utf8',
  )

  for (const field of [
    'chartWindow', 'cameraControls', 'fps', 'separation', 'pointSize',
    'maskBlur', 'radius', 'valueScale', 'blurFactor', 'maxOpacity', 'alphaFloor',
  ]) {
    assert.match(source, new RegExp(`${field}:`), `missing documented params field: ${field}`)
  }
})
