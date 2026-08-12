export {
  default,
  TerrainMap,
  TerrainMapPage,
  TERRAIN_COLOR_SCHEMES,
  bicubicInterpolateMatrix,
  gaussianBlurMatrix,
  getTerrainColor,
  normalizeMatrix,
} from './TerrainMapPage'

export type {
  TerrainColorScheme,
  TerrainMapOptions,
  TerrainMapProps,
  TerrainViewMode,
} from './TerrainMapPage'

export { buildTerrainWireSegments } from './terrainWireGrid.mjs'
export type { TerrainWireGridInput } from './terrainWireGrid.mjs'
