import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { buildTerrainWireSegments } from './terrainWireGrid.mjs'
import './terrain-map.css'

export type TerrainViewMode = '3d' | 'top' | 'side'
export type TerrainColorScheme = 'terrain' | 'ocean' | 'magma' | 'viridis' | 'thermal'

export type TerrainMapOptions = {
  viewMode: TerrainViewMode
  interpolation: number
  smoothing: number
  wireframe: boolean
  autoRotate: boolean
  colorScheme: TerrainColorScheme
  gain: number
}

export type TerrainMapProps = {
  data: readonly number[]
  rows?: number
  columns?: number
  maxValue?: number
  heightScale?: number
  height?: number | string
  title?: string
  subtitle?: string
  showControls?: boolean
  showMatrixPreview?: boolean
  options?: Partial<TerrainMapOptions>
  defaultOptions?: Partial<TerrainMapOptions>
  onOptionsChange?: (options: TerrainMapOptions) => void
  className?: string
  style?: React.CSSProperties
}

type ColorStop = readonly [position: number, color: string]

export const TERRAIN_COLOR_SCHEMES: Record<TerrainColorScheme, readonly ColorStop[]> = {
  terrain: [
    [0, '#061627'], [0.14, '#007b9e'], [0.3, '#00a878'],
    [0.48, '#8ebd18'], [0.66, '#f2b705'], [0.82, '#f06414'], [1, '#dd2020'],
  ],
  ocean: [
    [0, '#030b1a'], [0.22, '#063b73'], [0.46, '#087da5'],
    [0.7, '#45c2d1'], [1, '#e4fcff'],
  ],
  magma: [
    [0, '#08020d'], [0.22, '#35065f'], [0.46, '#8a174a'],
    [0.7, '#e2541c'], [1, '#ffe16b'],
  ],
  viridis: [
    [0, '#440154'], [0.25, '#3b528b'], [0.5, '#21918c'],
    [0.75, '#5ec962'], [1, '#fde725'],
  ],
  thermal: [
    [0, '#050505'], [0.24, '#29115c'], [0.48, '#a11845'],
    [0.7, '#f36b1b'], [0.86, '#ffd52a'], [1, '#fff7d6'],
  ],
}

const DEFAULT_OPTIONS: TerrainMapOptions = {
  viewMode: '3d',
  interpolation: 2,
  smoothing: 0.8,
  wireframe: true,
  autoRotate: false,
  colorScheme: 'terrain',
  gain: 1,
}

function finiteOrZero(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

export function normalizeMatrix(
  data: readonly number[],
  rows: number,
  columns: number,
) {
  const size = Math.max(1, rows) * Math.max(1, columns)
  return Array.from({ length: size }, (_, index) => finiteOrZero(data[index]))
}

function createGaussianKernel(sigma: number) {
  if (sigma <= 0) return [1]
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const denominator = 2 * sigma * sigma
  return Array.from({ length: radius * 2 + 1 }, (_, index) => {
    const distance = index - radius
    return Math.exp(-(distance * distance) / denominator)
  })
}

export function gaussianBlurMatrix(
  data: readonly number[],
  rows: number,
  columns: number,
  sigma: number,
) {
  const source = normalizeMatrix(data, rows, columns)
  if (sigma <= 0) return source

  const kernel = createGaussianKernel(sigma)
  const radius = Math.floor(kernel.length / 2)
  const horizontal = new Array(source.length).fill(0)
  const output = new Array(source.length).fill(0)

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0
      let weight = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleColumn = Math.max(0, Math.min(columns - 1, column + offset))
        const sampleWeight = kernel[offset + radius]
        sum += source[row * columns + sampleColumn] * sampleWeight
        weight += sampleWeight
      }
      horizontal[row * columns + column] = weight ? sum / weight : 0
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0
      let weight = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleRow = Math.max(0, Math.min(rows - 1, row + offset))
        const sampleWeight = kernel[offset + radius]
        sum += horizontal[sampleRow * columns + column] * sampleWeight
        weight += sampleWeight
      }
      output[row * columns + column] = weight ? sum / weight : 0
    }
  }

  return output
}

function cubicWeight(distance: number) {
  const coefficient = -0.5
  const absolute = Math.abs(distance)
  if (absolute <= 1) {
    return (coefficient + 2) * absolute ** 3 - (coefficient + 3) * absolute ** 2 + 1
  }
  if (absolute < 2) {
    return coefficient * absolute ** 3 - 5 * coefficient * absolute ** 2 + 8 * coefficient * absolute - 4 * coefficient
  }
  return 0
}

export function bicubicInterpolateMatrix(
  data: readonly number[],
  rows: number,
  columns: number,
  scale: number,
) {
  const factor = Math.max(1, Math.round(scale))
  const source = normalizeMatrix(data, rows, columns)
  if (factor === 1) return { data: source, rows, columns }

  const outputRows = rows * factor
  const outputColumns = columns * factor
  const output = new Array(outputRows * outputColumns).fill(0)

  for (let outputRow = 0; outputRow < outputRows; outputRow += 1) {
    for (let outputColumn = 0; outputColumn < outputColumns; outputColumn += 1) {
      const sourceX = outputColumns === 1 ? 0 : outputColumn * (columns - 1) / (outputColumns - 1)
      const sourceY = outputRows === 1 ? 0 : outputRow * (rows - 1) / (outputRows - 1)
      const baseX = Math.floor(sourceX)
      const baseY = Math.floor(sourceY)
      const fractionX = sourceX - baseX
      const fractionY = sourceY - baseY
      let sum = 0
      let weightSum = 0

      for (let deltaY = -1; deltaY <= 2; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 2; deltaX += 1) {
          const sampleX = Math.max(0, Math.min(columns - 1, baseX + deltaX))
          const sampleY = Math.max(0, Math.min(rows - 1, baseY + deltaY))
          const weight = cubicWeight(fractionX - deltaX) * cubicWeight(fractionY - deltaY)
          sum += source[sampleY * columns + sampleX] * weight
          weightSum += weight
        }
      }

      output[outputRow * outputColumns + outputColumn] = Math.max(0, weightSum ? sum / weightSum : 0)
    }
  }

  return { data: output, rows: outputRows, columns: outputColumns }
}

export function getTerrainColor(value: number, scheme: TerrainColorScheme) {
  const normalized = Math.max(0, Math.min(1, value))
  const stops = TERRAIN_COLOR_SCHEMES[scheme] || TERRAIN_COLOR_SCHEMES.terrain
  let start = stops[0]
  let end = stops[stops.length - 1]

  for (let index = 0; index < stops.length - 1; index += 1) {
    if (normalized >= stops[index][0] && normalized <= stops[index + 1][0]) {
      start = stops[index]
      end = stops[index + 1]
      break
    }
  }

  const range = end[0] - start[0]
  const ratio = range > 0 ? (normalized - start[0]) / range : 0
  return new THREE.Color(start[1]).lerp(new THREE.Color(end[1]), ratio)
}

function TerrainSurface({
  data,
  rows,
  columns,
  options,
  maxValue,
  heightScale,
}: {
  data: readonly number[]
  rows: number
  columns: number
  options: TerrainMapOptions
  maxValue: number
  heightScale: number
}) {
  const { geometry, wireGeometry } = useMemo(() => {
    const blurred = gaussianBlurMatrix(data, rows, columns, options.smoothing)
    const prepared = bicubicInterpolateMatrix(blurred, rows, columns, options.interpolation)
    const mesh = new THREE.PlaneGeometry(10, 10, prepared.columns - 1, prepared.rows - 1)
    mesh.rotateX(-Math.PI / 2)
    const positions = mesh.getAttribute('position') as THREE.BufferAttribute
    const colors = new Float32Array(positions.count * 3)

    for (let index = 0; index < positions.count; index += 1) {
      const normalized = Math.max(0, Math.min(1, prepared.data[index] * options.gain / maxValue))
      const color = getTerrainColor(normalized, options.colorScheme)
      positions.setY(index, normalized * heightScale)
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
    }

    mesh.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    mesh.computeVertexNormals()
    positions.needsUpdate = true

    const wireSegments = buildTerrainWireSegments({
      data: prepared.data,
      dataRows: prepared.rows,
      dataColumns: prepared.columns,
      gridRows: rows,
      gridColumns: columns,
      maxValue,
      gain: options.gain,
      heightScale,
    })
    const wire = new THREE.BufferGeometry()
    wire.setAttribute('position', new THREE.Float32BufferAttribute(wireSegments, 3))

    return { geometry: mesh, wireGeometry: wire }
  }, [columns, data, heightScale, maxValue, options, rows])

  useEffect(() => () => {
    geometry.dispose()
    wireGeometry.dispose()
  }, [geometry, wireGeometry])

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          vertexColors
          side={THREE.DoubleSide}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {options.wireframe ? (
        <lineSegments geometry={wireGeometry}>
          <lineBasicMaterial
            color="#e0f0ff"
            opacity={0.55}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      ) : null}
    </group>
  )
}

function SceneFloor() {
  return (
    <group position={[0, -0.025, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 12]} />
        <meshBasicMaterial color="#0c1822" />
      </mesh>
      <gridHelper args={[12, 32, '#25475b', '#142a37']} position={[0, 0.015, 0]} />
    </group>
  )
}

function CameraController({ mode, autoRotate }: { mode: TerrainViewMode; autoRotate: boolean }) {
  const { camera } = useThree()

  useEffect(() => {
    const positions: Record<TerrainViewMode, [number, number, number]> = {
      '3d': [9, 8, 9],
      top: [0, 15, 0.01],
      side: [15, 3, 0],
    }
    camera.position.set(...positions[mode])
    camera.lookAt(0, 1.5, 0)
  }, [camera, mode])

  return (
    <OrbitControls
      autoRotate={autoRotate}
      autoRotateSpeed={-1.4}
      dampingFactor={0.06}
      enableDamping
      maxDistance={25}
      minDistance={4}
      target={[0, 1.5, 0]}
    />
  )
}

function MatrixPreview({
  data,
  rows,
  columns,
  maxValue,
  colorScheme,
}: {
  data: readonly number[]
  rows: number
  columns: number
  maxValue: number
  colorScheme: TerrainColorScheme
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const scale = Math.max(2, Math.floor(240 / Math.max(rows, columns)))
    canvas.width = columns * scale
    canvas.height = rows * scale
    context.fillStyle = '#071018'
    context.fillRect(0, 0, canvas.width, canvas.height)

    normalizeMatrix(data, rows, columns).forEach((value, index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const color = getTerrainColor(value / maxValue, colorScheme)
      context.fillStyle = `#${color.getHexString()}`
      context.fillRect(column * scale, row * scale, scale, scale)
    })
  }, [colorScheme, columns, data, maxValue, rows])

  return <canvas ref={canvasRef} className="shroom-terrain__matrix" aria-label={`${rows} × ${columns} 矩阵预览`} />
}

function resolveMaxValue(data: readonly number[], explicitMax?: number) {
  if (explicitMax && explicitMax > 0) return explicitMax
  const detected = data.reduce((maximum, value) => Math.max(maximum, finiteOrZero(value)), 0)
  return Math.max(1, detected)
}

export function TerrainMap({
  data,
  rows = 32,
  columns = 32,
  maxValue,
  heightScale = 4.8,
  height = 620,
  title = '3D Pressure Terrain Map',
  subtitle = '矩阵压力三维地形渲染',
  showControls = true,
  showMatrixPreview = true,
  options,
  defaultOptions,
  onOptionsChange,
  className = '',
  style,
}: TerrainMapProps) {
  const [localOptions, setLocalOptions] = useState<TerrainMapOptions>({
    ...DEFAULT_OPTIONS,
    ...defaultOptions,
  })
  const resolvedOptions = useMemo(() => ({ ...localOptions, ...options }), [localOptions, options])
  const normalizedRows = Math.max(2, Math.floor(rows))
  const normalizedColumns = Math.max(2, Math.floor(columns))
  const normalizedData = useMemo(
    () => normalizeMatrix(data, normalizedRows, normalizedColumns),
    [data, normalizedColumns, normalizedRows],
  )
  const resolvedMaxValue = resolveMaxValue(normalizedData, maxValue)
  const stats = useMemo(() => {
    const activeValues = normalizedData.filter((value) => value > 0)
    const maximum = normalizedData.reduce((result, value) => Math.max(result, value), 0)
    const total = normalizedData.reduce((result, value) => result + value, 0)
    return {
      active: activeValues.length,
      average: activeValues.length ? total / activeValues.length : 0,
      maximum,
    }
  }, [normalizedData])

  const updateOption = <Key extends keyof TerrainMapOptions>(key: Key, value: TerrainMapOptions[Key]) => {
    const next = { ...resolvedOptions, [key]: value }
    setLocalOptions(next)
    onOptionsChange?.(next)
  }

  const rootStyle = {
    ...style,
    '--shroom-terrain-height': typeof height === 'number' ? `${height}px` : height,
  } as React.CSSProperties

  return (
    <section className={`shroom-terrain ${className}`.trim()} style={rootStyle}>
      <header className="shroom-terrain__header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <dl className="shroom-terrain__summary">
          <div><dt>峰值</dt><dd>{stats.maximum.toFixed(1)}</dd></div>
          <div><dt>有效点</dt><dd>{stats.active}</dd></div>
          <div><dt>平均值</dt><dd>{stats.average.toFixed(1)}</dd></div>
        </dl>
      </header>

      {showControls ? (
        <div className="shroom-terrain__toolbar" aria-label="矩阵渲染设置">
          <div className="shroom-terrain__segmented" aria-label="视角">
            {(['3d', 'top', 'side'] as TerrainViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={resolvedOptions.viewMode === mode ? 'is-active' : ''}
                onClick={() => updateOption('viewMode', mode)}
              >
                {mode === '3d' ? '3D' : mode === 'top' ? '俯视' : '侧视'}
              </button>
            ))}
          </div>

          <label>
            配色
            <select
              value={resolvedOptions.colorScheme}
              onChange={(event) => updateOption('colorScheme', event.target.value as TerrainColorScheme)}
            >
              {Object.keys(TERRAIN_COLOR_SCHEMES).map((scheme) => (
                <option key={scheme} value={scheme}>{scheme}</option>
              ))}
            </select>
          </label>

          <label>
            插值
            <select
              value={resolvedOptions.interpolation}
              onChange={(event) => updateOption('interpolation', Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}x</option>)}
            </select>
          </label>

          <label className="shroom-terrain__range">
            平滑 {resolvedOptions.smoothing.toFixed(1)}
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={resolvedOptions.smoothing}
              onChange={(event) => updateOption('smoothing', Number(event.target.value))}
            />
          </label>

          <label className="shroom-terrain__range">
            增益 {resolvedOptions.gain.toFixed(1)}x
            <input
              type="range"
              min="0.2"
              max="3"
              step="0.1"
              value={resolvedOptions.gain}
              onChange={(event) => updateOption('gain', Number(event.target.value))}
            />
          </label>

          <label className="shroom-terrain__check">
            <input
              type="checkbox"
              checked={resolvedOptions.wireframe}
              onChange={(event) => updateOption('wireframe', event.target.checked)}
            />
            网格
          </label>

          <label className="shroom-terrain__check">
            <input
              type="checkbox"
              checked={resolvedOptions.autoRotate}
              onChange={(event) => updateOption('autoRotate', event.target.checked)}
            />
            旋转
          </label>
        </div>
      ) : null}

      <div className={`shroom-terrain__content ${showMatrixPreview ? '' : 'is-full'}`}>
        <div className="shroom-terrain__scene" data-terrain-scene>
          <Canvas
            camera={{ position: [9, 8, 9], fov: 40, near: 0.1, far: 100 }}
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          >
            <color attach="background" args={['#071018']} />
            <fog attach="fog" args={['#071018', 24, 42]} />
            <CameraController mode={resolvedOptions.viewMode} autoRotate={resolvedOptions.autoRotate} />
            <TerrainSurface
              data={normalizedData}
              rows={normalizedRows}
              columns={normalizedColumns}
              options={resolvedOptions}
              maxValue={resolvedMaxValue}
              heightScale={heightScale}
            />
            <SceneFloor />
          </Canvas>
          <span className="shroom-terrain__scene-hint">拖动旋转 · 滚轮缩放</span>
        </div>

        {showMatrixPreview ? (
          <aside className="shroom-terrain__aside">
            <div className="shroom-terrain__aside-title">
              <span>Matrix</span>
              <strong>{normalizedRows} × {normalizedColumns}</strong>
            </div>
            <MatrixPreview
              data={normalizedData}
              rows={normalizedRows}
              columns={normalizedColumns}
              maxValue={resolvedMaxValue}
              colorScheme={resolvedOptions.colorScheme}
            />
            <p>矩阵预览使用协议解析和线序归一化后的原始帧，不使用插值后的地形数据。</p>
          </aside>
        ) : null}
      </div>
    </section>
  )
}

export default TerrainMap
