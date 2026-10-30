import type { ProductExampleOptions } from './product-examples.js';

/** 产品取数调用的选择项；手套必须提供实物手侧。 */
export type ProductCallOptions = Omit<ProductExampleOptions, 'kind'> & {
  /** 五步文档使用统一 readProduct；仅适用于 Node 取数。 */
  quickFlow?: boolean;
};

/** 返回一个产品连接函数的调用代码；宿主项目需先完成授权，浏览器需从点击事件调用。 */
export function createProductCall(options: ProductCallOptions): string;
