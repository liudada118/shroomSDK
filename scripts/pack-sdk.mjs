/**
 * 打包 Python / Node.js 独立 ZIP，并保留 shroom-sdk.zip 兼容旧链接。
 *
 *   npm run pack:sdk
 *
 * 自己实现 zip 是为了不引依赖、也不依赖系统上有没有 zip / PowerShell，
 * CI 上跑和本地跑结果一致。时间戳写死，所以内容不变时产物字节相同，
 * 不会每次打包都在 git 里产生 diff。
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { extname, join, relative, sep, resolve, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// index.template.html 是给构建脚本用的源文件，用户拿到的是渲染好的 index.html
const SKIP = new Set([
  'node_modules', '.git', '.DS_Store', 'index.template.html',
  '__pycache__', '.venv', 'venv', 'build', 'dist', '.pytest_cache', '.ruff_cache',
  '.shroom-recordings', 'recordings', 'tests', 'coverage',
  'generate-product-examples.mjs', 'requirements-test.lock',
]);
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.json', '.md', '.html', '.css', '.py', '.toml', '.txt', '.sh', '.bat', '.in', '.typed', '.yml', '.yaml']);
const DELIVERY_DIRECTORIES = new Set(['src', 'docs', 'examples', 'python', 'scripts']);
const DELIVERY_FILES = new Set(['package.json', 'package-lock.json',
  'README.md', 'CHANGELOG.md', 'MIGRATION.md',
  'LICENSE', 'LICENSE.md', 'LICENSE.txt']);
const LEGACY_ROOT_DOCS = new Set(['AI-CONTEXT.md', '怎么用AI开发.md', 'BACKEND.md']);
const LAUNCHERS = new Set(['start.mjs', 'start.sh', 'start-demo.bat']);

/** 仓库按职责归档；兼容 ZIP 在交付时映射旧路径，不在源码中保留重复实现。 */
export function sdkDeliveryPath(source) {
  if (/^src\/(?:backend|core|flow|node|web)\//.test(source)
    || /^src\/(?:index\.d\.ts|quick-flow\.(?:js|d\.ts))$/.test(source)) return source.slice(4);
  if (source.startsWith('scripts/')) return LAUNCHERS.has(source.slice(8)) ? source.slice(8) : null;
  if (source === 'docs/SDK-RELEASING.md') return null;
  if (source.startsWith('docs/') && LEGACY_ROOT_DOCS.has(source.slice(5))) return source.slice(5);
  if (/^examples\/(?:node|web)\//.test(source)) return source.slice('examples/'.length);
  if (/^examples\/products\/(?:hand-pad|glove-left|glove-right)-example\.(?:html|mjs)$/.test(source)) return posix.basename(source);
  if (source.startsWith('examples/products/')) return null;
  if (/^(?:docs|examples|python)\//.test(source) || DELIVERY_FILES.has(source)) return source;
  return null;
}

export const SDK_ARCHIVES = Object.freeze([
  { kind: 'combined', file: 'shroom-sdk.zip', prefix: 'shroom-sdk/' },
  { kind: 'node', file: 'shroom-sdk-node.zip', prefix: 'shroom-sdk-node/' },
  { kind: 'python', file: 'shroom-sdk-python.zip', prefix: 'shroom-sdk-python/' },
]);

// 固定为 2026-01-01 00:00:00 的 DOS 时间，保证产物可复现
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

// zip 要记录 Unix 权限位，「version made by」的高字节必须声明成 Unix(3)，
// 否则解压工具不会去读 external attributes 里的 mode，start.sh 就丢了可执行位 ——
// macOS / Linux 用户解压后 ./start.sh 直接 Permission denied。
const MADE_BY_UNIX = (3 << 8) | 20;
const MODE_EXEC = 0o100755;
const MODE_FILE = 0o100644;
const isExecutable = (name) => name.endsWith('.sh');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

async function walk(dir, out = [], topLevel = true) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // 根目录只交付明确的 SDK 内容，自定义数据目录和随手保存的文件不会被自动发布。
    if (topLevel && !(entry.isDirectory() ? DELIVERY_DIRECTORIES.has(entry.name)
      : DELIVERY_FILES.has(entry.name))) continue;
    if (SKIP.has(entry.name) || entry.name.startsWith('.') || /\.(?:pyc|pyo|egg-info|whl)$/.test(entry.name)) continue;
    // 自定义录制目录中的 SQLite 数据与日志也不能进入客户源码包。
    if (/\.(?:sqlite3?|db3?)(?:-(?:wal|shm|journal))?$/i.test(entry.name)
      || /\.(?:jsonl|csv|meta\.json|meta\.tmp)$/i.test(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`SDK 打包不接受符号链接：${full}`);
    if (entry.isDirectory()) await walk(full, out, false);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** 文件挪动后重算真实模块和文档链接；模板中不存在的虚拟相对路径保持原样。 */
function rewriteLinks(text, source, destination, paths) {
  const mapped = (reference) => {
    if (/^(?:[a-z]+:|\/|#)/i.test(reference)) return reference;
    const [, path, suffix = ''] = /^([^?#]*)(.*)$/.exec(reference);
    const original = posix.normalize(posix.join(posix.dirname(source), path));
    if (original === 'docs/SDK-RELEASING.md') return 'https://github.com/liudada118/shroomSDK/blob/main/docs/SDK-RELEASING.md' + suffix;
    const target = paths.get(original);
    if (!target) return reference;
    const next = posix.relative(posix.dirname(destination), target);
    return (next.startsWith('.') ? next : './' + next) + suffix;
  };
  return text.replace(/(['"])(\.{1,2}\/[^'"\r\n]+)\1/g, (_match, quote, path) => quote + mapped(path) + quote)
    .replace(/(\]\()([^\s)]+)(\))/g, (_match, before, path, after) => before + mapped(path) + after);
}

/** 文本统一 LF，避免 Windows 与 Linux 从相同 Git 内容生成不同 ZIP。 */
async function archiveContent(file, sdkRoot, paths) {
  const raw = await readFile(file);
  const source = relative(sdkRoot, file).split(sep).join('/');
  if (source === 'docs/catalog.json') {
    const catalog = JSON.parse(raw.toString('utf8'));
    return Buffer.from(JSON.stringify(catalog.map(entry => ({ ...entry, file: paths.get(entry.file) ?? entry.file })), null, 2) + '\n');
  }
  if (source === 'package.json') {
    const metadata = JSON.parse(raw.toString('utf8'));
    // 客户包不附带开发测试与生成器，因此不能留下指向缺失文件的 npm 脚本。
    metadata.scripts = Object.fromEntries(Object.entries(metadata.scripts ?? {})
      .filter(([name]) => !/^(?:test|generate|build|lint|sdk|pack)(?::|$)/.test(name)
        && !['prepack', 'postpack', 'prepare', 'prepublishOnly'].includes(name))
      .map(([name, command]) => [name, command.replace(/\bscripts\/(start\.(?:mjs|sh)|start-demo\.bat)\b/g, '$1')
        .replace(/\bexamples\/node\//g, 'node/')]));
    const remap = (value) => typeof value === 'string' ? value.replace(/^\.\/src\//, './')
      : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remap(entry)]));
    if (metadata.exports) metadata.exports = remap(metadata.exports);
    if (metadata.types) metadata.types = metadata.types.replace(/^(?:\.\/)?src\//, '');
    return Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  }
  if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) return raw;
  let text = rewriteLinks(raw.toString('utf8').replace(/\r\n/g, '\n'), source, paths.get(source), paths);
  if (source.startsWith('examples/products/')) text = text
    .replaceAll('在仓库根目录 npm install', '在 SDK 根目录 npm install')
    .replaceAll('文件放在仓库 examples/products/ 时使用此路径', '文件放在 SDK 根目录时使用此路径')
    .replaceAll('本文件位于 examples/products/；先在仓库根目录执行 npm install。', '把本文件放在 SDK 根目录，与 node/ 同级，先 npm install。')
    .replaceAll('位于仓库 <code>examples/products/</code>；先在仓库根目录安装依赖。', '放在解压后的 SDK 根目录，与 <code>web/</code> 同级。')
    .replaceAll('examples/products/', '').replaceAll('scripts/start.mjs', 'start.mjs');
  if (source.startsWith('examples/node/')) text = text.replaceAll('examples/node/', 'node/')
    .replaceAll('scripts/start.mjs', 'start.mjs').replaceAll('examples/web/', 'web/');
  if (source === 'scripts/start.mjs') text = text.replace("new URL('..', import.meta.url)", "new URL('.', import.meta.url)")
    .replaceAll("join(ROOT, 'examples', 'web',", "join(ROOT, 'web',")
    .replaceAll('examples/web', 'web').replaceAll('scripts/start.mjs', 'start.mjs')
    .replaceAll('请在仓库根目录运行 npm run build，生成示例后再执行 npm start。', '请完整解压 SDK 安装包，再在解压目录执行 npm start。');
  if (source === 'scripts/start.sh') text = text.replaceAll('sh scripts/start.sh', 'sh start.sh');
  return Buffer.from(text);
}

/** 生成确定性的 ZIP 字节；普通打包不写版本目录，不修改已发布历史。 */
async function pack(files, prefix, sdkRoot, paths) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = prefix + paths.get(relative(sdkRoot, file).split(sep).join('/'));
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = await archiveContent(file, sdkRoot, paths);
    const deflated = deflateRawSync(raw, { level: 9 });
    // 压完反而更大的（比如小图片）就原样存
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x800, 6); // 文件名按 UTF-8 解释
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(MADE_BY_UNIX, 4); // version made by：Unix + 2.0
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // external attributes 高 16 位放 Unix mode，.sh 给 755，其余 644
    central.writeUInt32LE((isExecutable(name) ? MODE_EXEC : MODE_FILE) * 0x10000, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** 返回三种客户包，供兼容下载和正式版本制品复用同一套打包规则。 */
export async function createSdkArchives({ sdkRoot = ROOT } = {}) {
  await stat(sdkRoot);
  const pathFor = (file) => relative(sdkRoot, file).split(sep).join('/');
  const files = (await walk(sdkRoot)).filter(file => sdkDeliveryPath(pathFor(file)) !== null).sort();
  const paths = new Map(files.map(file => [pathFor(file), sdkDeliveryPath(pathFor(file))]));
  if (new Set(paths.values()).size !== paths.size) throw new Error('SDK 交付路径重复，请检查源码目录映射。');
  return Promise.all(SDK_ARCHIVES.map(async (archive) => {
    // Node 保留 Python 说明作为文档交叉引用，但不附带 Python 源码或依赖。
    const selected = archive.kind === 'node'
      ? files.filter((file) => !pathFor(file).startsWith('python/') || pathFor(file) === 'python/README.md')
      : archive.kind === 'python' ? files.filter((file) => pathFor(file).startsWith('python/') || pathFor(file) === 'CHANGELOG.md') : files;
    return { ...archive, count: selected.length, bytes: await pack(selected, archive.prefix, sdkRoot, paths) };
  }));
}

export async function packSdk({ projectRoot = ROOT, log = console.log } = {}) {
  const archives = await createSdkArchives({ sdkRoot: projectRoot });
  const output = join(projectRoot, 'dist');
  await mkdir(output, { recursive: true });
  for (const archive of archives) {
    await writeFile(join(output, archive.file), archive.bytes);
    log(`已打包 ${archive.count} 个文件 → dist/${archive.file} (${(archive.bytes.length / 1024).toFixed(1)} KB)`);
  }
  return archives;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  packSdk().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
