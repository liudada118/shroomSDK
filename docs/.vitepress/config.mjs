export default {
  title: 'Shroom SDK',
  description: 'Sensor SDK docs for backend integration, serial experiments, UI components, and display-system metadata.',
  cleanUrls: true,
  themeConfig: {
    logo: null,
    nav: [
      { text: 'Guide', link: '/SDK_GUIDE' },
      { text: 'Serial', link: '/SERIAL_CHAIN' },
      { text: 'UI Components', link: '/UI_COMPONENTS' },
      { text: 'API Reference', link: '/API_REFERENCE' },
    ],
    sidebar: [
      {
        text: '开始',
        items: [
          { text: 'Overview', link: '/' },
          { text: '使用文档', link: '/SDK_GUIDE' },
        ],
      },
      {
        text: '后端与串口',
        items: [
          { text: '后端连接链路', link: '/BACKEND_CLIENT' },
          { text: '本地串口链路', link: '/SERIAL_CHAIN' },
        ],
      },
      {
        text: 'UI 组件',
        items: [
          { text: '组件总览', link: '/UI_COMPONENTS' },
          {
            text: '矩阵渲染 render',
            collapsed: false,
            items: [
              { text: 'TerrainMap', link: '/components/render/terrain-map' },
              { text: 'NumMatrixRenderer', link: '/components/render/num-matrix-renderer' },
              { text: 'PointGridRenderer', link: '/components/render/point-grid-renderer' },
              { text: 'HandPointsRenderer', link: '/components/render/hand-points-renderer' },
              { text: 'WebglHeatmapRenderer', link: '/components/render/webgl-heatmap-renderer' },
              { text: 'BlobHeatmapRenderer', link: '/components/render/blob-heatmap-renderer' },
            ],
          },
          {
            text: '动态报告 qxui',
            collapsed: false,
            items: [
              { text: 'DynamicReportCard', link: '/components/qxui/dynamic-report-card' },
              { text: 'ComparePlay', link: '/components/qxui/compare-play' },
              { text: 'PlaybackControls', link: '/components/qxui/playback-controls' },
              { text: 'ReportMetrics', link: '/components/qxui/report-metrics' },
              { text: 'NoRender', link: '/components/qxui/no-render' },
            ],
          },
          {
            text: '基础组件 shroomui',
            collapsed: false,
            items: [
              { text: 'AsyncState', link: '/components/shroomui/async-state' },
              { text: 'ChartPanel', link: '/components/shroomui/chart-panel' },
              { text: 'DraggablePanel', link: '/components/shroomui/draggable-panel' },
              { text: 'Drawer', link: '/components/shroomui/drawer' },
              { text: 'ExportDialog', link: '/components/shroomui/export-dialog' },
              { text: 'ExportProgressDialog', link: '/components/shroomui/export-progress-dialog' },
              { text: 'MetricValue', link: '/components/shroomui/metric-value' },
              { text: 'PlaybackPlayToggle', link: '/components/shroomui/playback-play-toggle' },
              { text: 'PlaybackSpeedMenu', link: '/components/shroomui/playback-speed-menu' },
              { text: 'Select', link: '/components/shroomui/select' },
              { text: 'SettingControlRow', link: '/components/shroomui/setting-control-row' },
              { text: 'ToolbarAction', link: '/components/shroomui/toolbar-action' },
            ],
          },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'API 总览', link: '/API_REFERENCE' },
        ],
      },
    ],
    socialLinks: [],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Shroom SDK standalone documentation',
      copyright: 'Version 0.2.0',
    },
  },
};
