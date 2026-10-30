/** 将产品示例事实源同步为 SDK 根目录中可直接使用的六个完整示例。 */
import { writeFile } from 'node:fs/promises';
import { createProductExample, getProductExampleFilename } from './product-examples.js';

// 预置文案默认 Windows；macOS/Linux 可在产品接入页选择系统后生成对应提示的示例。
// 生成位置固定以本脚本为基准，不受执行命令时所在目录影响。
const configurations = [
  { product: 'glove', side: 'left' },
  { product: 'glove', side: 'right' },
  { product: 'pad' },
];
for (const configuration of configurations) {
  for (const env of ['web', 'node']) {
    const options = { ...configuration, env, platform: 'windows', kind: 'complete' };
    const path = new URL('../' + getProductExampleFilename(options), import.meta.url);
    await writeFile(path, createProductExample(options), 'utf8');
  }
}
console.log('已同步 6 个产品取数示例（Windows 预置提示；macOS/Linux 可从产品接入页生成）。');
