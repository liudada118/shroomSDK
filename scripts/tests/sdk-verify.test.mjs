import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { verifySdk } from '../sdk-verify.mjs';

async function fixture(t) {
  const base = resolve(tmpdir());
  const root = await mkdtemp(join(base, 'shroom-release-gate-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(base + sep));
    await rm(root, { recursive: true, force: true });
  });
  for (const directory of ['tests', 'scripts/tests']) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, 'fixture.test.mjs'), '');
  }
  return root;
}

test('version failure prevents generation, packaging and release work', async (t) => {
  const root = await fixture(t);
  const calls = [];
  await assert.rejects(verifySdk({ root, run: async (_command, args) => {
    calls.push(args); throw new Error('version drift');
  } }), /version drift/);
  assert.deepEqual(calls, [['scripts/sdk-check.mjs']]);
});

test('failed SDK tests stop before packaging and customer installation checks', async (t) => {
  const root = await fixture(t);
  const calls = [];
  await assert.rejects(verifySdk({ root, run: async (_command, args) => {
    calls.push(args);
    if (args.some(arg => arg === 'tests/fixture.test.mjs')) throw new Error('SDK regression');
  } }), /SDK regression/);
  assert.ok(!calls.some(args => args.includes('scripts/pack-sdk.mjs')));
  assert.ok(!calls.some(args => args.includes('scripts/check-sdk-packages.mjs')));
});

test('standalone gate packages only after language and type checks without website dependencies', async (t) => {
  const root = await fixture(t);
  const calls = [];
  await verifySdk({ root, run: async (_command, args) => { calls.push(args); }, log: () => {} });
  const pack = calls.findIndex(args => args.includes('scripts/pack-sdk.mjs'));
  for (const marker of ['tests/fixture.test.mjs', 'scripts/tests/fixture.test.mjs',
    'scripts/sdk-python-tests.mjs', 'node_modules/typescript/bin/tsc']) {
    const index = calls.findIndex(args => args.includes(marker));
    assert.ok(index >= 0 && index < pack, marker);
  }
  assert.ok(calls.findIndex(args => args.includes('verify-latest')) > pack);
  assert.ok(calls.findIndex(args => args.includes('scripts/check-sdk-packages.mjs')) > pack);
  assert.equal(calls.at(-1)[0], 'scripts/check-sdk-packages.mjs');
  assert.ok(!calls.flat().some(arg => /vinext|build-docs|server\/|check-product-workspace/.test(arg)));
});
