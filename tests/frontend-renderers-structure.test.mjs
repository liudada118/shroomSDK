import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const rendererNames = ['numMatrix', 'pointGrid', 'handPoints', 'webglHeatmap', 'blobHeatmap']

test('renderer families live beside frontend core', () => {
  assert.equal(existsSync(new URL('../UI/renderers', import.meta.url)), false)

  for (const name of rendererNames) {
    assert.equal(
      existsSync(new URL(`../UI/frontend/renderers/${name}/core/index.js`, import.meta.url)),
      true,
    )
    assert.equal(
      existsSync(new URL(`../UI/frontend/renderers/${name}/react`, import.meta.url)),
      true,
    )
  }
})

test('frontend package exposes core and renderer entry points', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../UI/frontend/package.json', import.meta.url), 'utf8'),
  )

  assert.equal(pkg.type, 'module')
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./core'], './core/index.js')
  assert.equal(pkg.exports['./renderers'], './renderers/index.js')
  assert.equal(pkg.exports['./renderers/*'], './renderers/*')
  assert.equal(pkg.files, undefined)
  const npmIgnore = readFileSync(
    new URL('../UI/frontend/.npmignore', import.meta.url),
    'utf8',
  )
  assert.match(npmIgnore, /^docs\/$/m)
  assert.match(npmIgnore, /^\*\*\/\*\.test\.js$/m)
})

test('root package uses explicit UI publish paths', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )

  assert.equal(pkg.files.includes('UI'), false)
  for (const path of [
    'UI/index.js',
    'UI/package.json',
    'UI/qxui',
    'UI/render',
    'UI/shroomui',
    'UI/frontend/index.js',
    'UI/frontend/package.json',
    'UI/frontend/core',
    'UI/frontend/renderers',
    'UI/frontend/styles',
  ]) {
    assert.ok(pkg.files.includes(path), `missing publish path: ${path}`)
  }

  const frontendIgnore = readFileSync(
    new URL('../UI/frontend/.npmignore', import.meta.url),
    'utf8',
  )
  const renderIgnore = readFileSync(
    new URL('../UI/render/.npmignore', import.meta.url),
    'utf8',
  )
  const coreIgnore = readFileSync(
    new URL('../UI/frontend/core/.npmignore', import.meta.url),
    'utf8',
  )
  const renderersIgnore = readFileSync(
    new URL('../UI/frontend/renderers/.npmignore', import.meta.url),
    'utf8',
  )
  assert.match(frontendIgnore, /^docs\/$/m)
  assert.match(frontendIgnore, /^\*\*\/\*\.test\.js$/m)
  assert.match(renderIgnore, /^prototypes\/$/m)
  assert.match(coreIgnore, /^\*\.test\.js$/m)
  assert.match(renderersIgnore, /^\*\*\/\*\.test\.js$/m)
})
