/** 发布工具共用的子进程入口：使用参数数组，避免 shell 转义与 Windows 可见窗口。 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

export function runCommand(command, args, { cwd, env = process.env } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) done();
      else reject(new Error(`${command} 执行失败（${signal ?? `退出码 ${code}`}）；发布流程已停止。`));
    });
  });
}

/** 显式配置优先，其次使用本仓库隔离环境；不会自动修改全局 Python 环境。 */
export async function pythonCommand(root) {
  if (process.env.SDK_PYTHON) return process.env.SDK_PYTHON;
  for (const directory of ['work/sdk-release-venv', '.venv']) {
    const executable = resolve(root, directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    try { await access(executable); return executable; } catch { /* 尝试下一个已存在的环境。 */ }
  }
  return 'python';
}
