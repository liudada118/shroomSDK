import type { ProductCallOptions } from './product-call.js';

/** 文档中的一个调用步骤；代码是可展示/复制的字符串，不会在生成时执行。 */
export interface ProductFlowStep {
  /** 固定的页面定位锚点，用于旧链接兼容和步骤跳转。 */
  id: 'flow-read' | 'flow-ws' | 'flow-start' | 'flow-stop' | 'flow-download';
  title: string;
  /** 同一步可有多个运行端；创建 WS 同时包含 Node 服务与网页连接两段。 */
  blocks: { runtime: 'node' | 'web'; code: string }[];
  /** 该步的执行时机或行为边界。 */
  note: string;
}

/** Node 取数/创建服务，浏览器通过 WS 控制录制与下载；foot 需 SDK 0.7.0，默认导出完整 JSONL。 */
export function createProductFlow(options: Omit<ProductCallOptions, 'env'>): ProductFlowStep[];
