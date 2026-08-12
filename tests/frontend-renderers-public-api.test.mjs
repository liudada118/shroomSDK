import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { listRenderers, resetRendererRegistry } from '../UI/frontend/core/registry.js'
import { registerBuiltinRenderers } from '../UI/frontend/renderers/index.js'

test('UI package exposes frontend renderer namespaces', () => {
  const source = readFileSync(new URL('../UI/index.js', import.meta.url), 'utf8')

  assert.match(source, /export \* as Frontend from '\.\/frontend\/index\.js'/)
  assert.match(source, /export \* as MatrixRenderers from '\.\/frontend\/renderers\/index\.js'/)
})

test('registers five matrix renderers idempotently', () => {
  resetRendererRegistry()
  assert.equal(registerBuiltinRenderers(), 5)
  assert.deepEqual(
    listRenderers().map(({ id }) => id).sort(),
    ['blobHeatmap', 'handPoints', 'numMatrix', 'pointGrid', 'webglHeatmap'],
  )
  assert.equal(registerBuiltinRenderers(), 5)
  assert.equal(listRenderers().length, 5)
})
