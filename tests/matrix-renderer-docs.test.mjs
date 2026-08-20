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
  assert.match(source, /filterMin: 0/)
  assert.match(source, /blurSigma: 0/)
  assert.doesNotMatch(source, /rotateHeight:/)
  assert.doesNotMatch(source, /rotateWidth:/)
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

test('documents the declarative frame prop on every renderer page', () => {
  for (const [file, name] of pages) {
    const markdown = readFileSync(
      new URL(`../docs/components/render/${file}`, import.meta.url),
      'utf8',
    )

    // 最小用法必须是声明式那一版：接入成本从「建 ref + useEffect + 记住
    // wsPointData 这个名字」降到一个 prop，是这一轮的主要收益，写在别处等于没写。
    assert.match(markdown, /## 声明式 props/, `${name} 缺少声明式 props 小节`)
    assert.match(markdown, /\| `frame` \|/, `${name} 的 props 表缺 frame`)
    assert.match(markdown, /frame=\{matrix\}/, `${name} 的最小用法没用上 frame`)

    // 引用比较这条必须写明：原地改数组不重画是最容易踩的一个坑。
    assert.match(markdown, /原地修改同一个数组不会触发重画/, `${name} 未说明引用比较语义`)
  }
})

test('only pointGrid documents the second declarative channel', () => {
  for (const [file, name] of pages) {
    const markdown = readFileSync(
      new URL(`../docs/components/render/${file}`, import.meta.url),
      'utf8',
    )
    const hasBackFrame = /\| `backFrame` \|/.test(markdown)
    assert.equal(hasBackFrame, name === 'PointGridRenderer', `${name} 的 backFrame 文档与实现不一致`)
  }
})

test('sidebar lists all matrix renderer pages', () => {
  const config = readFileSync(
    new URL('../docs/.vitepress/config.mjs', import.meta.url),
    'utf8',
  )

  for (const [, name] of pages) assert.match(config, new RegExp(`text: '${name}'`))
})
