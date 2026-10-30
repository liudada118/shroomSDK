/**
 * Node 授权辅助入口：从环境变量或文件读取密钥，在用户目录保存稳定安装标识。
 * 示例需主动调用此函数；仅导入 SDK 不会读取环境变量或自动激活。
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { activateLicense } from '../core/license.js';

/**
 * SHROOM_LICENSE_KEY 优先于 SHROOM_LICENSE_FILE；SHROOM_DEVICE_ID 可覆盖本机安装标识。
 * 默认在线模式，SHROOM_LICENSE_MODE=offline 使用离线验证；可另配服务地址和公钥文件。
 * 返回核心 activateLicense 的 Promise；文件读取错误及授权失败由调用方捕获。
 */
export async function activateLicenseFromEnv() {
  const key = process.env.SHROOM_LICENSE_KEY ?? (process.env.SHROOM_LICENSE_FILE
    ? await readFile(process.env.SHROOM_LICENSE_FILE, 'utf8') : '');
  if (!key.trim()) return activateLicense('');
  let deviceId = process.env.SHROOM_DEVICE_ID;
  if (!deviceId) {
    const directory = join(homedir(), '.shroom-sdk');
    const path = join(directory, 'device-id');
    await mkdir(directory, { recursive: true });
    try { deviceId = (await readFile(path, 'utf8')).trim(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const candidate = randomBytes(32).toString('hex');
      // 独占创建避免并发进程覆盖同一电脑的标识；随后统一读取最终已存在的文件。
      try { await writeFile(path, candidate, { flag: 'wx', mode: 0o600 }); }
      catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; }
      deviceId = (await readFile(path, 'utf8')).trim();
    }
  }
  return activateLicense(key.trim(), {
    mode: process.env.SHROOM_LICENSE_MODE ?? 'online',
    ...(process.env.SHROOM_LICENSE_SERVER ? { serverUrl: process.env.SHROOM_LICENSE_SERVER } : {}), deviceId,
    ...(process.env.SHROOM_LICENSE_PUBLIC_KEY_FILE
      ? { publicKey: await readFile(process.env.SHROOM_LICENSE_PUBLIC_KEY_FILE, 'utf8') } : {}),
  });
}
