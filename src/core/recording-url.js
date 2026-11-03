/** Node 服务与浏览器订阅共用的记录下载地址规则；不访问文件、网络或 DOM。 */
import { ShroomError } from './errors.js';

/**
 * 从已校验的 WS/WSS 或 HTTP/HTTPS 服务地址构造同主机、同端口下载 URL。
 * id 必须是采集记录 UUID，format 仅支持 csv/jsonl；默认 csv。
 * 清除连接路径和查询参数，不检查记录是否存在或是否已经写完。
 */
export function createRecordingUrl(serviceUrl, id, { format = 'csv' } = {}) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
    throw new ShroomError('INVALID_CONFIG', '必须传入采集记录 ID（recording.id），不能使用标签、产品 ID 或 WS 端口', { stage: 'stream' });
  }
  if (!['csv', 'jsonl'].includes(format)) {
    throw new ShroomError('INVALID_CONFIG', '下载格式仅支持 csv 或 jsonl', { stage: 'stream' });
  }
  const downloadUrl = new URL(serviceUrl);
  downloadUrl.protocol = ['wss:', 'https:'].includes(downloadUrl.protocol) ? 'https:' : 'http:';
  downloadUrl.pathname = `/recordings/${id}.${format}`;
  downloadUrl.search = '';
  return downloadUrl.href;
}
