/**
 * 在检查通过后冻结 SDK 版本制品。普通 pack:sdk 只更新兼容下载，本脚本才创建版本目录。
 * prepare [--require-clean]；verify [--directory <path>] [--require-clean] [--expected-commit <sha>]。
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createSdkArchives, crc32, SDK_ARCHIVES } from './pack-sdk.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const runFile = promisify(execFile);
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const HASH = /^[a-f0-9]{64}$/;
const SCHEMA = 'shroom.sdk.release.v1';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

/** 所有发布路径由稳定 SemVer 生成，不能通过版本号访问任意目录。 */
function validVersion(version) {
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('SDK 版本必须是稳定 SemVer，例如 0.1.0。');
  return version;
}

async function sdkVersion(projectRoot) {
  return validVersion(JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')).version);
}

/** 来源使用真实 Git 状态，不用当前时间或随机标识伪造发布证据。 */
async function gitSource(projectRoot) {
  const { stdout: commit } = await runFile('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { windowsHide: true });
  const { stdout: status } = await runFile('git', ['-C', projectRoot, 'status', '--porcelain', '--untracked-files=normal'], { windowsHide: true });
  if (!COMMIT.test(commit.trim())) throw new Error('无法确定发布源码的 Git 提交。');
  return { commit: commit.trim(), dirty: status.trim().length > 0 };
}

/** 只取指定版本章节；缺少更新说明不能生成一个看似正式的发布目录。 */
export function releaseNotes(changelog, version) {
  validVersion(version);
  const normalized = changelog.replace(/\r\n/g, '\n');
  const sections = [...normalized.matchAll(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})[ \t]*$/gm)];
  const selected = sections.filter((section) => section[1] === version);
  if (selected.length !== 1) throw new Error('CHANGELOG 必须包含且只能包含一个 [' + version + '] 版本章节。');
  const section = selected[0];
  const date = section[2];
  const parsedDate = new Date(date + 'T00:00:00.000Z');
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('CHANGELOG 发布日期无效。');
  const afterHeading = normalized.slice(section.index + section[0].length);
  const nextHeading = afterHeading.search(/^## /m);
  const body = (nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading)).trim();
  if (!body || /\bTODO\b|待补充|待填写/i.test(body)) throw new Error('请先填写 ' + version + ' 的实际更新内容。');
  return { date, bytes: Buffer.from('# Shroom SDK ' + version + '\n\n发布日期：' + date + '\n\n' + body + '\n') };
}

/** 检查本工具生成的 ZIP，包括每个文件的大小和 CRC，避免只核对外层文件名。 */
export function readZipEntries(zip) {
  if (zip.length < 22) throw new Error('SDK ZIP 不完整。');
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt16LE(end + 20) !== 0) throw new Error('SDK ZIP 结束目录无效。');
  const count = zip.readUInt16LE(end + 10);
  const centralSize = zip.readUInt32LE(end + 12);
  const centralOffset = zip.readUInt32LE(end + 16);
  if (centralOffset + centralSize !== end) throw new Error('SDK ZIP 目录边界无效。');
  const entries = new Map();
  let offset = 0;
  while (offset < centralOffset) {
    if (offset + 30 > centralOffset || zip.readUInt32LE(offset) !== 0x04034b50) throw new Error('SDK ZIP 文件头无效。');
    const method = zip.readUInt16LE(offset + 8);
    const expectedCrc = zip.readUInt32LE(offset + 14);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const size = zip.readUInt32LE(offset + 22);
    const nameSize = zip.readUInt16LE(offset + 26);
    const extraSize = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + nameSize + extraSize;
    if (start + compressedSize > centralOffset) throw new Error('SDK ZIP 文件边界无效。');
    const name = zip.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').some((part) => !part || part === '..' || part === '.')
      || entries.has(name)) throw new Error('SDK ZIP 含非法或重复文件名。');
    const compressed = zip.subarray(start, start + compressedSize);
    const bytes = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!bytes || bytes.length !== size || crc32(bytes) !== expectedCrc) throw new Error('SDK ZIP 文件校验失败：' + name);
    entries.set(name, { bytes, offset, crc: expectedCrc, size, compressedSize, method });
    offset = start + compressedSize;
  }
  if (entries.size !== count || !count) throw new Error('SDK ZIP 文件数量无效。');
  let central = centralOffset;
  for (const [name, entry] of entries) {
    if (central + 46 > end || zip.readUInt32LE(central) !== 0x02014b50) throw new Error('SDK ZIP 中央目录无效。');
    const nameSize = zip.readUInt16LE(central + 28);
    const extraSize = zip.readUInt16LE(central + 30);
    const commentSize = zip.readUInt16LE(central + 32);
    const next = central + 46 + nameSize + extraSize + commentSize;
    if (next > end || zip.subarray(central + 46, central + 46 + nameSize).toString('utf8') !== name
      || zip.readUInt32LE(central + 42) !== entry.offset || zip.readUInt32LE(central + 16) !== entry.crc
      || zip.readUInt32LE(central + 20) !== entry.compressedSize || zip.readUInt32LE(central + 24) !== entry.size
      || zip.readUInt16LE(central + 10) !== entry.method) throw new Error('SDK ZIP 中央目录与文件不一致。');
    central = next;
  }
  if (central !== end) throw new Error('SDK ZIP 中央目录长度无效。');
  return new Map([...entries].map(([name, entry]) => [name, entry.bytes]));
}

/** 校验交付内容与语言边界；开发目录、数据库和机器环境不能混入源码包。 */
export function verifySdkArchive(bytes, kind, version) {
  const definition = SDK_ARCHIVES.find((entry) => entry.kind === kind);
  if (!definition) throw new Error('未知 SDK 包类型。');
  const entries = readZipEntries(bytes);
  for (const name of entries.keys()) {
    if (!name.startsWith(definition.prefix)) throw new Error('SDK ZIP 顶层目录不匹配。');
    const path = name.slice(definition.prefix.length);
    if (path.split('/').some((part) => part.startsWith('.') || ['node_modules', 'tests', 'build', 'dist', 'coverage', '__pycache__', 'recordings', 'scripts'].includes(part) || part.endsWith('.egg-info'))
      || /\.(?:sqlite3?|db3?)(?:-(?:wal|shm|journal))?$/i.test(path) || /\.(?:pyc|pyo|whl|jsonl|csv|meta\.json|meta\.tmp)$/.test(path)
      || path === 'examples/generate-product-examples.mjs') throw new Error('SDK ZIP 含非交付文件：' + name);
    if (kind === 'node' && path.startsWith('python/') && path !== 'python/README.md') throw new Error('Node ZIP 含 Python 源码。');
    if (kind === 'python' && !path.startsWith('python/') && path !== 'CHANGELOG.md') throw new Error('Python ZIP 含其他语言文件。');
  }
  const required = kind === 'python'
    ? ['python/pyproject.toml', 'python/src/shroom_sdk/__init__.py']
    : ['package.json', 'package-lock.json', 'quick-flow.js', 'node/index.js', 'web/index.js'];
  if (kind === 'combined') required.push('python/pyproject.toml', 'python/src/shroom_sdk/__init__.py');
  for (const path of required) if (!entries.has(definition.prefix + path)) throw new Error('SDK ZIP 缺少必需文件：' + path);
  if (kind !== 'python') {
    const metadata = JSON.parse(entries.get(definition.prefix + 'package.json').toString('utf8'));
    const lock = JSON.parse(entries.get(definition.prefix + 'package-lock.json').toString('utf8'));
    if (metadata.version !== version || lock.version !== version || lock.packages?.['']?.version !== version) throw new Error('SDK ZIP 包版本与发布版本不一致。');
    if (metadata.name !== lock.name) throw new Error('SDK ZIP 包名与依赖锁不一致。');
    for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      if (!isDeepStrictEqual(metadata[key] ?? {}, lock.packages[''][key] ?? {})) throw new Error('SDK ZIP 依赖与锁文件不一致：' + key);
    }
    function checkExport(value) {
      if (typeof value === 'string' && value.startsWith('./') && !entries.has(definition.prefix + value.slice(2))) throw new Error('SDK ZIP 缺少声明入口：' + value);
      if (value && typeof value === 'object') for (const entry of Object.values(value)) checkExport(entry);
    }
    checkExport(metadata.exports);
    if (metadata.types && !entries.has(definition.prefix + metadata.types.replace(/^\.\//, ''))) throw new Error('SDK ZIP 缺少类型入口。');
    if (Object.keys(metadata.scripts ?? {}).some((name) => /^(?:test|generate|build|lint|sdk|pack)(?::|$)/.test(name))) throw new Error('SDK ZIP 残留开发脚本。');
  }
  if (kind !== 'node') {
    const pyproject = entries.get(definition.prefix + 'python/pyproject.toml').toString('utf8');
    if (!pyproject.includes('version = "' + version + '"')) throw new Error('Python ZIP 版本与发布版本不一致。');
  }
  return entries;
}

/** 检查 dist 中的当前客户下载包；不创建或修改任何正式版本目录。 */
export async function verifyLatestPackages({ projectRoot = ROOT } = {}) {
  const version = await sdkVersion(projectRoot);
  const archives = await createSdkArchives({ sdkRoot: join(projectRoot) });
  for (const archive of archives) {
    const built = await regularFile(join(projectRoot, 'dist', archive.file));
    if (!built.equals(archive.bytes)) throw new Error('兼容包与当前源码不一致，请先运行 npm run pack:sdk：' + archive.file);
    verifySdkArchive(built, archive.kind, version);
  }
  return { version, archives };
}

/** 只读取普通文件，不跟随版本目录内的外部文件链接。 */
async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('发布制品必须是普通文件：' + basename(path));
  return readFile(path);
}

/** 可独立验证已下载的 Release 目录，不依赖源码包已安装第三方库。 */
export async function verifyRelease({ directory, expectedVersion, expectedCommit, requireClean = false, projectRoot = ROOT } = {}) {
  if (requireClean && !expectedVersion) expectedVersion = await sdkVersion(projectRoot);
  const target = resolve(directory ?? join(projectRoot, 'dist', 'releases', await sdkVersion(projectRoot)));
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('发布目录必须是实际目录。');
  const manifestBytes = await regularFile(join(target, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const version = validVersion(manifest.version);
  if (manifest.schema !== SCHEMA || manifest.tag !== 'sdk-v' + version || (expectedVersion && version !== expectedVersion)
    || !COMMIT.test(manifest.source?.commit) || typeof manifest.source?.dirty !== 'boolean') throw new Error('发布清单或源码来源无效。');
  if (requireClean && manifest.source.dirty) throw new Error('正式发布不能使用包含未提交修改的制品。');
  if (requireClean && !expectedCommit) expectedCommit = (await gitSource(projectRoot)).commit;
  if (expectedCommit && manifest.source.commit !== expectedCommit) throw new Error('发布制品来源与目标 Git 提交不一致。');
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== SDK_ARCHIVES.length) throw new Error('发布清单必须包含三种 SDK 包。');
  const expectedFiles = new Map([['manifest.json', manifestBytes]]);
  for (const definition of SDK_ARCHIVES) {
    const matches = manifest.artifacts.filter((entry) => entry.kind === definition.kind);
    const expectedName = definition.file.replace(/\.zip$/, '-' + version + '.zip');
    if (matches.length !== 1 || matches[0].file !== expectedName || !HASH.test(matches[0].sha256)) throw new Error('发布清单包定义无效。');
    const item = matches[0];
    const bytes = await regularFile(join(target, expectedName));
    if (bytes.length !== item.size || hash(bytes) !== item.sha256) throw new Error('发布包 SHA-256 或大小不匹配：' + expectedName);
    verifySdkArchive(bytes, definition.kind, version);
    expectedFiles.set(expectedName, bytes);
  }
  if (manifest.notes?.file !== 'RELEASE-NOTES.md' || !HASH.test(manifest.notes.sha256)) throw new Error('发布说明定义无效。');
  const notes = await regularFile(join(target, 'RELEASE-NOTES.md'));
  if (hash(notes) !== manifest.notes.sha256 || !notes.toString('utf8').startsWith('# Shroom SDK ' + version + '\n')) throw new Error('发布说明校验失败。');
  expectedFiles.set('RELEASE-NOTES.md', notes);
  const expectedSums = [...expectedFiles].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => hash(bytes) + '  ' + name).join('\n') + '\n';
  if ((await regularFile(join(target, 'SHA256SUMS'))).toString('utf8') !== expectedSums) throw new Error('SHA256SUMS 与实际制品不一致。');
  const names = (await readdir(target)).sort();
  if (JSON.stringify(names) !== JSON.stringify([...expectedFiles.keys(), 'SHA256SUMS'].sort())) throw new Error('发布目录包含未登记文件。');
  return { directory: target, manifest };
}

/** 完整验证后一次性冻结目录；同版本同字节可重试，任何变化都要求发布新版本。 */
export async function prepareRelease({ projectRoot = ROOT, outputRoot, requireClean = false } = {}) {
  const version = await sdkVersion(projectRoot);
  const source = await gitSource(projectRoot);
  if (requireClean && source.dirty) throw new Error('正式发布要求干净的 Git 工作区，请先提交源码和构建产物。');
  const notes = releaseNotes(await readFile(join(projectRoot, 'CHANGELOG.md'), 'utf8'), version);
  const { archives } = await verifyLatestPackages({ projectRoot });
  const files = new Map();
  const artifacts = [];
  for (const archive of archives) {
    const built = archive.bytes;
    const file = archive.file.replace(/\.zip$/, '-' + version + '.zip');
    files.set(file, built);
    artifacts.push({ kind: archive.kind, file, size: built.length, sha256: hash(built) });
  }
  const after = await gitSource(projectRoot);
  if (after.commit !== source.commit || after.dirty !== source.dirty) throw new Error('准备发布期间 Git 状态改变，请重试。');
  const manifest = { schema: SCHEMA, version, tag: 'sdk-v' + version, releaseDate: notes.date, source, artifacts,
    notes: { file: 'RELEASE-NOTES.md', sha256: hash(notes.bytes) } };
  files.set('RELEASE-NOTES.md', notes.bytes);
  files.set('manifest.json', jsonBytes(manifest));
  files.set('SHA256SUMS', Buffer.from([...files].sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([name, bytes]) => hash(bytes) + '  ' + name).join('\n') + '\n'));
  const base = resolve(outputRoot ?? join(projectRoot, 'dist', 'releases'));
  const destination = join(base, version);
  async function identicalExisting() {
    try {
      await verifyRelease({ directory: destination, expectedVersion: version });
      for (const [name, bytes] of files) if (!(await regularFile(join(destination, name))).equals(bytes)) {
        throw new Error('同版本已存在不同制品，禁止覆盖；请升级 SDK 版本。');
      }
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        try { await lstat(destination); } catch (missing) { if (missing.code === 'ENOENT') return false; throw missing; }
      }
      throw new Error('已有版本目录不可覆盖：' + version + '。' + error.message, { cause: error });
    }
  }
  if (await identicalExisting()) return { directory: destination, manifest, reused: true };
  await mkdir(base, { recursive: true });
  const temporary = await mkdtemp(join(base, '.prepare-' + version + '-'));
  try {
    for (const [name, bytes] of files) await writeFile(join(temporary, name), bytes, { flag: 'wx' });
    await verifyRelease({ directory: temporary, expectedVersion: version });
    try { await rename(temporary, destination); }
    catch (error) { if (!(await identicalExisting())) throw error; }
  } finally {
    const absolute = resolve(temporary);
    if (absolute.startsWith(base + sep) && basename(absolute).startsWith('.prepare-' + version + '-')) {
      await rm(absolute, { recursive: true, force: true });
    }
  }
  return { directory: destination, manifest, reused: false };
}

async function main(args) {
  const [command, ...options] = args;
  const config = {};
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === '--require-clean') config.requireClean = true;
    else if (['--directory', '--expected-commit'].includes(option) && options[index + 1] && !options[index + 1].startsWith('--')) {
      config[option === '--directory' ? 'directory' : 'expectedCommit'] = options[++index];
    } else throw new Error('未知或缺少参数的发布选项：' + option);
  }
  if (command === 'prepare' && !config.directory && !config.expectedCommit) {
    const result = await prepareRelease(config);
    console.log((result.reused ? '已验证已有版本：' : '已生成版本制品：') + result.directory);
    if (result.manifest.source.dirty) console.log('本地候选包含未提交修改；manifest 已标记 dirty，不能作为正式 Release。');
  } else if (command === 'verify') {
    const result = await verifyRelease(config);
    console.log('版本制品校验通过：' + result.manifest.version + ' (' + result.manifest.source.commit + ')');
  } else if (command === 'verify-latest' && !options.length) {
    const result = await verifyLatestPackages();
    console.log('三种兼容下载包校验通过：' + result.version);
  } else throw new Error('用法：sdk-release-artifacts.mjs prepare [--require-clean]、verify [--directory 路径] [--require-clean] [--expected-commit SHA] 或 verify-latest');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
