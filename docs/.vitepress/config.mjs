export default {
  title: 'Shroom SDK',
  description: 'Sensor SDK docs for backend integration, serial experiments, and display-system metadata.',
  cleanUrls: true,
  themeConfig: {
    logo: null,
    nav: [
      { text: 'Guide', link: '/SDK_GUIDE' },
      { text: 'API', link: '/API_REFERENCE' },
      { text: 'Serial Chain', link: '/SERIAL_CHAIN' },
      { text: 'Backend Client', link: '/BACKEND_CLIENT' },
    ],
    sidebar: [
      {
        text: 'SDK Docs',
        items: [
          { text: 'Overview', link: '/' },
          { text: '使用文档', link: '/SDK_GUIDE' },
          { text: 'API Reference', link: '/API_REFERENCE' },
          { text: '本地串口链路', link: '/SERIAL_CHAIN' },
          { text: '后端连接链路', link: '/BACKEND_CLIENT' },
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
