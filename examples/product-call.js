/** 示例产品合同：侧别要求与返回字段分别定义，不能用 side 推断数据结构。 */
const callProducts = {
  glove: { connect: 'connectGlove', side: '手', fields: ['fingers', 'palm', 'imu'] },
  pad: { connect: 'connectHandPad', fields: ['pressureMatrix', 'values'] },
  body: { connect: 'connectProduct', nodeExampleOnly: true, minSdkVersion: '0.3.0', fields: ['regions', 'raw'] },
  insole: { connect: 'connectProduct', side: '脚', nodeExampleOnly: true, minSdkVersion: '0.3.0', fields: ['sensors', 'pressure', 'imu'] },
};

/** 供同一五步流程的 Node / WS 回调共用；仅返回字段名，不解码或绘制数据。 */
export function productCallDataFields(product) {
  if (!Object.hasOwn(callProducts, product)) throw new TypeError('请选择已支持的产品。');
  return [...callProducts[product].fields];
}

/** 生成产品取数调用，运行前由宿主项目完成 SDK 授权；不生成界面或重复解析协议。 */
export function createProductCall(options) {
  const { product, side, protocol, env, platform = 'windows', quickFlow = false, importStyle = 'relative' } = options ?? {};
  const fields = productCallDataFields(product);
  const profile = callProducts[product];
  if (profile.side && !['left', 'right'].includes(side)) throw new TypeError(`请明确实物${profile.side}侧。`);
  if (product === 'insole' && protocol !== undefined && !['12bit', '8bit'].includes(protocol)) throw new TypeError('鞋垫协议请选择 12bit 或 8bit。');
  if (product !== 'insole' && protocol !== undefined) throw new TypeError('当前产品不使用鞋垫 protocol 参数。');
  if (!['web', 'node'].includes(env)) throw new TypeError('请选择浏览器或 Node.js。');
  if (profile.nodeExampleOnly && env !== 'node') throw new TypeError('新增产品示例使用 Node.js 取数，浏览器通过 WS 接收。');
  if (!['windows', 'macos', 'linux'].includes(platform)) throw new TypeError('请选择采集电脑系统。');
  if (!['relative', 'package'].includes(importStyle)) throw new TypeError('请选择源码相对路径或 npm 包入口。');
  if (quickFlow && env !== 'node') throw new TypeError('产品串口快速调用在 Node.js 中运行。');
  const name = quickFlow ? 'readProduct' : profile.connect;
  const path = platform === 'windows' ? 'COM3' : platform === 'macos' ? '/dev/cu.usbserial-实际端口' : '/dev/ttyUSB0';
  // 官网 npm 接入与 ZIP 示例共用调用合同，只切换公开模块路径。
  const entry = importStyle === 'package'
    ? `shroom-sdk/${quickFlow ? 'quick-flow' : env}`
    : quickFlow ? './quick-flow.js' : `./${env}/index.js`;
  return [
    `import { ${name} } from '${entry}';`, '',
    ...(profile.minSdkVersion ? [`// 需要 SDK ${profile.minSdkVersion} 或更高版本；Node 服务端与网页请安装相同版本。`] : []),
    env === 'web' ? '// SDK 授权完成后，在“连接”按钮的点击事件中调用。' : '// SDK 授权完成后调用；path 替换为系统中的实际串口。',
    `const device = await ${name}({`,
    ...(quickFlow || name === 'connectProduct' ? [`  product: '${product}', // 由 SDK 注册表选择对应产品协议`] : []),
    ...(env === 'node' ? [`  path: '${path}', // 替换为 listPorts() 查询后用户选择的串口`] : []),
    ...(profile.side ? [`  side: '${side}', // 按实际左${profile.side}或右${profile.side}设置`] : []),
    ...(product === 'insole' ? [`  protocol: '${protocol ?? '12bit'}', // 按设备固件选择 12bit 或 8bit，默认 12bit`] : []),
    '  onData(data) {',
    '    // 每次收到一帧已解析的产品数据，在这里接入你的业务。',
    `    console.log(${fields.map(field => `data.${field}`).join(', ')});`,
    '  },',
    '  onError: error => console.error(error.code, error.message),',
    '});', '',
    '// 释放串口时：await device.close();',
  ].join('\n');
}
