import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('publishes runtime sources without the documentation site', () => {
  const rootPackage = JSON.parse(read('package.json'))
  const frontendPackage = JSON.parse(read('UI/frontend/package.json'))

  assert.equal(rootPackage.files.includes('docs'), false)
  assert.equal(rootPackage.peerDependencies.three, '>=0.152.0')
  assert.equal(frontendPackage.peerDependencies.three, '>=0.152.0')
})

test('uses an explicit opt-in URL for the optional hand model', () => {
  const params = read('UI/frontend/renderers/handPoints/core/params.js')
  const renderer = read('UI/frontend/renderers/handPoints/react/HandPointsRenderer.jsx')

  assert.match(params, /modelUrl: typeof params\.modelUrl === 'string' \? params\.modelUrl : ''/)
  assert.match(renderer, /effectDisposed/)
})

test('sizes renderer surfaces from their host containers', () => {
  const hand = read('UI/frontend/renderers/handPoints/react/HandPointsRenderer.jsx')
  const webgl = read('UI/frontend/renderers/webglHeatmap/react/WebglHeatmapRenderer.jsx')
  const blob = read('UI/frontend/renderers/blobHeatmap/react/BlobHeatmapRenderer.jsx')

  assert.match(hand, /new ResizeObserver\(onWindowResize\)/)
  assert.match(blob, /new ResizeObserver\(resizeCanvas\)/)
  assert.match(webgl, /maxWidth: '100%'/)
  assert.match(webgl, /maxHeight: '100%'/)
  for (const source of [webgl, blob]) {
    assert.doesNotMatch(source, /100vw|100vh/)
  }
})
