/**
 * 渲染器独立入口。
 *
 * 此入口只静态导出纯逻辑和注册函数，不静态加载 React/Three 渲染组件，
 * 从而保留按需加载和独立代码分块。
 */
export { registerBuiltinRenderers } from './builtins.js';

export * as numMatrix from './numMatrix/core/index.js';
export * as pointGrid from './pointGrid/core/index.js';
export * as handPoints from './handPoints/core/index.js';
export * as webglHeatmap from './webglHeatmap/core/index.js';
export * as blobHeatmap from './blobHeatmap/core/index.js';
