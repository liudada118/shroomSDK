import { ReloadOutlined } from '@ant-design/icons'
import React, {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import BlobHeatmapRenderer from '../../../../UI/frontend/renderers/blobHeatmap/react/BlobHeatmapRenderer.jsx'
import HandPointsRenderer from '../../../../UI/frontend/renderers/handPoints/react/HandPointsRenderer.jsx'
import NumMatrixRenderer from '../../../../UI/frontend/renderers/numMatrix/react/NumMatrixRenderer.jsx'
import PointGridRenderer from '../../../../UI/frontend/renderers/pointGrid/react/PointGridRenderer.jsx'
import WebglHeatmapRenderer from '../../../../UI/frontend/renderers/webglHeatmap/react/WebglHeatmapRenderer.jsx'
import { createRendererFrame, parseParamsJson } from './MatrixRendererDemoUtils.mjs'

function useRendererFrame(rendererRef, frame, params) {
  useEffect(() => {
    rendererRef.current?.sitData({ wsPointData: frame }, false)
  }, [frame, params, rendererRef])
}

class RendererErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('Matrix renderer demo failed', error)
  }

  render() {
    if (this.state.failed) {
      return <div className="matrix-renderer-fallback">渲染器初始化失败</div>
    }
    return this.props.children
  }
}

function RendererDemoShell({ editor, controls, children }) {
  return (
    <div className="matrix-renderer-demo">
      {editor}
      <div className="matrix-renderer-toolbar">{controls}</div>
      <div className="matrix-renderer-stage">
        <RendererErrorBoundary>{children}</RendererErrorBoundary>
      </div>
    </div>
  )
}

function formatParams(params) {
  return JSON.stringify(params, null, 2)
}

export function ParamsEditor({ params, defaultParams, onApply }) {
  const [source, setSource] = useState(() => formatParams(params))
  const [error, setError] = useState('')

  useEffect(() => {
    setSource(formatParams(params))
    setError('')
  }, [params])

  const apply = () => {
    try {
      const nextParams = parseParamsJson(source)
      setError('')
      onApply(nextParams)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'params JSON 无效')
    }
  }

  const reset = () => {
    const nextParams = JSON.parse(JSON.stringify(defaultParams))
    setSource(formatParams(nextParams))
    setError('')
    onApply(nextParams)
  }

  return (
    <details className="matrix-params-editor">
      <summary className="matrix-params-editor__summary">
        <strong>params</strong>
        <span>展开编辑 JSON</span>
      </summary>
      <div className="matrix-params-editor__body">
        <textarea
          aria-label="编辑组件 params JSON"
          spellCheck="false"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              apply()
            }
          }}
        />
        <div className="matrix-params-editor__actions">
          <button type="button" className="matrix-params-apply" onClick={apply}>应用参数</button>
          <ResetButton label="重置参数" onClick={reset} />
          {error && <span className="matrix-params-editor__error" role="alert">{error}</span>}
        </div>
      </div>
    </details>
  )
}

const NUM_MATRIX_DEFAULTS = {
  backend: 'canvas2d',
  size: 2,
  gridWidth: 16,
  gridHeight: 16,
  canvasHeightRatio: { compact: 0.6, normal: 0.8 },
  textureValueMax: 255,
  decimalScale: 1,
  filterMin: 0,
  retintOnThresholdChange: true,
  cameraControls: true,
  chartWindow: 60,
  chartPadding: 20,
  pointChartPadding: 20,
  totalChartOffset: 0,
  statsBeforeFilter: true,
  totalMetric: 'sum',
  manageSidebar: false,
  canvas2d: {
    cellWidth: 28,
    cellHeight: 24,
    extraTop: 64,
    fontScale: 16,
    textHeight: 0.2,
    textColorMax: 255,
    colorValueScale: 1,
    blurSigma: 0,
    baseTiltDeg: 0,
    rotationPresets: [0, 0.5235987756, 1.0471975512],
  },
}

const POINT_GRID_DEFAULTS = {
  sit: { num1: 16, num2: 16, interp: 2, order: 4 },
  back: { num1: 16, num2: 32, interp: 2, order: 4 },
  fps: 10,
  separation: 100,
  heightScale: 0.5,
  colorMax: 2560,
  filterMin: 0,
  points: null,
}

const HAND_POINTS_DEFAULTS = {
  sit: { num1: 32, num2: 32, interp: 2, order: 4 },
  fps: 10,
  separation: 100,
  pointTable: 'gloves',
  maskMode: 'gloves',
  interpMode: 'centered',
  maskSource: 'mask',
  pointSize: 0.3125,
  particleScale: [0.0011, 0.0011, 0.0011],
  particlePosition: [1.5, 1.1, 3],
  rotationX: 3.1415926536,
  rotationZ: 3.1415926536,
  maskBlur: 1.2,
  maskThreshold: 50,
  hiddenY: -100000,
  modelUrl: '',
  fingerRotationScale: -1.5707963268,
  pointSprite: null,
}

const WEBGL_HEATMAP_DEFAULTS = {
  dataWidth: 32,
  dataHeight: 32,
  canvasWidth: 512,
  canvasHeight: 512,
  radius: 10,
  max: 1024,
  filter: 0,
  valueScale: 1,
  blurFactor: 0.55,
  displaySize: 'min(100%, 340px)',
  minFrameLength: 1,
  chartWindow: 60,
  edgeClear: null,
  mirrorX: false,
  background: '#05070b',
}

const BLOB_HEATMAP_DEFAULTS = {
  dataWidth: 32,
  dataHeight: 32,
  canvasScale: 0.82,
  radius: 8,
  max: 1024,
  min: 0,
  maxOpacity: 1,
  alphaFloor: 0,
  shadow: true,
  gradient: null,
}

function ResetButton({ label, onClick }) {
  return (
    <button className="matrix-renderer-icon-button" type="button" title={label} aria-label={label} onClick={onClick}>
      <ReloadOutlined />
    </button>
  )
}

function NumMatrixRendererDemo() {
  const rendererRef = useRef(null)
  const [params, setParams] = useState(NUM_MATRIX_DEFAULTS)
  const frame = useMemo(() => createRendererFrame('NumMatrixRenderer', params), [params])
  useRendererFrame(rendererRef, frame, params)

  return (
    <RendererDemoShell editor={<ParamsEditor params={params} defaultParams={NUM_MATRIX_DEFAULTS} onApply={setParams} />} controls={(
      <label className="matrix-renderer-field">
        渲染后端
        <select value={params.backend} onChange={(event) => setParams((current) => ({ ...current, backend: event.target.value }))}>
          <option value="canvas2d">Canvas 2D</option>
          <option value="webgl">WebGL</option>
        </select>
      </label>
    )}>
      <NumMatrixRenderer ref={rendererRef} params={params} />
    </RendererDemoShell>
  )
}

function PointGridRendererDemo() {
  const rendererRef = useRef(null)
  const [params, setParams] = useState(POINT_GRID_DEFAULTS)
  const frame = useMemo(() => createRendererFrame('PointGridRenderer', params), [params])
  useRendererFrame(rendererRef, frame, params)

  return (
    <RendererDemoShell editor={<ParamsEditor params={params} defaultParams={POINT_GRID_DEFAULTS} onApply={setParams} />} controls={(
      <>
        <label className="matrix-renderer-field matrix-renderer-field--range">
          点高度 <output>{params.heightScale}</output>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={params.heightScale}
            onChange={(event) => setParams((current) => ({ ...current, heightScale: Number(event.target.value) }))}
          />
        </label>
        <label className="matrix-renderer-field matrix-renderer-field--range">
          色阶上限 <output>{params.colorMax}</output>
          <input
            type="range"
            min="200"
            max="5000"
            step="20"
            value={params.colorMax}
            onChange={(event) => setParams((current) => ({ ...current, colorMax: Number(event.target.value) }))}
          />
        </label>
        <ResetButton label="重置视角" onClick={() => rendererRef.current?.reset()} />
      </>
    )}>
      <PointGridRenderer ref={rendererRef} params={params} />
    </RendererDemoShell>
  )
}

function HandPointsRendererDemo() {
  const rendererRef = useRef(null)
  const [params, setParams] = useState(HAND_POINTS_DEFAULTS)
  const frame = useMemo(() => createRendererFrame('HandPointsRenderer', params), [params])
  useRendererFrame(rendererRef, frame, params)

  return (
    <RendererDemoShell editor={<ParamsEditor params={params} defaultParams={HAND_POINTS_DEFAULTS} onApply={setParams} />} controls={<ResetButton label="重新校准" onClick={() => rendererRef.current?.resetHand()} />}>
      <HandPointsRenderer ref={rendererRef} params={params} />
    </RendererDemoShell>
  )
}

function WebglHeatmapRendererDemo() {
  const rendererRef = useRef(null)
  const [params, setParams] = useState(WEBGL_HEATMAP_DEFAULTS)
  const frame = useMemo(() => createRendererFrame('WebglHeatmapRenderer', params), [params])
  useRendererFrame(rendererRef, frame, params)

  const updateMax = (value) => {
    setParams((current) => ({ ...current, max: value }))
    rendererRef.current?.sitValue({ valuej: value })
  }

  return (
    <RendererDemoShell editor={<ParamsEditor params={params} defaultParams={WEBGL_HEATMAP_DEFAULTS} onApply={setParams} />} controls={(
      <label className="matrix-renderer-field matrix-renderer-field--range">
            色阶上限 <output>{params.max}</output>
            <input type="range" min="128" max="2048" step="32" value={params.max} onChange={(event) => updateMax(Number(event.target.value))} />
      </label>
    )}>
      <WebglHeatmapRenderer ref={rendererRef} params={params} />
    </RendererDemoShell>
  )
}

function BlobHeatmapRendererDemo() {
  const rendererRef = useRef(null)
  const [params, setParams] = useState(BLOB_HEATMAP_DEFAULTS)
  const frame = useMemo(() => createRendererFrame('BlobHeatmapRenderer', params), [params])
  useRendererFrame(rendererRef, frame, params)

  const updateMax = (value) => {
    setParams((current) => ({ ...current, max: value }))
    rendererRef.current?.sitValue({ valuej: value })
    rendererRef.current?.sitData({ wsPointData: frame }, false)
  }

  return (
    <RendererDemoShell editor={<ParamsEditor params={params} defaultParams={BLOB_HEATMAP_DEFAULTS} onApply={setParams} />} controls={(
      <label className="matrix-renderer-field matrix-renderer-field--range">
            色阶上限 <output>{params.max}</output>
            <input type="range" min="128" max="2048" step="32" value={params.max} onChange={(event) => updateMax(Number(event.target.value))} />
      </label>
    )}>
      <BlobHeatmapRenderer ref={rendererRef} params={params} />
    </RendererDemoShell>
  )
}

export const matrixRendererDemos = {
  NumMatrixRenderer: NumMatrixRendererDemo,
  PointGridRenderer: PointGridRendererDemo,
  HandPointsRenderer: HandPointsRendererDemo,
  WebglHeatmapRenderer: WebglHeatmapRendererDemo,
  BlobHeatmapRenderer: BlobHeatmapRendererDemo,
}
