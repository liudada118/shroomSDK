/** SDK 发布门禁：测试全部通过才打包；任一步失败，后续构建与发布停止。 */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_ROOT } from './sdk-version.mjs';
import { runCommand } from './sdk-command.mjs';

async function testFiles(root, directory, suffix) {
  return (await readdir(resolve(root, directory))).filter(name => name.endsWith(suffix)).sort().map(name => `${directory}/${name}`);
}

export async function verifySdk({ root = VERSION_ROOT, run = runCommand, log = console.log } = {}) {
  const node = (args) => run(process.execPath, args, { cwd: root });
  await node(['scripts/sdk-check.mjs']);
  await node(['scripts/check-sdk-node.mjs']);
  // 先生成测试会用到的浏览器代码与示例；此阶段不产生发布包。
  await node(['scripts/build-sdk-bundle.mjs']);
  await node(['examples/generate-product-examples.mjs']);
  await node(['--test', '--test-reporter=spec', ...await testFiles(root, 'tests', '.test.mjs')]);
  await node(['--test', '--test-reporter=spec', ...await testFiles(root, 'scripts/tests', '.test.mjs')]);
  await node(['scripts/sdk-python-tests.mjs']);
  await node(['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']);
  // 独立 SDK 只验证自己的源码与交付包；官网集成测试在官网仓库运行。
  await node(['scripts/pack-sdk.mjs']);
  await node(['scripts/sdk-release-artifacts.mjs', 'verify-latest']);
  await node(['scripts/check-sdk-packages.mjs']);
  log('SDK 发布门禁通过：JS、Python、原生依赖、类型、发布工具和客户下载包。');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifySdk().catch(error => { console.error(error.message); process.exitCode = 1; });
}
