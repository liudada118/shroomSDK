/** 用发布环境运行 Python 基础与授权测试，不依赖开发者的全局包。 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_ROOT } from './sdk-version.mjs';
import { pythonCommand, runCommand } from './sdk-command.mjs';

export async function testPython(root = VERSION_ROOT) {
  const python = await pythonCommand(root);
  const options = { cwd: root, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } };
  await runCommand(python, ['scripts/check-sdk-python.py'], options);
  await runCommand(python, ['-m', 'unittest', 'discover', '-s', 'python/tests'], options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  testPython().catch(error => { console.error(error.message); process.exitCode = 1; });
}
