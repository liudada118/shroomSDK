export type ProductCallProduct = 'glove' | 'pad' | 'body' | 'insole' | 'foot';

/** 精简调用独立于旧完整 HTML 生成器；新增产品只提供 Node 取数与五步 WS 流程。 */
export interface ProductCallOptions {
  product: ProductCallProduct;
  /** glove/insole 手动连接需明确实物侧别；foot 省略时自动发现。auto 仅适用于 Node 分包手套/足底。 */
  side?: 'left' | 'right' | 'auto';
  /** Node glove/foot 可显式自动扫描并用 side 筛选；其余产品与浏览器不接收。现有产品默认保持手动。 */
  connectionMode?: 'manual' | 'auto';
  /** 仅 insole 使用；与设备固件匹配，默认 12bit。 */
  protocol?: '12bit' | '8bit';
  /** body/insole/foot 的直接取数示例仅使用 node；网页通过五步 WS 流程接收。 */
  env: 'web' | 'node';
  platform: 'windows' | 'macos' | 'linux';
  /** 保留原调用生成选项兼容，不改变精简片段的文件位置。 */
  layout?: 'archive' | 'repository';
  /** 五步文档使用统一 readProduct；仅适用于 Node 取数。 */
  quickFlow?: boolean;
  /** 官网 npm 示例使用 package；默认 relative 保留源码 ZIP 的可运行导入路径。 */
  importStyle?: 'relative' | 'package';
}

/** 同一产品在 Node 与浏览器 WS 回调中读取的真实字段。 */
export function productCallDataFields(product: ProductCallProduct): string[];

/** 返回一个产品连接函数的调用代码；宿主项目需先完成授权，浏览器需从点击事件调用。 */
export function createProductCall(options: ProductCallOptions): string;
