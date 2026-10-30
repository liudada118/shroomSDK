/**
 * 调色板：把 0~1 的值映射成颜色。
 *
 * 内置 shroom、jet、jetWhite、grey；均返回 0~255 的 [R, G, B] 数组。
 * 输入先限制到 0~1，新增配色可向 COLORMAPS 注册同签名函数。
 */

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 经典 jet 彩虹配色：蓝 → 青 → 绿 → 黄 → 红 */
export function jet(t) {
  const x = clamp01(t);
  let r = 1;
  let g = 1;
  let b = 1;
  if (x < 0.25) {
    r = 0;
    g = 4 * x;
  } else if (x < 0.5) {
    r = 0;
    b = 1 + 4 * (0.25 - x);
  } else if (x < 0.75) {
    r = 4 * (x - 0.5);
    b = 0;
  } else {
    g = 1 + 4 * (0.75 - x);
    b = 0;
  }
  return [Math.round(255 * r), Math.round(255 * g), Math.round(255 * b)];
}

/** 白底 jet：0 是白色，压力越大越红。适合打印和浅色界面 */
export function jetWhite(t) {
  const x = clamp01(t);
  if (x <= 0.001) return [255, 255, 255];
  const [r, g, b] = jet(x);
  const fade = Math.min(1, x / 0.15);
  return [
    Math.round(255 + (r - 255) * fade),
    Math.round(255 + (g - 255) * fade),
    Math.round(255 + (b - 255) * fade),
  ];
}

/** 灰度：黑到白 */
export function grey(t) {
  const v = Math.round(255 * clamp01(t));
  return [v, v, v];
}

/**
 * Shroom 上位机同款配色：深紫底 → 蓝紫 → 青 → 绿 → 黄 → 红。
 * 色标和取值点跟正式上位机一致，两边看到的颜色能对上。
 */
const SHROOM_STOPS = [
  [0.0, [21, 18, 42]],
  [0.4, [62, 0, 248]],
  [0.55, [149, 253, 237]],
  [0.7, [154, 255, 62]],
  [0.85, [246, 254, 71]],
  [1.0, [216, 36, 36]],
];

/** 按相邻色标做 RGB 线性插值，保持与 Shroom 上位机一致的色阶。 */
export function shroom(t) {
  const x = clamp01(t);
  for (let i = 1; i < SHROOM_STOPS.length; i += 1) {
    const [p1, c1] = SHROOM_STOPS[i];
    if (x > p1) continue;
    const [p0, c0] = SHROOM_STOPS[i - 1];
    const k = p1 === p0 ? 0 : (x - p0) / (p1 - p0);
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * k),
      Math.round(c0[1] + (c1[1] - c0[1]) * k),
      Math.round(c0[2] + (c1[2] - c0[2]) * k),
    ];
  }
  return SHROOM_STOPS[SHROOM_STOPS.length - 1][1].slice();
}

export const COLORMAPS = { shroom, jet, jetWhite, grey };

/** 按名字取调色板，取不到就回退到 jet；直接传函数时原样返回，供调用方自定义颜色。 */
export function getColormap(name) {
  if (typeof name === 'function') return name;
  return COLORMAPS[name] ?? jet;
}
