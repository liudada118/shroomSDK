/**
 * SDK 版本维护：package.json 是唯一版本来源。
 * --check 只检查；--sync 更新生成文件；bump patch|minor|major|X.Y.Z 升版并同步。
 * 网站与浏览器 bundle 直接读取该 package.json；Python 元数据和运行时版本由此生成。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CANONICAL = 'package.json';
const LOCKS = ['package-lock.json', 'npm-shrinkwrap.json'];
const normalized = (text) => text.replace(/\r\n/g, '\n');

/** 只接受稳定的三段版本，避免 npm 与 Python 对预发布版本解释不同。 */
export function parseSdkVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('SDK 版本必须是稳定版本 X.Y.Z，例如 0.2.0；不接受前导 v、预发布或前导零。');
  }
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('SDK 版本号超过安全整数范围。');
  return parts;
}

/** 计算下一版本；显式版本也必须严格递增，不允许覆盖当前或回退版本。 */
export function nextSdkVersion(current, target) {
  const parts = parseSdkVersion(current);
  let next = target;
  const segment = ['major', 'minor', 'patch'].indexOf(target);
  if (segment !== -1) {
    parts[segment] += 1;
    for (let index = segment + 1; index < parts.length; index += 1) parts[index] = 0;
    next = parts.join('.');
  }
  const nextParts = parseSdkVersion(next);
  const currentParts = parseSdkVersion(current);
  const changed = nextParts.findIndex((value, index) => value !== currentParts[index]);
  if (changed === -1 || nextParts[changed] < currentParts[changed]) {
    throw new Error(`新版本 ${next} 必须高于当前版本 ${current}，不能覆盖或回退已命名版本。`);
  }
  return next;
}

/** 缺失的派生文件可由 --sync 创建；其他读取失败不能假装文件不存在。 */
async function readOptional(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** 在 project 小节更新 Python 包版本，保留依赖、入口与其他配置。 */
function pythonMetadata(text, version) {
  const header = /^\[project\][ \t]*\r?$/m.exec(text);
  if (!header) throw new Error('python/pyproject.toml 缺少 [project] 小节。');
  const bodyStart = header.index + header[0].length;
  const nextHeader = /^\[/m.exec(text.slice(bodyStart));
  const end = nextHeader ? bodyStart + nextHeader.index : text.length;
  const section = text.slice(header.index, end);
  const versionLine = /^version[ \t]*=[ \t]*"[^"\r\n]+"[ \t]*(?=\r?$)/gm;
  if ([...section.matchAll(versionLine)].length !== 1) {
    throw new Error('python/pyproject.toml 的 [project] 小节缺少明确的 version。');
  }
  return text.slice(0, header.index) + section.replace(versionLine, `version = "${version}"`) + text.slice(end);
}

/** 读取并预先校验所有要改的元数据；无效输入在写入任何文件前失败。 */
async function planVersion(root, override) {
  const packageText = await readFile(resolve(root, CANONICAL), 'utf8');
  const pkg = JSON.parse(packageText);
  parseSdkVersion(pkg.version);
  const version = override ?? pkg.version;
  parseSdkVersion(version);
  const files = new Map([
    ['core/version.js', `/** 自动生成自 package.json；请使用 npm run sdk:version，不要手动修改。 */\nexport const SDK_VERSION = '${version}';\n`],
    ['python/src/shroom_sdk/_version.py', `"""自动生成自 package.json；请通过 SDK 版本工具更新。"""\n\n__version__ = "${version}"\n`],
  ]);
  const pythonText = await readFile(resolve(root, 'python/pyproject.toml'), 'utf8');
  files.set('python/pyproject.toml', pythonMetadata(pythonText, version));
  for (const path of LOCKS) {
    const text = await readOptional(resolve(root, path));
    if (text === null) continue;
    const lock = JSON.parse(text);
    if (lock.name !== pkg.name || (lock.packages?.['']?.name && lock.packages[''].name !== pkg.name)) {
      throw new Error(`${path} 不属于 ${pkg.name}，不能更改其他项目的锁文件。`);
    }
    lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
    files.set(path, `${JSON.stringify(lock, null, 2)}\n`);
  }
  if (override !== undefined) {
    pkg.version = version;
    files.set(CANONICAL, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return { version, files };
}

/** 对元数据和运行时接线做只读检查，防止升级后入口仍返回旧的硬编码版本。 */
export async function checkSdkVersion(root = VERSION_ROOT) {
  const { version, files } = await planVersion(root);
  const mismatches = [];
  for (const [path, expected] of files) {
    const actual = await readOptional(resolve(root, path));
    if (actual === null || normalized(actual) !== normalized(expected)) mismatches.push(path);
  }
  for (const path of ['node/index.js', 'web/index.js']) {
    const text = await readFile(resolve(root, path), 'utf8');
    if (!/import\s*\{\s*SDK_VERSION\s*\}\s*from\s*['"]\.\.\/core\/version\.js['"]/.test(text)
      || !/\bversion:\s*SDK_VERSION\b/.test(text)) mismatches.push(path);
  }
  const pythonEntry = await readFile(resolve(root, 'python/src/shroom_sdk/__init__.py'), 'utf8');
  if (!/^from \._version import __version__\s*$/m.test(pythonEntry)
    || /^__version__\s*=/m.test(pythonEntry)) mismatches.push('python/src/shroom_sdk/__init__.py');
  if (mismatches.length) {
    throw new Error(`SDK ${version} 版本不同步：\n${mismatches.map((path) => `  ${path}`).join('\n')}\n运行 npm run sdk:version -- --sync；入口应引用生成的版本常量。`);
  }
  return version;
}

/** 只在内容变化时写入，避免每次构建造成无意义改动。 */
async function applyVersion(root, plan) {
  for (const [path, expected] of plan.files) {
    const absolute = resolve(root, path);
    const actual = await readOptional(absolute);
    if (actual !== null && normalized(actual) === normalized(expected)) continue;
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, expected, 'utf8');
  }
  return plan.version;
}

export async function syncSdkVersion(root = VERSION_ROOT) {
  return applyVersion(root, await planVersion(root));
}

export async function bumpSdkVersion(target, root = VERSION_ROOT) {
  const pkg = JSON.parse(await readFile(resolve(root, CANONICAL), 'utf8'));
  return applyVersion(root, await planVersion(root, nextSdkVersion(pkg.version, target)));
}

/** CLI 只处理本仓库的版本文件，不自动提交、打标签或发布外部服务。 */
async function main(args) {
  let version;
  if (args.length === 0 || (args.length === 1 && args[0] === '--check')) version = await checkSdkVersion();
  else if (args.length === 1 && args[0] === '--sync') version = await syncSdkVersion();
  else if (args.length === 2 && args[0] === 'bump') version = await bumpSdkVersion(args[1]);
  else throw new Error('用法：node scripts/sdk-version.mjs [--check | --sync | bump patch|minor|major|X.Y.Z]');
  console.log(`SDK 版本 ${version}：${args[0] === 'bump' ? '已升版并同步' : args[0] === '--sync' ? '已同步' : '检查通过'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
