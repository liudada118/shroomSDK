/** 准备受版本保护的发布包；本脚本不提交代码、不推送标签、不发布外部服务。 */
import { VERSION_ROOT } from './sdk-version.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from './sdk-command.mjs';
import { verifySdk } from './sdk-verify.mjs';

async function main(args) {
  if (args.some(arg => arg !== '--require-clean') || args.length > 1) {
    throw new Error('用法：npm run sdk:release [-- --require-clean]');
  }
  const node = (argv) => runCommand(process.execPath, argv, { cwd: VERSION_ROOT });
  const { version } = JSON.parse(await readFile(join(VERSION_ROOT, 'package.json'), 'utf8'));
  const tag = process.env.GITHUB_REF ?? `sdk-v${version}`;
  if (args.includes('--require-clean')) await node(['scripts/sdk-release-git.mjs', tag]);
  await verifySdk();
  if (args.includes('--require-clean')) await node(['scripts/sdk-release-git.mjs', tag]);
  await node(['scripts/sdk-release-artifacts.mjs', 'prepare', ...args]);
  await node(['scripts/sdk-release-artifacts.mjs', 'verify', ...args]);
}

main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
