/**
 * registry.js - 渲染器插件注册表
 *
 * 与 displays/registry.js 的分工：
 * - displays/registry.js 管"展示系统"（一台设备的完整定义：协议、矩阵、通道、视图）
 * - 本文件管"渲染器"（把一帧数据画出来的那段实现）
 *
 * 拆开的原因是：多个展示系统会共用同一个渲染器，只是参数不同。
 * 例如 matCol 与 carCol 是两个展示系统，但渲染器是同一个，
 * 差别仅在 sit.num1 和 sit.order 两个数字。
 *
 * 渲染器一律通过动态 import 懒加载。Home.jsx 目前静态导入了 55 个
 * 场景组件，全部打进同一个 chunk（959KB），而运行时只会用到其中一个。
 */

import { validateRendererDescriptor } from './contract.js';

/** 已注册的渲染器描述符，key 为渲染器 id */
const RENDERER_REGISTRY = new Map();

/** 已解析的渲染器组件缓存，避免同一渲染器重复 import */
const LOADED_RENDERERS = new Map();

/** 注册失败记录，供设置页展示"此模块加载失败"而不是整体崩溃 */
const REGISTRATION_FAILURES = new Map();

/**
 * 注册一个渲染器插件。
 *
 * 校验失败时不抛错，而是记录失败原因并返回 false。坏插件不应该
 * 让整个应用起不来——这是平台化的底线要求。
 *
 * @param {object} descriptor 渲染器描述符。
 * @param {string} descriptor.id 渲染器唯一标识。
 * @param {() => Promise<{ default: React.ComponentType }>} descriptor.load 动态导入函数。
 * @param {string} [descriptor.label] 展示名称。
 * @param {string[]} [descriptor.capabilities] 能力标记。
 * @param {string[]} [descriptor.methods] 支持的命令式方法。
 * @param {(params: object) => object} [descriptor.normalizeParams] 参数归一化函数。
 * @returns {boolean} 是否注册成功。
 */
export function registerRenderer(descriptor) {
  const { valid, errors } = validateRendererDescriptor(descriptor);

  if (!valid) {
    const id = descriptor?.id || '<未命名渲染器>';
    REGISTRATION_FAILURES.set(id, errors);
    console.error(`[renderers] 渲染器 ${id} 注册失败:`, errors.join('; '));
    return false;
  }

  REGISTRATION_FAILURES.delete(descriptor.id);
  RENDERER_REGISTRY.set(descriptor.id, {
    label: descriptor.id,
    capabilities: [],
    methods: [],
    ...descriptor,
  });
  return true;
}

/**
 * 读取渲染器描述符。
 *
 * @param {string} id 渲染器 id。
 * @returns {object | null} 描述符，未注册时返回 null。
 */
export function getRendererDescriptor(id) {
  return RENDERER_REGISTRY.get(id) || null;
}

/**
 * 列出全部已注册渲染器。
 *
 * 供 Display System Builder 生成渲染器下拉列表。
 *
 * @param {object} [filter] 过滤条件。
 * @param {string[]} [filter.capabilities] 要求同时具备的能力。
 * @returns {object[]} 渲染器描述符数组。
 */
export function listRenderers(filter = {}) {
  const required = filter.capabilities || [];
  return [...RENDERER_REGISTRY.values()].filter((descriptor) => (
    required.every((capability) => descriptor.capabilities.includes(capability))
  ));
}

/**
 * 列出注册失败的渲染器及原因。
 *
 * @returns {Array<{ id: string, errors: string[] }>} 失败列表。
 */
export function listRegistrationFailures() {
  return [...REGISTRATION_FAILURES.entries()].map(([id, errors]) => ({ id, errors }));
}

/**
 * 懒加载渲染器组件。
 *
 * 同一渲染器并发请求时共享同一个 Promise，避免重复 import。
 * 加载失败会清除缓存，使得下次调用可以重试——网络或磁盘的瞬时错误
 * 不应该让这个渲染器在本次会话里永久不可用。
 *
 * @param {string} id 渲染器 id。
 * @returns {Promise<React.ComponentType>} 渲染器组件。
 */
export function loadRenderer(id) {
  if (LOADED_RENDERERS.has(id)) return LOADED_RENDERERS.get(id);

  const descriptor = RENDERER_REGISTRY.get(id);
  if (!descriptor) {
    return Promise.reject(new Error(`未注册的渲染器: ${id}`));
  }

  const pending = Promise.resolve()
    .then(() => descriptor.load())
    .then((module) => module?.default || module)
    .catch((error) => {
      LOADED_RENDERERS.delete(id);
      throw error;
    });

  LOADED_RENDERERS.set(id, pending);
  return pending;
}

/**
 * 归一化某个渲染器的参数。
 *
 * 渲染器自带 normalizeParams 时交由它处理，否则原样返回。
 * 这样参数校验规则跟着渲染器走，注册表本身不需要认识任何具体参数。
 *
 * @param {string} id 渲染器 id。
 * @param {object} params 原始参数。
 * @returns {object} 归一化后的参数。
 */
export function normalizeRendererParams(id, params) {
  const descriptor = RENDERER_REGISTRY.get(id);
  if (!descriptor?.normalizeParams) return params || {};
  return descriptor.normalizeParams(params || {});
}

/**
 * 从展示系统定义中解析出渲染器 id 与参数。
 *
 * 兼容三种来源，优先级从高到低：
 * 1. manifest 显式声明的 display.renderers[].type
 * 2. 展示系统定义上的 rendererId
 * 3. 回落到 null，由调用方决定是否走 Home.jsx 的旧场景分支
 *
 * 回落这一步是绞杀者模式的关键：新渲染器覆盖不到的展示系统
 * 继续走旧路径，迁移可以一次一个，不必一次性切换。
 *
 * @param {object} definition 展示系统定义。
 * @param {string} [profileId] 指定的显示方案 id。
 * @returns {{ rendererId: string, params: object } | null} 解析结果。
 */
export function resolveRendererFromDefinition(definition, profileId) {
  if (!definition) return null;

  const page = definition.page || {};
  const renderers = Array.isArray(page.renderers) ? page.renderers : [];
  const profiles = Array.isArray(page.profiles) ? page.profiles : [];

  const profile = profileId
    ? profiles.find((item) => item.id === profileId)
    : profiles.find((item) => item.id === page.defaultProfile) || profiles[0];

  const rendererEntry = renderers.find((item) => item.id === profile?.renderer)
    || renderers.find((item) => item.id === definition.rendererId)
    || renderers[0];

  const rendererId = rendererEntry?.type || definition.rendererId;
  if (!rendererId || !RENDERER_REGISTRY.has(rendererId)) return null;

  return {
    rendererId,
    params: normalizeRendererParams(rendererId, rendererEntry?.params),
  };
}

/**
 * 清空注册表。仅供测试使用。
 */
export function resetRendererRegistry() {
  RENDERER_REGISTRY.clear();
  LOADED_RENDERERS.clear();
  REGISTRATION_FAILURES.clear();
}
