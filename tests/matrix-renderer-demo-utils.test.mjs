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
  assert.match(source, /event\.ctrlKey \|\| event\.metaKey\) && event\.key === 'Enter'/)
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

test('heatmap demos scale the sequential 32x32 frame without saturating the canvas', () => {
  const source = readFileSync(
    new URL('../docs/.vitepress/theme/components/MatrixRendererDemos.jsx', import.meta.url),
    'utf8',
  )

  assert.match(
    source,
    /const WEBGL_HEATMAP_DEFAULTS = \{[\s\S]*?radius: 10,[\s\S]*?max: 1024,/,
  )
  assert.match(
    source,
    /const BLOB_HEATMAP_DEFAULTS = \{[\s\S]*?radius: 8,[\s\S]*?max: 1024,/,
  )
  assert.equal((source.match(/max="2048"/g) || []).length, 2)
})

test('renderer demos collapse params and use a compact stage without clipping the num canvas', () => {
  const styles = readFileSync(
    new URL('../docs/.vitepress/theme/components/matrix-renderer-demos.css', import.meta.url),
    'utf8',
  )
  const componentDemo = readFileSync(
    new URL('../docs/.vitepress/theme/components/ComponentDemo.jsx', import.meta.url),
    'utf8',
  )
  const rendererDemos = readFileSync(
    new URL('../docs/.vitepress/theme/components/MatrixRendererDemos.jsx', import.meta.url),
    'utf8',
  )

  assert.match(rendererDemos, /<details className="matrix-params-editor">/)
  assert.match(styles, /min-height:\s*100px/)
  assert.match(styles, /max-height:\s*180px/)
  assert.match(styles, /\.matrix-renderer-stage\s*\{[^}]*height:\s*360px/s)
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.matrix-renderer-stage\s*\{[^}]*height:\s*340px/)
  assert.match(styles, /\.matrix-renderer-stage \.maxNum\s*\{[^}]*inset:\s*0/s)
  assert.match(styles, /\.matrix-renderer-stage \.canvasNum \.threeBoxF\s*\{[^}]*width:\s*min\(100%, 340px\)[^}]*height:\s*auto[^}]*aspect-ratio:\s*1/s)
  assert.match(styles, /\.matrix-renderer-stage \.canvasNum \.threeBoxF canvas\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s)
  assert.match(componentDemo, /height:\s*460/)
  assert.match(rendererDemos, /heightScale:\s*0\.5/)
  assert.match(rendererDemos, /colorMax:\s*2560/)
  assert.match(rendererDemos, /step="20"/)
  assert.match(rendererDemos, /displaySize:\s*'min\(100%, 340px\)'/)
})
