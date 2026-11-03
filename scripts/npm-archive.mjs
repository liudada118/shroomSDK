/** 无第三方依赖的 npm 交付包检查；Release 附件下载后也能独立复核。 */
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';

export function readNpmEntries(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 });
  const entries = new Map();
  const string = (buffer) => buffer.toString('utf8').replace(/\0.*$/s, '');
  let offset = 0;
  let ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      assert.ok(tar.length - offset >= 1024 && tar.subarray(offset).every(byte => byte === 0), 'npm TAR 结束块无效');
      ended = true;
      break;
    }
    const checksum = Number.parseInt(string(header.subarray(148, 156)).trim(), 8);
    const actual = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(checksum, actual, 'npm TAR 文件头校验失败');
    const prefix = string(header.subarray(345, 500));
    const name = (prefix ? prefix + '/' : '') + string(header.subarray(0, 100));
    assert.ok(name.startsWith('package/') && !name.includes('\\') && !name.includes(':'), 'npm TAR 路径无效');
    const path = name.slice(8);
    assert.ok(path && path.split('/').every(part => part && part !== '.' && part !== '..'), 'npm TAR 路径越界');
    const sizeText = string(header.subarray(124, 136)).trim();
    assert.match(sizeText, /^[0-7]+$/, 'npm TAR 文件大小无效');
    const size = Number.parseInt(sizeText, 8);
    const type = header[156];
    assert.ok(type === 0 || type === 48, 'npm TAR 仅接受普通文件，不接受链接或扩展头');
    const start = offset + 512;
    const next = start + Math.ceil(size / 512) * 512;
    assert.ok(next <= tar.length && !entries.has(path), 'npm TAR 文件越界或重复');
    entries.set(path, tar.subarray(start, start + size));
    offset = next;
  }
  assert.ok(ended && entries.size, 'npm TAR 不完整');
  return entries;
}

export function verifyNpmArchive(bytes, expectedVersion, { requirePublishable = false } = {}) {
  const entries = readNpmEntries(bytes);
  for (const path of entries.keys()) {
    assert.ok(/^(?:package\.json|README\.md|CHANGELOG\.md|MIGRATION\.md|LICENSE(?:\.md|\.txt)?)$/.test(path)
      || /^(?:runtime|browser)\/(?:[\w-]+\/)*[\w.-]+\.(?:js|d\.ts)$/.test(path), 'npm 包包含非交付文件：' + path);
    assert.ok(!/(?:^|\/)(?:tests|scripts|examples|node_modules|python|recordings)(?:\/|$)/.test(path), 'npm 包包含开发或数据文件');
  }
  assert.ok(entries.has('package.json') && entries.has('README.md'), 'npm 包缺少安装说明或元数据');
  const pkg = JSON.parse(entries.get('package.json'));
  assert.equal(pkg.name, 'shroom-sdk');
  assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (expectedVersion) assert.equal(pkg.version, expectedVersion, 'npm 包版本与 SDK 不一致');
  assert.equal(pkg.type, 'module');
  // 旧官网 TGZ 保持可安装、可校验；新发布包必须明确指向官方公共注册表。
  assert.ok(pkg.private === true || pkg.private === false, 'npm 包必须明确声明发布范围');
  if (requirePublishable) assert.equal(pkg.private, false, '此安装包未启用 npm 注册表发布');
  if (pkg.private === false) {
    assert.equal(pkg.publishConfig?.access, 'public', 'npm 发布包必须声明 public');
    assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org/', 'npm 发布包必须使用官方注册表');
  }
  assert.ok(!pkg.scripts && !pkg.devDependencies, 'npm 包不能包含开发脚本或依赖');
  function checkTarget(value) {
    if (typeof value === 'string') {
      assert.ok(value.startsWith('./') && entries.has(value.slice(2)), 'npm 包缺少声明入口：' + value);
    } else {
      assert.ok(value && typeof value === 'object', 'npm 导出必须指向交付文件');
      for (const child of Object.values(value)) checkTarget(child);
    }
  }
  assert.ok(pkg.exports?.['./quick-flow'], 'npm 包缺少五函数入口');
  checkTarget(pkg.exports);
  checkTarget(pkg.types?.startsWith('./') ? pkg.types : './' + pkg.types);
  return pkg;
}
