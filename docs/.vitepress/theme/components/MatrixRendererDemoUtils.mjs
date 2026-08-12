const DEFAULT_DIMENSIONS = {
  NumMatrixRenderer: [16, 16],
  PointGridRenderer: [16, 16],
  HandPointsRenderer: [32, 32],
  WebglHeatmapRenderer: [32, 32],
  BlobHeatmapRenderer: [32, 32],
  TerrainMap: [32, 32],
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

export function createSequentialFrame(length) {
  const size = positiveInteger(length, 0)
  return Array.from({ length: size }, (_, index) => index + 1)
}

export function parseParamsJson(source) {
  const value = JSON.parse(source)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('params 必须是 JSON 对象')
  }
  return value
}

export function createRendererFrame(rendererName, params = {}) {
  const fallback = DEFAULT_DIMENSIONS[rendererName] || [1, 1]
  let width
  let height

  if (rendererName === 'TerrainMap') {
    width = positiveInteger(params.columns, fallback[0])
    height = positiveInteger(params.rows, fallback[1])
  } else if (rendererName === 'NumMatrixRenderer') {
    width = positiveInteger(params.gridWidth, fallback[0])
    height = positiveInteger(params.gridHeight, fallback[1])
  } else if (rendererName === 'PointGridRenderer' || rendererName === 'HandPointsRenderer') {
    width = positiveInteger(params.sit?.num2, fallback[0])
    height = positiveInteger(params.sit?.num1, fallback[1])
  } else {
    width = positiveInteger(params.dataWidth, fallback[0])
    height = positiveInteger(params.dataHeight, fallback[1])
  }

  return createSequentialFrame(width * height)
}
