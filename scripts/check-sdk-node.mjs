/** 检查实际安装的 SDK 依赖与锁文件相符，并加载原生 SQLite/串口模块。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { VERSION_ROOT } from './sdk-version.mjs';

try {
  const sdkRoot = join(VERSION_ROOT);
  const lock = JSON.parse(await readFile(join(sdkRoot, 'package-lock.json'), 'utf8'));
  const require = createRequire(join(sdkRoot, 'package.json'));
  for (const name of ['serialport', 'ws', 'better-sqlite3']) {
    const pkg = JSON.parse(await readFile(join(sdkRoot, 'node_modules', name, 'package.json'), 'utf8'));
    assert.equal(pkg.version, lock.packages[`node_modules/${name}`].version, `${name} 与 SDK 锁文件版本不同`);
    require(name);
  }
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  try { assert.equal(db.prepare('SELECT 1 AS ok').get().ok, 1); } finally { db.close(); }
  console.log('Node SDK：串口、WS、SQLite 依赖版本及原生加载检查通过');
} catch (error) {
  console.error(`${error.message}\n请在 SDK 仓库根目录执行 npm ci，确认原生依赖适用于当前 Node.js。`);
  process.exitCode = 1;
}
