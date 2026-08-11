export default {
  title: 'Shroom SDK',
  description: 'Shroom backend SDK documentation for serial capture, backend integration, replay, export, and protocol parsing.',
  lang: 'zh-CN',
  cleanUrls: true,
  themeConfig: {
    siteTitle: 'Shroom SDK',
    search: {
      provider: 'local',
    },
    nav: [
      { text: '快速开始', link: '/getting-started' },
      { text: '使用指南', link: '/guides/backend-client' },
      { text: 'API', link: '/api/backend-sdk-client' },
      { text: '排错', link: '/troubleshooting' },
    ],
    sidebar: [
      {
        text: '开始',
        items: [
          { text: 'SDK 总览', link: '/' },
          { text: '快速开始', link: '/getting-started' },
          { text: '核心概念', link: '/concepts' },
        ],
      },
      {
        text: '使用指南',
        collapsed: false,
        items: [
          { text: '连接主项目后端', link: '/guides/backend-client' },
          { text: '本地串口链路', link: '/guides/local-serial' },
          { text: '协议与 Profiles', link: '/guides/profiles-protocols' },
          { text: '线序处理', link: '/guides/line-order' },
          { text: '采集、回放、导出', link: '/guides/capture-replay-export' },
        ],
      },
      {
        text: 'API Reference',
        collapsed: false,
        items: [
          { text: 'BackendSdkClient', link: '/api/backend-sdk-client' },
          { text: 'ShroomSensorSDK', link: '/api/shroom-sensor-sdk' },
          { text: '协议、存储与服务', link: '/api/services' },
        ],
      },
      {
        text: '支持',
        items: [
          { text: '常见问题', link: '/troubleshooting' },
        ],
      },
    ],
    outline: {
      level: [2, 3],
      label: '本页目录',
    },
    footer: {
      message: 'Standalone SDK documentation for Shroom integrations.',
      copyright: 'Version 0.2.0',
    },
  },
};
