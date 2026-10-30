/** 产品示例的生成选项；这不是连接硬件或激活授权的参数。 */
export interface ProductExampleOptions {
  /** glove 使用 handGloveFullPacket 协议；pad 使用 hand 协议。 */
  product: 'glove' | 'pad';
  /** glove 必须明确填写实物手侧，否则生成时抛出 TypeError；pad 不使用此参数。 */
  side?: 'left' | 'right';
  /** 选择生成浏览器 HTML 或 Node.js 模块，不会在当前进程执行示例。 */
  env: 'web' | 'node';
  /** 影响驱动准备、串口格式和运行提示，不限制 SDK 的实际部署系统。 */
  platform: 'windows' | 'macos' | 'linux';
  /** 默认 complete：含授权、连接、错误和清理；snippet 供已授权、已有会话管理的项目接入。 */
  kind?: 'complete' | 'snippet';
}

/**
 * 返回带中文注释的完整 HTML、Node.js 模块或接入片段。
 * 纯字符串生成，不访问 DOM，不连接硬件，不激活授权，不创建浏览器全局变量。
 * 完整示例应放在 SDK 根目录，与 web/ 和 node/ 同级，以保证相对导入路径正确。
 */
export function createProductExample(options: ProductExampleOptions): string;

/**
 * 返回相同选项的示例文件名，如 glove-left-example.html 或 hand-pad-example.mjs。
 * 参数校验与 createProductExample 一致；kind 不影响文件名。
 */
export function getProductExampleFilename(options: ProductExampleOptions): string;
