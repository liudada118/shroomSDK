/**
 * component-spec.test.mjs - 组件规约断言
 *
 * 对应 `docs/superpowers/specs/2026-08-21-component-spec.md`。规约不落成断言就会漂
 * ——本仓已有反例：「不许出现 100vw」有断言，一年后还成立；「参数要写进文档」没有
 * 断言，numMatrix 覆盖率掉到 29%。
 *
 * ## 豁免清单的用法
 *
 * `EXEMPT` 列的是**已知偏差**，不是"允许违规"。它的作用是让新组件立刻受约束，
 * 而老偏差按 spec 第七节的决策逐个清掉，不必一次性阻塞。
 *
 * **清掉一条偏差时，要把对应的豁免项一起删掉** —— 留着的话下次再引入同样的问题
 * 就抓不到了。每条豁免都注明了它对应 spec 第七节的哪个决策。
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)

function read(relativePath) {
  return readFileSync(new URL(relativePath, root), 'utf8')
}

function listDirs(relativePath) {
  return readdirSync(new URL(relativePath, root), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function listFiles(relativePath) {
  return readdirSync(new URL(relativePath, root), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}

/* ─── 豁免清单 ──────────────────────────────────────────────────────── */

const EXEMPT = {
  /** spec 第七节决策 1：CSS 类名未加 `ui-` 前缀，会和宿主样式相撞。 */
  cssNamespace: ['ChartPanel', 'DraggablePanel', 'Drawer', 'Select', 'ToolbarAction'],
  /** spec 第七节决策 2：SCSS 使用 rem，依赖宿主根字号。C 类已全部改 px，B 类未跟上。 */
  remUnits: [
    'AsyncState', 'ChartPanel', 'DraggablePanel', 'Drawer', 'ExportDialog',
    'MetricValue', 'Select', 'SettingControlRow', 'ToolbarAction',
  ],
  /**
   * spec 第七节决策 3：引用了 SDK 内未定义的宿主全局类（纯 bug，不是风格问题）。
   *
   * | 组件 | 未定义的类 |
   * | :--- | :--- |
   * | `Drawer` | `.closeDrawer` `.cursor` |
   * | `Playback` | `.playOrStop` `.cursor` |
   * | `Select` | `.cursor` `.fs16` |
   * | `ToolbarAction` | `.fs14` |
   *
   * `.cursor` 被三个组件引用（应是 `cursor: pointer`），`.fs14` / `.fs16` 是字号
   * 工具类。`Playback/` 还是 10 个目录里唯一没有 `index.scss` 的——两个组件的
   * 样式完全依赖宿主。
   */
  hostGlobalClasses: ['Drawer', 'Playback', 'Select', 'ToolbarAction'],
  /** spec 第七节决策 5：缩进与 B 类的 4 空格约定不一致。 */
  indent: ['Select.jsx', 'ToolbarAction.jsx'],
  /**
   * 语义确实是全局的模块级状态。见 spec 共通规矩第 1 条：
   * 禁止的是「把每实例状态提到模块作用域」，不是「禁止一切模块级状态」。
   *
   * `DraggablePanel` 的 `globalMaxZIndex` 与 `Drawer` 的 `topDrawerZIndex` 都是
   * 跨实例的层叠顺序计数器——"点击置顶"必须知道当前最高的 z-index，
   * 每实例状态实现不了。这一条是**设计决策而非待清偏差**。
   */
  moduleState: [
    'UI/shroomui/DraggablePanel/DraggablePanel.jsx',
    'UI/shroomui/Drawer/Drawer.jsx',
  ],
  /**
   * A 类 core 的注入式 DOM 访问。见 spec 形态 A 第 2 条：
   * import 时不碰 DOM，运行时通过 `createIntensity({ createCanvas })` 注入。
   * 这一条是**设计决策而非待清偏差**，不对应第七节任何决策。
   */
  coreDom: ['blobHeatmap/core/intensity.js'],
}

const RENDERERS = ['numMatrix', 'pointGrid', 'handPoints', 'webglHeatmap', 'blobHeatmap']

/* ─── 形态 A：core + react 分层 ─────────────────────────────────────── */

test('A 类：每个渲染器都有 core 与 react 两层', () => {
  for (const id of RENDERERS) {
    const files = listFiles(`UI/frontend/renderers/${id}/core`)
    assert.ok(files.includes('index.js'), `${id} 缺 core/index.js`)
    assert.ok(files.includes('params.js'), `${id} 缺 core/params.js`)
    assert.ok(
      listDirs(`UI/frontend/renderers/${id}`).includes('react'),
      `${id} 缺 react 层`,
    )
  }
})

test('A 类：params.js 导出归一化函数与取值范围', () => {
  for (const id of RENDERERS) {
    const source = read(`UI/frontend/renderers/${id}/core/params.js`)
    const name = id.charAt(0).toUpperCase() + id.slice(1)

    assert.match(source, new RegExp(`export function normalize${name}Params`), `${id} 缺归一化函数`)
    assert.match(source, /export const PARAM_RANGES/, `${id} 缺 PARAM_RANGES`)
    // 非法输入退回默认值而非抛错：空串/null 必须先拦掉，否则会被夹到 range.min。
    assert.match(
      source,
      /value === null \|\| value === undefined \|\| value === ''/,
      `${id} 的 clamp 没有拦掉 null / undefined / 空串`,
    )
  }
})

test('A 类：core 不引入 React 或 three', () => {
  for (const id of RENDERERS) {
    for (const file of listFiles(`UI/frontend/renderers/${id}/core`)) {
      if (file.endsWith('.test.js')) continue
      const source = read(`UI/frontend/renderers/${id}/core/${file}`)
      assert.doesNotMatch(source, /^import .* from ['"]react['"]/m, `${id}/core/${file} 引入了 React`)
      assert.doesNotMatch(source, /^import .* from ['"]three/m, `${id}/core/${file} 引入了 three`)
    }
  }
})

test('A 类：core 顶层不访问 DOM', () => {
  for (const id of RENDERERS) {
    for (const file of listFiles(`UI/frontend/renderers/${id}/core`)) {
      if (file.endsWith('.test.js')) continue
      if (EXEMPT.coreDom.includes(`${id}/core/${file}`)) continue

      const source = read(`UI/frontend/renderers/${id}/core/${file}`)
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释里大量引用原实现，不算
        .replace(/\/\/.*$/gm, '')
      // `window` 在 pushWindow 里是函数参数名，只查带成员访问的 document。
      assert.doesNotMatch(
        code,
        /\bdocument\s*\./,
        `${id}/core/${file} 直接访问了 document；需要宿主能力请做成可注入并加进豁免`,
      )
    }
  }
})

test('A 类：五个渲染器都接了声明式与命令式两条帧入口', () => {
  for (const id of RENDERERS) {
    const file = listFiles(`UI/frontend/renderers/${id}/react`)
      .find((name) => name.endsWith('Renderer.jsx'))
    assert.ok(file, `${id} 找不到 Renderer 组件`)

    const source = read(`UI/frontend/renderers/${id}/react/${file}`)
    assert.match(source, /useDeclarativeFrame\(props\.frame/, `${id} 缺声明式 frame 入口`)
    assert.match(source, /useImperativeHandle/, `${id} 缺命令式 ref 入口`)
  }
})

test('A 类：不按视口尺寸铺画面', () => {
  for (const id of RENDERERS) {
    for (const file of listFiles(`UI/frontend/renderers/${id}/react`)) {
      const source = read(`UI/frontend/renderers/${id}/react/${file}`)
      assert.doesNotMatch(source, /100vw|100vh/, `${id}/react/${file} 用了视口单位，应以宿主容器为边界`)
    }
  }
})

/* ─── 形态 B / C 共通：依赖边界 ─────────────────────────────────────── */

function collectComponents(base) {
  const out = []
  for (const group of listDirs(base)) {
    for (const file of listFiles(`${base}/${group}`)) {
      if (file.endsWith('.jsx') && !file.endsWith('.styles.jsx')) {
        out.push({ group, file, path: `${base}/${group}/${file}`, name: file.replace('.jsx', '') })
      }
    }
  }
  return out
}

const shroomui = collectComponents('UI/shroomui')
const qxui = collectComponents('UI/qxui')

test('B / C 类：不请求业务接口、不引入项目别名', () => {
  for (const component of [...shroomui, ...qxui]) {
    const source = read(component.path)
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${component.path} 直接请求了接口`)
    assert.doesNotMatch(source, /from ['"]axios['"]/, `${component.path} 引入了 axios`)
    assert.doesNotMatch(source, /from ['"]@\//, `${component.path} 引入了项目别名`)
  }
})

test('B / C 类：默认导出组件，不留模块级可变状态', () => {
  for (const component of [...shroomui, ...qxui]) {
    const source = read(component.path)
    assert.match(source, /export default/, `${component.path} 没有默认导出`)
    if (EXEMPT.moduleState.includes(component.path)) continue

    // 把**每实例**状态提到模块作用域是「同页两个实例互相踩」的根因
    // （原 canvas.jsx 的教训）。语义真属于全局的进豁免并写明理由。
    const topLevel = source.split('\n').filter((line) => /^(let|var) /.test(line))
    assert.deepEqual(topLevel, [], `${component.path} 有模块级可变状态: ${topLevel.join(', ')}`)
  }
})

test('B / C 类：用 ref 取自己的节点，不用全局选择器', () => {
  for (const component of [...shroomui, ...qxui]) {
    const source = read(component.path)
    assert.doesNotMatch(
      source,
      /document\.(getElementById|querySelector)/,
      `${component.path} 用了全局选择器，同页第二个实例会抢同一元素`,
    )
  }
})

/* ─── 形态 B：基础组件 ──────────────────────────────────────────────── */

test('B 类：不订阅外部状态（observer 属于 C 类）', () => {
  for (const component of shroomui) {
    const source = read(component.path)
    assert.doesNotMatch(
      source,
      /from ['"]mobx/,
      `${component.path} 引入了 mobx；带业务状态的组件属于 UI/qxui`,
    )
  }
})

test('B 类：CSS 类名带 ui- 前缀', () => {
  for (const group of listDirs('UI/shroomui')) {
    if (!listFiles(`UI/shroomui/${group}`).includes('index.scss')) continue
    if (EXEMPT.cssNamespace.includes(group)) continue

    const scss = read(`UI/shroomui/${group}/index.scss`)
    const selectors = [...scss.matchAll(/^\.([a-zA-Z][\w-]*)/gm)].map((m) => m[1])
    for (const selector of selectors) {
      assert.ok(
        selector.startsWith('ui-'),
        `UI/shroomui/${group}/index.scss 的 .${selector} 没有 ui- 前缀，会和宿主样式相撞`,
      )
    }
  }
})

test('B 类：样式用 px 而非 rem', () => {
  for (const group of listDirs('UI/shroomui')) {
    if (!listFiles(`UI/shroomui/${group}`).includes('index.scss')) continue
    if (EXEMPT.remUnits.includes(group)) continue

    const scss = read(`UI/shroomui/${group}/index.scss`)
    assert.doesNotMatch(
      scss,
      /[\d.]+rem\b/,
      `UI/shroomui/${group}/index.scss 用了 rem，外观会取决于宿主根字号`,
    )
  }
})

test('B 类：不引用 SDK 内未定义的全局 CSS 类', () => {
  // 收集 shroomui 全部 SCSS 定义过的类名。
  //
  // SCSS 大量使用 `&__message` / `&--active` 嵌套，这些类名**不会**以完整形式
  // 出现在文件里，所以除了字面类名，还要单独收集 BEM 后缀，再按「已定义的块名
  // + 后缀」判定。不展开的话 `.ui-async-state__message` 会被误报成宿主全局类。
  const defined = new Set()
  const bemSuffixes = new Set()
  for (const group of listDirs('UI/shroomui')) {
    if (!listFiles(`UI/shroomui/${group}`).includes('index.scss')) continue
    const scss = read(`UI/shroomui/${group}/index.scss`)
    for (const match of scss.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(match[1])
    for (const match of scss.matchAll(/&((?:__|--)[\w-]+)/g)) bemSuffixes.add(match[1])
  }

  const isDefined = (cls) => {
    if (defined.has(cls)) return true
    // BEM 展开：块名已定义，且后缀在同一批 SCSS 里出现过。
    for (const suffix of bemSuffixes) {
      if (cls.endsWith(suffix) && defined.has(cls.slice(0, -suffix.length))) return true
    }
    return false
  }

  for (const component of shroomui) {
    // 按 group 而非文件名豁免：SCSS 是按 group 组织的（`Playback/` 一个目录下
    // 放 PlaybackPlayToggle 与 PlaybackSpeedMenu 两个组件）。
    if (EXEMPT.hostGlobalClasses.includes(component.group)) continue

    const source = read(component.path)
    // 只查 className 里的静态字面量，模板里的插值段跳过。
    for (const match of source.matchAll(/className=(?:'([^'{]*)'|"([^"{]*)")/g)) {
      const classes = (match[1] || match[2] || '').split(/\s+/).filter(Boolean)
      for (const cls of classes) {
        assert.ok(
          isDefined(cls) || cls.startsWith('ant-'),
          `${component.path} 用了 .${cls}，但 shroomui 的 SCSS 里没有定义它（宿主全局类）`,
        )
      }
    }
  }
})

test('B 类：缩进 4 空格', () => {
  for (const component of shroomui) {
    if (EXEMPT.indent.includes(component.file)) continue

    const source = read(component.path)
    const firstIndented = source.split('\n').find((line) => /^ +\S/.test(line))
    assert.ok(firstIndented, `${component.path} 没有缩进行`)
    assert.match(
      firstIndented,
      /^ {4}\S/,
      `${component.path} 首个缩进不是 4 空格（B 类约定 4，C 类约定 2）`,
    )
  }
})

/* ─── 形态 C：业务展示组件 ──────────────────────────────────────────── */

test('C 类：每个组件配一份同名 styles.jsx', () => {
  for (const component of qxui) {
    const files = listFiles(`UI/qxui/${component.group}`)
    assert.ok(
      files.includes(`${component.name}.styles.jsx`),
      `${component.path} 缺同名 ${component.name}.styles.jsx`,
    )
  }
})

test('C 类：styled-components 用 px，不用 rem', () => {
  for (const group of listDirs('UI/qxui')) {
    for (const file of listFiles(`UI/qxui/${group}`)) {
      if (!file.endsWith('.styles.jsx')) continue
      assert.doesNotMatch(
        read(`UI/qxui/${group}/${file}`),
        /[\d.]+rem\b/,
        `UI/qxui/${group}/${file} 用了 rem`,
      )
    }
  }
})

test('C 类：可以 observer，但不许自己读 Store', () => {
  for (const component of qxui) {
    const source = read(component.path)
    assert.doesNotMatch(
      source,
      /\b(useStore|getStore|rootStore|deviceStore)\b/,
      `${component.path} 自己读了 Store；业务状态应由 props 传入`,
    )
  }
})

test('C 类：缩进 2 空格', () => {
  for (const component of qxui) {
    const source = read(component.path)
    const firstIndented = source.split('\n').find((line) => /^ +\S/.test(line))
    assert.ok(firstIndented, `${component.path} 没有缩进行`)
    assert.match(firstIndented, /^ {2}\S/, `${component.path} 首个缩进不是 2 空格`)
  }
})

/* ─── 发布边界与文档 ────────────────────────────────────────────────── */

test('全部形态：新增运行文件落在 files 白名单内', () => {
  const pkg = JSON.parse(read('package.json'))
  const published = pkg.files.filter((entry) => !entry.startsWith('!'))

  for (const base of ['UI/shroomui', 'UI/qxui', 'UI/frontend/core', 'UI/frontend/renderers']) {
    assert.ok(
      published.some((entry) => base === entry || base.startsWith(`${entry}/`)),
      `${base} 不在发布白名单内`,
    )
  }
})

test('全部形态：每个公开组件都有独立文档页', () => {
  const barrels = {
    'UI/shroomui/index.js': 'docs/components/shroomui',
    'UI/qxui/DynamicReport/index.js': 'docs/components/qxui',
  }

  for (const [barrel, docDir] of Object.entries(barrels)) {
    const source = read(barrel)
    // 只取组件导出：`default as X`，以及 `export { A, B }` 里不带 `as` 的项。
    // 不能一把抓 `X as Y` —— `SPEEDS as PLAYBACK_SPEEDS` 是常量而非组件，
    // 抓进来会去找一个不存在的 `speeds as playback_speeds.md`。
    const exported = [
      ...[...source.matchAll(/\bdefault as (\w+)/g)].map((match) => match[1]),
      ...[...source.matchAll(/export \{([^}]+)\}/g)]
        .flatMap((match) => match[1].split(','))
        .map((name) => name.trim())
        .filter((name) => name && !name.includes(' as ')),
    ].filter((name) => /^[A-Z]/.test(name))

    const pages = listFiles(docDir).map((file) => file.replace('.md', ''))

    for (const name of new Set(exported)) {
      const slug = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
      assert.ok(pages.includes(slug), `${name} 没有文档页（应为 ${docDir}/${slug}.md）`)
    }
  }
})

test('豁免清单里的每一项都还真实存在', () => {
  // 偏差清掉之后豁免项必须一起删。留着过期豁免 = 下次再引入同样问题抓不到。
  const groups = listDirs('UI/shroomui')
  for (const key of ['cssNamespace', 'remUnits', 'hostGlobalClasses']) {
    for (const entry of EXEMPT[key]) {
      assert.ok(groups.includes(entry), `豁免项 ${key}/${entry} 对应的目录已不存在，请删除该豁免`)
    }
  }
  for (const file of EXEMPT.indent) {
    assert.ok(
      shroomui.some((component) => component.file === file),
      `豁免项 indent/${file} 已不存在，请删除该豁免`,
    )
  }
  for (const path of EXEMPT.coreDom) {
    assert.doesNotThrow(
      () => statSync(new URL(`UI/frontend/renderers/${path}`, root)),
      `豁免项 coreDom/${path} 已不存在，请删除该豁免`,
    )
  }
})
