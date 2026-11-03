import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createSdkArchives, packSdk } from '../pack-sdk.mjs';
import { prepareRelease as prepareActualRelease, readZipEntries, releaseNotes, verifyLatestPackages, verifyRelease } from '../sdk-release-artifacts.mjs';
import { readNpmEntries, verifyNpmArchive } from '../npm-archive.mjs';
import { createProductExample, getProductExampleFilename } from '../../examples/product-examples.js';

const runFile = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const version = '0.1.0';

/** 简单 TAR fixture 验证发布协议；真正 npm pack/安装由 test:npm 覆盖。 */
function tarFixture(files) {
  const parts = [];
  for (const [name, contents] of files) {
    const bytes = Buffer.from(contents);
    const header = Buffer.alloc(512);
    header.write('package/' + name);
    header.write('0000644\0', 100);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

async function fixtureNpm({ projectRoot }) {
  const source = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const metadata = { name: source.name, version: source.version, type: 'module', private: true,
    optionalDependencies: source.optionalDependencies, types: './runtime/index.d.ts',
    exports: { '.': './runtime/web/index.js', './node': './runtime/node/index.js', './quick-flow': './runtime/quick-flow.js' } };
  const files = new Map([['package.json', JSON.stringify(metadata)], ['README.md', '# npm fixture'], ['runtime/index.d.ts', 'export {};']]);
  for (const path of ['quick-flow.js', 'node/index.js', 'web/index.js']) files.set('runtime/' + path, await readFile(join(projectRoot, 'src', path)));
  return { bytes: tarFixture(files) };
}

const prepareRelease = (options) => prepareActualRelease({ ...options, buildNpm: fixtureNpm });

/** 每项测试只在自己的 Git 临时仓库操作，绝不提交或重置项目工作区。 */
async function fixture(t) {
  const base = resolve(tmpdir());
  const root = await mkdtemp(join(base, 'shroom-release-test-'));
  t.after(async () => {
    const target = resolve(root);
    assert.ok(target.startsWith(base + sep), '清理目标必须仍在本测试临时目录内');
    await rm(target, { recursive: true, force: true });
  });
  async function put(path, contents) {
    const full = join(root, path);
    await mkdir(resolve(full, '..'), { recursive: true });
    await writeFile(full, contents);
  }
  const metadata = {
    name: 'shroom-sdk', version, private: true, type: 'module',
    exports: { '.': './src/web/index.js', './node': './src/node/index.js', './quick-flow': './src/quick-flow.js' }, types: './src/index.d.ts',
    optionalDependencies: { ws: '^8.14.2' },
    scripts: { start: 'node scripts/start.mjs', 'demo:quick': 'node examples/node/quick-demo.js',
      prepack: 'node scripts/npm-source-guard.mjs',
      'test:backend': 'node --test tests/a.mjs', 'generate:examples': 'node examples/generate-product-examples.mjs',
      'sdk:release': 'node scripts/sdk-release.mjs', 'pack:sdk': 'node scripts/pack-sdk.mjs' },
  };
  await put('.gitignore', '/dist/\n');
  await put('package.json', JSON.stringify(metadata, null, 2));
  await put('package-lock.json', JSON.stringify({ name: metadata.name, version, lockfileVersion: 3, packages: { '': { name: metadata.name, version, optionalDependencies: metadata.optionalDependencies } } }));
  for (const path of ['src/quick-flow.js', 'src/node/index.js', 'src/web/index.js', 'src/index.d.ts', 'examples/node/quick-demo.js', 'scripts/start.mjs']) {
    await put('' + path, '// SDK fixture\r\nexport {};\r\n');
  }
  await put('CHANGELOG.md', '# SDK 更新日志\n\n## [0.1.0] - 2026-10-29\n\n- 新增五步函数和 SQLite 采集。\n\n## [0.0.1] - 2026-10-01\n\n- 初始测试。\n');
  await put('README.md', '# SDK\r\n\r\n客户说明。\r\n');
  await put('python/README.md', '# Python\n\n[更新日志](../CHANGELOG.md)\n');
  await put('python/pyproject.toml', '[project]\nname = "shroom-sdk"\nversion = "0.1.0"\n');
  await put('python/src/shroom_sdk/__init__.py', '__version__ = "0.1.0"\n');
  // 这些文件故意存在，测试必须确认它们不会交付给客户。
  for (const path of ['tests/private.test.mjs', 'node_modules/native.node', 'python/tests/test_private.py',
    'python/build/lib/stale.py', 'python/src/shroom_sdk.egg-info/PKG-INFO', 'examples/generate-product-examples.mjs',
    'python/requirements-test.lock', 'captures/user.sqlite', 'captures/user.sqlite-wal', 'captures/private.txt',
    'src/node/user.jsonl', 'src/node/user.meta.json', 'src/node/user.db3', '.env.local']) {
    await put('' + path, 'do not distribute\n');
  }
  await packSdk({ projectRoot: root, log: () => {} });
  await put('dist/shroom-sdk-0.1.0.tgz', (await fixtureNpm({ projectRoot: root })).bytes);
  const git = async (...args) => (await runFile('git', ['-C', root, '-c', 'core.hooksPath=' + join(root, '.disabled-hooks'), ...args], { windowsHide: true })).stdout.trim();
  await git('init', '-q', '-b', 'main');
  await git('add', '--all');
  await git('-c', 'user.name=SDK release test', '-c', 'user.email=sdk-test@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'fixture');
  return { root, put, git, output: join(root, 'dist', 'releases'), pack: () => packSdk({ projectRoot: root, log: () => {} }) };
}

test('customer ZIPs are deterministic across line endings and contain only runnable delivery files', async (t) => {
  const context = await fixture(t);
  const before = await createSdkArchives({ sdkRoot: join(context.root) });
  await context.put('README.md', '# SDK\n\n客户说明。\n');
  const after = await createSdkArchives({ sdkRoot: join(context.root) });
  for (let index = 0; index < before.length; index += 1) assert.deepEqual(before[index].bytes, after[index].bytes);
  const entries = readZipEntries(before.find((entry) => entry.kind === 'node').bytes);
  assert.ok(entries.has('shroom-sdk-node/package-lock.json'));
  assert.ok(![...entries.keys()].some((name) => /tests|node_modules|\.sqlite|\.egg-info|generate-product-examples|\.env|\/user\.|captures/.test(name)));
  const metadata = JSON.parse(entries.get('shroom-sdk-node/package.json'));
  assert.deepEqual(Object.keys(metadata.scripts), ['start', 'demo:quick']);
  assert.deepEqual(metadata.optionalDependencies, { ws: '^8.14.2' });
  const python = readZipEntries(before.find((entry) => entry.kind === 'python').bytes);
  assert.ok(python.has('shroom-sdk-python/CHANGELOG.md'));
  assert.ok(python.has('shroom-sdk-python/python/src/shroom_sdk/__init__.py'));
  assert.ok(![...python.keys()].some((name) => /requirements-test|\/tests\/|\/build\//.test(name)));
});

test('release freezes three ZIPs and a verified npm package with Git provenance and checksums', async (t) => {
  const context = await fixture(t);
  const latest = await verifyLatestPackages({ projectRoot: context.root });
  assert.equal(latest.version, version);
  const prepared = await prepareRelease({ projectRoot: context.root, requireClean: true });
  const verified = await verifyRelease({ directory: prepared.directory, projectRoot: context.root, requireClean: true });
  assert.equal(verified.manifest.source.commit, await context.git('rev-parse', 'HEAD'));
  assert.equal(verified.manifest.source.dirty, false);
  assert.equal(verified.manifest.tag, 'sdk-v0.1.0');
  assert.equal(verified.manifest.schema, 'shroom.sdk.release.v2');
  assert.equal(verified.manifest.artifacts.filter(item => item.kind === 'npm').length, 1);
  assert.equal((await readdir(prepared.directory)).length, 7);
  for (const artifact of verified.manifest.artifacts) {
    const bytes = await readFile(join(prepared.directory, artifact.file));
    assert.equal(bytes.length, artifact.size);
    assert.equal(sha256(bytes), artifact.sha256);
  }
  const notes = await readFile(join(prepared.directory, 'RELEASE-NOTES.md'), 'utf8');
  assert.match(notes, /五步函数和 SQLite/);
  assert.doesNotMatch(notes, /0\.0\.1|初始测试/);
  const repeated = await prepareRelease({ projectRoot: context.root, requireClean: true });
  assert.equal(repeated.reused, true);
  const cli = new URL('../sdk-release-artifacts.mjs', import.meta.url);
  const { stdout } = await runFile(process.execPath, [fileURLToPath(cli), 'verify',
    '--directory', prepared.directory, '--require-clean', '--expected-commit', verified.manifest.source.commit], { windowsHide: true });
  assert.match(stdout, /版本制品校验通过/);
});

test('organized repository delivers compatible product examples, module imports and documentation links', async (t) => {
  const context = await fixture(t);
  await context.put('examples/node/license-env.js', "import { Shroom } from '../../src/node/index.js';\nexport { Shroom };\n");
  await context.put('docs/NPM.md', '# install\n');
  await context.put('docs/AI-CONTEXT.md', '[安装](./NPM.md#install)\n[五步](../src/quick-flow.js)\n');
  await context.put('docs/catalog.json', JSON.stringify([{ file: 'docs/AI-CONTEXT.md' }, { file: 'docs/NPM.md' }]));
  await context.put('docs/SDK-RELEASING.md', 'maintenance-only-marker');
  await context.put('README.md', '[维护](docs/SDK-RELEASING.md)\n');
  await context.put('examples/node/quick-demo.js', "console.log('node scripts/start.mjs http://localhost:5178/examples/web/quick-start.html');\n");
  const options = [{ product: 'glove', side: 'left' }, { product: 'glove', side: 'right' }, { product: 'pad' }]
    .flatMap(product => ['web', 'node'].map(env => ({ ...product, env, platform: 'windows', kind: 'complete' })));
  for (const option of options) await context.put('examples/products/' + getProductExampleFilename(option),
    createProductExample({ ...option, layout: 'repository' }));
  const archive = (await createSdkArchives({ sdkRoot: context.root })).find(item => item.kind === 'node');
  const entries = readZipEntries(archive.bytes);
  for (const option of options) assert.equal(entries.get('shroom-sdk-node/' + getProductExampleFilename(option)).toString(),
    createProductExample(option), 'ZIP 中的完整示例应与旧版下载布局完全一致');
  assert.equal(entries.get('shroom-sdk-node/node/license-env.js').toString(), "import { Shroom } from './index.js';\nexport { Shroom };\n");
  assert.equal(entries.get('shroom-sdk-node/AI-CONTEXT.md').toString(), '[安装](./docs/NPM.md#install)\n[五步](./quick-flow.js)\n');
  assert.equal(entries.get('shroom-sdk-node/README.md').toString(), '[维护](https://github.com/liudada118/shroomSDK/blob/main/docs/SDK-RELEASING.md)\n');
  assert.equal(entries.get('shroom-sdk-node/node/quick-demo.js').toString(), "console.log('node start.mjs http://localhost:5178/web/quick-start.html');\n");
  assert.deepEqual(JSON.parse(entries.get('shroom-sdk-node/docs/catalog.json')).map(entry => entry.file), ['AI-CONTEXT.md', 'docs/NPM.md']);
  assert.ok(![...entries.keys()].some(path => path.includes('/src/') || path.endsWith('SDK-RELEASING.md')));
  const metadata = JSON.parse(entries.get('shroom-sdk-node/package.json'));
  assert.equal(metadata.exports['./quick-flow'], './quick-flow.js');
  assert.equal(metadata.types, 'index.d.ts');
  assert.equal(metadata.scripts.start, 'node start.mjs');
  assert.equal(metadata.scripts['demo:quick'], 'node node/quick-demo.js');
});

test('a changed package cannot overwrite an existing version and leaves no staging directory', async (t) => {
  const context = await fixture(t);
  const prepared = await prepareRelease({ projectRoot: context.root });
  const original = await readFile(join(prepared.directory, 'shroom-sdk-node-0.1.0.zip'));
  await context.put('src/node/index.js', '// changed implementation\nexport const changed = true;\n');
  await context.pack();
  await context.put('dist/shroom-sdk-0.1.0.tgz', (await fixtureNpm({ projectRoot: context.root })).bytes);
  await assert.rejects(prepareRelease({ projectRoot: context.root }), /不可覆盖|禁止覆盖/);
  assert.deepEqual(await readFile(join(prepared.directory, 'shroom-sdk-node-0.1.0.zip')), original);
  assert.deepEqual(await readdir(context.output), ['0.1.0']);
});

test('stale aliases or missing release notes fail before creating a version directory', async (t) => {
  const context = await fixture(t);
  await context.put('src/node/index.js', '// changed after packing\nexport const changed = true;\n');
  await assert.rejects(prepareRelease({ projectRoot: context.root }), /兼容包与当前源码不一致/);
  await assert.rejects(readdir(context.output), { code: 'ENOENT' });
  await context.put('CHANGELOG.md', '# SDK\n\n## [0.1.0] - 2026-10-29\n\nTODO\n');
  await context.pack();
  await assert.rejects(prepareRelease({ projectRoot: context.root }), /实际更新内容/);
  await assert.rejects(readdir(context.output), { code: 'ENOENT' });
});

test('local dirty candidates are explicit and cannot pass a formal release check', async (t) => {
  const context = await fixture(t);
  await context.put('README.md', '# SDK\n\n未提交的新说明。\n');
  await context.pack();
  await assert.rejects(prepareRelease({ projectRoot: context.root, requireClean: true }), /干净的 Git 工作区/);
  const candidate = await prepareRelease({ projectRoot: context.root });
  assert.equal(candidate.manifest.source.dirty, true);
  await assert.rejects(verifyRelease({ directory: candidate.directory, requireClean: true, projectRoot: context.root }), /未提交修改/);
});

test('verification rejects a wrong source commit, altered ZIP bytes and unregistered files', async (t) => {
  const context = await fixture(t);
  const prepared = await prepareRelease({ projectRoot: context.root });
  await assert.rejects(verifyRelease({ directory: prepared.directory, expectedCommit: 'f'.repeat(40) }), /Git 提交不一致/);
  const file = join(prepared.directory, 'shroom-sdk-node-0.1.0.zip');
  const original = await readFile(file);
  const altered = Buffer.from(original);
  altered[35] ^= 1;
  await writeFile(file, altered);
  await assert.rejects(verifyRelease({ directory: prepared.directory }), /SHA-256/);
  await writeFile(file, original);
  await writeFile(join(prepared.directory, 'unexpected.sqlite'), 'user data');
  await assert.rejects(verifyRelease({ directory: prepared.directory }), /未登记文件/);
});

test('latest package validation rejects a dependency lock drift and missing declared entry', async (t) => {
  const context = await fixture(t);
  const manifestPath = join(context.root, 'package.json');
  const metadata = JSON.parse(await readFile(manifestPath, 'utf8'));
  metadata.optionalDependencies.ws = '^9.0.0';
  await context.put('package.json', JSON.stringify(metadata));
  await context.pack();
  await assert.rejects(verifyLatestPackages({ projectRoot: context.root }), /依赖与锁文件不一致/);
  metadata.optionalDependencies.ws = '^8.14.2';
  metadata.exports['./missing'] = './missing.js';
  await context.put('package.json', JSON.stringify(metadata));
  await context.pack();
  await assert.rejects(verifyLatestPackages({ projectRoot: context.root }), /缺少声明入口/);
});

test('release notes reject duplicate versions, invalid dates and path-like versions', () => {
  assert.throws(() => releaseNotes('## [0.1.0] - 2026-10-29\n\nA\n## [0.1.0] - 2026-10-29\n\nB', version), /只能包含一个/);
  assert.throws(() => releaseNotes('## [0.1.0] - 2026-02-31\n\nA', version), /日期无效/);
  assert.throws(() => releaseNotes('anything', '../outside'), /稳定 SemVer/);
});

test('a stale npm archive is rejected before freezing a release', async (t) => {
  const context = await fixture(t);
  await context.put('src/quick-flow.js', 'export const changed = true;');
  await context.pack();
  await assert.rejects(prepareRelease({ projectRoot: context.root }), /npm 安装包与当前源码不一致/);
  await assert.rejects(readdir(context.output), { code: 'ENOENT' });
});

test('npm archive validation rejects traversal, development files and missing exports', async (t) => {
  const context = await fixture(t);
  const bytes = (await fixtureNpm({ projectRoot: context.root })).bytes;
  assert.equal(verifyNpmArchive(bytes, version).name, 'shroom-sdk');
  const entries = readNpmEntries(bytes);
  entries.set('../secret.js', Buffer.from('secret'));
  assert.throws(() => readNpmEntries(tarFixture(entries)), /路径越界/);
  entries.delete('../secret.js');
  entries.set('scripts/private.js', Buffer.from('private'));
  assert.throws(() => verifyNpmArchive(tarFixture(entries), version), /非交付文件/);
  entries.delete('scripts/private.js');
  entries.delete('runtime/quick-flow.js');
  assert.throws(() => verifyNpmArchive(tarFixture(entries), version), /缺少声明入口/);
  assert.throws(() => readNpmEntries(bytes.subarray(0, bytes.length - 8)));
});
