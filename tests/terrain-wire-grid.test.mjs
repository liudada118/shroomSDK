import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTerrainWireSegments } from '../UI/render/terrainWireGrid.mjs'

test('builds horizontal and vertical base-grid edges without triangle diagonals', () => {
  const segments = buildTerrainWireSegments({
    data: [255, 255, 255, 255],
    dataRows: 2,
    dataColumns: 2,
    gridRows: 2,
    gridColumns: 2,
    maxValue: 255,
    gain: 1,
    heightScale: 4,
  })

  assert.equal(segments.length, 24)
  assert.deepEqual(Array.from(segments), [
    -5, 4.03, -5, 5, 4.03, -5,
    -5, 4.03, -5, -5, 4.03, 5,
    5, 4.03, -5, 5, 4.03, 5,
    -5, 4.03, 5, 5, 4.03, 5,
  ])
})

test('does not connect a grid edge through an inactive cell', () => {
  const segments = buildTerrainWireSegments({
    data: [255, 255, 0, 0],
    dataRows: 2,
    dataColumns: 2,
    gridRows: 2,
    gridColumns: 2,
    maxValue: 255,
    gain: 1,
    heightScale: 4,
  })

  assert.deepEqual(Array.from(segments), [-5, 4.03, -5, 5, 4.03, -5])
})

test('keeps wire density at the base grid when surface data is interpolated', () => {
  const segments = buildTerrainWireSegments({
    data: new Array(16).fill(255),
    dataRows: 4,
    dataColumns: 4,
    gridRows: 2,
    gridColumns: 2,
    maxValue: 255,
    gain: 1,
    heightScale: 4,
  })

  assert.equal(segments.length / 6, 4)
})

test('supports rectangular base grids', () => {
  const segments = buildTerrainWireSegments({
    data: new Array(6).fill(255),
    dataRows: 2,
    dataColumns: 3,
    gridRows: 2,
    gridColumns: 3,
    maxValue: 255,
    gain: 1,
    heightScale: 4,
  })

  assert.equal(segments.length / 6, 7)
})

test('includes points exactly at the threshold and excludes points below it', () => {
  const atThreshold = buildTerrainWireSegments({
    data: new Array(4).fill(1),
    dataRows: 2,
    dataColumns: 2,
    gridRows: 2,
    gridColumns: 2,
    maxValue: 100,
    gain: 1,
    heightScale: 4,
  })
  const belowThreshold = buildTerrainWireSegments({
    data: new Array(4).fill(0.999),
    dataRows: 2,
    dataColumns: 2,
    gridRows: 2,
    gridColumns: 2,
    maxValue: 100,
    gain: 1,
    heightScale: 4,
  })

  assert.equal(atThreshold.length / 6, 4)
  assert.equal(belowThreshold.length, 0)
})

test('uses finite defaults when optional numeric values are invalid', () => {
  const segments = buildTerrainWireSegments({
    data: new Array(4).fill(1),
    dataRows: 2,
    dataColumns: 2,
    gridRows: 2,
    gridColumns: 2,
    maxValue: 1,
    gain: Number.NaN,
    heightScale: Number.NaN,
    width: Number.NaN,
    depth: Number.NaN,
    threshold: Number.NaN,
    elevation: Number.NaN,
  })

  assert.equal(segments.length / 6, 4)
  assert.ok(segments.every(Number.isFinite))
})
