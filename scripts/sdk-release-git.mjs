/** 发布前只读检查：SDK 标签必须与包版本、当前提交一致，工作区必须干净。 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** 仅接收稳定版标签，避免把分支名或任意命令文本带入 Git 操作。 */
export function releaseTag(version, ref) {
  if (typeof version !== 'string' || !STABLE_VERSION.test(version)) {
    throw new Error('SDK version 必须是稳定语义版本，例如 0.1.0。');
  }
  const expected = `sdk-v${version}`;
  if (ref !== expected && ref !== `refs/tags/${expected}`) {
    throw new Error(`发布标签必须是 ${expected}，且与 package.json.version 一致。`);
  }
  return expected;
}

/** 不创建、移动或推送标签；将 Git 参数逐项传递，适用于 Windows 与 CI。 */
export function checkReleaseGit({ cwd = ROOT, ref = process.env.GITHUB_REF,
  expectedCommit = process.env.GITHUB_SHA } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  const tag = releaseTag(manifest.version, ref);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let commit;
  let taggedCommit;
  try {
    commit = git('rev-parse', '--verify', 'HEAD^{commit}');
    taggedCommit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  } catch {
    throw new Error(`找不到本地发布标签 ${tag}；CI checkout 需要获取完整标签。`);
  }
  if (taggedCommit !== commit) throw new Error(`标签 ${tag} 没有指向当前 HEAD，拒绝发布其他提交的内容。`);
  if (expectedCommit && expectedCommit !== commit) throw new Error('当前 HEAD 与触发工作流的提交不一致。');
  if (git('status', '--porcelain=v1', '--untracked-files=normal')) {
    throw new Error('发布工作区存在未提交或未跟踪文件，请先提交版本、源码与生成产物。');
  }
  return { version: manifest.version, tag, commit };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length > 3) throw new Error('用法：node scripts/sdk-release-git.mjs [sdk-vX.Y.Z]');
    const result = checkReleaseGit({ ref: process.argv[2] ?? process.env.GITHUB_REF });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
