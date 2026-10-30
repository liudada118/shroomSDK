import { createProductCall } from './product-call.js';

/** 同一条调用链：Node 负责设备与 WS，浏览器复用 stream 控制录制并下载。 */
export function createProductFlow(options) {
  const readCode = createProductCall({ ...options, env: 'node', quickFlow: true });
  const glove = options.product === 'glove';
  return [
    {
      id: 'flow-read', title: '取数',
      blocks: [{ runtime: 'node', code: readCode }],
      note: 'onData 持续返回产品帧；这一步已开始读取设备，还没有保存采集记录。',
    },
    {
      id: 'flow-ws', title: '创建 WS',
      blocks: [
        { runtime: 'node', code: [
          "import { createWS } from './quick-flow.js';", '',
          'const server = await createWS(device, { port: 19999 });',
          'console.log(server.url); // ws://127.0.0.1:19999',
          '// 退出时 await server.close()，会等待文件写完并释放设备。',
        ].join('\n') },
        { runtime: 'web', code: [
          "import { readProduct, startRecording, stopRecording, downloadRecording } from './quick-flow.js';", '',
          '// 浏览器连接一次，后面三步复用同一个 stream。',
          'const stream = await readProduct({',
          "  url: 'ws://127.0.0.1:19999',",
          glove ? '  onData: data => console.log(data.fingers, data.palm, data.imu),' : '  onData: data => console.log(data.pressureMatrix, data.values),',
          '  onError: error => console.error(error.code, error.message),',
          '});',
          '// SDK 内部保存本次停止的记录 ID，下载时无需手动管理。',
        ].join('\n') },
      ],
      note: '先在 Node 创建服务，再从同一台电脑的 http://localhost 网页连接。HTTPS 部署需另配 WSS。',
    },
    {
      id: 'flow-start', title: '开始采集',
      blocks: [{ runtime: 'web', code: [
        '// 放在“开始采集”按钮的点击处理中。',
        'const session = await startRecording(stream, { label: \'本次采集\' });',
        'console.log(session.id); // 本次采集的唯一记录 ID',
      ].join('\n') }],
      note: '从此刻开始将收到的帧保存到 Node 端。不要在页面初始化时立即连续执行开始和停止。',
    },
    {
      id: 'flow-stop', title: '停止采集',
      blocks: [{ runtime: 'web', code: [
        '// 放在“停止采集”按钮的点击处理中。',
        'const recording = await stopRecording(stream);',
        'console.log(recording.id); // 等待本次记录写入完成',
      ].join('\n') }],
      note: '停止保存这次记录；设备取数和 WS 仍保持连接。SDK 记住本次记录 ID，供下一步下载。',
    },
    {
      id: 'flow-download', title: '下载',
      blocks: [{ runtime: 'web', code: [
        '// 放在“下载”按钮的点击处理中。',
        "downloadRecording(stream, { format: 'csv' });",
        "// 保留完整帧结构时，将 format 改为 'jsonl'。",
      ].join('\n') }],
      note: '按本次记录 ID 触发浏览器下载，不默认选择最近记录；触发下载不等于文件已保存完成。',
    },
  ];
}
