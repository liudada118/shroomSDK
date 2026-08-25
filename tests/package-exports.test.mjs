/**
 * package-exports.test.mjs - 根包 exports 映射
 *
 * 加 `exports` 是不可逆的收口动作：一旦声明，**未列出的子路径全部被封死**。
 * 所以这份测试守两件事——
 *
 * 1. 新短别名真的能解析（`shroom-backend-sdk/renderers/numMatrix` 这种）；
 * 2. 文档里教过的每一条旧路径**一条都没被封掉**。
 *
 * 用 `require.resolve` 而不是查 JSON：包自带 `exports` 后可以自引用，走的就是
 * Node 真实的解析算法，能抓到「目录型入口没有显式声明」这类查 JSON 看不出的问题
 * （`./UI/*` 通配到目录不会自动补 index.js）。
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** 新增的短别名。接入代码从 7 段路径降到 2 段，是加 exports 的主要收益。 */
const SHORT_ALIASES = [
  'shroom-backend-sdk/renderers',
  'shroom-backend-sdk/renderers/numMatrix',
  'shroom-backend-sdk/renderers/pointGrid',
  'shroom-backend-sdk/renderers/handPoints',
  'shroom-backend-sdk/renderers/webglHeatmap',
  'shroom-backend-sdk/renderers/blobHeatmap',
  'shroom-backend-sdk/renderers/numMatrix/core',
  'shroom-backend-sdk/renderers/pointGrid/core',
  'shroom-backend-sdk/renderers/handPoints/core',
  'shroom-backend-sdk/renderers/webglHeatmap/core',
  'shroom-backend-sdk/renderers/blobHeatmap/core',
  'shroom-backend-sdk/core',
  'shroom-backend-sdk/frontend',
  'shroom-backend-sdk/qxui',
  'shroom-backend-sdk/shroomui',
  'shroom-backend-sdk/render',
]

/**
 * 加 exports 之前就能用、文档里教过的路径。**这一组是向后兼容契约，只能增不能减。**
 */
const LEGACY_PATHS = [
  'shroom-backend-sdk',
  'shroom-backend-sdk/package.json',
  // README / SDK_GUIDE / UI_COMPONENTS 教的三条目录型入口
  'shroom-backend-sdk/UI/qxui',
  'shroom-backend-sdk/UI/shroomui',
  'shroom-backend-sdk/UI/render',
  // UI 聚合入口与前端子包
  'shroom-backend-sdk/UI',
  'shroom-backend-sdk/UI/frontend',
  'shroom-backend-sdk/UI/frontend/core',
  'shroom-backend-sdk/UI/frontend/renderers',
  // 组件文档页教的完整深路径（带 .jsx 扩展名）
  'shroom-backend-sdk/UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx',
  'shroom-backend-sdk/UI/frontend/renderers/pointGrid/react/PointGridRenderer.jsx',
  'shroom-backend-sdk/UI/frontend/renderers/handPoints/react/HandPointsRenderer.jsx',
  'shroom-backend-sdk/UI/frontend/renderers/webglHeatmap/react/WebglHeatmapRenderer.jsx',
  'shroom-backend-sdk/UI/frontend/renderers/blobHeatmap/react/BlobHeatmapRenderer.jsx',
  // 样式与静态资源
  'shroom-backend-sdk/UI/frontend/styles/canvas.css',
  // API_REFERENCE「不在根入口的模块」那张表，两种写法都要成立
  'shroom-backend-sdk/src/profiles',
  'shroom-backend-sdk/src/profiles.js',
  'shroom-backend-sdk/src/serial/SensorSession',
  'shroom-backend-sdk/src/protocol/parsers',
  'shroom-backend-sdk/src/utils/stats',
  'shroom-backend-sdk/src/config/PathService',
  'shroom-backend-sdk/src/backend/BackendCommandRouter',
]

test('root package declares an exports map', () => {
  assert.ok(pkg.exports, '根 package.json 缺 exports')
  assert.equal(pkg.exports['.'], './index.js')
  // 工具链普遍要读它，封死会引发难查的构建报错。
  assert.equal(pkg.exports['./package.json'], './package.json')
})

test('short aliases resolve', () => {
  for (const specifier of SHORT_ALIASES) {
    assert.doesNotThrow(() => require.resolve(specifier), `短别名无法解析: ${specifier}`)
  }
})

test('every documented legacy path still resolves', () => {
  for (const specifier of LEGACY_PATHS) {
    assert.doesNotThrow(
      () => require.resolve(specifier),
      `exports 封死了已文档化的旧路径: ${specifier}`,
    )
  }
})

test('short aliases and legacy deep paths point at the same files', () => {
  const pairs = [
    ['shroom-backend-sdk/renderers/numMatrix', 'shroom-backend-sdk/UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx'],
    ['shroom-backend-sdk/renderers/blobHeatmap/core', 'shroom-backend-sdk/UI/frontend/renderers/blobHeatmap/core/index.js'],
    ['shroom-backend-sdk/core', 'shroom-backend-sdk/UI/frontend/core'],
    ['shroom-backend-sdk/qxui', 'shroom-backend-sdk/UI/qxui'],
  ]

  for (const [short, long] of pairs) {
    assert.equal(require.resolve(short), require.resolve(long), `${short} 与 ${long} 指向不同文件`)
  }
})

test('every exports target exists on disk', () => {
  const targets = []
  const collect = (value) => {
    if (typeof value === 'string') targets.push(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(pkg.exports)

  for (const target of targets) {
    // 通配目标（含 *）由上面的解析用例覆盖，这里只查固定路径的错别字。
    if (target.includes('*')) continue
    assert.ok(
      existsSync(new URL(`../${target.slice(2)}`, import.meta.url)),
      `exports 指向了不存在的文件: ${target}`,
    )
  }
})

test('exports targets stay inside published files', () => {
  // exports 指到 files 白名单外的路径，本地能跑、装包之后必崩。
  // 通配目标按 `*` 之前的固定前缀判定：前缀落在白名单内，展开出来的才可能被发布。
  const published = pkg.files.filter((entry) => !entry.startsWith('!'))
  const targets = []
  const collect = (value) => {
    if (typeof value === 'string') targets.push(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(pkg.exports)

  for (const target of targets) {
    const path = target.slice(2)
    if (path === 'package.json') continue
    const prefix = path.includes('*') ? path.slice(0, path.indexOf('*')) : path
    assert.ok(
      published.some((entry) => prefix === entry
        || prefix.startsWith(`${entry}/`)
        || `${entry}/`.startsWith(prefix)),
      `exports 目标不在 files 白名单内: ${target}`,
    )
  }
})

test('exports does not expose paths excluded from the tarball', () => {
  // `files` 用 `!UI/render/prototypes` 把迁移参考件挡在发布之外。exports 若能
  // 通配到它，装包后就是一条指向不存在文件的入口。
  const excluded = pkg.files
    .filter((entry) => entry.startsWith('!'))
    .map((entry) => entry.slice(1))
    .filter((entry) => !entry.includes('*'))

  for (const entry of excluded) {
    assert.throws(
      () => require.resolve(`shroom-backend-sdk/${entry}`),
      `exports 暴露了不发布的路径: ${entry}`,
    )
  }
})

test('the only typed surface is wired to its declaration file', () => {
  // UI/render 是全仓唯一带 .d.ts 的入口，两条路径都要把 types 接上，
  // 否则 TS 使用方拿到的是 any。
  for (const key of ['./render', './UI/render']) {
    assert.equal(pkg.exports[key]?.types, './UI/render/index.d.ts', `${key} 未接类型入口`)
  }
})
