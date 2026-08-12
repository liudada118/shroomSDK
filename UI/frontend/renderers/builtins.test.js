/**
 * builtins.test.js - 本包 ships 的五个渲染器描述符能不能注册上
 *
 * ## 为什么这条值得单独测
 *
 * `registerRenderer` 对不合法的描述符是**静默失败**：`validateRendererDescriptor`
 * 收集错误 → 返回 `false` → 记进 `listRegistrationFailures()`，**不抛**。这是
 * 有意的（坏插件不该让应用起不来），代价是描述符里写错一个方法名，现象只是
 * "这个展示形式一片空白" + 控制台一行 —— 上一轮补 10 个契约方法名就是踩在
 * 这上面。这里把它变成一条会红的断言。
 *
 * ## 为什么这个测试能在 node 环境里跑
 *
 * `builtins.js` 只 import `core/`（contract / registry / 三份 params），渲染器
 * 本体在 `load: () => import(...)` 里，本测试从不调用它。`backends/canvas2d.js`
 * 同理 —— 它整个文件只依赖 `core/`，DOM 的部分都在工厂函数体内。所以这里不需要
 * jsdom，也不需要装 react 这个 peer 依赖。
 *
 * 反过来说，**这个测试跑不到渲染器本体**：`HandPointsRenderer.jsx` 静态 import 了
 * react 与 three，两条热力的渲染器也都静态 import 了 react，在这个包的 node_modules
 * 里都不存在。它们的回归靠真机手测，见 `sdk/frontend/README.md` 里那份清单。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { RENDERER_CAPABILITIES, RENDERER_METHODS } from '../core/contract.js';
import {
  getRendererDescriptor,
  listRegistrationFailures,
  resetRendererRegistry,
} from '../core/registry.js';
import createCanvas2dMatrixBackend from './numMatrix/react/backends/canvas2d.js';
import createWebglMatrixBackend from './numMatrix/react/backends/webgl.js';
import { registerBuiltinRenderers } from './builtins.js';

/** 本包 ships 的五个渲染器 id。再加一个时这里和下面的计数一起改。 */
const RENDERER_IDS = [
  'numMatrix',
  'pointGrid',
  'handPoints',
  'webglHeatmap',
  'blobHeatmap',
];

/** 所有后端都有的那四个，由 `NumMatrixRenderer` 自己实现，不随后端变。 */
const SHELL_METHODS = ['sitData', 'sitValue', 'changeWsData', 'changeWsDataRaw'];

/**
 * 两个带命令的后端的 `commandNames` 并集，去重后排序。
 *
 * `sprite3d` 不在里面 —— 它一个命令都没有，这正是这些方法「可选」的原因。
 */
const BACKEND_COMMANDS = [...new Set([
  ...createCanvas2dMatrixBackend.commandNames,
  ...createWebglMatrixBackend.commandNames,
])].sort();

describe('内置渲染器注册', () => {
  beforeEach(() => {
    resetRendererRegistry();
  });

  it('五个渲染器都能注册上，没有一条校验失败', () => {
    expect(registerBuiltinRenderers()).toBe(RENDERER_IDS.length);
    // 失败清单要空 —— 只看返回值会漏掉"注册了 5 个但第 6 个悄悄挂了"的情况。
    expect(listRegistrationFailures()).toEqual([]);
    RENDERER_IDS.forEach((id) => {
      expect(getRendererDescriptor(id), `${id} 没注册上`).not.toBeNull();
    });
  });

  it('声明的方法名全部在契约里（漏一个就是静默拒绝注册）', () => {
    registerBuiltinRenderers();
    RENDERER_IDS.forEach((id) => {
      const stray = getRendererDescriptor(id).methods
        .filter((method) => !(method in RENDERER_METHODS));
      expect(stray, `${id} 有契约外的方法名`).toEqual([]);
    });
  });

  it('声明的能力全部在契约里', () => {
    registerBuiltinRenderers();
    const known = new Set(Object.values(RENDERER_CAPABILITIES));
    RENDERER_IDS.forEach((id) => {
      const stray = getRendererDescriptor(id).capabilities.filter((cap) => !known.has(cap));
      expect(stray, `${id} 有契约外的能力`).toEqual([]);
    });
  });

  it('幂等：重复注册不产生失败记录', () => {
    expect(registerBuiltinRenderers()).toBe(RENDERER_IDS.length);
    expect(registerBuiltinRenderers()).toBe(RENDERER_IDS.length);
    expect(listRegistrationFailures()).toEqual([]);
  });
});

describe('handPoints 描述符', () => {
  beforeEach(() => {
    resetRendererRegistry();
    registerBuiltinRenderers();
  });

  it('那 13 个方法一个不少 —— 少一个就是「这个命令一调就静默无效」', () => {
    // 名单与 `handPoints/HandPointsRenderer.jsx` 里 `state.api` 的键必须一致。
    // 那边多一个这里少一个，`RendererHost` 的契约审计会告警但不拦；这边多一个
    // 那边少一个，才是真会在真机上崩的方向 —— 而那个方向本文件测不到（跑不到
    // 渲染器本体），只能靠这份清单 + 手测。
    expect([...getRendererDescriptor('handPoints').methods].sort()).toEqual([
      'calibration',
      'cancelSelect',
      'changaCamera', // 原拼写如此，契约里也是这个拼法
      'changeBox',
      'changeDataFlag',
      'changeHandAngle',
      'changePointRotation',
      'changeSelectFlag',
      'handZero',
      'resetHand',
      'sitData',
      'sitRenew',
      'sitValue',
    ]);
  });

  it('是全仓唯一声明 ARTICULATED 的渲染器', () => {
    const articulated = RENDERER_IDS
      .filter((id) => getRendererDescriptor(id).capabilities
        .includes(RENDERER_CAPABILITIES.ARTICULATED));
    expect(articulated).toEqual(['handPoints']);
  });

  it('三条预设都在描述符里，且 normalizeParams 能吃下它们', () => {
    const { presets, normalizeParams } = getRendererDescriptor('handPoints');
    expect(Object.keys(presets)).toEqual(['hand0205', 'hand0205Alt', 'hand0205_147']);
    Object.entries(presets).forEach(([id, preset]) => {
      expect(() => normalizeParams(preset), `${id}`).not.toThrow();
    });
  });

  it('不声明 optionalMethods —— 它只有一套实现，没有后端开关', () => {
    expect(getRendererDescriptor('handPoints').optionalMethods).toBeUndefined();
  });

  it('五个渲染器的 id / label 都不重复', () => {
    const labels = RENDERER_IDS.map((id) => getRendererDescriptor(id).label);
    expect(new Set(labels).size).toBe(RENDERER_IDS.length);
    expect(new Set(RENDERER_IDS).size).toBe(RENDERER_IDS.length);
  });
});

describe('两条热力的描述符', () => {
  beforeEach(() => {
    resetRendererRegistry();
    registerBuiltinRenderers();
  });

  /**
   * 这两条是「为什么不是同一个渲染器的两个后端」的可执行版本。
   *
   * `numMatrix` 的三个后端吃同一份参数、暴露同一组方法（差集在
   * `optionalMethods` 里说清楚了）。两条热力不是那个关系：方法集不同、参数表不
   * 重合。要是哪天有人把它们合成一个 id，下面这两条会红。
   */
  it('webglHeatmap 四个方法，blobHeatmap 三个 —— 后者没有 changeColor', () => {
    expect([...getRendererDescriptor('webglHeatmap').methods].sort()).toEqual([
      'bthClickHandle', 'changeColor', 'sitData', 'sitValue',
    ]);
    expect([...getRendererDescriptor('blobHeatmap').methods].sort()).toEqual([
      'bthClickHandle', 'sitData', 'sitValue',
    ]);
  });

  it('两条都只声明 SIT —— 平面图，没有视角也没有框选', () => {
    ['webglHeatmap', 'blobHeatmap'].forEach((id) => {
      expect(getRendererDescriptor(id).capabilities, id)
        .toEqual([RENDERER_CAPABILITIES.SIT]);
    });
  });

  it('两条都不声明 optionalMethods —— 各自只有一套实现', () => {
    ['webglHeatmap', 'blobHeatmap'].forEach((id) => {
      expect(getRendererDescriptor(id).optionalMethods, id).toBeUndefined();
    });
  });

  it('预设都在描述符里，且 normalizeParams 能吃下它们', () => {
    expect(Object.keys(getRendererDescriptor('webglHeatmap').presets))
      .toEqual(['bed4096', 'plain']);
    expect(Object.keys(getRendererDescriptor('blobHeatmap').presets))
      .toEqual(['default', 'carCol']);
    ['webglHeatmap', 'blobHeatmap'].forEach((id) => {
      const { presets, normalizeParams } = getRendererDescriptor(id);
      Object.entries(presets).forEach(([presetId, preset]) => {
        expect(() => normalizeParams(preset), `${id}/${presetId}`).not.toThrow();
      });
    });
  });
});

describe('numMatrix 的 optionalMethods 与两个后端对账', () => {
  beforeEach(() => {
    resetRendererRegistry();
    registerBuiltinRenderers();
  });

  /**
   * 这一条是那份"刻意的重复"的对账。
   *
   * `builtins.js` 没有从 `backends/*.js` import `commandNames`，因为一旦静态
   * import 任何后端，`load: () => import(...)` 的懒加载 chunk 就会塌回主包
   * （Rollup 只发 warning 不报错）。两处各写一遍是选定的方案，代价是会漂 ——
   * 所以由测试来盯。
   */
  it('optionalMethods 就是两个后端 commandNames 的并集', () => {
    const { optionalMethods } = getRendererDescriptor('numMatrix');
    expect([...optionalMethods].sort()).toEqual(BACKEND_COMMANDS);
  });

  it('methods 恰好是「壳的四个 + 两个后端的命令」的并集', () => {
    const { methods } = getRendererDescriptor('numMatrix');
    expect([...methods].sort()).toEqual([...SHELL_METHODS, ...BACKEND_COMMANDS].sort());
  });

  /**
   * `webgl` 的四个命令必须是 `canvas2d` 那十个的子集之外还能对上契约 ——
   * 换句话说，两个后端重名的方法（`changeWsData147` / `changeWsData256` /
   * `drawContent`）语义必须一致，否则同一个 id 的契约声明就是在撒谎。
   *
   * 这条测不了语义，只能钉住「重名的确实是这三个」，重名集合变了就要人来看一眼。
   */
  it('两个后端重名的命令只有那三个', () => {
    const c2d = new Set(createCanvas2dMatrixBackend.commandNames);
    const shared = createWebglMatrixBackend.commandNames.filter((name) => c2d.has(name));
    expect(shared.sort()).toEqual(['changeWsData147', 'changeWsData256', 'drawContent']);
  });

  it('壳的四个方法不在 optionalMethods 里 —— 它们任何后端都必须有', () => {
    const optional = new Set(getRendererDescriptor('numMatrix').optionalMethods);
    SHELL_METHODS.forEach((name) => {
      expect(optional.has(name), `${name} 不该是可选的`).toBe(false);
    });
  });

  it('pointGrid 不声明 optionalMethods —— 它只有一套实现', () => {
    expect(getRendererDescriptor('pointGrid').optionalMethods).toBeUndefined();
  });
});
