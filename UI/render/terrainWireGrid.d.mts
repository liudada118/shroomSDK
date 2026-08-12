export type TerrainWireGridInput = {
  data: readonly number[]
  dataRows: number
  dataColumns: number
  gridRows: number
  gridColumns: number
  maxValue: number
  gain: number
  heightScale: number
  width?: number
  depth?: number
  threshold?: number
  elevation?: number
}

export function buildTerrainWireSegments(input: TerrainWireGridInput): number[]
