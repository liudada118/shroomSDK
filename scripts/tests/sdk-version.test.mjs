import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { checkSdkVersion, syncSdkVersion, bumpSdkVersion, nextSdkVersion } from '../sdk-version.mjs';

/** 所有升版测试使用独立副本，不能修改开发中的真实包或锁文件。 */
async function fixture(t) {
  const parent = resolve(tmpdir());
  const root = await mkdtemp(join(parent, 'shroom-sdk-version-test-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(parent + sep), '只清理本测试创建的临时子目录');
    await rm(root, { recursive: true, force: true });
  });
  const write = async (path, content) => {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  };
  const read = (path) => readFile(resolve(root, path), 'utf8');
  await write('package.json', JSON.stringify({ name: 'shroom-sdk', version: '0.1.0', private: true,
    optionalDependencies: { ws: '^8.14.2' } }, null, 2) + '\n');
  await write('package-lock.json', JSON.stringify({ name: 'shroom-sdk', version: '0.1.0', lockfileVersion: 3,
    packages: { '': { name: 'shroom-sdk', version: '0.1.0', optionalDependencies: { ws: '^8.14.2' } },
      'node_modules/ws': { version: '8.18.0', integrity: 'sha512-fixture' } } }, null, 2) + '\n');
  // version 紧邻下一个小节，验证替换后不会吞掉换行或覆盖其他配置。
  await write('python/pyproject.toml', '[build-system]\nrequires = ["setuptools>=68"]\n\n[project]\nname = "shroom-sdk"\nversion = "0.1.0"\n[project.optional-dependencies]\nserial = ["pyserial>=3.5,<4"]\n');
  for (const path of ['node/index.js', 'web/index.js']) {
    await write(path, "import { SDK_VERSION } from '../core/version.js';\nexport const Shroom = { version: SDK_VERSION };\n");
  }
  await write('python/src/shroom_sdk/__init__.py', 'from ._version import __version__\n');
  return { root, read, write };
}

test('sync creates runtime versions, preserves Python metadata and check detects drift', async (t) => {
  const context = await fixture(t);
  await assert.rejects(checkSdkVersion(context.root), /版本不同步/);
  assert.equal(await syncSdkVersion(context.root), '0.1.0');
  assert.equal(await checkSdkVersion(context.root), '0.1.0');
  assert.match(await context.read('python/pyproject.toml'), /version = "0\.1\.0"\n\[project.optional-dependencies\]/);
  await context.write('core/version.js', "export const SDK_VERSION = '9.0.0';\n");
  await assert.rejects(checkSdkVersion(context.root), /core\/version\.js/);
  await syncSdkVersion(context.root);
  assert.equal(await checkSdkVersion(context.root), '0.1.0');
});

test('bump updates JS/Python and both lock root versions without changing resolved dependencies', async (t) => {
  const context = await fixture(t);
  await syncSdkVersion(context.root);
  assert.equal(await bumpSdkVersion('minor', context.root), '0.2.0');
  assert.equal(await checkSdkVersion(context.root), '0.2.0');
  assert.equal(JSON.parse(await context.read('package.json')).version, '0.2.0');
  const lock = JSON.parse(await context.read('package-lock.json'));
  assert.equal(lock.version, '0.2.0');
  assert.equal(lock.packages[''].version, '0.2.0');
  assert.deepEqual(lock.packages['node_modules/ws'], { version: '8.18.0', integrity: 'sha512-fixture' });
  assert.match(await context.read('python/src/shroom_sdk/_version.py'), /__version__ = "0\.2\.0"/);
  assert.match(await context.read('python/pyproject.toml'), /serial = \["pyserial>=3\.5,<4"\]/);
  assert.equal(await bumpSdkVersion('1.0.0', context.root), '1.0.0');
});

test('invalid or non-increasing versions fail without mutating any version file', async (t) => {
  const context = await fixture(t);
  await syncSdkVersion(context.root);
  const paths = ['package.json', 'package-lock.json', 'core/version.js', 'python/pyproject.toml',
    'python/src/shroom_sdk/_version.py'];
  const before = await Promise.all(paths.map(context.read));
  for (const target of ['0.1.0', '0.0.9', 'v1.0.0', '1.0', '01.0.0', '1.0.0-beta.1', '1.0.0+build', '', '9007199254740992.0.0']) {
    await assert.rejects(bumpSdkVersion(target, context.root));
    assert.deepEqual(await Promise.all(paths.map(context.read)), before, target);
  }
  assert.equal(nextSdkVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextSdkVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextSdkVersion('1.2.3', 'major'), '2.0.0');
});

test('check refuses a disconnected runtime entry and unrelated locks cannot be rewritten', async (t) => {
  const context = await fixture(t);
  await syncSdkVersion(context.root);
  await context.write('node/index.js', "export const Shroom = { version: '0.1.0' };\n");
  await assert.rejects(checkSdkVersion(context.root), /node\/index\.js/);
  const manifest = await context.read('package.json');
  const wrongLock = JSON.stringify({ name: 'another-package', version: '1.2.3', lockfileVersion: 3 });
  await context.write('package-lock.json', wrongLock);
  await assert.rejects(bumpSdkVersion('patch', context.root), /不能更改其他项目的锁文件/);
  assert.equal(await context.read('package.json'), manifest);
  assert.equal(await context.read('package-lock.json'), wrongLock);
});
