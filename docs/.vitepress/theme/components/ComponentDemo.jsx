import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'antd'
import { DatabaseOutlined, DownloadOutlined } from '@ant-design/icons'
import i18n from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import {
  ComparePlay,
  DynamicReportCard,
  NoRender,
  PlaybackControls,
  ReportMetrics,
} from '../../../../UI/qxui/index.js'
import {
  AsyncState,
  ChartPanel,
  DraggablePanel,
  Drawer,
  ExportDialog,
  ExportProgressDialog,
  MetricValue,
  PlaybackPlayToggle,
  PlaybackSpeedMenu,
  Select,
  SettingControlRow,
  ToolbarAction,
} from '../../../../UI/shroomui/index.js'
import { TerrainMap } from '../../../../UI/render/index.js'
import { createRendererFrame } from './MatrixRendererDemoUtils.mjs'
import { matrixRendererDemos, ParamsEditor } from './MatrixRendererDemos.jsx'

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: 'zh-CN',
    fallbackLng: 'zh-CN',
    interpolation: { escapeValue: false },
    resources: {
      'zh-CN': {
        translation: {
          pressure_release_average: '平均压力',
          pressure_cont_area_average: '接触面积',
          perUnitArea: '单位面积压力',
          play_speed: '播放倍速',
          zoomOut: '缩小',
          resetZoom: '恢复 100%',
          zoomIn: '放大',
        },
      },
    },
  })
}

const fields = [
  { label: '时间戳', value: 'timestamp' },
  { label: '平均压力', value: 'pressure' },
  { label: '接触面积', value: 'area' },
  { label: '原始矩阵', value: 'raw' },
]

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function createFrame(progress) {
  return Array.from({ length: 64 }, (_, index) => {
    const x = index % 8
    const y = Math.floor(index / 8)
    const wave = Math.sin((x + progress / 8) * 0.8) + Math.cos((y - progress / 10) * 0.7)
    return Math.max(0, Math.round((wave + 2) * 62))
  })
}

function useMockChair() {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(24)
  const [playSpeed, setPlaySpeed] = useState(1)

  useEffect(() => {
    if (!playing) return undefined
    const timer = window.setInterval(() => {
      setProgress((value) => (value >= 100 ? 0 : Math.min(100, value + playSpeed)))
    }, 180)
    return () => window.clearInterval(timer)
  }, [playSpeed, playing])

  return {
    name: '左手压力回放',
    frameData: createFrame(progress),
    frameQueue: {
      meanPressureStr: (108 + progress * 0.42).toFixed(1),
      meanAreaStr: (31 + progress * 0.08).toFixed(1),
      meanContactPressureStr: (3.4 + progress * 0.006).toFixed(2),
    },
    dataLength: 600,
    durationTime: '01:40',
    progressTime: formatTime(progress),
    progress,
    playSpeed,
    playing,
    paused: !playing,
    startPlay: () => setPlaying(true),
    pausePlay: () => setPlaying(false),
    setPlaySpeed,
    setOffset: (offset) => setProgress(Math.max(0, Math.min(100, offset / 6))),
  }
}

function DemoSurface({ children, tone = 'light', compact = false }) {
  return <div className={`sdk-demo-surface sdk-demo-surface--${tone} ${compact ? 'is-compact' : ''}`}>{children}</div>
}

function DynamicReportCardDemo() {
  const chair = useMockChair()
  return <DemoSurface><div className="sdk-demo-report"><DynamicReportCard chair={chair} heatmapWidth={420} /></div></DemoSurface>
}

function ComparePlayDemo() {
  const chair = useMockChair()
  return <DemoSurface><div className="sdk-demo-report"><ComparePlay chair={chair} width={420} /></div></DemoSurface>
}

function PlaybackControlsDemo() {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(35)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    if (!playing) return undefined
    const timer = window.setInterval(() => setProgress((value) => value >= 100 ? 0 : value + speed), 200)
    return () => window.clearInterval(timer)
  }, [playing, speed])

  return (
    <DemoSurface>
      <PlaybackControls
        durationTime="01:40"
        isPlaying={playing}
        onChangeProgress={setProgress}
        onChangeSpeed={setSpeed}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        playSpeed={speed}
        progress={progress}
        progressTime={formatTime(progress)}
        speedLabel={`${speed}x`}
      />
    </DemoSurface>
  )
}

function ReportMetricsDemo() {
  const [pressure, setPressure] = useState(128.5)
  return (
    <DemoSurface compact>
      <ReportMetrics items={[
        { key: 'pressure', label: '平均压力', value: pressure.toFixed(1), unit: 'PA' },
        { key: 'area', label: '接触面积', value: '34.2', unit: 'CM2' },
        { key: 'contact', label: '单位面积压力', value: '3.76', unit: 'PA' },
      ]} />
      <Button onClick={() => setPressure((value) => value >= 140 ? 118.5 : value + 3.5)}>模拟下一帧</Button>
    </DemoSurface>
  )
}

function RenderProbe({ data }) {
  const renders = useRef(0)
  renders.current += 1
  return <div className="sdk-demo-probe">子组件渲染次数：<strong>{renders.current}</strong>，数据首项：{data[0]}</div>
}

function NoRenderDemo() {
  const [data, setData] = useState([10, 20, 30])
  const [, forceUpdate] = useState(0)
  return (
    <DemoSurface compact>
      <NoRender data={data}><RenderProbe data={data} /></NoRender>
      <div className="sdk-demo-actions">
        <Button onClick={() => { data[0] += 1; forceUpdate((value) => value + 1) }}>修改同一引用</Button>
        <Button type="primary" onClick={() => setData((value) => [value[0] + 1, ...value.slice(1)])}>创建新引用</Button>
      </div>
      <p className="sdk-demo-caption">只有新数组引用会让受保护的子组件重新渲染。</p>
    </DemoSurface>
  )
}

function AsyncStateDemo() {
  const [status, setStatus] = useState('loading')
  const messages = { loading: '正在加载串口数据', empty: '暂无采集记录', error: '加载失败，请重试' }
  return (
    <DemoSurface>
      <div className="sdk-demo-segments">
        {['loading', 'empty', 'error'].map((item) => <button key={item} className={status === item ? 'is-active' : ''} onClick={() => setStatus(item)}>{item}</button>)}
      </div>
      <AsyncState status={status} message={messages[status]} actionLabel={status === 'loading' ? undefined : '重试'} onAction={() => setStatus('loading')} />
    </DemoSurface>
  )
}

function ChartPanelDemo() {
  const [dense, setDense] = useState(false)
  const bars = dense ? [58, 72, 46, 84, 66, 91, 78, 55] : [30, 44, 38, 62, 50, 71, 60, 42]
  return (
    <DemoSurface>
      <ChartPanel
        title="实时压力"
        actions={<Button size="small" onClick={() => setDense((value) => !value)}>切换数据</Button>}
        legend={<span className="sdk-demo-legend"><i /> 压力值</span>}
        description="最近 8 帧的平均压力"
        footer="采集频率 12Hz"
      >
        <div className="sdk-demo-bars">{bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
      </ChartPanel>
    </DemoSurface>
  )
}

function DraggablePanelDemo() {
  const [visible, setVisible] = useState(false)
  return (
    <DemoSurface compact>
      <Button type="primary" onClick={() => setVisible(true)} disabled={visible}>创建浮动面板</Button>
      <p className="sdk-demo-caption">创建后拖动标题栏，或使用标题栏右侧按钮缩放。</p>
      {visible ? (
        <DraggablePanel title="串口调试面板" defaultPosition={{ right: 28, bottom: 28 }}>
          <div className="sdk-demo-floating-content">
            <span>COM36 · 已连接</span>
            <Button size="small" onClick={() => setVisible(false)}>移除面板</Button>
          </div>
        </DraggablePanel>
      ) : null}
    </DemoSurface>
  )
}

function DrawerDemo() {
  const [show, setShow] = useState(false)
  return (
    <DemoSurface compact>
      <Button type="primary" onClick={() => setShow(true)}>打开设置抽屉</Button>
      <Drawer show={show} setShow={setShow} title="串口设置" direction="right">
        <div className="sdk-demo-drawer-content">
          <label>端口</label><strong>COM36</strong>
          <label>波特率</label><strong>921600</strong>
          <Button onClick={() => setShow(false)}>完成</Button>
        </div>
      </Drawer>
    </DemoSurface>
  )
}

function ExportDialogDemo() {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('E:\\data\\capture.csv')
  const [format, setFormat] = useState('csv')
  const [selectedFields, setSelectedFields] = useState(['timestamp', 'pressure'])
  return (
    <DemoSurface compact>
      <Button type="primary" onClick={() => setOpen(true)}>配置导出</Button>
      <ExportDialog
        open={open}
        title="导出采集数据"
        path={path}
        pathHint="选择文件格式和需要导出的字段。"
        inputPlaceholder="输出路径"
        browseLabel="浏览"
        format={format}
        formatLabel="文件格式"
        fieldOptions={fields}
        selectedFields={selectedFields}
        fieldsLabel="导出字段"
        selectAllLabel="全选"
        clearLabel="清空"
        confirmText="开始导出"
        cancelText="取消"
        onPathChange={setPath}
        onBrowse={() => setPath('E:\\data\\new-capture.csv')}
        onFormatChange={setFormat}
        onFieldsChange={setSelectedFields}
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </DemoSurface>
  )
}

function ExportProgressDialogDemo() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('downloading')
  const [percent, setPercent] = useState(0)

  useEffect(() => {
    if (!open || status !== 'downloading') return undefined
    const timer = window.setInterval(() => {
      setPercent((value) => {
        if (value >= 90) {
          setStatus('done')
          return 100
        }
        return value + 10
      })
    }, 180)
    return () => window.clearInterval(timer)
  }, [open, status])

  const start = () => { setPercent(0); setStatus('downloading'); setOpen(true) }
  return (
    <DemoSurface compact>
      <Button type="primary" onClick={start}>模拟导出进度</Button>
      <ExportProgressDialog
        open={open}
        title="导出进度"
        status={status}
        percent={percent}
        hint={status === 'done' ? '导出完成' : '正在生成文件'}
        files={status === 'done' ? [{ fileName: 'capture.csv', filePath: 'E:\\data\\capture.csv' }] : []}
        filesLabel="结果文件"
        openFileLabel="打开"
        openFolderLabel="打开目录"
        closeLabel="关闭"
        onOpenFile={() => window.alert('示例：打开 capture.csv')}
        onOpenFolder={() => setOpen(false)}
        onClose={() => setOpen(false)}
      />
    </DemoSurface>
  )
}

function MetricValueDemo() {
  const [value, setValue] = useState(128.4)
  return (
    <DemoSurface compact>
      <MetricValue label="平均压力" value={value} precision={1} unit="PA" indicatorColor="#0072ef" />
      <input className="sdk-demo-range" type="range" min="80" max="180" step="0.1" value={value} onChange={(event) => setValue(Number(event.target.value))} />
    </DemoSurface>
  )
}

function PlaybackPlayToggleDemo() {
  const [paused, setPaused] = useState(true)
  return (
    <DemoSurface compact>
      <div className="sdk-demo-play-toggle"><PlaybackPlayToggle isPaused={paused} onPlay={() => setPaused(false)} onStop={() => setPaused(true)} /></div>
      <span className="sdk-demo-caption">当前状态：{paused ? '已暂停' : '播放中'}</span>
    </DemoSurface>
  )
}

function PlaybackSpeedMenuDemo() {
  const [speed, setSpeed] = useState('1.0')
  return (
    <DemoSurface tone="dark" compact>
      <div className="sdk-demo-speed"><PlaybackSpeedMenu value={speed} onChange={setSpeed} /></div>
      <span>当前倍速：{speed}X</span>
    </DemoSurface>
  )
}

function SelectDemo() {
  const [port, setPort] = useState('COM36')
  const options = useMemo(() => ['COM3', 'COM18', 'COM36', 'Mock'].map((value) => ({ label: value, value })), [])
  return (
    <DemoSurface tone="dark" compact>
      <Select defaultValue={port} options={options} onChange={setPort} getPopupContainer={() => document.body} />
      <span>已选择：{port}</span>
    </DemoSurface>
  )
}

function SettingControlRowDemo() {
  const [value, setValue] = useState(54)
  const [enabled, setEnabled] = useState(true)
  return (
    <DemoSurface tone="dark">
      <SettingControlRow
        label="压力阈值"
        description="低于阈值的数据会被过滤。"
        meta="0-100"
        value={value}
        min={0}
        max={100}
        step={1}
        onChange={(nextValue) => setValue(Number(nextValue) || 0)}
        switchLabel="启用"
        switchChecked={enabled}
        onSwitchChange={setEnabled}
      />
    </DemoSurface>
  )
}

function ToolbarActionDemo() {
  const [active, setActive] = useState(false)
  return (
    <DemoSurface tone="dark" compact>
      <div className="sdk-demo-toolbar">
        <ToolbarAction icon={<DownloadOutlined />} label="导出" onClick={() => window.alert('触发导出')} />
        <ToolbarAction icon={<DatabaseOutlined />} label="采集" active={active} onClick={() => setActive((value) => !value)} />
        <ToolbarAction icon={<DatabaseOutlined />} label="回放" disabled />
      </div>
      <span>采集状态：{active ? '进行中' : '未开始'}</span>
    </DemoSurface>
  )
}

const TERRAIN_MAP_DEFAULTS = {
  rows: 32,
  columns: 32,
  maxValue: 1024,
  heightScale: 4.8,
  height: 460,
  title: 'Glove Pressure Matrix',
  subtitle: '32 x 32 sequential matrix',
  showControls: true,
  showMatrixPreview: true,
  options: {
    viewMode: '3d',
    interpolation: 2,
    smoothing: 0.7,
    wireframe: true,
    autoRotate: false,
    colorScheme: 'terrain',
    gain: 1,
  },
}

function TerrainMapDemo() {
  const [params, setParams] = useState(TERRAIN_MAP_DEFAULTS)
  const matrix = useMemo(() => createRendererFrame('TerrainMap', params), [params])
  return (
    <div className="matrix-renderer-demo">
      <ParamsEditor params={params} defaultParams={TERRAIN_MAP_DEFAULTS} onApply={setParams} />
      <TerrainMap
        data={matrix}
        rows={params.rows}
        columns={params.columns}
        maxValue={params.maxValue}
        heightScale={params.heightScale}
        height={params.height}
        title={params.title}
        subtitle={params.subtitle}
        showControls={params.showControls}
        showMatrixPreview={params.showMatrixPreview}
        options={params.options}
        onOptionsChange={(options) => setParams((current) => ({ ...current, options }))}
      />
    </div>
  )
}

const demos = {
  TerrainMap: TerrainMapDemo,
  ...matrixRendererDemos,
  DynamicReportCard: DynamicReportCardDemo,
  ComparePlay: ComparePlayDemo,
  PlaybackControls: PlaybackControlsDemo,
  ReportMetrics: ReportMetricsDemo,
  NoRender: NoRenderDemo,
  AsyncState: AsyncStateDemo,
  ChartPanel: ChartPanelDemo,
  DraggablePanel: DraggablePanelDemo,
  Drawer: DrawerDemo,
  ExportDialog: ExportDialogDemo,
  ExportProgressDialog: ExportProgressDialogDemo,
  MetricValue: MetricValueDemo,
  PlaybackPlayToggle: PlaybackPlayToggleDemo,
  PlaybackSpeedMenu: PlaybackSpeedMenuDemo,
  Select: SelectDemo,
  SettingControlRow: SettingControlRowDemo,
  ToolbarAction: ToolbarActionDemo,
}

export default function ComponentDemo({ name }) {
  const Demo = demos[name]
  if (!Demo) return <div>未知组件：{name}</div>
  return <I18nextProvider i18n={i18n}><Demo /></I18nextProvider>
}
