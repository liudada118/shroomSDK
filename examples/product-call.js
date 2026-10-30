/** 生成产品取数调用，运行前由宿主项目完成 SDK 授权；不生成界面或重复解析协议。 */
export function createProductCall(options) {
  const { product, side, env, platform = 'windows', quickFlow = false } = options ?? {};
  if (!['glove', 'pad'].includes(product)) throw new TypeError('请选择手套或手部检测垫。');
  if (product === 'glove' && !['left', 'right'].includes(side)) throw new TypeError('请明确实物手侧。');
  if (!['web', 'node'].includes(env)) throw new TypeError('请选择浏览器或 Node.js。');
  if (!['windows', 'macos', 'linux'].includes(platform)) throw new TypeError('请选择采集电脑系统。');
  if (quickFlow && env !== 'node') throw new TypeError('产品串口快速调用在 Node.js 中运行。');
  const name = quickFlow ? 'readProduct' : product === 'glove' ? 'connectGlove' : 'connectHandPad';
  const path = platform === 'windows' ? 'COM3' : platform === 'macos' ? '/dev/cu.usbserial-实际端口' : '/dev/ttyUSB0';
  return [
    `import { ${name} } from '${quickFlow ? './quick-flow.js' : `./${env}/index.js`}';`, '',
    env === 'web' ? '// SDK 授权完成后，在“连接”按钮的点击事件中调用。' : '// SDK 授权完成后调用；path 替换为系统中的实际串口。',
    `const device = await ${name}({`,
    ...(quickFlow ? [`  product: '${product}', // 由 SDK 注册表选择对应产品协议`] : []),
    ...(env === 'node' ? [`  path: '${path}',`] : []),
    ...(product === 'glove' ? [`  side: '${side}', // 按实际左手或右手设置`] : []),
    '  onData(data) {',
    '    // 每次收到一帧已解析的产品数据，在这里接入你的业务。',
    product === 'glove' ? '    console.log(data.fingers, data.palm, data.imu);' : '    console.log(data.pressureMatrix, data.values);',
    '  },',
    '  onError: error => console.error(error.code, error.message),',
    '});', '',
    '// 释放串口时：await device.close();',
  ].join('\n');
}
