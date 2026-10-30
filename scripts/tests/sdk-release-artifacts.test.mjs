import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createSdkArchives, packSdk } from '../pack-sdk.mjs';
import { prepareRelease, readZipEntries, releaseNotes, verifyLatestPackages, verifyRelease } from '../sdk-release-artifacts.mjs';

const runFile = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const version = '0.1.0';

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
    exports: { '.': './web/index.js', './node': './node/index.js', './quick-flow': './quick-flow.js' },
    optionalDependencies: { ws: '^8.14.2' },
    scripts: { start: 'node start.mjs', 'demo:quick': 'node node/quick-demo.js',
      'test:backend': 'node --test tests/a.mjs', 'generate:examples': 'node examples/generate-product-examples.mjs',
      'sdk:release': 'node scripts/sdk-release.mjs', 'pack:sdk': 'node scripts/pack-sdk.mjs' },
  };
  await put('.gitignore', '/dist/\n');
  await put('package.json', JSON.stringify(metadata, null, 2));
  await put('package-lock.json', JSON.stringify({ name: metadata.name, version, lockfileVersion: 3, packages: { '': { name: metadata.name, version, optionalDependencies: metadata.optionalDependencies } } }));
  for (const path of ['quick-flow.js', 'node/index.js', 'web/index.js', 'node/quick-demo.js', 'start.mjs']) {
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
    'node/user.jsonl', 'node/user.meta.json', 'node/user.db3', '.env.local']) {
    await put('' + path, 'do not distribute\n');
  }
  await packSdk({ projectRoot: root, log: () => {} });
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

test('release freezes three verified ZIPs with real Git provenance, checksums and only the selected notes', async (t) => {
  const context = await fixture(t);
  const latest = await verifyLatestPackages({ projectRoot: context.root });
  assert.equal(latest.version, version);
  const prepared = await prepareRelease({ projectRoot: context.root, requireClean: true });
  const verified = await verifyRelease({ directory: prepared.directory, projectRoot: context.root, requireClean: true });
  assert.equal(verified.manifest.source.commit, await context.git('rev-parse', 'HEAD'));
  assert.equal(verified.manifest.source.dirty, false);
  assert.equal(verified.manifest.tag, 'sdk-v0.1.0');
  assert.equal((await readdir(prepared.directory)).length, 6);
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

test('a changed package cannot overwrite an existing version and leaves no staging directory', async (t) => {
  const context = await fixture(t);
  const prepared = await prepareRelease({ projectRoot: context.root });
  const original = await readFile(join(prepared.directory, 'shroom-sdk-node-0.1.0.zip'));
  await context.put('node/index.js', '// changed implementation\nexport const changed = true;\n');
  await context.pack();
  await assert.rejects(prepareRelease({ projectRoot: context.root }), /不可覆盖|禁止覆盖/);
  assert.deepEqual(await readFile(join(prepared.directory, 'shroom-sdk-node-0.1.0.zip')), original);
  assert.deepEqual(await readdir(context.output), ['0.1.0']);
});

test('stale aliases or missing release notes fail before creating a version directory', async (t) => {
  const context = await fixture(t);
  await context.put('node/index.js', '// changed after packing\nexport const changed = true;\n');
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
