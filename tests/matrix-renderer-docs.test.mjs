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

test('renderer pages teach the short import path', () => {
  const ids = {
    NumMatrixRenderer: 'numMatrix',
    PointGridRenderer: 'pointGrid',
    HandPointsRenderer: 'handPoints',
    WebglHeatmapRenderer: 'webglHeatmap',
    BlobHeatmapRenderer: 'blobHeatmap',
  }

  for (const [file, name] of pages) {
    const markdown = readFileSync(
      new URL(`../docs/components/render/${file}`, import.meta.url),
      'utf8',
    )

    assert.match(
      markdown,
      new RegExp(`from 'shroom-backend-sdk/renderers/${ids[name]}'`),
      `${name} 的示例没用上短路径`,
    )
    // 7 段深路径仍然可用，但不该再出现在示例里。
    assert.doesNotMatch(
      markdown,
      /from 'shroom-backend-sdk\/UI\/frontend\/renderers/,
      `${name} 的示例仍在教旧的深路径`,
    )
  }
})

test('every documented param exists in the normalized output', () => {
  // 文档写了但归一化不产出的参数 = 教用户填一个没人读的键。
  const specs = [
    ['num-matrix-renderer.md', 'numMatrix', 'normalizeNumMatrixParams', 'NumMatrixRenderer.jsx'],
    ['point-grid-renderer.md', 'pointGrid', 'normalizePointGridParams', 'PointGridRenderer.jsx'],
    ['hand-points-renderer.md', 'handPoints', 'normalizeHandPointsParams', 'HandPointsRenderer.jsx'],
    ['webgl-heatmap-renderer.md', 'webglHeatmap', 'normalizeWebglHeatmapParams', 'WebglHeatmapRenderer.jsx'],
    ['blob-heatmap-renderer.md', 'blobHeatmap', 'normalizeBlobHeatmapParams', 'BlobHeatmapRenderer.jsx'],
  ]

  for (const [file, id, fnName, component] of specs) {
    const markdown = readFileSync(
      new URL(`../docs/components/render/${file}`, import.meta.url),
      'utf8',
    )
    const source = readFileSync(
      new URL(`../UI/frontend/renderers/${id}/core/params.js`, import.meta.url),
      'utf8',
    )
    // 少数参数刻意不进归一化层，直接由 React 层从原始 props 读 —— `pointGrid`
    // 的 `pointSprite` 就是（core 是零依赖层，不该知道有张图被打包器发出来了）。
    // 所以两处都算数。
    const react = readFileSync(
      new URL(`../UI/frontend/renderers/${id}/react/${component}`, import.meta.url),
      'utf8',
    )

    // 「关键参数」小节里所有形如 | `foo` | 或 | `foo.bar` | 的行首单元格。
    //
    // 扫描止于第一个三级标题或「## 公开命令」，取先到的那个 —— 参数小节之后
    // 常跟着别的表格（例如 pointGrid 的「纯算法层」函数表），那些不是 params。
    // 「### 取值范围」这类参数小节内部的三级标题不受影响，因为它们不含表格行。
    const start = markdown.indexOf('## 关键参数')
    const sectionRaw = markdown.slice(start, markdown.indexOf('## 公开命令'))
    const cutoff = sectionRaw.search(/\n## (?!关键参数)/)
    const section = cutoff === -1 ? sectionRaw : sectionRaw.slice(0, cutoff)
    const documented = [...section.matchAll(/^\| `([a-zA-Z][\w.]*)`/gm)]
      .map((match) => match[1].split('.')[0])

    assert.ok(documented.length > 0, `${file} 的关键参数表是空的`)
    assert.match(source, new RegExp(`export function ${fnName}`))

    for (const key of new Set(documented)) {
      const pattern = new RegExp(`\\b${key}\\b`)
      assert.ok(
        pattern.test(source) || pattern.test(react),
        `${file} 记录了 params.${key}，但 ${id} 的 core 与 react 层都没有这个键`,
      )
    }
  }
})

test('the two least-documented renderers now cover their nested params', () => {
  // 分析时 numMatrix 覆盖 29%、handPoints 21%，缺的正是最难猜的嵌套对象。
  const numMatrix = readFileSync(
    new URL('../docs/components/render/num-matrix-renderer.md', import.meta.url),
    'utf8',
  )
  for (const key of ['canvas2d.cellWidth', 'webgl.variant', 'webgl.glove.mode', 'webgl.foot.ttlMs', 'webgl.robot.parts', 'pressureRedistribution.enabled', 'sharedTuningKey', 'statsBeforeFilter']) {
    assert.ok(numMatrix.includes(`\`${key}\``), `num-matrix 文档缺 ${key}`)
  }

  const handPoints = readFileSync(
    new URL('../docs/components/render/hand-points-renderer.md', import.meta.url),
    'utf8',
  )
  for (const key of ['maskSource', 'interpMode', 'particleScale', 'particlePosition', 'maskBlur', 'maskThreshold', 'hiddenY', 'fingerBones', 'fingerRotationScale', 'pointSprite']) {
    assert.ok(handPoints.includes(`\`${key}\``), `hand-points 文档缺 ${key}`)
  }

  // 静默钳制是排障时最查不到原因的一类行为，五个页面都要写明。
  for (const [file] of pages) {
    const markdown = readFileSync(
      new URL(`../docs/components/render/${file}`, import.meta.url),
      'utf8',
    )
    assert.match(markdown, /静默钳制|静默改成|按边界值/, `${file} 未说明取值范围钳制`)
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
