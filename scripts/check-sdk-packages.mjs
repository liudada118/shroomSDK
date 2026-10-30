/**
 * 客户交付包冒烟检查：只使用真实 ZIP 解压出来的文件、依赖锁和安装结果。
 * npm/pip 安装、缓存、模拟采集数据库均位于本脚本创建的临时目录，退出时清理。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pythonCommand } from './sdk-command.mjs';
import { readZipEntries, verifyLatestPackages } from './sdk-release-artifacts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const runFile = promisify(execFile);

/** 以 Node 直接执行 npm CLI；不借助 cmd/sh，也不拼接带路径的命令字符串。 */
async function npmCli() {
  const binary = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(binary, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(binary, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* 尝试下一个已知安装位置。 */ }
  }
  throw new Error('找不到 npm CLI；请通过 npm run sdk:verify 执行交付包检查。');
}

/** 子进程结束后再释放目录；失败保留输出帮助定位缺依赖或原生模块安装错误。 */
async function execute(command, args, { cwd, env, label, timeout = 180000 } = {}) {
  try {
    const { stdout } = await runFile(command, args, {
      cwd, env, windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024,
    });
    if (stdout.trim()) console.log(stdout.trim());
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    throw new Error(label + '失败' + (detail ? '：\n' + detail : '：' + error.message), { cause: error });
  }
}

/** 只在自有临时目录内展开经过 CRC 和目录结构校验的 ZIP。 */
async function extract(zip, directory) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  for (const [name, bytes] of readZipEntries(zip)) {
    const destination = resolve(root, name);
    if (name.includes(':') || !destination.startsWith(root + sep)) throw new Error('ZIP 解压路径超出临时目录。');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }
}

// 在独立 Node 进程内运行，进程退出后 Windows 才能释放已加载的 SQLite 原生 DLL。
const NODE_SMOKE = String.raw`
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [sdk, recordingsDir, expectedVersion] = process.argv.slice(1);
const { Shroom } = await import(pathToFileURL(join(sdk, 'node/index.js')));
const { readProduct, createWS, startRecording, stopRecording, downloadRecording } =
  await import(pathToFileURL(join(sdk, 'quick-flow.js')));
assert.equal(Shroom.version, expectedVersion);
const device = Shroom.mock({ rows: 2, cols: 2, fps: 100 });
let server;
let stream;
try {
  server = await createWS(device, { port: 0, recordingsDir });
  stream = await readProduct({ url: server.url });
  const started = await startRecording(server, { label: '交付包采集检查' });
  await new Promise((done, reject) => {
    let count = 0;
    const timer = setTimeout(() => { removeData(); removeError(); reject(new Error('交付包未收到模拟 WS 数据')); }, 5000);
    const removeError = stream.onError((error) => { clearTimeout(timer); removeData(); removeError(); reject(error); });
    const removeData = stream.onData((frame) => {
      assert.equal(frame.raw.length, 4);
      if (++count === 3) { clearTimeout(timer); removeData(); removeError(); done(); }
    });
  });
  const stopped = await stopRecording(server);
  assert.equal(stopped.id, started.id);
  assert.equal(stopped.status, 'stopped');
  assert.ok(stopped.frameCount >= 3);
  const response = await fetch(downloadRecording(server, { format: 'jsonl' }), { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const rows = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, stopped.frameCount);
  assert.ok(rows.every((row) => row.sessionId === started.id && row.label === '交付包采集检查' && row.source === 'mock'));
  const csv = await fetch(downloadRecording(server, { format: 'csv' }), { signal: AbortSignal.timeout(5000) });
  assert.equal(csv.status, 200);
  assert.ok((await csv.text()).includes(started.id));
  console.log('Node ZIP 安装与五步调用检查通过：' + Shroom.version + '，采集 ' + stopped.frameCount + ' 帧。');
} finally {
  try { await stream?.close(); }
  finally {
    try { await server?.close(); }
    finally { await device.close(); }
  }
}
assert.equal(device.state, 'closed');
assert.equal((await readFile(resolve(recordingsDir, 'recordings.sqlite'))).subarray(0, 16).toString(), 'SQLite format 3\0');
`;

const PYTHON_SMOKE = String.raw`
import importlib.metadata
from pathlib import Path
import sys
import shroom_sdk
from shroom_sdk import Shroom
target, expected = Path(sys.argv[1]).resolve(), sys.argv[2]
assert Path(shroom_sdk.__file__).resolve().is_relative_to(target), '必须从临时安装结果加载 SDK'
assert shroom_sdk.__version__ == expected
assert Shroom.version == expected
assert importlib.metadata.version('shroom-sdk') == expected
with Shroom.mock(rows=2, cols=2, fps=1000, seed=7) as device:
    frames = [device.read_frame(timeout=1) for _ in range(3)]
    assert all(frame is not None and len(frame.raw) == 4 for frame in frames)
    assert all(0 <= value <= 1 for frame in frames for value in frame.values)
    assert device.frame_count == 3
assert device.closed
print('Python ZIP 安装与模拟取数检查通过：' + expected + '，读取 3 帧。')
`;

export async function checkSdkPackages({ projectRoot = ROOT } = {}) {
  const { version } = await verifyLatestPackages({ projectRoot });
  const [npm, python] = await Promise.all([npmCli(), pythonCommand(projectRoot)]);
  const temporaryRoot = resolve(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'shroom-package-smoke-'));
  try {
    const nodeExtraction = join(temporary, 'node');
    const pythonExtraction = join(temporary, 'python');
    await extract(await readFile(join(projectRoot, 'dist', 'shroom-sdk-node.zip')), nodeExtraction);
    await extract(await readFile(join(projectRoot, 'dist', 'shroom-sdk-python.zip')), pythonExtraction);
    const nodeSdk = join(nodeExtraction, 'shroom-sdk-node');
    const pythonSdk = join(pythonExtraction, 'shroom-sdk-python', 'python');
    const pythonInstall = join(temporary, 'python-installed');
    const env = {
      ...process.env,
      npm_config_cache: join(temporary, 'npm-cache'),
      npm_config_devdir: join(temporary, 'node-gyp'),
      npm_config_fetch_retries: '1',
      npm_config_fetch_timeout: '30000',
      npm_config_update_notifier: 'false',
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PIP_NO_CACHE_DIR: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      TMPDIR: temporary, TEMP: temporary, TMP: temporary,
    };
    console.log('检查客户 ZIP：在临时目录安装锁定依赖。');
    await execute(process.execPath, [npm, 'ci', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: nodeSdk, env, label: 'Node 交付包 npm ci',
    });
    await execute(process.execPath, ['--input-type=module', '--eval', NODE_SMOKE, nodeSdk, join(temporary, 'recordings'), version], {
      cwd: temporary, env, label: 'Node 交付包取数/采集/下载', timeout: 20000,
    });
    await execute(python, ['-m', 'pip', 'install', '--quiet', '--no-build-isolation', '--no-deps', '--no-cache-dir',
      '--target', pythonInstall, pythonSdk], { cwd: temporary, env, label: 'Python 交付包本地安装' });
    await execute(python, ['-S', '-c', PYTHON_SMOKE, pythonInstall, version], {
      cwd: temporary, env: { ...env, PYTHONPATH: pythonInstall }, label: 'Python 交付包模拟取数', timeout: 20000,
    });
    return { version };
  } finally {
    const target = resolve(temporary);
    assert.ok(target.startsWith(temporaryRoot + sep) && target !== temporaryRoot, '只能清理本脚本创建的临时子目录');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkSdkPackages().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
