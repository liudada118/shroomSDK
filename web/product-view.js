/**
 * 产品二维视图：手套按五指、独立指腹和非齐行手掌展示；检测垫复用矩阵热力图。
 * 只消费已解析的产品帧；显示增益和刷新节流不修改数据源，也不影响服务端录制。
 */
import { createHeatmap } from './heatmap.js';
import { getColormap } from '../core/colormap.js';
import { ShroomError } from '../core/errors.js';

const productViewFingerNames = { thumb: '大拇指', index: '食指', middle: '中指', ring: '无名指', little: '小拇指' };

/** 把不支持的产品或损坏的形状作为清晰的应用错误返回。 */
function productViewError(message, code = 'INVALID_CONFIG') {
  return new ShroomError(code, message, { stage: 'render' });
}

/** 只接受真实存在的点位，不为手掌缺失的三个点补零。 */
function productViewValidateRegion(region, rowLengths, name) {
  const size = rowLengths.reduce((sum, value) => sum + value, 0);
  if (!region || region.rows !== rowLengths.length || region.cols !== Math.max(...rowLengths)
    || !Array.isArray(region.rowLengths) || region.rowLengths.length !== rowLengths.length
    || region.rowLengths.some((length, i) => length !== rowLengths[i])
    || region.raw?.length !== size || region.values?.length !== size
    || !Array.from(region.raw).every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    || !Array.from(region.values).every((value) => Number.isFinite(value) && value >= 0)) {
    throw productViewError(`${name}分区形状无效，请传入 SDK 产品帧`, 'PARSE_FAILED');
  }
}

/** 校验产品帧的最小绘制契约，拒绝把通用矩阵误画成手套。 */
function productViewValidateFrame(frame) {
  if (frame?.product === 'hand') {
    if (frame.rows !== 32 || frame.cols !== 32 || frame.values?.length !== 1024
      || !Array.from(frame.values).every((value) => Number.isFinite(value) && value >= 0)) {
      throw productViewError('手部检测垫需要 32×32 的有效数据', 'PARSE_FAILED');
    }
  } else if (frame?.product === 'handGloveFullPacket') {
    if (!['left', 'right'].includes(frame.side)) throw productViewError('手套数据缺少左右手信息', 'PARSE_FAILED');
    for (const [key, name] of Object.entries(productViewFingerNames)) {
      productViewValidateRegion(frame.fingers?.[key], [3, 3, 3, 3], name);
      productViewValidateRegion(frame.fingers[key].pulp, [1], `${name}指腹`);
    }
    productViewValidateRegion(frame.palm, [12, 15, 15, 15, 15], '手掌');
  } else throw productViewError('产品视图仅支持整包触觉手套和手部检测垫');
}

/**
 * 创建产品展示并可自动订阅数据源；手套为二维分区图，并非三维手模。
 * @param {HTMLElement|string} target 普通容器或选择器，不能直接传 canvas。
 * @param {object} [options] source 可传设备或 WS 客户端；不传时由应用手动调用 render。
 * @returns {object} 提供 render/resize/destroy；destroy 释放视图订阅，数据源由调用方关闭。
 */
export function createProductView(target, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw productViewError('视图选项需要配置对象');
  const container = typeof target === 'string' ? globalThis.document?.querySelector(target) : target;
  if (!container || typeof container.appendChild !== 'function' || container.tagName === 'CANVAS') {
    throw productViewError('createProductView 需要一个页面容器，例如 <div id="view">');
  }
  if (options.source && typeof options.source.onData !== 'function' && typeof options.source.onFrame !== 'function') {
    throw productViewError('source 需要提供 onData 或 onFrame 订阅方法');
  }
  const initialProduct = options.product ?? options.source?.info?.product;
  if (initialProduct && !['handGloveFullPacket', 'hand'].includes(initialProduct)) throw productViewError('当前产品不支持标准视图');
  const documentRef = container.ownerDocument ?? document;
  const root = documentRef.createElement('section');
  root.setAttribute('aria-label', 'Shroom 产品实时数据');
  Object.assign(root.style, { color: '#e6edf3', fontFamily: 'system-ui, "Microsoft YaHei", sans-serif', lineHeight: '1.6' });
  const heading = documentRef.createElement('div');
  heading.textContent = '等待产品数据';
  Object.assign(heading.style, { fontSize: '16px', fontWeight: '600', marginBottom: '12px' });
  const content = documentRef.createElement('div');
  Object.assign(content.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '12px' });
  const legend = documentRef.createElement('p');
  legend.textContent = '相对压力：低 → 高 · 蓝—青—绿—黄—红。数值为原始 ADC，非牛顿或 kPa。';
  Object.assign(legend.style, { color: '#b4bec9', fontSize: '13px', margin: '12px 0 0' });
  root.appendChild(heading);
  root.appendChild(content);
  root.appendChild(legend);
  container.appendChild(root);
  let product = null;
  let side = null;
  let heatmap = null;
  let lastFrame = null;
  let pending = null;
  let rafId = 0;
  let destroyed = false;
  let unsubscribe = null;
  let observer = null;
  const cards = new Map();
  const color = getColormap(options.colormap ?? 'jet');
  const gain = options.gain ?? 1;
  if (typeof gain !== 'number' || !Number.isFinite(gain) || gain <= 0) {
    root.remove();
    throw productViewError('gain 应为大于 0 的有限数字');
  }

  /** 为一个区域创建有名称、读数和独立画布的卡片。 */
  function makeRegionCard(key, title, palm = false) {
    const card = documentRef.createElement('div');
    Object.assign(card.style, { border: '1px solid #30363d', borderRadius: '8px', padding: '12px', background: '#0d1117', minWidth: '0' });
    if (palm) card.style.gridColumn = '1 / -1';
    const label = documentRef.createElement('div');
    label.textContent = title;
    label.style.fontWeight = '600';
    const canvas = documentRef.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${title}相对压力分布`);
    Object.assign(canvas.style, { display: 'block', width: '100%', height: palm ? '180px' : '144px', margin: '8px 0' });
    const stats = documentRef.createElement('div');
    Object.assign(stats.style, { fontSize: '12px', color: '#b4bec9', whiteSpace: 'pre-line' });
    card.appendChild(label);
    card.appendChild(canvas);
    card.appendChild(stats);
    let pulpCanvas = null;
    let pulpStats = null;
    if (!palm) {
      const pulpLabel = documentRef.createElement('div');
      pulpLabel.textContent = '独立指腹';
      Object.assign(pulpLabel.style, { fontSize: '13px', marginTop: '12px' });
      pulpCanvas = documentRef.createElement('canvas');
      pulpCanvas.setAttribute('role', 'img');
      pulpCanvas.setAttribute('aria-label', `${title}指腹相对压力`);
      Object.assign(pulpCanvas.style, { width: '32px', height: '32px', display: 'inline-block', verticalAlign: 'middle', margin: '6px 8px 0 0' });
      pulpStats = documentRef.createElement('span');
      pulpStats.style.fontSize = '13px';
      card.appendChild(pulpLabel);
      card.appendChild(pulpCanvas);
      card.appendChild(pulpStats);
    }
    content.appendChild(card);
    cards.set(key, { card, canvas, stats, pulpCanvas, pulpStats });
  }

  /** 切换产品时销毁旧画布；不影响外部的数据连接或录制。 */
  function prepare(frame) {
    if (product === frame.product && side === frame.side) return;
    heatmap?.clear();
    heatmap = null;
    content.replaceChildren();
    cards.clear();
    product = frame.product;
    side = frame.side;
    if (product === 'hand') {
      heading.textContent = '手部检测垫 · 32 × 32';
      const canvas = documentRef.createElement('canvas');
      Object.assign(canvas.style, { display: 'block', width: '100%', height: 'auto', aspectRatio: '1', gridColumn: '1 / -1', maxHeight: '560px', background: '#0d1117' });
      canvas.width = 512;
      canvas.height = 512;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', '手部检测垫 32×32 相对压力分布');
      content.appendChild(canvas);
      heatmap = createHeatmap(canvas, { mode: 'grid', smooth: false, ...options, gain });
    } else {
      heading.textContent = `${side === 'left' ? '左手' : '右手'}触觉手套 · 二维分区视图`;
      const order = side === 'left' ? ['little', 'ring', 'middle', 'index', 'thumb'] : ['thumb', 'index', 'middle', 'ring', 'little'];
      for (const key of order) makeRegionCard(key, productViewFingerNames[key]);
      makeRegionCard('palm', '手掌 · 72 个有效点（行长 12 / 15 / 15 / 15 / 15）', true);
    }
  }

  /** 在实际行长内逐点着色，空缺位置保持空白而不是伪造零值。 */
  function paintRegion(canvas, region) {
    const dpr = globalThis.window?.devicePixelRatio || 1;
    const width = Math.max(1, Math.round((canvas.clientWidth || 160) * dpr));
    const height = Math.max(1, Math.round((canvas.clientHeight || 144) * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw productViewError('浏览器无法创建 Canvas 2D 画布', 'UNSUPPORTED_ENVIRONMENT');
    ctx.clearRect(0, 0, width, height);
    const cellWidth = width / region.cols;
    const cellHeight = height / region.rows;
    const gap = Math.max(1, Math.min(cellWidth, cellHeight) * 0.06);
    let index = 0;
    for (let row = 0; row < region.rows; row += 1) {
      for (let col = 0; col < region.rowLengths[row]; col += 1) {
        const rgb = color(Math.max(0, Math.min(1, region.values[index++] * gain)));
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fillRect(col * cellWidth + gap, row * cellHeight + gap, Math.max(1, cellWidth - gap * 2), Math.max(1, cellHeight - gap * 2));
      }
    }
    const raw = Array.from(region.raw);
    canvas.title = `ADC：${raw.join(', ')}`;
    return { max: Math.max(...raw), average: raw.reduce((sum, value) => sum + value, 0) / raw.length };
  }

  /** 绘制最新的产品快照；绘制频率不决定录制帧数。 */
  function draw(frame) {
    if (destroyed) return;
    prepare(frame);
    lastFrame = frame;
    if (heatmap) { heatmap.render(frame); return; }
    for (const [key, card] of cards) {
      const region = key === 'palm' ? frame.palm : frame.fingers[key];
      const stats = paintRegion(card.canvas, region);
      card.stats.textContent = `${region.raw.length} 点 · 最大 ${stats.max}\n均值 ${stats.average.toFixed(1)} ADC`;
      if (card.pulpCanvas) {
        paintRegion(card.pulpCanvas, region.pulp);
        card.pulpStats.textContent = `${region.pulp.raw[0]} ADC`;
      }
    }
  }

  /** 合并同一屏幕刷新周期的数据，只绘制最新一帧。 */
  function render(frame) {
    if (destroyed) return;
    productViewValidateFrame(frame);
    if (initialProduct && frame.product !== initialProduct) throw productViewError('数据帧产品与连接产品不一致', 'PARSE_FAILED');
    pending = frame;
    if (typeof requestAnimationFrame !== 'function') { pending = null; draw(frame); return; }
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const next = pending;
      pending = null;
      if (next) draw(next);
    });
  }

  /** 容器尺寸变化后重画最近一帧，不更改或补齐原始传感数据。 */
  function resize() { if (!destroyed && lastFrame) render(lastFrame); }

  /** 解除自动订阅、观察器及刷新任务，只移除本视图创建的内容。 */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (typeof unsubscribe === 'function') unsubscribe();
    observer?.disconnect();
    if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    rafId = 0;
    pending = null;
    lastFrame = null;
    heatmap?.clear();
    cards.clear();
    root.remove();
  }

  try {
    if (typeof ResizeObserver === 'function') { observer = new ResizeObserver(resize); observer.observe(container); }
    if (options.source) {
      const subscribe = options.source.onData ?? options.source.onFrame;
      unsubscribe = subscribe.call(options.source, render);
    }
  } catch (error) { destroy(); throw error; }
  return { render, resize, destroy, get element() { return root; }, get product() { return product; } };
}
