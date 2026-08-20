/**
 * declarativeFrame.test.js - 声明式 `frame` prop 的接线检查
 *
 * 这一层没有 jsdom（vitest 默认 node 环境，见 `package.json#test:renderers`），
 * 所以钩子的行为由 `core/framePayload.test.js` 覆盖纯逻辑那半，这里用源码断言
 * 覆盖"五个渲染器都真的接上了"那半 —— 漏接一个的表现是画面永远空白，
 * 而纯逻辑测试对此一无所知。
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { RENDERER_PROPS } from '../core/contract.js';

const renderers = [
  ['numMatrix', 'NumMatrixRenderer.jsx'],
  ['pointGrid', 'PointGridRenderer.jsx'],
  ['handPoints', 'HandPointsRenderer.jsx'],
  ['webglHeatmap', 'WebglHeatmapRenderer.jsx'],
  ['blobHeatmap', 'BlobHeatmapRenderer.jsx'],
];

function readRenderer(id, file) {
  return readFileSync(new URL(`./${id}/react/${file}`, import.meta.url), 'utf8');
}

describe('声明式 frame prop', () => {
  it('两个新 prop 都进了契约', () => {
    expect(RENDERER_PROPS.frame).toBeTruthy();
    expect(RENDERER_PROPS.backFrame).toBeTruthy();
  });

  it('没有占用已经归宿主回调 ref 使用的 data 键', () => {
    expect(RENDERER_PROPS.data).toMatch(/ref/);
    expect(RENDERER_PROPS.frame).not.toBe(RENDERER_PROPS.data);
  });

  it.each(renderers)('%s 接上了 useDeclarativeFrame', (id, file) => {
    const source = readRenderer(id, file);

    expect(source).toMatch(/import \{ useDeclarativeFrame \} from '\.\.\/\.\.\/shared\/react\/useDeclarativeFrame\.js'/);
    expect(source).toMatch(/useDeclarativeFrame\(props\.frame/);
  });

  it.each(renderers)('%s 的声明式通路最终落到 sitData', (id, file) => {
    const source = readRenderer(id, file);
    const call = source.slice(source.indexOf('useDeclarativeFrame(props.frame'));

    expect(call).toMatch(/sitData/);
  });

  it('只有 pointGrid 暴露第二通道，因为只有它实现了 backData', () => {
    for (const [id, file] of renderers) {
      const source = readRenderer(id, file);
      const hasBackFrame = /useDeclarativeFrame\(props\.backFrame/.test(source);
      expect(hasBackFrame).toBe(id === 'pointGrid');
      if (hasBackFrame) expect(source).toMatch(/api\?\.backData\(payload\)/);
    }
  });

  it('会整场重建的三个渲染器都传了 resetKey', () => {
    // 参数变化把 state.api 置空，不重推的话画面会空到下一帧到达为止。
    for (const [id, file] of [renderers[0], renderers[1], renderers[2]]) {
      const source = readRenderer(id, file);
      const call = source.slice(source.indexOf('useDeclarativeFrame(props.frame'));
      expect(call, id).toMatch(/\}, (paramsKey|frameResetKey)\)/);
    }
  });

  it('pointGrid 的 resetKey 带上了 paramsKey 覆盖不到的 spriteUrl', () => {
    const source = readRenderer('pointGrid', 'PointGridRenderer.jsx');
    expect(source).toMatch(/frameResetKey = `\$\{paramsKey\}\|\$\{spriteUrl\}`/);
  });

  it('两个热力图按参数内容取键，不按 props.params 引用', () => {
    for (const [id, file] of [renderers[3], renderers[4]]) {
      const source = readRenderer(id, file);
      expect(source, id).toMatch(/const paramsKey = useMemo\(\(\) => JSON\.stringify\(params\), \[params\]\)/);
    }
  });

  it('命令式通路一个都没被删掉', () => {
    for (const [id, file] of renderers) {
      expect(readRenderer(id, file), id).toMatch(/useImperativeHandle/);
    }
  });
});
