import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const demoModule = new URL(
  '../docs/.vitepress/theme/components/MatrixRendererDemos.jsx',
  import.meta.url,
)
const names = [
  'NumMatrixRenderer',
  'PointGridRenderer',
  'HandPointsRenderer',
  'WebglHeatmapRenderer',
  'BlobHeatmapRenderer',
]
const pages = [
  ['num-matrix-renderer.md', 'NumMatrixRenderer'],
  ['point-grid-renderer.md', 'PointGridRenderer'],
  ['hand-points-renderer.md', 'HandPointsRenderer'],
  ['webgl-heatmap-renderer.md', 'WebglHeatmapRenderer'],
  ['blob-heatmap-renderer.md', 'BlobHeatmapRenderer'],
]

test('exports every real matrix renderer demo', () => {
  const source = readFileSync(demoModule, 'utf8')

  for (const name of names) assert.match(source, new RegExp(`${name}:`))
  assert.match(source, /sitData\(\{ wsPointData: frame \}/)
  assert.match(source, /modelUrl: ''/)
  assert.match(source, /rotateHeight: 16/)
  assert.match(source, /rotateWidth: 16/)
})

test('publishes one interactive page per renderer', () => {
  for (const [file, name] of pages) {
    const markdown = readFileSync(
      new URL(`../docs/components/render/${file}`, import.meta.url),
      'utf8',
    )
    assert.match(markdown, new RegExp(`# ${name}`))
    assert.match(markdown, new RegExp(`<UiComponentDemo name="${name}" />`))
    assert.match(markdown, /## 最小用法/)
    assert.match(markdown, /## 输入数据/)
  }
})

test('sidebar lists all matrix renderer pages', () => {
  const config = readFileSync(
    new URL('../docs/.vitepress/config.mjs', import.meta.url),
    'utf8',
  )

  for (const [, name] of pages) assert.match(config, new RegExp(`text: '${name}'`))
})
