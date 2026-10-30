#!/usr/bin/env node
// 只读示例：查询已有后端并订阅实时帧，不切换传感器、开关串口或启动采集。
import { BackendSdkClient } from './backend.js';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  http: { type: 'string', default: 'http://127.0.0.1:19245' },
  ws: { type: 'string', default: 'ws://127.0.0.1:19999' },
  channels: { type: 'string', default: 'sit' },
  duration: { type: 'string', default: '10000' },
  help: { type: 'boolean', default: false },
} });

if (values.help) {
  console.log('node node/backend-demo.js [--http URL] [--ws URL] [--channels sit,back] [--duration 10000]');
  console.log('只读取后端元数据和订阅实时帧；需要已启动的主项目后端，不会自动连接设备或启动采集。');
} else {
  const duration = Number(values.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('--duration 必须是正毫秒数');
  const client = new BackendSdkClient({ httpBaseUrl: values.http, wsUrl: values.ws });
  let stop;
  // 超时、断连、错误或 Ctrl+C 共用一个退出信号，清理由 finally 统一执行。
  const interrupted = new Promise((resolve) => { stop = resolve; });
  const onSignal = () => stop();
  process.once('SIGINT', onSignal);
  let timer;
  let frames = 0;
  try {
    console.log('后端契约:', await client.getContract());
    console.log('串口状态:', await client.getSerialStatus());
    client.on('frame', (frame) => {
      frames += 1;
      if (frames <= 5) console.log('后端原始帧:', frame);
    });
    client.on('error', (error) => { console.error(error.message); process.exitCode = 1; stop(); });
    client.on('close', () => stop());
    client.on('open', () => console.log('已连接实时通道'));
    client.connectRealtime({ channels: values.channels.split(',').map((s) => s.trim()).filter(Boolean) });
    timer = setTimeout(stop, duration);
    await interrupted;
    console.log(`结束，共收到 ${frames} 帧`);
  } catch (error) {
    console.error('后端连接失败:', error.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', onSignal);
    client.disconnectRealtime();
  }
}
