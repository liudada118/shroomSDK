/**
 * 产出两样东西：
 *   1. web/shroom.bundle.js  —— core/ + web/ 拼成的「经典脚本」，挂 window.Shroom
 *   2. web/index.html        —— 由 index.template.html 把上面那段**内联**进去
 *
 *   npm run build:sdk-bundle
 *
 * 为什么要这么绕：
 *   - 浏览器不允许 file:// 页面加载 ES 模块（<script type="module"> 被 CORS 拦掉），
 *     但普通脚本是放行的。所以示例页面不能用 import，得有个 bundle。
 *   - 而且不能用 <script src="./shroom.bundle.js">：在 zip 里直接双击 html 时，
 *     Windows 资源管理器只把那一个文件解到临时目录，同目录的兄弟文件一个都没有。
 *     内联进去就彻底没有「依赖同目录文件」这回事了，单个 html 拷到哪都能跑。
 *
 * 注意：串口该连不上还是连不上 —— navigator.serial 在规范里标了 SecureContext，
 * 白名单只有 https 和 localhost，file:// 不在其中。那部分只能靠 start-demo.bat。
 *
 * 这里按本地静态 import 自动发现依赖、排序，再拼接并去掉 import/export。
 * 仅支持单行具名导入和顶层具名声明；循环依赖及拼接语法错误会在写文件前报错。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SDK = ROOT;
const OUT = join(SDK, 'web', 'shroom.bundle.js');
const PAGE_TEMPLATE = join(SDK, 'web', 'index.template.html');
const PAGE_OUT = join(SDK, 'web', 'index.html');
const PLACEHOLDER = '<!--@INLINE_BUNDLE@-->';

// 公共能力入口；内部产品由 registry 的静态 import 自动带入，无需在此重复登记。
const ENTRY_FILES = [
  'core/mock.js',
  'backend/client.js',
  'web/heatmap.js',
  'web/serial.js',
  'web/stream.js',
  'web/product-view.js',
];

// 顶层 import 整行删掉；export 关键字去掉，声明本身留下。
const IMPORT_LINE = /^import\s[^;]*;\s*$/;
const EXPORT_DECL = /^export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/;
// 这两种形态拼接不了，遇到就直接报错，免得悄悄少打包一个符号
const EXPORT_OTHER = /^export\s/;

// 保持简单拼接器的约束：不改名、不支持默认导入，也不静默忽略无法转换的 import。
const STATIC_IMPORT = /^import\s+\{\s*([\w$\s,]+)\s*\}\s+from\s+(['"])([^'"]+)\2;\s*$/;

/** 深度优先收集依赖；只读取 SDK 内的本地模块，在写产物前拒绝循环。 */
async function collectBundleModules(entries) {
  const ordered = [];
  const sources = new Map();
  const visiting = new Set();
  const visited = new Set();

  async function visit(file, trail = []) {
    if (visiting.has(file)) throw new Error(`SDK 模块循环依赖：${[...trail, file].join(' → ')}`);
    if (visited.has(file)) return;
    visiting.add(file);
    const source = await readFile(join(SDK, file), 'utf8');
    sources.set(file, source);
    for (const line of source.split(/\r?\n/)) {
      if (!/^import\s/.test(line)) continue;
      const match = STATIC_IMPORT.exec(line);
      if (!match || /\bas\b/.test(match[1])) throw new Error(`${file} 仅支持单行本地具名导入：${line.trim()}`);
      const specifier = match[3];
      const dependency = posix.normalize(posix.join(posix.dirname(file), specifier));
      if (!/^\.{1,2}\//.test(specifier) || dependency.startsWith('../') || !dependency.endsWith('.js')) {
        throw new Error(`${file} 的静态依赖必须是 SDK 目录内的 .js 模块：${specifier}`);
      }
      await visit(dependency, [...trail, file]);
    }
    visiting.delete(file);
    visited.add(file);
    ordered.push(file);
  }

  for (const file of entries) await visit(file);
  return { ordered, sources };
}

function strip(source, file) {
  return source
    .split(/\r?\n/)
    .map((line) => {
      if (IMPORT_LINE.test(line)) return null;
      if (EXPORT_DECL.test(line)) return line.replace(EXPORT_DECL, '');
      if (EXPORT_OTHER.test(line)) {
        throw new Error(
          `${file} 里有拼接不了的导出写法，请改成顶层具名声明：\n    ${line.trim()}`
        );
      }
      return line;
    })
    .filter((line) => line !== null)
    .join('\n')
    .trim();
}

const pkg = JSON.parse(await readFile(join(SDK, 'package.json'), 'utf8'));
const { ordered: FILES, sources } = await collectBundleModules(ENTRY_FILES);

const parts = [];
for (const file of FILES) {
  const source = sources.get(file);
  parts.push(`// ---------- ${file} ----------\n${strip(source, file)}`);
}

const body = parts.join('\n\n');

// 注意：这段注释里不要出现 script 标签的字面量 —— 它会被原样内联进 index.html
const bundle = `/**
 * Shroom SDK ${pkg.version} —— 单文件版（自动生成，别手改）
 *
 * 由 scripts/build-sdk-bundle.mjs 从 core/ + web/ 拼出来，内容和模块版完全一致。
 * 它是「经典脚本」而不是模块，所以用普通的 script 标签引进去就行，file:// 下也能加载，
 * 加载完全局多一个 Shroom 对象。
 *
 * 正经项目里请直接 import 模块版：import { Shroom } from './web/index.js'
 */
(function (global) {
  'use strict';

${body
  .split('\n')
  .map((line) => (line ? `  ${line}` : ''))
  .join('\n')}

  // ---------- 对外入口 ----------
  var Shroom = {
    activateLicense: activateLicense,
    getLicenseStatus: getLicenseStatus,
    clearLicense: clearLicense,
    SDK_PRODUCT_TYPE: SDK_PRODUCT_TYPE,
    connectProduct: connectProduct,
    connectGlove: connectGlove,
    connectHandPad: connectHandPad,
    listDeviceProducts: listDeviceProducts,
    ShroomError: ShroomError,
    ERROR_CODES: ERROR_CODES,
    asShroomError: asShroomError,
    BackendSdkClient: BackendSdkClient,
    connect: connectSerial,
    mock: createMockDevice,
    createHeatmap: createHeatmap,
    connectStream: connectStream,
    createProductView: createProductView,
    encodeStreamFrame: encodeStreamFrame,
    decodeStreamFrame: decodeStreamFrame,
    STREAM_SCHEMA: STREAM_SCHEMA,
    isSupported: isSerialSupported,
    version: ${JSON.stringify(pkg.version)},
    // 想自己接数据源（WebSocket、蓝牙、录制回放）就用这几个
    createFramer: createFramer,
    decodeFrame: decodeFrame,
    resolveShape: resolveShape,
    getLayout: getLayout,
    listLayouts: listLayouts,
    LAYOUTS: LAYOUTS,
    getProduct: getProduct,
    listProducts: listProducts,
    PRODUCTS: PRODUCTS,
    getColormap: getColormap,
    DEFAULT_DELIMITER: DEFAULT_DELIMITER,
  };

  global.Shroom = Shroom;
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;

// 只编译而不执行：模块共享作用域，重名的 const/class 等必须在产物覆盖前报错。
new Script(bundle, { filename: 'shroom.bundle.js' });
await writeFile(OUT, bundle);
console.log(`  已生成 web/shroom.bundle.js（${FILES.length} 个模块，${bundle.length} 字节）`);

// ---------- 把 bundle 内联进示例页面 ----------
const template = (await readFile(PAGE_TEMPLATE, 'utf8')).replace(/\r\n?/g, '\n');
if (!template.includes(PLACEHOLDER)) {
  throw new Error(`index.template.html 里找不到占位符 ${PLACEHOLDER}`);
}

// 闭合标签出现在内联脚本里会提前结束 script，哪怕是在注释或字符串里也一样
const inlineSafe = bundle.replace(/<\/(script)/gi, '<\\/$1');
if (/<\/script/i.test(inlineSafe)) throw new Error('内联脚本里还有没转义的 script 闭合标签');

const INDENT = '    ';
const page = template.replace(
  PLACEHOLDER,
  [
    '<!--',
    '  下面这段是 SDK 本体，由 scripts/build-sdk-bundle.mjs 内联进来的，别手改。',
    '  内联而不是外链一个 .js，是为了让这个 html 单独拷到任何地方都能跑 ——',
    '  在 zip 里直接双击时，资源管理器只解出这一个文件，同目录的兄弟文件拿不到。',
    "  写自己的项目请用模块版：import { Shroom } from './index.js'",
    '-->',
    '<script>',
    inlineSafe.trim(),
    '</script>',
  ]
    .join('\n')
    .split('\n')
    .map((line, i) => (i === 0 || !line ? line : INDENT + line))
    .join('\n')
);

await writeFile(PAGE_OUT, page);
console.log(`  已生成 web/index.html（自包含，${page.length} 字节）`);
