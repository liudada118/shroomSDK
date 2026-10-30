/** 发布前的只读配置检查，不安装依赖、不构建、更不修改版本。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSdkVersion, VERSION_ROOT } from './sdk-version.mjs';

export async function checkSdkConfiguration(root = VERSION_ROOT) {
  const version = await checkSdkVersion(root);
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.lockfileVersion, 3, 'SDK 需要 npm v3 格式锁文件');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.deepEqual(lock.packages?.['']?.[field] ?? {}, pkg[field] ?? {}, `SDK ${field} 与锁文件不一致；在 SDK 仓库根目录运行 npm install`);
  }
  for (const [name, dependency] of Object.entries(lock.packages ?? {})) {
    if (!name) continue;
    assert.ok(name.startsWith('node_modules/') && !dependency.link && !dependency.extraneous,
      `SDK 锁文件包含本机或额外依赖：${name}`);
    assert.ok(/^https:\/\//.test(dependency.resolved ?? '') && dependency.integrity,
      `SDK 依赖缺少可移植下载地址或完整性校验：${name}`);
  }
  const notes = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(notes.includes(`## [${version}] - `), `请先在 CHANGELOG.md 中补充 ${version} 的发布日期与更新说明`);
  const pythonLock = await readFile(resolve(root, 'python/requirements-test.lock'), 'utf8');
  const requirements = pythonLock.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
  assert.ok(requirements.length > 0 && requirements.every(line => /^[\w.-]+==\d[\w.+-]*$/.test(line)),
    'Python 测试环境依赖必须锁定具体版本');
  console.log(`SDK ${version}：版本、依赖锁和更新说明检查通过`);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkSdkConfiguration().catch(error => { console.error(error.message); process.exitCode = 1; });
}
