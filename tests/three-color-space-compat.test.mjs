import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const rendererFiles = [
  '../UI/frontend/renderers/pointGrid/react/PointGridRenderer.jsx',
  '../UI/frontend/renderers/handPoints/react/HandPointsRenderer.jsx',
]

test('Three renderers use the current output color-space API', () => {
  for (const file of rendererFiles) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /outputEncoding|sRGBEncoding/)
    assert.match(source, /outputColorSpace\s*=\s*THREE\.SRGBColorSpace/)
  }
})
