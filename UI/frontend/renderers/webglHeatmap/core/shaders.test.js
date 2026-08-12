/**
 * shaders.test.js - 生成的着色器与原件等价
 *
 * 四段 GLSL 里有三段是**逐字搬**的（两段斑点 + 合成顶点），只把原件的 `"\ … \"`
 * 行尾续行换成了模板字符串 —— 那三段用「归一化空白后逐行相同」钉住。
 *
 * 第四段（合成片元）不是逐字搬：色带由 `core/colormaps.js` 的 `HEAT_BLOB_STOPS`
 * **发码**（`glslStopLadder`），而不是手抄第二份。所以它比的不是文本，是**语义**：
 *
 * 1. 发出来的阶梯，断点与两端颜色逐个等于原件里那八个 `const vec3 cN` 和七个
 *    `if(p <= X)` —— 两者都从内联的原件源码里正则抽出来比，不是我复述一遍。
 * 2. `sampleHeatBlobsRgb()`（JS 侧，色卡在用）与 GLSL 侧
 *    `linearToSRGB(getColorByPercent(p))` 算出同一个颜色 —— 这条保证文档站的
 *    色卡和屏幕上的出图是同一个配色，不是两套。
 *
 * 为什么值得这么比：GLSL 那段是唯一一处「色带写在着色器里」的配色，前两轮把 18
 * 份 jet 阶梯收敛成一份时就漏过它一次（躲在模板字符串里，`grep "function jet"`
 * 扫不到）。这次发码 + 这个文件，让它没法再漂。
 */

import { describe, expect, it } from 'vitest';

import { HEAT_BLOB_STOPS, glslStopLadder, sampleColormapRgb } from '../../../core/colormaps.js';
import {
  BLOB_ALPHA_CUTOFF,
  BLOB_FRAGMENT_SHADER,
  BLOB_VERTEX_SHADER,
  COMPOSITE_FRAGMENT_SHADER,
  COMPOSITE_VERTEX_SHADER,
  buildCompositeFragmentShader,
} from './shaders.js';

/** `WebGL.HeatMap copy 2.js:3-30` 的 `vertexShader`，逐字内联（续行换成真换行）。 */
const LEGACY_BLOB_VERTEX = `
attribute vec4 a_Position;
uniform vec2 u_resolution;
uniform float u_maxClick;
uniform float u_minClick;
uniform float u_filterClick;
attribute float a_click;
attribute vec2 a_center;
attribute float a_radius;
varying vec2 v_center;
varying vec2 v_resolution;
varying float v_radius;
varying float v_maxClick;
varying float v_minClick;
varying float v_filterClick;
varying float v_click;
void main() {
        gl_PointSize = a_radius * 2.0;
        vec2 clipspace = a_center / u_resolution * 2.0 - 1.0;
        gl_Position = vec4(clipspace * vec2(1, -1), 0, 1);
        v_center = a_center;
        v_resolution = u_resolution;
        v_radius = a_radius - 1.0;
        v_maxClick = u_maxClick;
        v_minClick = u_minClick;
        v_filterClick = u_filterClick;
        v_click = a_click;
}`;

/** `WebGL.HeatMap copy 2.js:31-73` 的 `fragmentShader`，逐字内联。 */
const LEGACY_BLOB_FRAGMENT = `
precision mediump float;
varying vec2 v_center;
varying vec2 v_resolution;
varying float v_radius;
varying float v_maxClick;
varying float v_minClick;
varying float v_filterClick;
varying float v_click;
varying float v_groupIdx;
uniform float u_blurFactor;
void main() {
        vec4 color0 = vec4(0.0, 0.0, 0.0, 0.0);
        float x = gl_FragCoord.x;
        float y = v_resolution[1] - gl_FragCoord.y;
        float dx = v_center[0] - x;
        float dy = v_center[1] - y;
        float distance = sqrt(dx*dx + dy*dy);
        float diff = v_radius-distance;
        float currentPercent=0.95;
        float blurFactory=u_blurFactor;
        float pxAlpha=0.0;
        if(v_maxClick>= v_click && v_click>= v_minClick){
            pxAlpha = (v_click-v_minClick)/(v_maxClick-v_minClick);
        }
        if(v_click>= v_maxClick){
            pxAlpha = 1.0;
        }
        if ( diff >  0.0 ) {
            if(diff > v_radius * blurFactory) {
                gl_FragColor = vec4(0,0,0,pxAlpha);
            } else {
                float p=diff/(v_radius*blurFactory);
                gl_FragColor = vec4(0,0,0,p*pxAlpha);
            }
        } else {
            if ( diff >= 0.0 && diff <= 1.0 ){
            }
            else{
                gl_FragColor = vec4(0,0,0,0);
            }
        }
}`;

/** `WebGL.HeatMap copy 2.js:74-78` 的 `vertexShader1`，逐字内联。 */
const LEGACY_COMPOSITE_VERTEX = `
attribute vec4 a_Position;
void main(void){
    gl_Position = a_Position;
}`;

/** `WebGL.HeatMap copy 2.js:79-135` 的 `fragmentShader1`，逐字内联。 */
const LEGACY_COMPOSITE_FRAGMENT = `
precision mediump float;
uniform vec2 u_resolution;
uniform sampler2D u_Sampler;

vec3 linearToSRGB(vec3 color){
  return pow(color * 1.5, vec3(1.0/2.2));
}

vec3 getColorByPercent(float pct){
  float p = clamp(pct, 0.0, 1.0);
  /* Color stops (sRGB, hex -> 0~1) */
  const vec3 c0 = vec3(0.0,    0.0,    0.0   ); /* 0.00 -> #000000 */
  const vec3 c1 = vec3(0.0,    0.0,    1.0   ); /* 0.14 -> #0000FF */
  const vec3 c2 = vec3(0.0,    0.4,    1.0   ); /* 0.28 -> #0066FF */
  const vec3 c3 = vec3(0.0,    1.0,    0.0   ); /* 0.42 -> #00FF00 */
  const vec3 c4 = vec3(1.0,    1.0,    0.0   ); /* 0.56 -> #FFFF00 */
  const vec3 c5 = vec3(1.0,    0.4,    0.0   ); /* 0.70 -> #FF6600 */
  const vec3 c6 = vec3(1.0,    0.0,    0.0   ); /* 0.84 -> #FF0000 */
  const vec3 c7 = vec3(1.0, 0.0, 0.0 ); /* 1.00 -> #FF1E42 */

  if(p <= 0.14){
    float t = (p - 0.00) / (0.14 - 0.00);
    return mix(c0, c1, t);
  }else if(p <= 0.28){
    float t = (p - 0.14) / (0.28 - 0.14);
    return mix(c1, c2, t);
  }else if(p <= 0.42){
    float t = (p - 0.28) / (0.42 - 0.28);
    return mix(c2, c3, t);
  }else if(p <= 0.56){
    float t = (p - 0.42) / (0.56 - 0.42);
    return mix(c3, c4, t);
  }else if(p <= 0.70){
    float t = (p - 0.56) / (0.70 - 0.56);
    return mix(c4, c5, t);
  }else if(p <= 0.84){
    float t = (p - 0.70) / (0.84 - 0.70);
    return mix(c5, c6, t);
  }else{
    float t = (p - 0.84) / (1.0 - 0.84);
    return mix(c6, c7, t);
  }
}

void main(void){
  vec2 uv = vec2(gl_FragCoord.x / u_resolution.x, gl_FragCoord.y / u_resolution.y);
  vec4 c = texture2D(u_Sampler, uv);
  float p_alpha = c.a;
  if(p_alpha > 0.03){
    vec3 col = getColorByPercent(p_alpha);
    col = linearToSRGB(col);
    gl_FragColor = vec4(col, 1.0);
  }else{
    discard;
  }
}`;

/** 去块注释、去首尾空白、丢空行。 */
function lines(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 抽出 `const vec3 cN = vec3(a, b, c)` 的八组常量，按声明顺序。 */
function legacyStopColors(source) {
  const matched = [...source.matchAll(
    /const\s+vec3\s+c\d+\s*=\s*vec3\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g,
  )];
  return matched.map((hit) => [Number(hit[1]), Number(hit[2]), Number(hit[3])]);
}

/** 抽出 `if(p <= X)` 的七个断点，按出现顺序。 */
function legacyThresholds(source) {
  return [...source.matchAll(/p\s*<=\s*([\d.]+)\)/g)].map((hit) => Number(hit[1]));
}

/** 原件那条阶梯的 JS 复现，输入 0~1，输出 0~1 的三分量。 */
function legacyLadder(p) {
  const colors = legacyStopColors(LEGACY_COMPOSITE_FRAGMENT);
  const breaks = [0, ...legacyThresholds(LEGACY_COMPOSITE_FRAGMENT), 1];
  const clamped = Math.min(1, Math.max(0, p));
  for (let i = 0; i < breaks.length - 1; i += 1) {
    const upper = breaks[i + 1];
    if (clamped <= upper || i === breaks.length - 2) {
      const lower = breaks[i];
      const t = (clamped - lower) / (upper - lower);
      return colors[i].map((channel, k) => channel + (colors[i + 1][k] - channel) * t);
    }
  }
  return colors[colors.length - 1];
}

/** 原件的 `linearToSRGB` + 光栅化取整，输出 0~255 整数。 */
function legacyColorAt(p) {
  return legacyLadder(p).map(
    (channel) => Math.round(255 * Math.min(1, Math.pow(channel * 1.5, 1 / 2.2))),
  );
}

describe('逐字搬的三段与原件逐行相同', () => {
  it('斑点顶点着色器', () => {
    expect(lines(BLOB_VERTEX_SHADER)).toEqual(lines(LEGACY_BLOB_VERTEX));
  });

  it('斑点片元着色器', () => {
    expect(lines(BLOB_FRAGMENT_SHADER)).toEqual(lines(LEGACY_BLOB_FRAGMENT));
  });

  it('合成顶点着色器', () => {
    expect(lines(COMPOSITE_VERTEX_SHADER)).toEqual(lines(LEGACY_COMPOSITE_VERTEX));
  });

  it('那个空分支照抄了 —— 圆最外一像素环仍然什么都不写', () => {
    expect(BLOB_FRAGMENT_SHADER).toContain('if ( diff >= 0.0 && diff <= 1.0 ){');
  });
});

describe('发出来的色带与原件等价', () => {
  it('八个色标逐个等于原件的 c0..c7', () => {
    const legacy = legacyStopColors(LEGACY_COMPOSITE_FRAGMENT);
    expect(legacy).toHaveLength(HEAT_BLOB_STOPS.length);
    HEAT_BLOB_STOPS.forEach((stop, index) => {
      stop.rgb.forEach((channel, k) => {
        expect(channel / 255).toBeCloseTo(legacy[index][k], 10);
      });
    });
  });

  it('七个断点逐个等于原件的 if(p <= X)', () => {
    expect(legacyThresholds(LEGACY_COMPOSITE_FRAGMENT))
      .toEqual(HEAT_BLOB_STOPS.slice(1, -1).map((stop) => stop.at));
  });

  it('⚠️ c7 的注释写 #FF1E42，代码是纯红 —— 照抄代码，最后 16% 是等色 mix', () => {
    const legacy = legacyStopColors(LEGACY_COMPOSITE_FRAGMENT);
    expect(legacy[7]).toEqual(legacy[6]);
    expect(HEAT_BLOB_STOPS[7].rgb).toEqual(HEAT_BLOB_STOPS[6].rgb);
  });

  it('发出来的 GLSL 里每个断点都在，且插进了合成片元', () => {
    const ladder = glslStopLadder('getColorByPercent', HEAT_BLOB_STOPS);
    HEAT_BLOB_STOPS.slice(1, -1).forEach((stop) => {
      expect(ladder).toContain(`p <= ${stop.at}`);
    });
    expect(COMPOSITE_FRAGMENT_SHADER).toContain(ladder);
  });
});

describe('JS 侧色卡与 GLSL 侧出图同色', () => {
  it.each([0, 0.07, 0.14, 0.28, 0.35, 0.42, 0.56, 0.63, 0.7, 0.84, 0.92, 1])(
    'p = %s',
    (p) => {
      const sdk = sampleColormapRgb('heatBlobs', p);
      const legacy = legacyColorAt(p);
      // 两侧的浮点路径不同（一边先归一化到 0-255 再除回去），差 1 个量化级
      // 属于取整噪声，不是配色不同。
      sdk.forEach((channel, k) => {
        expect(Math.abs(channel - legacy[k])).toBeLessThanOrEqual(1);
      });
    },
  );

  it('起点是黑、终点是纯红过完 gamma 之后的样子', () => {
    expect(sampleColormapRgb('heatBlobs', 0)).toEqual([0, 0, 0]);
    expect(sampleColormapRgb('heatBlobs', 1)).toEqual(legacyColorAt(1));
  });
});

describe('buildCompositeFragmentShader', () => {
  it('默认 cutoff 是 0.03，与原件一致', () => {
    expect(BLOB_ALPHA_CUTOFF).toBe(0.03);
    expect(COMPOSITE_FRAGMENT_SHADER).toContain('p_alpha > 0.0300');
  });

  it('cutoff 可换', () => {
    expect(buildCompositeFragmentShader({ alphaCutoff: 0.5 })).toContain('p_alpha > 0.5000');
  });

  it('色带可换 —— 换成两段就只发一个分支', () => {
    const ladder = glslStopLadder('getColorByPercent', [
      { at: 0, rgb: [0, 0, 0] },
      { at: 1, rgb: [255, 255, 255] },
    ]);
    expect(ladder).toContain('vec3(1.0, 1.0, 1.0)');
    // 只有一段就不该有 if/else 阶梯（`main()` 里那个 `}else{` 不算，所以比的是
    // 发出来的函数本身，不是整段着色器）。
    expect(ladder).not.toContain('else');
    expect(ladder).not.toContain('if (');
    expect(buildCompositeFragmentShader({
      stops: [{ at: 0, rgb: [0, 0, 0] }, { at: 1, rgb: [255, 255, 255] }],
    })).toContain(ladder);
  });

  it('main() 与原件逐行相同（cutoff 字面量除外）', () => {
    const generated = lines(COMPOSITE_FRAGMENT_SHADER).slice(-9).join('\n');
    const legacy = lines(LEGACY_COMPOSITE_FRAGMENT).slice(-9).join('\n');
    expect(generated.replace('0.0300', '0.03')).toEqual(legacy);
  });
});
