/**
 * shaders.test.js - 生成的片元着色器与两份原件逐行相同
 *
 * `buildFragmentShader()` 是把两份手写 GLSL 合成的一份模板 + 两个布尔开关。
 * 「合并没合错」这件事在 Node 里没法靠运行来验（没有 GL 上下文），所以采用与
 * `layouts.test.js` / `jetLadder.test.js` 同一套办法：**把两份原件逐字内联**，
 * 再拿生成结果与它们比对。
 *
 * 比的是 `main()` 的**函数体逐行相同**（归一化空白之后），不是"包含某几个
 * 关键字"。后者挡不住漏掉一行 `return;` 这类改观感的错。
 *
 * 中间那个 `jet1()` 不在这里比 —— 它由 `glslJetLadder()` 发码，已经被
 * `core/jetLadder.test.js` 逐字锁死，这里只确认它确实被插进去了。
 */

import { describe, expect, it } from 'vitest';

import { glslJetLadder } from '../../../core/colormaps.js';
import {
  FRAGMENT_VARIANTS,
  QUAD_POSITIONS,
  QUAD_TEX_COORDS,
  VERTEX_SHADER_SRC,
  buildFragmentShader,
} from './shaders.js';

/** `Num2D.jsx:80-89` 的顶点着色器，逐字内联。`Num2Doriginal.jsx:96-104` 与之一字不差。 */
const LEGACY_VERTEX_SRC = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

/** `Num2D.jsx:91-131` 的片元着色器，逐字内联。 */
const LEGACY_PLAIN_SRC = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_data;
  uniform float u_min;
  uniform float u_max;

  vec3 jet1(float minVal, float maxVal, float x) {
    if (x < minVal) x = minVal;
    if (x > maxVal) x = maxVal;
    float dv = maxVal - minVal;
    if (dv == 0.0) return vec3(0.0, 0.0, 1.0);
    float t = (x - minVal) / dv;

    float r = 1.0, g = 1.0, b = 1.0;
    if (t < 0.25) {
      r = 0.0;
      g = 4.0 * t;
      b = 1.0;
    } else if (t < 0.5) {
      r = 0.0;
      g = 1.0;
      b = 1.0 - 4.0 * (t - 0.25);
    } else if (t < 0.75) {
      r = 4.0 * (t - 0.5);
      g = 1.0;
      b = 0.0;
    } else {
      r = 1.0;
      g = 1.0 - 4.0 * (t - 0.75);
      b = 0.0;
    }
    return vec3(r, g, b);
  }

  void main() {
    float value = texture2D(u_data, v_texCoord).r * 255.0;
    vec3 color = jet1(u_min, u_max, value);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** `Num2Doriginal.jsx:106-162` 的片元着色器，逐字内联（含那句中文注释）。 */
const LEGACY_MASKED_SRC = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_data;
  uniform sampler2D u_mask;
  uniform float u_min;
  uniform float u_max;
  uniform float u_useMask;
  uniform vec2 u_texScale;

  vec3 jet1(float minVal, float maxVal, float x) {
    if (x < minVal) x = minVal;
    if (x > maxVal) x = maxVal;
    float dv = maxVal - minVal;
    if (dv == 0.0) return vec3(0.0, 0.0, 1.0);
    float t = (x - minVal) / dv;

    float r = 1.0, g = 1.0, b = 1.0;
    if (t < 0.25) {
      r = 0.0;
      g = 4.0 * t;
      b = 1.0;
    } else if (t < 0.5) {
      r = 0.0;
      g = 1.0;
      b = 1.0 - 4.0 * (t - 0.25);
    } else if (t < 0.75) {
      r = 4.0 * (t - 0.5);
      g = 1.0;
      b = 0.0;
    } else {
      r = 1.0;
      g = 1.0 - 4.0 * (t - 0.75);
      b = 0.0;
    }
    return vec3(r, g, b);
  }

  void main() {
    vec2 scaledCoord = v_texCoord * u_texScale;
    float value = texture2D(u_data, scaledCoord).r * 255.0;
    if (u_useMask > 0.5) {
      float maskVal = texture2D(u_mask, scaledCoord).r;
      if (maskVal < 0.5) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        return;
      }
    }
    // 0值显示白色背景
    if (value < 0.5) {
      gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
      return;
    }
    vec3 color = jet1(u_min, u_max, value);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** 归一化空白：GLSL 的缩进不参与语义，但漏行、多行都要露出来。 */
function lines(source) {
  return source.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** 取 `main()` 的函数体（含签名与收尾大括号）。两份源码里 main 都是最后一段。 */
function mainBody(source) {
  const at = source.indexOf('void main()');
  expect(at).toBeGreaterThan(-1);
  return lines(source.slice(at));
}

/** 收集 uniform / varying 声明。GLSL 不在乎声明次序，所以排序后比集合。 */
function declarations(source) {
  return (source.match(/^\s*(?:uniform|varying)\s+[\w]+\s+\w+;/gm) || [])
    .map((line) => line.trim())
    .sort();
}

describe('顶点着色器与全屏四边形', () => {
  it('与原件逐行相同', () => {
    expect(lines(VERTEX_SHADER_SRC)).toEqual(lines(LEGACY_VERTEX_SRC));
  });

  it('两个三角形铺满裁剪空间，v 是翻过来的', () => {
    expect(QUAD_POSITIONS).toHaveLength(12);
    expect(QUAD_TEX_COORDS).toHaveLength(12);
    // 左下角顶点 (-1,-1) 对应纹理 (0,1) —— 纹理第 0 行画在画面顶部。
    expect([QUAD_POSITIONS[0], QUAD_POSITIONS[1]]).toEqual([-1, -1]);
    expect([QUAD_TEX_COORDS[0], QUAD_TEX_COORDS[1]]).toEqual([0, 1]);
    // 每个分量都在 [-1,1] / [0,1] 内。
    QUAD_POSITIONS.forEach((v) => expect(Math.abs(v)).toBe(1));
    QUAD_TEX_COORDS.forEach((v) => expect([0, 1]).toContain(v));
  });
});

describe('片元着色器：plain 变体 = Num2D.jsx', () => {
  const generated = buildFragmentShader(FRAGMENT_VARIANTS.plain);

  it('main() 内联掉 scaledCoord 之后与原件逐行相同', () => {
    // 生成的那份总是先算 `scaledCoord = v_texCoord * u_texScale`，plain 关掉
    // POT 时后端传 (1,1)，乘 1 是恒等变换。把这一步内联回去再比，剩下的必须一字不差。
    const inlined = mainBody(generated)
      .filter((line) => !line.startsWith('vec2 scaledCoord'))
      .map((line) => line.replace(/scaledCoord/g, 'v_texCoord'));
    expect(inlined).toEqual(mainBody(LEGACY_PLAIN_SRC));
  });

  it('声明面只比原件多一个 u_texScale', () => {
    expect(declarations(generated)).toEqual(
      [...declarations(LEGACY_PLAIN_SRC), 'uniform vec2 u_texScale;'].sort(),
    );
  });

  it('没有掩码相关的任何东西', () => {
    expect(generated).not.toContain('u_mask');
    expect(generated).not.toContain('u_useMask');
    expect(generated).not.toContain('maskVal');
  });

  it('没有零值显白那一支', () => {
    expect(generated).not.toContain('value < 0.5');
    expect(generated).not.toContain('vec4(1.0, 1.0, 1.0, 1.0)');
  });
});

describe('片元着色器：masked + whiteOnZero 变体 = Num2Doriginal.jsx', () => {
  const generated = buildFragmentShader(FRAGMENT_VARIANTS.maskedWhiteOnZero);

  it('main() 与原件逐行相同，一处不差', () => {
    expect(mainBody(generated)).toEqual(mainBody(LEGACY_MASKED_SRC));
  });

  it('声明面与原件完全相同', () => {
    expect(declarations(generated)).toEqual(declarations(LEGACY_MASKED_SRC));
  });

  it('掩码判断排在零值判断之前 —— 照抄原件的次序', () => {
    // 两支都输出白，眼下换次序不改画面；钉住是为了将来谁改了其中一支。
    expect(generated.indexOf('u_useMask > 0.5')).toBeLessThan(generated.indexOf('value < 0.5'));
  });

  it('两支提前返回都带 return —— 漏掉就会被后面的配色覆盖', () => {
    expect(generated.match(/gl_FragColor = vec4\(1\.0, 1\.0, 1\.0, 1\.0\);\s*\n\s*return;/g))
      .toHaveLength(2);
  });
});

describe('片元着色器：开关是正交的', () => {
  it('四个变体两两不同', () => {
    const sources = Object.values(FRAGMENT_VARIANTS).map((v) => buildFragmentShader(v));
    expect(new Set(sources).size).toBe(4);
  });

  it('useMask 只加掩码，whiteOnZero 只加零值支', () => {
    const masked = buildFragmentShader(FRAGMENT_VARIANTS.masked);
    const white = buildFragmentShader(FRAGMENT_VARIANTS.whiteOnZero);
    expect(masked).toContain('u_useMask');
    expect(masked).not.toContain('value < 0.5');
    expect(white).toContain('value < 0.5');
    expect(white).not.toContain('u_useMask');
  });

  it('缺省参数等于 plain', () => {
    expect(buildFragmentShader()).toBe(buildFragmentShader(FRAGMENT_VARIANTS.plain));
    expect(buildFragmentShader({})).toBe(buildFragmentShader(FRAGMENT_VARIANTS.plain));
  });

  it('u_texScale 四个变体都发 —— 后端不必判断它在不在', () => {
    Object.values(FRAGMENT_VARIANTS).forEach((variant) => {
      expect(buildFragmentShader(variant)).toContain('uniform vec2 u_texScale;');
    });
  });
});

describe('配色是可替换的注入点', () => {
  it('缺省插的是 glslJetLadder() 那一份', () => {
    // 缩进两格之后逐行嵌进模板，所以比 trim 过的行。
    const generated = buildFragmentShader();
    lines(glslJetLadder('jet1')).forEach((line) => {
      expect(lines(generated)).toContain(line);
    });
  });

  it('传 colormapGlsl 就换掉配色，其余一行不变', () => {
    const stub = 'vec3 jet1(float minVal, float maxVal, float x) {\n  return vec3(0.5);\n}';
    const generated = buildFragmentShader({ colormapGlsl: stub });
    expect(generated).toContain('return vec3(0.5);');
    expect(generated).not.toContain('if (t < 0.25)');
    // main() 不受影响 —— 换配色不该动采样与输出。
    expect(mainBody(generated)).toEqual(mainBody(buildFragmentShader()));
  });
});
