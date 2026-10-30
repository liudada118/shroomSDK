/**
 * 点位排列（线序）：把「采集板扫描顺序」换成「垫子上的实际位置」。
 *
 * 串口里那 1024 个字节是采集板按自己的扫描顺序发出来的，不等于从垫子左上角
 * 逐行数过去的顺序。不做转换直接铺成 32×32，按上边一行会显示在画面中间——
 * 位置全是错的，但数值本身没问题。
 *
 * 每种产品的走线不一样，所以排列要按产品选，不能自动猜。用法：
 *
 *   Shroom.connect({ layout: 'carSeat' })
 *   Shroom.decodeFrame(payload, { layout: 'carSeat' })
 *
 * 有几点要先说清楚：
 *
 * 1. 排列会决定输出的行列。比如 car10 是从 1024 个扫描点里取 10×10 那一块，
 *    所以 frame.rows / frame.cols 是 10，不是 32——不用自己再传 rows / cols。
 * 2. 这里**只做位置搬运，不改数值**。正式上位机在某些产品上还会跑坏点插值、
 *    空行填补、压力换算，那些属于数值处理，不在公开 SDK 的范围里，
 *    所以同一帧数据这里的数字和正式上位机可能对不上，位置是对的。
 * 3. 个别产品有「无传感器」的空位（比如 carCol 中间那一列），排列表里记成 -1，
 *    解出来固定是 0。
 * 4. 整包手套走 connectGlove() 产品层；不属于此通用矩阵线序表。
 * 5. 大多数产品一帧是 1024 个扫描点，少数是 256 个（小样垫、触觉足底）。
 *    排列自己知道要几个点，`scan` 字段记着，调用方不用管。
 */

/** 32×32 是采集板最常见的扫描矩阵，绝大多数排列都从它出发 */
const SCAN = 32;
const SCAN_SIZE = SCAN * SCAN;

/** 16×16 的小包：小样垫、触觉足底这类一帧只有 256 个点 */
const SCAN_SIZE_256 = 256;

/** 一张「还没动过」的下标表：seed()[i] === i */
function seed(size = SCAN_SIZE) {
  const a = new Array(size);
  for (let i = 0; i < size; i += 1) a[i] = i;
  return a;
}

// ------------------------------------------------------------------ 通用工具
// 下面这几个和正式上位机里的同名函数是一一对应的，只是这里搬的是下标不是数值。

/** 逆时针旋转 90°（方阵） */
function rotate90(a, side) {
  const out = new Array(side * side);
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) {
      out[(side - 1 - j) * side + i] = a[i * side + j];
    }
  }
  return out;
}

/** 顺时针旋转 90°（方阵） */
function rotate90cw(a, side) {
  const out = new Array(side * side);
  for (let i = 0; i < side; i += 1) {
    for (let j = 0; j < side; j += 1) {
      out[j * side + (side - 1 - i)] = a[i * side + j];
    }
  }
  return out;
}

/** 每行左右翻转 */
function flipX(a, rows, cols) {
  const out = a.slice();
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols >> 1; j += 1) {
      const p = i * cols + j;
      const q = i * cols + cols - 1 - j;
      const t = out[p];
      out[p] = out[q];
      out[q] = t;
    }
  }
  return out;
}

/** 上下翻转（整行对调） */
function flipY(a, rows, cols) {
  const out = a.slice();
  for (let i = 0; i < rows >> 1; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const p = i * cols + j;
      const q = (rows - 1 - i) * cols + j;
      const t = out[p];
      out[p] = out[q];
      out[q] = t;
    }
  }
  return out;
}

/** 每行把 [from, to] 这一段列前后倒过来 */
function reverseCols(a, rows, cols, from, to) {
  const out = a.slice();
  for (let i = 0; i < rows; i += 1) {
    for (let p = from, q = to; p < q; p += 1, q -= 1) {
      const x = i * cols + p;
      const y = i * cols + q;
      const t = out[x];
      out[x] = out[y];
      out[y] = t;
    }
  }
  return out;
}

/** 交换第 r1、r2 两行 */
function swapRows(a, cols, r1, r2) {
  for (let j = 0; j < cols; j += 1) {
    const p = r1 * cols + j;
    const q = r2 * cols + j;
    const t = a[p];
    a[p] = a[q];
    a[q] = t;
  }
}

/**
 * 从扫描矩阵里按行段、列段抠出一块。
 * 段写成 [起, 止]，起 > 止就是倒着取。对应上位机的 arrToRealLine。
 */
function pick(a, rowSpans, colSpans) {
  const expand = (spans) => {
    const out = [];
    for (const [from, to] of spans) {
      if (from > to) for (let i = from; i >= to; i -= 1) out.push(i);
      else for (let i = from; i <= to; i += 1) out.push(i);
    }
    return out;
  };
  const rows = expand(rowSpans);
  const cols = expand(colSpans);
  const out = [];
  for (const r of rows) {
    for (const c of cols) out.push(a[r * SCAN + c]);
  }
  return out;
}

// -------------------------------------------------------------- 各产品的线序

/** 32×32 通用压力垫（床垫 / 手部垫 / 眠枕 / 宠物垫都是这一套） */
function jqbed(src) {
  const a = src.slice();
  for (let i = 0; i < 8; i += 1) swapRows(a, SCAN, i, 14 - i);
  const head = a.splice(0, 15 * SCAN);
  return a.concat(head);
}

/** 坐垫：在通用垫的基础上再左右翻一次 */
function sitPad(src) {
  return flipX(jqbed(src), 32, 32);
}

/** 汽车坐垫 / 脚垫 */
function carSeat(src) {
  const a = src.slice();
  for (let i = 0; i < 8; i += 1) swapRows(a, SCAN, i, 15 - i);
  // 第 15 列往右那 17 列，以第 23 列为轴对折
  for (let i = 0; i < SCAN; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      const p = i * SCAN + j + 15;
      const q = i * SCAN + 31 - j;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
  return flipX(a, 32, 32);
}

/** 汽车靠背 */
function carBack(src) {
  const a = src.slice();
  for (let i = 0; i < 8; i += 1) swapRows(a, SCAN, i, 14 - i);
  for (let i = 0; i < SCAN; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      const p = i * SCAN + j + 15;
      const q = i * SCAN + 31 - j;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
  const head = a.splice(0, 15 * SCAN);
  const rolled = a.concat(head);
  return flipY(flipX(rotate90cw(rolled, SCAN), 32, 32), 32, 32);
}

/** 10×10 汽车坐垫：只用扫描矩阵左上角 10 行 × 右边 10 列那一块 */
function car10(src) {
  const a = pick(src, [[0, 9]], [[22, 31]]);
  for (let i = 0; i < 2; i += 1) swapRows(a, 10, i, 4 - i);
  for (let i = 0; i < 5; i += 1) swapRows(a, 10, i, i + 5);
  return a;
}

/** 10×10 汽车靠背。最外一圈没有传感器，抄邻边的值补上（上位机就是这么做的） */
function car10Back(src) {
  const a = car10(src);
  for (let i = 0; i < 10; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      const p = i * 10 + j;
      const q = i * 10 + 9 - j;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
  for (let i = 0; i < 10; i += 1) {
    a[i * 10] = a[i * 10 + 1];
    a[i * 10 + 9] = a[i * 10 + 8];
    a[i] = a[10 + i];
  }
  return rotate90(a, 10);
}

/** 10×10 坐垫 */
function sit10(src) {
  const a = pick(src, [[0, 9]], [[22, 31]]);
  for (let i = 0; i < 2; i += 1) swapRows(a, 10, i, 4 - i);
  return rotate90(a, 10);
}

/** 延锋 10×10 坐垫 */
function yanfeng10(src) {
  const a = pick(src, [[6, 15]], [[0, 9]]);
  for (let i = 0; i < 2; i += 1) swapRows(a, 10, 5 + i, 9 - i);
  return flipX(rotate90(a, 10), 10, 10);
}

/** 延锋 10×10 靠背 */
function yanfeng10Back(src) {
  const a = pick(src, [[6, 15]], [[0, 9]]);
  for (let i = 0; i < 2; i += 1) swapRows(a, 10, i, 4 - i);
  return rotate90(a, 10);
}

/** volvo 坐垫 / 靠背共用的前半段 */
function volvoCommon(src) {
  const a = src.slice();
  // 左半 16 列以第 7/8 列为轴对折
  for (let i = 0; i < SCAN; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      const p = i * SCAN + j;
      const q = i * SCAN + 15 - j;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
  // 左右两个半区整体对调
  for (let i = 0; i < SCAN; i += 1) {
    for (let j = 0; j < 16; j += 1) {
      const p = i * SCAN + j;
      const q = i * SCAN + 16 + j;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
  for (let i = 0; i < 9; i += 1) swapRows(a, SCAN, i, 17 - i);
  return a;
}

/** volvo 坐垫 */
function volvo(src) {
  return flipY(rotate90cw(volvoCommon(src), SCAN), 32, 32);
}

/** volvo 靠背 */
function volvoBack(src) {
  return rotate90(volvoCommon(src), SCAN);
}

/** volvo 头枕 10×10 */
function volvoHead(src) {
  const a = pick(src, [[6, 15]], [[0, 9]]);
  for (let i = 0; i < 2; i += 1) swapRows(a, 10, 5 + i, 9 - i);
  return rotate90(a, 10);
}

/** 长条垫 32 行 × 10 列 */
function smallM(src) {
  const a = [];
  for (let j = 0; j < SCAN; j += 1) {
    for (let i = 22; i < SCAN; i += 1) a.push(src[i * SCAN + j]);
  }
  for (let i = 0; i < SCAN; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      const p = i * 10 + j;
      const q = i * 10 + 4 - j;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
  return a;
}

/** 方垫 16 行 × 10 列 */
function rect(src) {
  const a = [];
  for (let i = 22; i < SCAN; i += 1) {
    for (let j = 0; j < 16; j += 1) a.push(src[i * SCAN + j]);
  }
  // 每行第 7~11 列这一段前后倒过来
  for (let i = 0; i < 10; i += 1) {
    for (let j = 7; j < 12; j += 1) {
      const p = i * 16 + j;
      const q = i * 16 + 22 - j;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
  const out = [];
  for (let j = 0; j < 16; j += 1) {
    for (let i = 0; i < 10; i += 1) out.push(a[i * 16 + j]);
  }
  return out;
}

/** 短垫 32×32：左右各自对折一次 */
function short(src) {
  const a = src.slice();
  for (let i = 0; i < SCAN; i += 1) {
    for (let j = 16; j < 24; j += 1) {
      const p = i * SCAN + j;
      const q = i * SCAN + 47 - j;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
  return flipX(a, 32, 32);
}

/** 列式垫 16 行 × 10 列 */
function matCol(src) {
  let a = pick(src, [[0, 15]], [[0, 9]]);
  for (let i = 0; i < 4; i += 1) swapRows(a, 10, i, 7 - i);
  const head = a.splice(0, 10 * 8);
  a = a.concat(head);
  return a;
}

/** 列式坐垫 32×32 */
function sitCol(src) {
  const a = src.slice();
  // 下半 16 行前后倒过来
  for (let i = 0; i < 8; i += 1) swapRows(a, SCAN, 16 + i, 31 - i);
  // 每行前 15 列前后倒过来
  for (let i = 0; i < SCAN; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      const p = i * SCAN + j;
      const q = i * SCAN + 14 - j;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
  return a;
}

/** 喜悦 32×32 */
function xiyue(src) {
  const a = src.slice();
  for (let i = 0; i < 6; i += 1) swapRows(a, SCAN, i, 10 - i);
  return a;
}

/** 列式汽车垫 9 行 × 10 列，中间一列没有传感器 */
function carCol(src) {
  const a = pick(src, [[6, 15]], [[0, 8]]);
  for (let i = 0; i < 2; i += 1) swapRows(a, 9, i, 4 - i);
  for (let i = 2; i <= 8; i += 1) a[i * 9 + 4] = -1; // 这一段没走线
  const out = [];
  for (let j = 0; j < 9; j += 1) {
    for (let i = 0; i < 10; i += 1) out.push(a[i * 9 + j]);
  }
  return out;
}

/** sit100 坐垫 12 行 × 6 列：右侧、左侧、中间三块拼起来 */
function sit100(src) {
  const left = pick(src, [[0, 2]], [[1, 0]]);
  const center = pick(src, [[3, 12]], [[7, 2]]);
  const right = pick(src, [[15, 13]], [[9, 8]]);
  for (let i = 0; i < 2; i += 1) swapRows(center, 6, 5 + i, 9 - i);
  return right.concat(left, center);
}

/** 恩迪 23×23 坐垫 */
function endiSit(src) {
  return pick(src, [[11, 22], [10, 0]], [[0, 22]]);
}

/** 沙发 16×16 */
function sofa(src) {
  return pick(src, [[0, 15]], [[7, 0], [8, 15]]);
}

/** 手部单点垫 32×32：以第 15 行为界上下两块前后调换 */
function handSinglePoint(src) {
  const out = [];
  for (let r = 15; r <= 30; r += 1) {
    for (let c = 0; c < SCAN; c += 1) out.push(src[r * SCAN + c]);
  }
  for (let r = 14; r >= 0; r -= 1) {
    for (let c = 0; c < SCAN; c += 1) out.push(src[r * SCAN + c]);
  }
  for (let c = 0; c < SCAN; c += 1) out.push(src[31 * SCAN + c]);
  return out;
}

/** 整椅：坐垫、靠背、头枕共用的开头——取扫描矩阵左上 16×16，再把每行右半段倒过来 */
function wholeChairCommon(src) {
  return reverseCols(pick(src, [[0, 15]], [[0, 15]]), 16, 16, 8, 15);
}

/** 整椅坐垫 16×16 */
function wholeChairSit(src) {
  return rotate90(wholeChairCommon(src), 16);
}

/** 整椅靠背 16×16 */
function wholeChairBack(src) {
  return flipY(rotate90(flipY(wholeChairCommon(src), 16, 16), 16), 16, 16);
}

/** 整椅头枕 10×10：取扫描矩阵第 6~15 行、左边 10 列那一块 */
function wholeChairHead(src) {
  const a = reverseCols(pick(src, [[6, 15]], [[0, 9]]), 10, 10, 5, 9);
  return flipY(rotate90cw(flipX(a, 10, 10), 10), 10, 10);
}

/**
 * 温度全床 12 行 × 15 列。
 * 走线和通用压力垫一样，但只有中间这一块装了压力点，两侧和第 20 列是留给温度的。
 * 温度那三个点不在这里——排列只管压力矩阵的位置。
 */
function tempFullBed(src) {
  return pick(jqbed(src), [[20, 31]], [[13, 19], [21, 28]]);
}

/** 小样垫 10×10：一帧 256 个点，纯查表 */
const SMALL_SAMPLE_TABLE = [
  223, 222, 221, 220, 219, 218, 217, 216, 215, 214,
  239, 238, 237, 236, 235, 234, 233, 232, 231, 230,
  255, 254, 253, 252, 251, 250, 249, 248, 247, 246,
  15, 14, 13, 12, 11, 10, 9, 8, 7, 6,
  31, 30, 29, 28, 27, 26, 25, 24, 23, 22,
  207, 206, 205, 204, 203, 202, 201, 200, 199, 198,
  191, 190, 189, 188, 187, 186, 185, 184, 183, 182,
  175, 174, 173, 172, 171, 170, 169, 168, 167, 166,
  159, 158, 157, 156, 155, 154, 153, 152, 151, 150,
  143, 142, 141, 140, 139, 138, 137, 136, 135, 134,
];

function smallSample(src) {
  return SMALL_SAMPLE_TABLE.map((i) => src[i]);
}

/**
 * 触觉足底 10 行 × 6 列，一帧 256 个点，纯查表。
 * 正式上位机还会把这 60 个点散到一张脚型轮廓上再插值，那是画法不是线序，这里不做。
 */
const FOOT_INSOLE_TABLE = [
  224, 208, 192, 176, 160, 144, 223, 207, 191, 175, 159, 143,
  222, 206, 190, 174, 158, 142, 221, 205, 189, 173, 157, 141,
  220, 204, 188, 172, 156, 140, 219, 203, 187, 171, 155, 139,
  218, 202, 186, 170, 154, 138, 217, 201, 185, 169, 153, 137,
  216, 200, 184, 168, 152, 136, 215, 199, 183, 167, 151, 135,
];

function footInsole(src) {
  return FOOT_INSOLE_TABLE.map((i) => src[i - 1]);
}

// ------------------------------------------------------------------ 排列注册表

/**
 * name: { rows, cols, label, build, scan? }
 * label 是给界面下拉框用的，SDK 本身不依赖它。
 * label 里不写尺寸——同名不同尺寸的产品（比如两种汽车坐垫）靠界面另外显示的行列区分。
 * scan 是这一帧有多少个扫描点，不写就是 1024。
 */
export const LAYOUTS = {
  mat32: { rows: 32, cols: 32, label: '通用压力垫', build: jqbed },
  sit: { rows: 32, cols: 32, label: '坐垫', build: sitPad },
  bed1: { rows: 32, cols: 32, label: '床垫（另一版走线）', build: jqbed },
  carSeat: { rows: 32, cols: 32, label: '汽车坐垫 / 脚垫', build: carSeat },
  carBack: { rows: 32, cols: 32, label: '汽车靠背', build: carBack },
  car10: { rows: 10, cols: 10, label: '汽车坐垫', build: car10 },
  car10Back: { rows: 10, cols: 10, label: '汽车靠背', build: car10Back },
  sit10: { rows: 10, cols: 10, label: '坐垫', build: sit10 },
  yanfeng10: { rows: 10, cols: 10, label: '延锋坐垫', build: yanfeng10 },
  yanfeng10Back: { rows: 10, cols: 10, label: '延锋靠背', build: yanfeng10Back },
  volvo: { rows: 32, cols: 32, label: 'volvo 坐垫', build: volvo },
  volvoBack: { rows: 32, cols: 32, label: 'volvo 靠背', build: volvoBack },
  volvoHead: { rows: 10, cols: 10, label: 'volvo 头枕', build: volvoHead },
  smallM: { rows: 32, cols: 10, label: '长条垫', build: smallM },
  rect: { rows: 16, cols: 10, label: '方垫', build: rect },
  short: { rows: 32, cols: 32, label: '短垫', build: short },
  matCol: { rows: 16, cols: 10, label: '列式垫', build: matCol },
  sitCol: { rows: 32, cols: 32, label: '列式坐垫', build: sitCol },
  xiyue: { rows: 32, cols: 32, label: '喜悦', build: xiyue },
  carCol: { rows: 9, cols: 10, label: '列式汽车垫', build: carCol },
  sit100: { rows: 12, cols: 6, label: 'sit100 坐垫', build: sit100 },
  endiSit: { rows: 23, cols: 23, label: '恩迪坐垫', build: endiSit },
  sofa: { rows: 16, cols: 16, label: '沙发', build: sofa },
  handSinglePoint: { rows: 32, cols: 32, label: '手部单点垫', build: handSinglePoint },
  wholeChair: { rows: 16, cols: 16, label: '整椅坐垫', build: wholeChairSit },
  wholeChairBack: { rows: 16, cols: 16, label: '整椅靠背', build: wholeChairBack },
  wholeChairHead: { rows: 10, cols: 10, label: '整椅头枕', build: wholeChairHead },
  tempFullBed: { rows: 12, cols: 15, label: '温度全床', build: tempFullBed },
  smallSample: { rows: 10, cols: 10, label: '小样垫', build: smallSample, scan: SCAN_SIZE_256 },
  footInsole: { rows: 10, cols: 6, label: '触觉足底', build: footInsole, scan: SCAN_SIZE_256 },
};

// 排列表只跟名字有关，算一次就够了。
// decodeFrame 每帧都会调 getLayout，一秒上百次，不缓存就是白白分配上百个数组。
const cache = new Map();

/**
 * 取排列。返回 null 表示按扫描顺序原样铺（'raw' 或名字不认识时）。
 *
 * @param {string} [name] 排列名，见 LAYOUTS
 * @returns {{rows: number, cols: number, perm: Int32Array}|null}
 *          perm[显示位置] = 扫描顺序里的下标；-1 表示这个位置没有传感器。
 *          结果按名称缓存并复用，调用方应只读使用；需要调整时先复制 perm。
 */
export function getLayout(name) {
  if (!name || name === 'raw') return null;
  if (cache.has(name)) return cache.get(name);

  const def = LAYOUTS[name];
  if (!def) {
    cache.set(name, null);
    return null;
  }

  const built = def.build(seed(def.scan ?? SCAN_SIZE));
  const size = def.rows * def.cols;
  const layout = built && built.length === size
    ? { rows: def.rows, cols: def.cols, perm: Int32Array.from(built) }
    : null;
  cache.set(name, layout);
  return layout;
}

/** 列出所有排列。这是按「线序」列的，界面下拉框请用 listProducts() */
export function listLayouts() {
  return Object.keys(LAYOUTS).map((name) => ({
    name,
    label: LAYOUTS[name].label,
    rows: LAYOUTS[name].rows,
    cols: LAYOUTS[name].cols,
  }));
}

// ------------------------------------------------------------------ 产品菜单

/**
 * 产品菜单：和公司桌面端「请选择传感器」那个下拉**一字不差、顺序也一样**，
 * 此通用矩阵菜单不包含手套；整包手套由独立的 connectGlove() 产品接口提供。
 *
 * 上面的 LAYOUTS 是按**线序**列的，一种走线一条，名字是内部叫法
 *（`mat32`、`列式垫`、`sit100 坐垫`……）。那张表是给 decodeFrame 用的，
 * 不适合直接摆到界面上让人挑——同一种走线上跑着好几款产品，
 * 用户手里拿的是「宠物看护」，不是「通用压力垫」。
 *
 * 所以界面下拉框用这张表：**一行一个产品，名字照抄桌面端**，
 * 每个产品指向它该用哪条线序。多个产品指向同一条线序是正常的，
 * 比如手部检测 / 小床监测 / 宠物看护 走的都是 jqbed 那套走线。
 *
 * 几点说明：
 *
 * 1. `layout: 'raw'` 表示这款产品**不需要换线序**，按扫描顺序原样铺就是对的
 *    （桌面端那几个「高速」和「正常测试」就是这样，代码里没有任何变换）。
 *    这种产品在下面写死 rows / cols，省得靠点数去猜。
 * 2. 桌面端菜单里还有几项**故意没收**，收了也是灰的：
 *    - 触觉上衣（宇树 G1 / 松延 N2 / 零次方 H1）—— 一帧 260 字节，
 *      末尾 4 个字节是姿态不是压力，走的也不是这套分帧
 *    - 64*64高速 / OneStep —— 一帧 4096 字节、3 Mbaud
 *    - 小床检测(12B) —— 一帧 2048 字节的 16 位数据，帧尾也不是 AA 55 03 99
 *    - 14*20高速 —— 142 + 158 两个包拼一帧
 *    - 轮椅 —— 走线和通用垫一样，但桌面端还会把一批点**抹成 0**，
 *      那是改数值不是搬位置，收进来这里就名不副实了（见文件开头第 2 条）
 *    - 小床褥监测 —— 桌面端菜单里没有这一项，别自己加
 *    - 整椅展示 —— 桌面端那**一个**菜单项背后是坐垫 + 靠背 + 头枕三块板子、
 *      三条线序、**三个串口同时连**，画面上拼成一把椅子。单个 SDK 连接对象对应一个口，
 *      组合展示需要应用管理多个连接，因此本菜单不将其中一个垫子冒充“整椅”。
 *      各部分的线序仍保留在 LAYOUTS 中，可按实际部件传入对应 `layout`。
 */
export const PRODUCTS = [
  { name: 'hand', label: '手部检测', layout: 'mat32' },
  { name: 'smallSample', label: '10*10小样', layout: 'smallSample' },
  { name: 'footVideo', label: '触觉足底', layout: 'footInsole' },
  { name: 'jqbed', label: '小床监测', layout: 'mat32' },
  { name: 'smallBedNoAlg', label: '小床检测(数据)', layout: 'mat32' },
  { name: 'tempFullBed', label: '温度全床系统', layout: 'tempFullBed' },
  { name: 'petCare', label: '宠物看护', layout: 'mat32' },
  { name: 'petCareMini', label: 'mini看护', layout: 'mat32' },
  { name: 'fast256', label: '16*16高速', layout: 'raw', rows: 16, cols: 16 },
  { name: 'fast1024', label: '32*32高速', layout: 'raw', rows: 32, cols: 32 },
  { name: 'handSinglePoint', label: '32*32(检测点)', layout: 'handSinglePoint' },
  { name: 'normal', label: '正常测试', layout: 'raw', rows: 32, cols: 32 },
  { name: 'humanBody', label: '人体全身', layout: 'raw', rows: 32, cols: 32 },
];

const PRODUCT_INDEX = new Map(PRODUCTS.map((p) => [p.name, p]));

/** 补上行列：走线序的从 LAYOUTS 取，raw 的产品自己写死了 */
function withShape(p) {
  const def = LAYOUTS[p.layout];
  return {
    name: p.name,
    label: p.label,
    layout: p.layout,
    rows: p.rows ?? def?.rows ?? null,
    cols: p.cols ?? def?.cols ?? null,
  };
}

/**
 * 按产品名取一项。名字不认识返回 null。
 *
 * @param {string} name 产品名，见 PRODUCTS
 * @returns {{name: string, label: string, layout: string, rows: number|null, cols: number|null}|null}
 */
export function getProduct(name) {
  const p = PRODUCT_INDEX.get(name);
  return p ? withShape(p) : null;
}

/** 列出所有产品，给界面下拉框用。顺序就是桌面端菜单的顺序，别排序 */
export function listProducts() {
  return PRODUCTS.map(withShape);
}
