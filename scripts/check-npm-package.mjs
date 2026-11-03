/**
 * npm 客户安装检查：只从临时项目的 node_modules 使用真实 .tgz，不借用源码入口。
 * 模拟设备代替硬件；WS、SQLite、HTTP 导出与原生依赖均实际运行。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { verifyNpmArchive } from './npm-archive.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const runFile = promisify(execFile);

/** 不经过 shell，Windows 上同样以参数数组启动 npm。 */
async function npmCli() {
  const binary = dirname(process.execPath);
  for (const candidate of [process.env.npm_execpath,
    join(binary, 'node_modules/npm/bin/npm-cli.js'),
    resolve(binary, '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean)) {
    try { await access(candidate); return candidate; } catch { /* 下一个已知安装位置。 */ }
  }
  throw new Error('找不到 npm CLI；请使用 npm run test:npm。');
}

async function execute(args, { cwd, env, label, timeout = 180000 }) {
  try {
    const { stdout } = await runFile(process.execPath, args, {
      cwd, env, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    if (stdout.trim()) console.log(stdout.trim());
  } catch (error) {
    throw new Error(`${label}失败：\n${[error.stdout, error.stderr].filter(Boolean).join('\n').trim() || error.message}`, { cause: error });
  }
}

/** 安装结果只允许精简运行库、公开类型与客户说明，不能夹带开发文件或采集数据。 */
async function inspectInstalledPackage(root, version) {
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.name, 'shroom-sdk');
  assert.equal(metadata.version, version);
  assert.equal(metadata.type, 'module');
  assert.equal(metadata.private, false, '客户安装包应允许 npm 注册表发布');
  assert.equal(metadata.publishConfig?.access, 'public');
  assert.equal(metadata.publishConfig?.registry, 'https://registry.npmjs.org/');
  assert.ok(!metadata.scripts && !metadata.devDependencies, '客户安装包不能带开发脚本或开发依赖');
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), '安装包不能通过符号链接夹带外部文件');
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(relative(root, path).split(sep).join('/'));
    }
  }
  await walk(root);
  for (const file of files) {
    assert.ok(/^(?:package\.json|README\.md|CHANGELOG\.md|MIGRATION\.md|LICENSE(?:\.(?:md|txt))?)$/.test(file)
      || /^(?:runtime|browser)\/[\w./-]+(?:\.js|\.d\.ts)$/.test(file), `npm 包出现非交付文件：${file}`);
    assert.ok(!/(?:^|\/)(?:tests?|scripts|examples|python|node_modules|work)(?:\/|$)|\.map$|\.sqlite|\.env/.test(file),
      `npm 包不能包含开发/采集文件：${file}`);
    if (file.endsWith('.js')) {
      const source = await readFile(join(root, file), 'utf8');
      assert.doesNotMatch(source, /sourceMappingURL\s*=|\/\*\*/, `运行产物不应带源映射或源码文档注释：${file}`);
    }
  }
  return { metadata, files };
}

const BROWSER_ENTRY = `
export * as flow from 'shroom-sdk/quick-flow';
export * as web from 'shroom-sdk/web';
export * as root from 'shroom-sdk';
export * as backend from 'shroom-sdk/backend';
export * as core from 'shroom-sdk/core';
`;

// 单独子进程加载原生 SQLite，退出之后再清理临时目录，避免 Windows DLL 锁定。
const NODE_SMOKE = String.raw`
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import * as root from 'shroom-sdk';
import * as web from 'shroom-sdk/web';
import * as node from 'shroom-sdk/node';
import * as flow from 'shroom-sdk/quick-flow';
import * as backend from 'shroom-sdk/backend';
import * as core from 'shroom-sdk/core';

const [recordingsDir, expectedVersion, browserBundle] = process.argv.slice(2);
const names = ['createWS', 'downloadRecording', 'readProduct', 'startRecording', 'stopRecording'];
assert.deepEqual(Object.keys(flow).sort(), names);
for (const name of names) assert.equal(typeof flow[name], 'function');
assert.equal(node.Shroom.version, expectedVersion);
assert.equal(root.Shroom, web.Shroom);
assert.equal(node.Shroom.mock, web.Shroom.mock, 'Node/Web 必须共享 mock 身份');
assert.equal(node.activateLicense, web.activateLicense, '授权状态必须在基础入口之间共享');
assert.equal(node.ShroomError, web.ShroomError);
assert.equal(core.decodeFrame, node.decodeFrame);
assert.equal(typeof backend.BackendSdkClient, 'function');
assert.equal(typeof node.listPorts, 'function');
assert.equal(node.listPorts, node.Shroom.listPorts);

const require = createRequire(import.meta.url);
assert.equal(typeof require('serialport').SerialPort, 'function');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const db = new Database(':memory:');
try { assert.equal(db.prepare('SELECT 1 AS ok').get().ok, 1); } finally { db.close(); }

// 使用测试进程临时签发的离线密钥确认跨入口共享状态，不访问实际授权后台。
const issuer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = issuer.publicKey.export({ type: 'spki', format: 'pem' });
const payload = Buffer.from(JSON.stringify({ productType: 'shroom-sdk', boundSensorTypes: 'all',
  sdkFeatures: ['serial', 'serial.raw', 'stream', 'recording'], expireDate: Date.now() + 60000, version: 3 })).toString('base64');
const key = Buffer.from(JSON.stringify({ payload,
  signature: sign('RSA-SHA256', Buffer.from(payload), issuer.privateKey).toString('base64') })).toString('base64');
await node.activateLicense(key, { mode: 'offline', publicKey });
assert.equal(web.getLicenseStatus().valid, true);
web.clearLicense();
assert.equal(node.getLicenseStatus().valid, false);

await assert.rejects(flow.readProduct({ url: 'https://invalid.example' }), error =>
  error instanceof node.ShroomError && error.code === 'INVALID_CONFIG' && typeof error.suggestion === 'string');
await assert.rejects(flow.readProduct({ product: 'pad', path: 'SHROOM_TEST_NO_DEVICE' }), { code: 'LICENSE_REQUIRED' });
assert.throws(() => flow.downloadRecording({}), { code: 'INVALID_CONFIG' });

// 真实浏览器条件产物放入没有 process/require/Buffer 的沙箱，仅注入标准 Web API。
let downloaded = null;
const browser = { console, URL, TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto,
  setTimeout, clearTimeout, setInterval, clearInterval, AbortController, WebSocket,
  document: { body: { appendChild() {} }, createElement() {
    return { click() { downloaded = this.href; }, remove() {} };
  } } };
runInNewContext(await readFile(browserBundle, 'utf8'), browser, { timeout: 5000 });
const consumer = browser.ShroomConsumer;
assert.deepEqual(Object.keys(consumer.flow).sort(), names);
assert.equal(consumer.root.Shroom, consumer.web.Shroom);
assert.equal(consumer.root.activateLicense, consumer.web.activateLicense);
assert.equal(consumer.backend.BackendSdkClient, consumer.web.BackendSdkClient);
assert.equal(consumer.core.decodeFrame, consumer.web.decodeFrame);
await consumer.web.activateLicense(key, { mode: 'offline', publicKey });
assert.equal(consumer.root.getLicenseStatus().valid, true);
consumer.root.clearLicense();
assert.equal(consumer.web.getLicenseStatus().valid, false);
await assert.rejects(consumer.flow.readProduct({ product: 'pad' }), { code: 'UNSUPPORTED_ENVIRONMENT' });
let closedUnsupported = false;
await assert.rejects(consumer.flow.createWS({ async close() { closedUnsupported = true; } }), { code: 'UNSUPPORTED_ENVIRONMENT' });
assert.equal(closedUnsupported, true);

function waitFrames(stream) {
  return new Promise((done, reject) => {
    let count = 0;
    let removeData = () => {};
    let removeError = () => {};
    const finish = (error) => { clearTimeout(timer); removeData(); removeError(); error ? reject(error) : done(); };
    const timer = setTimeout(() => finish(new Error('npm 客户未收到 WS 模拟数据')), 5000);
    removeError = stream.onError(finish);
    removeData = stream.onData(frame => {
      try { assert.equal(frame.raw.length, 4); if (++count === 3) finish(); }
      catch (error) { finish(error); }
    });
  });
}

const device = node.Shroom.mock({ rows: 2, cols: 2, fps: 100 });
let server;
let stream;
let browserStream;
try {
  server = await flow.createWS(device, { port: 0, recordingsDir });
  stream = await flow.readProduct({ url: server.url, WebSocketImpl: WebSocket });
  const started = await flow.startRecording(server, { label: 'npm 安装采集验证' });
  await waitFrames(stream);
  const stopped = await flow.stopRecording(server);
  assert.equal(stopped.id, started.id);
  assert.equal(stopped.status, 'stopped');
  assert.ok(stopped.frameCount >= 3);
  const response = await fetch(flow.downloadRecording(server, { format: 'jsonl' }), { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const rows = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, stopped.frameCount);
  assert.ok(rows.every(row => row.sessionId === started.id && row.label === 'npm 安装采集验证' && row.source === 'mock'));
  const csv = await fetch(flow.downloadRecording(server, { format: 'csv' }), { signal: AbortSignal.timeout(5000) });
  assert.equal(csv.status, 200);
  assert.ok((await csv.text()).includes(started.id));

  browserStream = await consumer.flow.readProduct({ url: server.url });
  const browserStarted = await consumer.flow.startRecording(browserStream, { label: 'npm 浏览器采集验证' });
  await waitFrames(browserStream);
  const browserStopped = await consumer.flow.stopRecording(browserStream);
  assert.equal(browserStopped.id, browserStarted.id);
  assert.ok(browserStopped.frameCount >= 3);
  const url = consumer.flow.downloadRecording(browserStream, { format: 'csv' });
  assert.equal(downloaded, url);
  const browserCsv = await fetch(url, { signal: AbortSignal.timeout(5000) });
  assert.equal(browserCsv.status, 200);
  assert.ok((await browserCsv.text()).includes(browserStarted.id));
  console.log('npm 包名导入、授权单例、错误处理、Node/浏览器五步流程及 CSV/JSONL 下载通过：' + expectedVersion);
} finally {
  try { await browserStream?.close(); }
  finally {
    try { await stream?.close(); }
    finally {
      try { await server?.close(); } finally { await device.close(); }
    }
  }
}
assert.equal(device.state, 'closed');
assert.equal((await readFile(join(recordingsDir, 'recordings.sqlite'))).subarray(0, 16).toString(), 'SQLite format 3\0');
`;

const TYPES_CONSUMER = `
import { Shroom, type Frame } from 'shroom-sdk';
import { Shroom as NodeShroom, listPorts } from 'shroom-sdk/node';
import { Shroom as WebShroom } from 'shroom-sdk/web';
import { BackendSdkClient } from 'shroom-sdk/backend';
import { decodeFrame } from 'shroom-sdk/core';
import { readProduct, createWS, startRecording, stopRecording, downloadRecording } from 'shroom-sdk/quick-flow';
const server = await createWS(NodeShroom.mock({ rows: 2, cols: 2 }));
const ports = await listPorts();
const device = await readProduct({ product: 'pad', path: ports[0]?.path ?? 'COM_TEST',
  reconnect: { intervalMs: 3000, maxAttempts: 3 },
  onStateChange(status) { console.log(status.state, status.attempt); } });
const unsubscribe = device.onStateChange(status => console.log(status.path));
unsubscribe();
await device.close();
const stream = await readProduct({ url: server.url, onData(frame: Frame) { console.log(frame.values); } });
await startRecording(stream, { label: '类型检查' });
await stopRecording(stream);
const url: string = downloadRecording(stream, { format: 'csv' });
const client = new BackendSdkClient();
console.log(url, client, Shroom.version, WebShroom.version, decodeFrame);
await stream.close();
await server.close();
// @ts-expect-error 五步函数仍拒绝未支持的下载格式。
downloadRecording(stream, { format: 'xlsx' });
// @ts-expect-error URL 连接不能混入串口产品参数。
await readProduct({ url: 'ws://127.0.0.1:19999', product: 'pad' });
// @ts-expect-error 串口重连配置不能用于 WS 客户端。
await readProduct({ url: 'ws://127.0.0.1:19999', reconnect: true });
`;

export async function checkNpmPackage({ projectRoot = ROOT, packagePath, fromRegistry = false } = {}) {
  const { version } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  const archive = resolve(packagePath ?? join(projectRoot, 'dist', `shroom-sdk-${version}.tgz`));
  const archiveBytes = await readFile(archive);
  verifyNpmArchive(archiveBytes, version, { requirePublishable: true });
  const npm = await npmCli();
  const temporaryRoot = resolve(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'shroom-npm-consumer-'));
  try {
    const consumer = join(temporary, 'consumer');
    await mkdir(consumer);
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'shroom-install-check', private: true, type: 'module' }));
    const env = { ...process.env, npm_config_cache: join(temporary, 'npm-cache'),
      npm_config_devdir: join(temporary, 'node-gyp'), npm_config_fetch_retries: '1',
      npm_config_fetch_timeout: '30000', npm_config_update_notifier: 'false',
      TMPDIR: temporary, TEMP: temporary, TMP: temporary };
    const specifier = fromRegistry ? `shroom-sdk@${version}` : archive;
    console.log('检查 npm 交付包：在独立客户项目安装 ' + (fromRegistry ? specifier : basename(archive)));
    await execute([npm, 'install', '--save-exact', '--no-audit', '--no-fund', '--loglevel=error',
      '--registry=https://registry.npmjs.org/', specifier],
      { cwd: consumer, env, label: 'npm 安装交付包' });
    const installed = join(consumer, 'node_modules/shroom-sdk');
    const { files } = await inspectInstalledPackage(installed, version);
    const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
    assert.equal(lock.packages['node_modules/shroom-sdk'].version, version);
    assert.ok(lock.packages['node_modules/shroom-sdk'].integrity, '客户锁文件必须记录安装包完整性');
    assert.equal(lock.packages['node_modules/shroom-sdk'].integrity,
      'sha512-' + createHash('sha512').update(archiveBytes).digest('base64'), '安装内容必须与通过验证的发布包一致');
    if (fromRegistry) assert.equal(new URL(lock.packages['node_modules/shroom-sdk'].resolved).origin,
      'https://registry.npmjs.org', '客户必须从 npm 官方注册表获取包');

    await writeFile(join(consumer, 'browser-entry.js'), BROWSER_ENTRY);
    const browserBundle = join(consumer, 'browser-bundle.js');
    const browserBuild = await build({ absWorkingDir: consumer, entryPoints: ['browser-entry.js'],
      outfile: browserBundle, bundle: true, platform: 'browser', format: 'iife', globalName: 'ShroomConsumer',
      target: 'es2022', metafile: true, logLevel: 'silent' });
    for (const input of Object.keys(browserBuild.metafile.inputs)) {
      assert.ok(!/runtime\/node\/|node_modules\/(?:serialport|ws|better-sqlite3)\//.test(input.replace(/\\/g, '/')),
        `浏览器包不能包含 Node 运行模块：${input}`);
    }
    assert.ok(Object.values(browserBuild.metafile.outputs).every(output => output.imports.length === 0),
      '浏览器打包结果不能残留 Node 内建模块或未解析依赖');
    await writeFile(join(consumer, 'smoke.mjs'), NODE_SMOKE);
    await execute(['smoke.mjs', join(temporary, 'recordings'), version, browserBundle],
      { cwd: consumer, env, label: 'npm 消费者五步流程', timeout: 30000 });

    await writeFile(join(consumer, 'types.mts'), TYPES_CONSUMER);
    for (const [module, moduleResolution, types] of [['NodeNext', 'NodeNext', ['node']], ['ESNext', 'Bundler', []]]) {
      const config = { compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module, moduleResolution, strict: true, noEmit: true, skipLibCheck: false, types,
        typeRoots: [join(projectRoot, 'node_modules/@types')] }, files: ['types.mts'] };
      await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify(config));
      await execute([join(projectRoot, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
        { cwd: consumer, env, label: `${moduleResolution} 客户类型声明`, timeout: 30000 });
    }
    console.log(`npm 包结构、${files.length} 个交付文件及 NodeNext/Bundler 类型检查通过。`);
    return { version, packagePath: archive, files };
  } finally {
    const target = resolve(temporary);
    assert.ok(target.startsWith(temporaryRoot + sep) && basename(target).startsWith('shroom-npm-consumer-'),
      '只能清理本检查创建的临时子目录');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkNpmPackage({ fromRegistry: process.argv.includes('--from-registry') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
