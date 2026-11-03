/** 五步流程实现：复用基础文档的公开 API，只管理连接、录制状态和资源释放。 */
import { ShroomError } from '../core/errors.js';

// 每个服务/网页连接独立保存操作状态；保存 ID 字符串，避免外部修改返回记录影响下载。
const recordingStates = new WeakMap();

function flowError(code, message) {
  return new ShroomError(code, message, { stage: 'stream' });
}

function optionsObject(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw flowError('INVALID_CONFIG', '请传入配置对象。');
  }
}

function recordingState(target) {
  const state = recordingStates.get(target);
  if (!state) throw flowError('INVALID_CONFIG', '请传入 readProduct 返回的网页连接或 createWS 返回的服务。');
  if (state.closed) throw flowError('SERVER_CLOSED', '采集服务已经关闭。');
  return state;
}

/** ① 取数：有 url 时订阅 WS；否则在 Node 按注册产品连接串口。 */
export async function readProduct(options) {
  optionsObject(options);
  if (Object.hasOwn(options, 'url')) {
    if (typeof options.url !== 'string' || !options.url.trim()
      || ['product', 'path', 'side'].some(key => Object.hasOwn(options, key))) {
      throw flowError('INVALID_CONFIG', 'WS 取数请填写 url，不要同时传入 product、path 或 side。');
    }
    const { connectStream } = await import('../web/index.js');
    const stream = await connectStream(options);
    recordingStates.set(stream, { busy: false, id: null, download: (id, format) => stream.downloadRecording(id, { format }) });
    return stream;
  }
  const { connectProduct } = await import('../node/index.js');
  return connectProduct(options);
}

/** ② 创建 WS：接管设备的关闭责任；启动失败也会释放串口。 */
export async function createWS(device, options = {}) {
  if (!device || typeof device.close !== 'function') {
    throw flowError('INVALID_CONFIG', '请传入可关闭的设备，例如 readProduct 返回的 device。');
  }
  let service;
  try {
    const { serveDevice } = await import('../node/index.js');
    service = await serveDevice(device, options);
  } catch (error) {
    try { await device.close(); }
    catch (closeError) { throw new AggregateError([error, closeError], 'WS 创建失败，且设备释放失败。', { cause: error }); }
    throw error;
  }

  const state = { busy: false, id: null, closed: false,
    download: (id, format) => service.getRecordingUrl(id, { format }) };
  let closing;
  const server = { ...service,
    close() {
      closing ??= (async () => {
        state.closed = true;
        const errors = [];
        try { await service.close(); } catch (error) { errors.push(error); }
        try { await device.close(); } catch (error) { errors.push(error); }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, '服务与设备关闭失败。');
      })();
      return closing;
    },
  };
  recordingStates.set(server, state);
  return server;
}

/** 同一连接不并发提交起停命令；失败后释放门闩，调用方可查询真实状态再处理。 */
async function controlRecording(target, operation) {
  const state = recordingState(target);
  if (state.busy) throw flowError('INVALID_REQUEST', '采集操作正在进行，请等待完成。');
  state.busy = true;
  try { return await operation(state); }
  finally { state.busy = false; }
}

/** ③ 开始保存；成功后清除上一轮的下载 ID，失败时保留已完成记录。 */
export async function startRecording(target, options = { label: '本次采集' }) {
  return controlRecording(target, async state => {
    const session = await target.startRecording(options);
    state.id = null;
    return session;
  });
}

/** ④ 等待录制文件收尾，记住实际返回的记录 ID；实时取数与 WS 保持连接。 */
export async function stopRecording(target) {
  return controlRecording(target, async state => {
    const recording = await target.stopRecording();
    if (!recording || typeof recording.id !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(recording.id)) {
      throw flowError('INVALID_REQUEST', '服务未返回有效的采集记录 ID。');
    }
    state.id = recording.id;
    return recording;
  });
}

/** ⑤ 网页触发下载、Node 返回 URL；只使用此连接最近一次成功停止的记录。 */
export function downloadRecording(target, options = {}) {
  optionsObject(options);
  const { format = 'csv' } = options;
  if (!['csv', 'jsonl'].includes(format)) throw flowError('INVALID_CONFIG', '下载格式仅支持 csv 或 jsonl。');
  const state = recordingState(target);
  if (state.busy) throw flowError('INVALID_REQUEST', '请等待采集操作完成后再下载。');
  if (!state.id) throw flowError('RECORDING_NOT_ACTIVE', '请先开始并停止本次采集，再下载。');
  return state.download(state.id, format);
}
