const DEFAULT_THRESHOLD = 0.01
const DEFAULT_ELEVATION = 0.03

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value))
}

function finiteOr(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function positiveIntegerOr(value, fallback) {
  return Math.max(1, Math.floor(finiteOr(value, fallback)))
}

export function buildTerrainWireSegments({
  data,
  dataRows,
  dataColumns,
  gridRows,
  gridColumns,
  maxValue,
  gain,
  heightScale,
  width = 10,
  depth = 10,
  threshold = DEFAULT_THRESHOLD,
  elevation = DEFAULT_ELEVATION,
}) {
  const sourceRows = positiveIntegerOr(dataRows, 1)
  const sourceColumns = positiveIntegerOr(dataColumns, 1)
  const rows = Math.max(2, positiveIntegerOr(gridRows, 2))
  const columns = Math.max(2, positiveIntegerOr(gridColumns, 2))
  const requestedLimit = finiteOr(maxValue, 1)
  const limit = requestedLimit > 0 ? requestedLimit : 1
  const resolvedGain = finiteOr(gain, 1)
  const resolvedHeightScale = finiteOr(heightScale, 4.8)
  const resolvedWidth = finiteOr(width, 10)
  const resolvedDepth = finiteOr(depth, 10)
  const resolvedThreshold = finiteOr(threshold, DEFAULT_THRESHOLD)
  const resolvedElevation = finiteOr(elevation, DEFAULT_ELEVATION)
  const segments = []

  const sample = (row, column) => {
    const sourceRow = Math.round(row / (rows - 1) * (sourceRows - 1))
    const sourceColumn = Math.round(column / (columns - 1) * (sourceColumns - 1))
    const value = Number(data[sourceRow * sourceColumns + sourceColumn])
    return clamp((Number.isFinite(value) ? value : 0) * resolvedGain / limit, 0, 1)
  }

  const position = (row, column, normalized) => [
    (column / (columns - 1) - 0.5) * resolvedWidth,
    normalized * resolvedHeightScale + resolvedElevation,
    (row / (rows - 1) - 0.5) * resolvedDepth,
  ]

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const normalized = sample(row, column)
      if (normalized < resolvedThreshold) continue

      const start = position(row, column, normalized)

      if (column < columns - 1) {
        const right = sample(row, column + 1)
        if (right >= resolvedThreshold) {
          segments.push(...start, ...position(row, column + 1, right))
        }
      }

      if (row < rows - 1) {
        const down = sample(row + 1, column)
        if (down >= resolvedThreshold) {
          segments.push(...start, ...position(row + 1, column, down))
        }
      }
    }
  }

  return segments
}
