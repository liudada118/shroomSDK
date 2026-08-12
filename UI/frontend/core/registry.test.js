/**
 * registry.test.js - 渲染器注册表行为验证
 *
 * 重点验证平台化的两条底线：
 * 1. 坏插件不能让整个注册流程崩溃；
 * 2. 未覆盖的展示系统能干净地回落到旧路径（绞杀者模式）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getRendererDescriptor,
  listRegistrationFailures,
  listRenderers,
  loadRenderer,
  normalizeRendererParams,
  registerRenderer,
  resetRendererRegistry,
  resolveRendererFromDefinition,
} from './registry.js';
import { RENDERER_CAPABILITIES } from './contract.js';

function makeDescriptor(overrides = {}) {
  return {
    id: 'pointGrid',
    label: '点阵',
    load: () => Promise.resolve({ default: () => null }),
    capabilities: [RENDERER_CAPABILITIES.SIT],
    methods: ['sitData', 'reset'],
    ...overrides,
  };
}

describe('渲染器注册', () => {
  beforeEach(() => {
    resetRendererRegistry();
    vi.restoreAllMocks();
  });

  it('注册合法渲染器后可以取回描述符', () => {
    expect(registerRenderer(makeDescriptor())).toBe(true);
    expect(getRendererDescriptor('pointGrid')?.label).toBe('点阵');
  });

  it('坏插件注册失败但不抛错，且记录原因', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(registerRenderer({ id: 'broken' })).toBe(false);
    expect(registerRenderer(null)).toBe(false);
    expect(registerRenderer(makeDescriptor({ id: 'badCap', capabilities: ['飞天'] }))).toBe(false);
    expect(registerRenderer(makeDescriptor({ id: 'badMethod', methods: ['nope'] }))).toBe(false);

    const failures = listRegistrationFailures();
    expect(failures.map((item) => item.id)).toContain('broken');
    expect(failures.find((item) => item.id === 'badCap')?.errors[0]).toContain('未知能力标记');
  });

  it('optionalMethods 必须是数组且是 methods 的子集', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // 合法用法：标出「换一套参数就不暴露」的那几个，且都在 methods 里。
    // numMatrix 走 sprite3d 还是 canvas2d 后端，暴露面是 4 个还是 14 个。
    expect(registerRenderer(makeDescriptor({
      methods: ['sitData', 'reset'],
      optionalMethods: ['reset'],
    }))).toBe(true);

    // 不在 methods 里的名字，契约审计根本看不到 —— 写在这里只会给人
    // "已经声明过了"的错觉，所以注册阶段就拦掉。
    expect(registerRenderer(makeDescriptor({
      id: 'strayOptional',
      methods: ['sitData'],
      optionalMethods: ['reset'],
    }))).toBe(false);
    expect(listRegistrationFailures().find((item) => item.id === 'strayOptional')?.errors[0])
      .toContain('不在 methods 中');

    // 写成字符串（少打一对方括号）也要拦，否则 for...of 会逐字符校验。
    expect(registerRenderer(makeDescriptor({ id: 'badType', optionalMethods: 'reset' })))
      .toBe(false);

    // 不声明是常态：前两轮的两个渲染器都没有这个字段。
    expect(registerRenderer(makeDescriptor({ id: 'noOptional' }))).toBe(true);
  });

  it('坏插件不影响其他插件注册', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    registerRenderer({ id: 'broken' });
    registerRenderer(makeDescriptor());

    expect(getRendererDescriptor('pointGrid')).not.toBeNull();
    expect(listRenderers()).toHaveLength(1);
  });

  it('按能力过滤渲染器列表', () => {
    registerRenderer(makeDescriptor({ id: 'sitOnly', capabilities: [RENDERER_CAPABILITIES.SIT] }));
    registerRenderer(makeDescriptor({
      id: 'full',
      capabilities: [RENDERER_CAPABILITIES.SIT, RENDERER_CAPABILITIES.BACK],
    }));

    expect(listRenderers({ capabilities: [RENDERER_CAPABILITIES.BACK] }).map((r) => r.id))
      .toEqual(['full']);
    expect(listRenderers()).toHaveLength(2);
  });
});

describe('渲染器懒加载', () => {
  beforeEach(() => {
    resetRendererRegistry();
  });

  it('并发请求共享同一次 import', async () => {
    const load = vi.fn(() => Promise.resolve({ default: 'component' }));
    registerRenderer(makeDescriptor({ load }));

    const [a, b] = await Promise.all([loadRenderer('pointGrid'), loadRenderer('pointGrid')]);

    expect(a).toBe('component');
    expect(b).toBe('component');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('未注册的渲染器返回 rejected promise 而不是抛同步错误', async () => {
    await expect(loadRenderer('missing')).rejects.toThrow('未注册的渲染器');
  });

  it('加载失败后可以重试，不会永久不可用', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('磁盘错误'))
      .mockResolvedValueOnce({ default: 'component' });
    registerRenderer(makeDescriptor({ load }));

    await expect(loadRenderer('pointGrid')).rejects.toThrow('磁盘错误');
    await expect(loadRenderer('pointGrid')).resolves.toBe('component');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('从展示系统定义解析渲染器', () => {
  beforeEach(() => {
    resetRendererRegistry();
    registerRenderer(makeDescriptor({
      normalizeParams: (params) => ({ normalized: true, ...params }),
    }));
  });

  it('按 defaultProfile 选中对应渲染器并归一化参数', () => {
    const resolved = resolveRendererFromDefinition({
      page: {
        defaultProfile: 'default',
        profiles: [{ id: 'default', renderer: 'main' }],
        renderers: [{ id: 'main', type: 'pointGrid', params: { sit: { num1: 16 } } }],
      },
    });

    expect(resolved.rendererId).toBe('pointGrid');
    expect(resolved.params).toEqual({ normalized: true, sit: { num1: 16 } });
  });

  it('显式指定 profileId 时优先使用它', () => {
    const definition = {
      page: {
        defaultProfile: 'a',
        profiles: [{ id: 'a', renderer: 'ra' }, { id: 'b', renderer: 'rb' }],
        renderers: [
          { id: 'ra', type: 'pointGrid', params: { tag: 'a' } },
          { id: 'rb', type: 'pointGrid', params: { tag: 'b' } },
        ],
      },
    };

    expect(resolveRendererFromDefinition(definition, 'b').params.tag).toBe('b');
  });

  it('渲染器未注册时返回 null，交由调用方回落旧场景分支', () => {
    const resolved = resolveRendererFromDefinition({
      page: { renderers: [{ id: 'main', type: 'wholeChair' }] },
    });

    expect(resolved).toBeNull();
  });

  it('定义缺失或无 renderers 时返回 null 而不是抛错', () => {
    expect(resolveRendererFromDefinition(null)).toBeNull();
    expect(resolveRendererFromDefinition({})).toBeNull();
    expect(resolveRendererFromDefinition({ page: { renderers: [] } })).toBeNull();
  });
});

describe('参数归一化委派', () => {
  beforeEach(() => {
    resetRendererRegistry();
  });

  it('渲染器未声明 normalizeParams 时原样返回', () => {
    registerRenderer(makeDescriptor());
    expect(normalizeRendererParams('pointGrid', { a: 1 })).toEqual({ a: 1 });
  });

  it('未注册渲染器返回空对象而不是抛错', () => {
    expect(normalizeRendererParams('missing', { a: 1 })).toEqual({ a: 1 });
    expect(normalizeRendererParams('missing', null)).toEqual({});
  });
});
