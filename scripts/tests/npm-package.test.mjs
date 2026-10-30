import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packNpm } from '../pack-npm.mjs';
import { readNpmEntries, verifyNpmArchive } from '../npm-archive.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** 复制一个隔离快照，打包测试不改工作目录中的 SDK、版本或交付文件。 */
async function fixture(t) {
  const base = await realpath(tmpdir());
  const root = await mkdtemp(join(base, 'shroom-npm-test-'));
  t.after(async () => {
    const target = resolve(root);
    assert.equal(dirname(target), base);
    assert.ok(target.startsWith(join(base, 'shroom-npm-test-')));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  for (const directory of ['core', 'backend', 'flow', 'node', 'web']) {
    await cp(join(ROOT, directory), join(root, directory), { recursive: true });
  }
  for (const file of ['package.json', 'quick-flow.js', 'quick-flow.d.ts', 'index.d.ts', 'CHANGELOG.md', 'MIGRATION.md']) {
    await cp(join(ROOT, file), join(root, file));
  }
  await mkdir(join(root, 'docs'));
  await cp(join(ROOT, 'docs/NPM.md'), join(root, 'docs/NPM.md'));
  return root;
}

test('npm package is reproducible and includes only reachable runtime, browser output and public types', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'core/private-debug.js'), '// private-maintenance-marker\n');
  await writeFile(join(root, 'node/customer.sqlite'), 'private-recording-marker');
  await writeFile(join(root, 'web/client.env'), 'private-configuration-marker');
  const first = await packNpm({ projectRoot: root, log() {} });
  const second = await packNpm({ projectRoot: root, outputDirectory: join(root, 'second-output'), log() {} });
  assert.deepEqual(second.bytes, first.bytes, '相同输入必须生成相同 tgz 字节');
  assert.equal(relative(root, first.file), join('dist', `shroom-sdk-${first.version}.tgz`));
  const pkg = verifyNpmArchive(first.bytes, first.version);
  const entries = readNpmEntries(first.bytes);
  assert.equal(entries.size, first.report.files.length);
  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.deepEqual(pkg.optionalDependencies, JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).optionalDependencies);
  for (const path of ['runtime/quick-flow.js', 'runtime/flow/runtime.js', 'runtime/core/license.js',
    'runtime/node/index.js', 'runtime/node/backend.js', 'runtime/node/recording-sqlite.js',
    'runtime/index.d.ts', 'runtime/quick-flow.d.ts', 'runtime/node/index.d.ts',
    'runtime/node/backend.d.ts', 'runtime/web/index.d.ts', 'runtime/backend/client.d.ts', 'runtime/core/frame.d.ts']) {
    assert.ok(entries.has(path), `运行模块或类型缺失：${path}`);
  }
  for (const path of entries.keys()) {
    assert.doesNotMatch(path, /private-debug|customer\.sqlite|client\.env|\.map$|(?:^|\/)demo\.js$|\.html$/);
  }
  assert.ok(entries.get('runtime/quick-flow.js').length < (await readFile(join(root, 'quick-flow.js'))).length);
  for (const [key, value] of Object.entries(pkg.exports)) {
    assert.ok(value.browser.startsWith('./browser/'), `缺少浏览器入口：${key}`);
    if (value.types) assert.equal(Object.keys(value)[0], 'types');
    assert.ok(Object.keys(value).indexOf('browser') < Object.keys(value).indexOf('default'));
  }
});

test('npm packaging rejects a reachable directory symlink', async t => {
  const root = await fixture(t);
  await rename(join(root, 'core'), join(root, 'core-original'));
  try { await symlink(join(root, 'core-original'), join(root, 'core'), 'junction'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('系统不允许测试进程创建目录链接');
    throw error;
  }
  await assert.rejects(packNpm({ projectRoot: root, log() {} }), /符号链接/);
});

test('npm packaging rejects exports outside the SDK root', async t => {
  const root = await fixture(t);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  pkg.exports['./escape'] = '../outside.js';
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await assert.rejects(packNpm({ projectRoot: root, log() {} }), /超出 SDK 目录/);
});
