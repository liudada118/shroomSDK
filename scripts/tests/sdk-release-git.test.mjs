import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { checkReleaseGit, releaseTag } from '../sdk-release-git.mjs';

/** 所有标签只创建在测试自己的临时仓库里，不触碰用户仓库的标签。 */
async function repository(t) {
  const base = resolve(tmpdir());
  const directory = await mkdtemp(join(base, 'shroom-release-git-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(base + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'SDK release tests');
  git('config', 'user.email', 'sdk-tests@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.1.0' }) + '\n');
  git('add', 'package.json');
  git('commit', '--quiet', '-m', 'test release source');
  git('tag', '-a', 'sdk-v0.1.0', '-m', 'test release tag');
  return { directory, git };
}

test('release tag must be an exact stable SDK version, never a branch or arbitrary ref', () => {
  assert.equal(releaseTag('0.1.0', 'refs/tags/sdk-v0.1.0'), 'sdk-v0.1.0');
  for (const [version, ref] of [['0.1.0', 'main'], ['0.1.0', 'refs/heads/sdk-v0.1.0'],
    ['0.1.0', 'sdk-v0.1.1'], ['0.1.0', 'sdk-v0.1.0; touch marker'],
    ['01.1.0', 'sdk-v01.1.0'], ['0.1.0-beta.1', 'sdk-v0.1.0-beta.1']]) {
    assert.throws(() => releaseTag(version, ref));
  }
});

test('annotated SDK tag resolves to the exact clean source commit', async t => {
  const { directory, git } = await repository(t);
  const commit = git('rev-parse', 'HEAD');
  assert.deepEqual(checkReleaseGit({ cwd: directory, ref: 'sdk-v0.1.0', expectedCommit: commit }),
    { version: '0.1.0', tag: 'sdk-v0.1.0', commit });
  assert.throws(() => checkReleaseGit({ cwd: directory, ref: 'sdk-v0.1.0', expectedCommit: '0'.repeat(40) }), /触发工作流/);
});

test('release refuses untracked or modified files and a tag pointing to another commit', async t => {
  const { directory, git } = await repository(t);
  const options = { cwd: directory, ref: 'sdk-v0.1.0', expectedCommit: null };
  await writeFile(join(directory, 'unreleased.txt'), 'new SDK behavior');
  assert.throws(() => checkReleaseGit(options), /未提交或未跟踪/);
  git('add', 'unreleased.txt');
  git('commit', '--quiet', '-m', 'post tag change');
  assert.throws(() => checkReleaseGit(options), /没有指向当前 HEAD/);
  git('tag', '-d', 'sdk-v0.1.0');
  assert.throws(() => checkReleaseGit(options), /找不到本地发布标签/);
});
