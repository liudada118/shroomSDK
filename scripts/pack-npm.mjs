/**
 * 生成供 npm 安装的精简包，不执行 npm publish。
 * Node 模块逐文件压缩以保留授权会话和设备身份；浏览器入口共享同一次构建的 chunk。
 * 客户包不包含维护源码注释、source map、测试、生成器、Python 或采集数据。
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';
import { verifyNpmArchive } from './npm-archive.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const execute = promisify(execFile);
const DECLARATIONS = ['index.d.ts', 'quick-flow.d.ts', 'node/index.d.ts', 'node/backend.d.ts',
  'web/index.d.ts', 'backend/client.d.ts', 'core/frame.d.ts'];
const METADATA = ['name', 'version', 'description', 'type', 'engines', 'license', 'repository', 'homepage', 'bugs',
  'dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'];

function within(root, file) {
  const path = relative(root, file);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** 检查每一级路径，避免通过目录符号链接读取工作区以外的文件。 */
async function checkedFile(root, file) {
  const absolute = resolve(root, file);
  assert.ok(within(root, absolute), `npm 文件超出 SDK 目录：${file}`);
  let current = root;
  for (const part of relative(root, absolute).split(sep)) {
    current = join(current, part);
    assert.ok(!(await lstat(current)).isSymbolicLink(), `npm 打包不接受符号链接：${current}`);
  }
  assert.ok((await lstat(absolute)).isFile(), `npm 交付内容必须是普通文件：${file}`);
  assert.ok(within(root, await realpath(absolute)), `npm 文件真实路径超出 SDK 目录：${file}`);
  return absolute;
}

function exportStrings(value) {
  return typeof value === 'string' ? [value] : Object.values(value ?? {}).flatMap(exportStrings);
}

function browserExport(value) {
  if (typeof value === 'string') return value;
  return value?.browser ? browserExport(value.browser) : value?.default ? browserExport(value.default) : undefined;
}

function runtimeExport(value) {
  if (typeof value === 'string') {
    assert.ok(value.startsWith('./src/') && !value.slice(2).split('/').includes('..'), `无效的包入口：${value}`);
    return `./runtime/${value.slice('./src/'.length)}`;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, runtimeExport(child)]));
}

/** 从公开入口发现完整运行依赖；外部 npm 包和 Node 内建模块由客户环境解析。 */
async function discoverRuntime(root, pkg, temporary) {
  const entries = [...new Set(exportStrings(pkg.exports).filter(path => path.endsWith('.js')))];
  assert.ok(entries.length > 0, 'SDK 必须声明 JavaScript exports');
  await Promise.all(entries.map(file => checkedFile(root, file)));
  const result = await build({
    absWorkingDir: root, entryPoints: entries, outdir: join(temporary, 'discovery'),
    platform: 'node', format: 'esm', target: 'es2022', bundle: true, splitting: true,
    packages: 'external', preserveSymlinks: true, metafile: true, write: false, logLevel: 'silent',
  });
  const modules = [];
  for (const file of Object.keys(result.metafile.inputs).sort()) {
    assert.ok(file.endsWith('.js'), `npm 运行模块存在未声明资源：${file}`);
    const source = await checkedFile(root, file);
    assert.ok(!relative(root, source).split(sep).some(part => ['node_modules', 'tests', 'scripts', 'work', 'dist'].includes(part)),
      `公开入口不应依赖维护文件：${file}`);
    modules.push(source);
  }
  const entryExports = new Map(Object.values(result.metafile.outputs)
    .filter(output => output.entryPoint)
    .map(output => [resolve(root, output.entryPoint), output.exports]));
  return { modules, entryExports };
}

/** 浏览器误调用本机串口/服务端入口时给出 SDK 错误，不将 Node 依赖塞进网页。 */
function browserNodeShim(root, entryExports) {
  const nodeNames = entryExports.get(resolve(root, 'src/node/index.js')) ?? [];
  const webNames = new Set(entryExports.get(resolve(root, 'src/web/index.js')) ?? []);
  const browserUnsafe = new Set(['connectSerial', 'connectProduct', 'connectGlove', 'connectHandPad']);
  const shared = nodeNames.filter(name => webNames.has(name) && !browserUnsafe.has(name) && !['default', 'Shroom'].includes(name));
  const unsupported = nodeNames.filter(name => !shared.includes(name) && !['default', 'Shroom'].includes(name));
  const source = JSON.stringify(resolve(root, 'src/web/index.js').split(sep).join('/'));
  return `import { Shroom as WebShroom, ${shared.join(', ')} } from ${source};
export { ${shared.join(', ')} };
function unsupported() { throw new ShroomError('UNSUPPORTED_ENVIRONMENT', '本机串口取数和创建 WS 服务须在 Node.js 中调用；网页请传入 WS url。', { stage: 'configure' }); }
${unsupported.map(name => `export const ${name} = unsupported;`).join('\n')}
export const Shroom = { ...WebShroom, connect: unsupported, connectProduct: unsupported,
  connectGlove: unsupported, connectHandPad: unsupported, listPorts: unsupported,
  serveDevice: unsupported, renderAscii: unsupported };
export default Shroom;
`;
}

async function browserBuild(root, pkg, staging, entryExports) {
  const entries = {};
  const publicPaths = new Map();
  for (const [key, value] of Object.entries(pkg.exports)) {
    assert.ok(key === '.' || /^\.\/[a-z0-9-]+$/.test(key), `暂不支持的 npm 子路径：${key}`);
    const name = key === '.' ? 'index' : key.slice(2);
    const entry = browserExport(value);
    assert.ok(entry?.endsWith('.js'), `浏览器入口缺失：${key}`);
    entries[name] = await checkedFile(root, entry);
    publicPaths.set(key, `./browser/${name}.js`);
  }
  const nodeEntry = resolve(root, 'src/node/index.js');
  const result = await build({
    absWorkingDir: root, entryPoints: entries, outdir: join(staging, 'browser'),
    platform: 'browser', format: 'esm', target: 'es2022', bundle: true, splitting: true,
    minify: true, keepNames: true, charset: 'utf8', legalComments: 'none', sourcemap: false,
    preserveSymlinks: true, metafile: true, write: false, logLevel: 'silent',
    entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]',
    plugins: [{ name: 'shroom-browser-environment', setup(builder) {
      builder.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'web-crypto', namespace: 'shroom-browser-shim' }));
      builder.onResolve({ filter: /(?:^|[\\/])node[\\/]index\.js$/ }, (args) => {
        const resolved = resolve(args.resolveDir || root, args.path);
        return resolved === nodeEntry ? { path: 'node-entry', namespace: 'shroom-browser-shim' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'shroom-browser-shim' }, (args) => ({
        contents: args.path === 'web-crypto' ? 'export const webcrypto = globalThis.crypto;'
          : browserNodeShim(root, entryExports), loader: 'js', resolveDir: root,
      }));
    } }],
  });
  for (const file of Object.keys(result.metafile.inputs)) {
    if (file.startsWith('shroom-browser-shim:')) continue;
    await checkedFile(root, file);
  }
  for (const output of Object.values(result.metafile.outputs)) {
    assert.ok(output.imports.every(value => !value.external), '浏览器 npm 产物不得保留 Node 或外部运行依赖');
  }
  for (const file of result.outputFiles) {
    assert.ok(within(resolve(staging, 'browser'), file.path), '浏览器构建输出超出 staging');
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }
  return publicPaths;
}

async function npmCli() {
  const binary = dirname(process.execPath);
  for (const candidate of [process.env.npm_execpath,
    join(binary, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(binary, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].filter(Boolean)) {
    try { await access(candidate); return candidate; } catch { /* 尝试常见安装位置。 */ }
  }
  throw new Error('找不到 npm CLI；请通过 npm run pack:npm 执行。');
}

/** 返回真实 .tgz 字节及 npm 文件清单，供发布门禁和独立消费者检查复用。 */
export async function packNpm({ projectRoot = ROOT, outputDirectory, log = console.log } = {}) {
  const root = resolve(projectRoot);
  assert.ok(!(await lstat(root)).isSymbolicLink(), 'SDK 根目录不能是符号链接');
  const pkg = JSON.parse(await readFile(await checkedFile(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'shroom-sdk', 'npm 包名称必须来自当前 SDK');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'npm 包需要稳定语义版本号');
  const output = resolve(outputDirectory ?? join(root, 'dist'));
  const temporaryRoot = await realpath(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'shroom-npm-pack-'));
  try {
    const staging = join(temporary, 'package');
    await mkdir(staging);
    const { modules, entryExports } = await discoverRuntime(root, pkg, temporary);
    for (const file of modules) {
      assert.ok(within(join(root, 'src'), file), 'npm 运行代码必须位于 src/');
      const destination = join(staging, 'runtime', relative(join(root, 'src'), file));
      const result = await transform(await readFile(file, 'utf8'), {
        format: 'esm', target: 'es2022', minify: true, keepNames: true,
        charset: 'utf8', legalComments: 'none', sourcemap: false,
      });
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, result.code);
    }
    for (const file of DECLARATIONS) {
      const source = await checkedFile(root, `src/${file}`);
      const destination = join(staging, 'runtime', file);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, (await readFile(source, 'utf8')).replace(/\r\n/g, '\n'));
    }
    const browserPaths = await browserBuild(root, pkg, staging, entryExports);
    const metadata = Object.fromEntries(METADATA.filter(key => pkg[key] !== undefined).map(key => [key, pkg[key]]));
    metadata.types = './runtime/index.d.ts';
    metadata.exports = Object.fromEntries(Object.entries(pkg.exports).map(([key, value]) => {
      const current = runtimeExport(value);
      return [key, typeof current === 'string' ? { browser: browserPaths.get(key), default: current }
        : { ...(current.types ? { types: current.types } : {}), browser: browserPaths.get(key),
          ...Object.fromEntries(Object.entries(current).filter(([condition]) => !['types', 'browser'].includes(condition))) }];
    }));
    // 只有经过白名单构建的交付包允许公开发布；源码仓库继续保持 private。
    metadata.private = false;
    metadata.publishConfig = { access: 'public', registry: 'https://registry.npmjs.org/' };
    metadata.files = ['runtime/', 'browser/', 'README.md', 'CHANGELOG.md', 'MIGRATION.md'];
    await writeFile(join(staging, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    for (const [source, destination] of [['docs/NPM.md', 'README.md'], ['CHANGELOG.md', 'CHANGELOG.md'], ['MIGRATION.md', 'MIGRATION.md']]) {
      let text = (await readFile(await checkedFile(root, source), 'utf8')).replace(/\r\n/g, '\n');
      if (destination === 'README.md') text = text.replace(/shroom-sdk-\d+\.\d+\.\d+\.tgz/g, `shroom-sdk-${pkg.version}.tgz`);
      await writeFile(join(staging, destination), text);
    }
    const { stdout } = await execute(process.execPath, [await npmCli(), 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {
      cwd: staging, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' },
    });
    const [report] = JSON.parse(stdout);
    const name = `${pkg.name}-${pkg.version}.tgz`;
    assert.equal(report.filename, name, 'npm 打包文件名与 SDK 版本不一致');
    const bytes = await readFile(join(temporary, name));
    verifyNpmArchive(bytes, pkg.version, { requirePublishable: true });
    await mkdir(output, { recursive: true });
    const file = join(output, name);
    await writeFile(file, bytes);
    log(`npm 安装包已生成：${file}（${report.files.length} 个文件，${bytes.length} 字节）`);
    return { file, bytes, report, version: pkg.version };
  } finally {
    const target = resolve(temporary);
    assert.ok(within(temporaryRoot, target) && dirname(target) === temporaryRoot
      && target.startsWith(join(temporaryRoot, 'shroom-npm-pack-')), '只允许清理本次创建的 npm 暂存目录');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  packNpm().catch(error => { console.error(error.message); process.exitCode = 1; });
}
