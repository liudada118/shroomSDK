/**
 * 快速接入只需要这五个函数，内部复用基础文档里的公开 API。
 * 本文件依赖同目录的 flow/、core/、node/、web/，请保留 SDK 目录结构。
 *
 * Node.js（先安装驱动、依赖，并激活 SDK 授权）：
 *   import { readProduct, createWS } from './quick-flow.js';
 *   const device = await readProduct({
 *     product: 'glove', side: 'left', path: 'COM3', // 手垫 product='pad'，不填 side。
 *     onData: data => console.log(data), // ① 持续收到解析后的产品数据。
 *     onError: error => console.error(error.code, error.message),
 *   });
 *   const server = await createWS(device, { port: 19999 }); // ② 创建本机 WS。
 *   // 退出时 await server.close()，等待文件写完并释放串口。
 *
 * 网页（同一台电脑通过 http://localhost 打开，使用 type="module"）：
 *   import { readProduct, startRecording, stopRecording, downloadRecording } from './quick-flow.js';
 *   const stream = await readProduct({
 *     url: 'ws://127.0.0.1:19999', // 接收 Node 数据；HTTPS 网页需另配 WSS。
 *     onData: data => console.log(data),
 *     onError: error => console.error(error.code, error.message),
 *   });
 *   // 分别放入三个按钮，等待每次操作完成后再进行下一步。
 *   await startRecording(stream, { label: '本次采集' }); // ③ 开始保存。
 *   await stopRecording(stream);                       // ④ 等待文件写完。
 *   downloadRecording(stream, { format: 'csv' });        // ⑤ 下载本次记录；也支持 jsonl。
 *   // 网页退出时 await stream.close()；正在采集时请先明确停止。
 *
 * Node 中也可把 server 传给后三个函数；下载函数此时返回 HTTP URL，不自动保存文件。
 * 异步操作失败由调用方 try/catch；onError 接收连接后的运行期错误。
 *
 * 基础 API 对应关系（参数与生命周期见 docs/CUSTOM.md）：
 * readProduct       → Node connectProduct / 网页 connectStream
 * createWS          → serveDevice
 * startRecording    → 连接或服务的 startRecording
 * stopRecording     → 连接或服务的 stopRecording
 * downloadRecording → 网页 downloadRecording / Node getRecordingUrl
 */
export { readProduct, createWS, startRecording, stopRecording, downloadRecording } from './flow/runtime.js';
