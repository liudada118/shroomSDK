import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rendererFamilies = [
  ['numMatrix', 'NumMatrixRenderer.jsx'],
  ['pointGrid', 'PointGridRenderer.jsx'],
  ['handPoints', 'HandPointsRenderer.jsx'],
  ['webglHeatmap', 'WebglHeatmapRenderer.jsx'],
  ['blobHeatmap', 'BlobHeatmapRenderer.jsx'],
];

function exists(relativePath) {
  return existsSync(new URL(relativePath, import.meta.url));
}

describe('renderers 可搬运目录边界', () => {
  it.each(rendererFamilies)('%s 同时包含纯逻辑和 React 实现', (id, componentFile) => {
    expect(exists(`./${id}/core/index.js`)).toBe(true);
    expect(exists(`./${id}/react/${componentFile}`)).toBe(true);
  });

  it('集中保存渲染器注册入口和共享图形工具', () => {
    expect(exists('./index.js')).toBe(true);
    expect(exists('./builtins.js')).toBe(true);
    expect(exists('./shared/three/SelectionHelper.js')).toBe(true);
    expect(exists('./shared/three/circle.png')).toBe(true);
    expect(exists('./shared/webgl/glUtil.js')).toBe(true);
  });

  it.each(rendererFamilies)('旧 core/%s 与 react/%s 目录已经移除', (id) => {
    expect(exists(`../core/${id}`)).toBe(false);
    expect(exists(`../react/${id}`)).toBe(false);
  });

  it('旧注册入口和共享图形目录已经移除', () => {
    expect(exists('../react/builtins.js')).toBe(false);
    expect(exists('../react/three')).toBe(false);
    expect(exists('../react/webgl')).toBe(false);
  });

  it('新旧包导出都指向 renderers', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );

    expect(packageJson.exports['./renderers']).toBe('./renderers/index.js');
    expect(packageJson.exports['./renderers/*']).toBe('./renderers/*');
    expect(packageJson.exports['./react/three/*']).toBe('./renderers/shared/three/*');
    expect(packageJson.exports['./react/webgl/*']).toBe('./renderers/shared/webgl/*');
    for (const [id] of rendererFamilies) {
      expect(packageJson.exports[`./core/${id}`]).toBe(`./renderers/${id}/core/index.js`);
      expect(packageJson.exports[`./core/${id}/*`]).toBe(`./renderers/${id}/core/*`);
      expect(packageJson.exports[`./react/${id}/*`]).toBe(`./renderers/${id}/react/*`);
      expect(packageJson.exports[`./renderers/${id}/core`]).toBe(`./renderers/${id}/core/index.js`);
    }

    expect(packageJson.files).toBeUndefined();
    const npmIgnore = readFileSync(new URL('../.npmignore', import.meta.url), 'utf8');
    expect(npmIgnore).toMatch(/^docs\/$/m);
    expect(npmIgnore).toMatch(/^\*\*\/\*\.test\.js$/m);
  });
});
