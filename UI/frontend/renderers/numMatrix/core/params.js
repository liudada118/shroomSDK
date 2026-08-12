/**
 * params.js - 数字矩阵渲染器（numMatrix）参数 schema
 *
 * 参数维度不是设计出来的，是从 `components/three/` 那三份 NumThreeColor
 * 逐行比对提炼的。比对结论比预想的乐观得多：
 *
 * **三份的布局公式与格子尺寸是代数等价的**，不是三套算法。
 *
 * | 文件 | 原写法 | 化简 |
 * | :--- | :--- | :--- |
 * | `NumThreeColor copy`（size=4，grid 16） | `(x - (32/size - 0.5)) / 32 * size` | `(x - 7.5) × 0.125` |
 * | `NumThreeColor1024`（通用） | `(x - (gw-1)/2) * worldCellSize` | 同上（gw=16 时） |
 * | `NumThreeColor1024sit`（grid 23） | `(x - (23/2 - 0.5)) / (23/2)` | `(x - 11) × 2/23` |
 *
 * 通用式 `(x - (gw-1)/2) * 2/max(gw,gh)` 三份都满足。格子尺寸同理：
 * `0.032*size` = `2.048/gridSize` = `worldCellSize * 1.024`，三份逐位相同。
 * 逐点验算见 `pipeline.test.js`。
 *
 * 所以真正的差异只剩五个开关（画布高度比例、分压、纹理是否跟随阈值、
 * 有没有缩放拖拽、阈值对象是否共享），这就是下面这份 schema 的全部内容。
 */

/** 一格精灵图的边长（像素）。三份原实现都写死 32，纹理尺寸由它乘格数得出。 */
export const TEXTURE_CELL_SIZE = 32;

/**
 * 参数取值范围，用于 Builder 表单校验与用户输入兜底。
 *
 * 上界防的是误填导致实例数爆炸：gridWidth × gridHeight 直接是 InstancedMesh
 * 的实例数，而每个实例每帧都要写 uvOffset 与 instanceColor。
 */
export const PARAM_RANGES = {
  size: { min: 1, max: 64 },
  gridWidth: { min: 0, max: 256 },
  gridHeight: { min: 0, max: 256 },
  textureValueMax: { min: 0, max: 4095 },
  decimalScale: { min: 1, max: 100 },
  chartWindow: { min: 2, max: 600 },
  chartPadding: { min: 0, max: 100000 },
  pressureRows: { min: 1, max: 256 },
  pressureCols: { min: 1, max: 256 },
  // ---- canvas2d 后端 ----
  pointChartPadding: { min: 0, max: 100000 },
  totalChartOffset: { min: 0, max: 1000 },
  cellWidth: { min: 4, max: 256 },
  cellHeight: { min: 4, max: 256 },
  extraTop: { min: 0, max: 2000 },
  fontScale: { min: 4, max: 200 },
  textHeight: { min: 0, max: 100 },
  textColorMax: { min: 1, max: 4095 },
  colorValueScale: { min: 0.01, max: 1000 },
  blurSigma: { min: 0, max: 20 },
  baseTiltDeg: { min: -180, max: 180 },
  rotateSize: { min: 1, max: 256 },
  // ---- webgl 后端 ----
  widthRatio: { min: 0.1, max: 1 },
  cellPadding: { min: 0, max: 500 },
  overlayPad: { min: 0, max: 200 },
  fixedCellSize: { min: 0, max: 200 },
  matrixSide: { min: 1, max: 256 },
  footTtlMs: { min: 0, max: 60000 },
  robotGap: { min: 0, max: 64 },
};

/** 画布边长占视口高度的比例。`compact` 用于 <750px 的小屏。 */
const DEFAULT_CANVAS_HEIGHT_RATIO = { compact: 0.6, normal: 0.8 };

function clampNumber(value, fallback, range) {
  // null / undefined / 空串一律视为「未提供」而非 0：Number('') === 0 且有限，
  // 不先拦掉的话缺省字段会被夹到 range.min 而不是回落默认值。
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < range.min) return range.min;
  if (parsed > range.max) return range.max;
  return parsed;
}

function clampInteger(value, fallback, range) {
  const parsed = clampNumber(value, fallback, range);
  return Math.round(parsed);
}

function normalizeBoolean(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return value !== false && value !== 'false' && value !== 0;
}

function normalizeRatio(ratio = {}, defaults = DEFAULT_CANVAS_HEIGHT_RATIO) {
  const range = { min: 0.1, max: 1 };
  return {
    compact: clampNumber(ratio.compact, defaults.compact, range),
    normal: clampNumber(ratio.normal, defaults.normal, range),
  };
}

/**
 * 归一化分压重分配设置。
 *
 * 只有 `NumThreeColor1024sit` 启用它（`press(ndata1, 23, 23, valuep, valueprop, 'col')`），
 * 另外两份把这段注释掉了。enabled 为假时 rows/cols 仍然归一化，避免用户先填了
 * 尺寸再打开开关时读到 0。
 *
 * @param {object} redistribution 原始设置。
 * @returns {{enabled: boolean, rows: number, cols: number, axis: string}} 归一化结果。
 */
function normalizePressureRedistribution(redistribution = {}) {
  return {
    enabled: normalizeBoolean(redistribution.enabled, false),
    rows: clampInteger(redistribution.rows, 23, PARAM_RANGES.pressureRows),
    cols: clampInteger(redistribution.cols, 23, PARAM_RANGES.pressureCols),
    axis: redistribution.axis === 'row' ? 'row' : 'col',
  };
}

/**
 * 归一化数字矩阵渲染器参数。
 *
 * 任何非法输入都退回默认值而非抛错：用户手写的 manifest 参数不全时应当
 * 降级渲染，而不是让整个模块加载失败。
 *
 * @param {object} params manifest 中的 display.renderers[].params。
 * @returns {object} 归一化后的完整参数。
 */
/**
 * 已实现的后端。
 *
 * | 值 | 画法 | 来源 |
 * | :--- | :--- | :--- |
 * | `sprite3d` | three.js `InstancedMesh` + 精灵图集，一次 draw call | 三份 `NumThreeColor*` |
 * | `canvas2d` | Canvas 2D 文字 + CSS `perspective` 伪 3D，**无 WebGL** | `num/NumWs.jsx` |
 * | `webgl` | WebGL 热场纹理 + Canvas 2D 数字叠加层 | `num/Num2D.jsx` + `Num2Doriginal.jsx` |
 *
 * 填了未知值会退回 `sprite3d` 而不是报错 —— 二开的人手写 manifest 拼错
 * 后端名时，看到画面出来了比看到白屏更容易发现自己写错了。
 */
export const BACKENDS = ['sprite3d', 'canvas2d', 'webgl'];

/**
 * `canvas2d` 后端的默认值。
 *
 * 这一组数字全部是 `NumWs.jsx` 里的写死值，逐个标了出处。它们之所以要参数化
 * 而不是留在后端里，是因为**格尺寸和字号一起决定了这个展示形式能看的矩阵有
 * 多大** —— 32×24 的格子铺 64×64 就是 2048×1736 的画布，超出多数屏幕。二开
 * 换一个矩阵尺寸时这几个数必须能调。
 */
const CANVAS2D_DEFAULTS = {
  cellWidth: 32,        // NumWs.jsx:95
  cellHeight: 24,       // NumWs.jsx:96
  extraTop: 200,        // NumWs.jsx:97，画布顶部留白，给"升起来"的数字用
  fontScale: 20,        // NumWs.jsx:64，字号 = max(8, round(视口宽/1920 × 本值))
  textHeight: 3,        // NumWs.jsx:106 `useRef(3)`，每 1 单位数值往上抬几像素
  textColorMax: 30,     // NumWs.jsx:107 `useRef(30)`，jet 色标上限
  colorValueScale: 5,   // NumWs.jsx:80，取色前先把数值放大几倍
  blurSigma: 1.6,       // NumWs.jsx:202
  baseTiltDeg: 20,      // NumWs.jsx:110，`rotateX` 初值
  /**
   * `rotate90CW` 用的行列数。**故意与 `grid` 解耦**：原实现写死
   * `rotate90CW(newData, 32, 32)`，`carCol`（10×9）走的也是这个 32，
   * 结果是一个长 1024、大部分 `undefined` 的数组。两条预设都保 32 是为了
   * 逐帧一致；要修 `carCol` 是单独一件事，改这个参数即可，不用动代码。
   */
  rotateHeight: 32,
  rotateWidth: 32,
};

/** `changePointRotation` / `changeGroupRotate` 的可选角度（弧度）。NumWs.jsx:92。 */
const DEFAULT_ROTATION_PRESETS = [0, Math.PI / 6, Math.PI / 3];

/**
 * 归一化 `canvas2d` 后端的嵌套参数。
 *
 * 走 `sprite3d` 时这一段也会算 —— 多算十几次 `clampNumber` 不值得为它加分支，
 * 而恒定存在的形状能让 Builder 表单不必判后端。
 *
 * @param {object} raw 用户填的 `params.canvas2d`。
 * @returns {object} 归一化结果，键与 `CANVAS2D_DEFAULTS` 一致，外加 `rotationPresets`。
 */
function normalizeCanvas2dParams(raw = {}) {
  const presets = Array.isArray(raw.rotationPresets) && raw.rotationPresets.length > 0
    ? raw.rotationPresets.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
    : DEFAULT_ROTATION_PRESETS;

  return {
    cellWidth: clampInteger(raw.cellWidth, CANVAS2D_DEFAULTS.cellWidth, PARAM_RANGES.cellWidth),
    cellHeight: clampInteger(raw.cellHeight, CANVAS2D_DEFAULTS.cellHeight, PARAM_RANGES.cellHeight),
    extraTop: clampInteger(raw.extraTop, CANVAS2D_DEFAULTS.extraTop, PARAM_RANGES.extraTop),
    fontScale: clampNumber(raw.fontScale, CANVAS2D_DEFAULTS.fontScale, PARAM_RANGES.fontScale),
    textHeight: clampNumber(raw.textHeight, CANVAS2D_DEFAULTS.textHeight, PARAM_RANGES.textHeight),
    textColorMax: clampNumber(
      raw.textColorMax, CANVAS2D_DEFAULTS.textColorMax, PARAM_RANGES.textColorMax,
    ),
    colorValueScale: clampNumber(
      raw.colorValueScale, CANVAS2D_DEFAULTS.colorValueScale, PARAM_RANGES.colorValueScale,
    ),
    blurSigma: clampNumber(raw.blurSigma, CANVAS2D_DEFAULTS.blurSigma, PARAM_RANGES.blurSigma),
    baseTiltDeg: clampNumber(
      raw.baseTiltDeg, CANVAS2D_DEFAULTS.baseTiltDeg, PARAM_RANGES.baseTiltDeg,
    ),
    rotateHeight: clampInteger(
      raw.rotateHeight, CANVAS2D_DEFAULTS.rotateHeight, PARAM_RANGES.rotateSize,
    ),
    rotateWidth: clampInteger(
      raw.rotateWidth, CANVAS2D_DEFAULTS.rotateWidth, PARAM_RANGES.rotateSize,
    ),
    rotationPresets: presets,
  };
}

/**
 * `webgl` 后端的两套默认值。
 *
 * `Num2D.jsx` 与 `Num2Doriginal.jsx` **不是两份实现，是一份加了东西**：两份
 * 片元着色器逐行只差 18 行，每一行都是后者在追加。差异摊平之后落成下面这张表，
 * 一栏一个开关，没有一处是「挑一个丢一个」。
 *
 * | 键 | `plain`（Num2D） | `original`（Num2Doriginal） |
 * | :--- | :--- | :--- |
 * | `useMask` | 着色器不发 `u_mask` | 发，机器人分区靠它把空隙涂白 |
 * | `whiteOnZero` | 0 值走配色（jet 的蓝） | 0 值直接输出白 |
 * | `potTexture` | 纹理 = 数据尺寸 | `nextPOT()` + `u_texScale` |
 * | `maxFromThreshold` | 色标上限恒取本帧最大值 | `valuej > 0` 时用 `valuej` |
 * | `retintOnTuning` | 拖阈值不重画 | 重画最后一帧 |
 * | `gridColor` | `rgba(0,0,40,0.6)` 深色细线 | `rgba(200,200,220,0.8)` 浅色 |
 * | `zeroTextColor` | 无（0 值也是白字） | `#999`（白底上要看得见） |
 * | `indexRow` | 无 | 底部一条蓝色列号带 |
 * | `overlayPad` | 0 | 30（给列号带与分区标题留的） |
 * | `refitOnSizeChange` | 纹理换尺寸时格子边长不变 | 跟着重算 |
 *
 * `variant` **只是这张表的选择器，后端一行都不读它** —— 归一化完之后剩下的
 * 全是具体开关。二开想要「Num2D 的配色 + Num2Doriginal 的列号带」，
 * 填 `{ variant: 'plain', indexRow: true }` 就行，不必新造一个 variant。
 */
const WEBGL_VARIANT_DEFAULTS = {
  /** `num/Num2D.jsx`。「数字」下拉项。 */
  plain: {
    useMask: false,
    whiteOnZero: false,
    potTexture: false,
    maxFromThreshold: false,
    retintOnTuning: false,
    rawTranspose: false,
    gridColor: 'rgba(0, 0, 40, 0.6)',   // Num2D.jsx:234
    zeroTextColor: null,                 // Num2D.jsx:259 恒 '#fff'
    indexRow: false,
    overlayPad: 0,                       // Num2D.jsx:380 无 +30
    refitOnSizeChange: false,            // Num2D.jsx:499-510 reinitGL 不动 cellSize
    glove: { enabled: false, mode: 'scatter32', width: 16, height: 16 },
    foot: { enabled: false, mode: 'interp', width: 16, height: 32 },
  },
  /** `num/Num2Doriginal.jsx`。「原始数据」下拉项。 */
  original: {
    useMask: true,
    whiteOnZero: true,
    potTexture: true,
    maxFromThreshold: true,
    retintOnTuning: true,
    rawTranspose: false,                 // 只有 jqbed 那条预设打开
    gridColor: 'rgba(200, 200, 220, 0.8)', // Num2Doriginal.jsx:345
    zeroTextColor: '#999',               // Num2Doriginal.jsx:371
    indexRow: true,                      // Num2Doriginal.jsx:380-395
    overlayPad: 30,                      // Num2Doriginal.jsx:658
    refitOnSizeChange: true,             // Num2Doriginal.jsx:903-921 会重算 cellSize
    glove: { enabled: false, mode: 'rows15', width: 15, height: 10 },
    foot: { enabled: false, mode: 'raw', width: 6, height: 10 },
  },
};

/** 两个变体共用、原实现里逐字相同的那些值。 */
const WEBGL_SHARED_DEFAULTS = {
  widthRatio: 0.4,        // MATRIX_WIDTH_RATIO，两份一致
  cellPadding: 40,        // calcCellSize 的第五个实参，两份所有调用点都是 40
  fixedCellSize: 0,       // 0 = 按视口算；Num2Doriginal 的 footVideo 写死 30
  textColor: '#fff',
  titleColor: '#ccc',                       // Num2Doriginal.jsx:449 分区标题
  indexRowColor: 'rgba(30, 60, 200, 0.85)', // Num2Doriginal.jsx:383
  showNumbers: true,      // 唯一调用点传的就是 true
  showBorder: true,
  glovePrimeOnMount: false,
  footTtlMs: 1200,        // 单/双脚布局探测窗口，两份一致
  robot: { enabled: false, name: '', gap: 2, widthRatio: 0.6, parts: null },
};

function normalizeWebglGlove(raw, defaults) {
  const source = raw || {};
  return {
    /**
     * 走不走手套通路。
     *
     * 原实现是在 `changeWsData147` 里现读 `props.matrixName` 判分支
     * （`Num2D.jsx:645`、`Num2Doriginal.jsx:940`）。搬进包之后由预设显式声明，
     * 因为 `matrixName` 是主应用的概念，包里不该认识那串字符串。
     *
     * 三条通路的优先级是 **glove > foot > robot**，照抄两份原件的 if/else 次序。
     */
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    /**
     * 147 点手套怎么铺。
     *
     * - `scatter32`：按点表散进 32×32 再 `addSide` 补边到 36×36（`Num2D.jsx:644-700`）。
     * - `rows15`：按 15 列补位成 15×10 或 15×13（`Num2Doriginal.jsx:939-956`）。
     *
     * **两者的点位表完全不同**，不是同一套铺法的参数化 —— 所以是 mode 而不是开关。
     */
    mode: source.mode === 'rows15' ? 'rows15' : (source.mode === 'scatter32' ? 'scatter32' : defaults.mode),
    /** 手套挂载时的初始纹理宽（格）。 */
    width: clampInteger(source.width, defaults.width, PARAM_RANGES.matrixSide),
    /** 手套挂载时的初始纹理高（格）。整包手套是 13，其余 10（或 plain 的 16）。 */
    height: clampInteger(source.height, defaults.height, PARAM_RANGES.matrixSide),
  };
}

function normalizeWebglFoot(raw, defaults) {
  const source = raw || {};
  return {
    /** 走不走足底通路（含左右双脚版面）。见 `glove.enabled` 的说明。 */
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    /**
     * 足底怎么铺。
     *
     * - `interp`：60 个采样点散进 16×32 再做双向线性插值（`Num2D.jsx:581-588`）。
     * - `raw`：6×10 原样上屏，**不插值**（`Num2Doriginal.jsx:957-962`）。
     *
     * 同样是两套画法而不是一套的参数，所以是 mode。
     */
    mode: source.mode === 'raw' ? 'raw' : (source.mode === 'interp' ? 'interp' : defaults.mode),
    width: clampInteger(source.width, defaults.width, PARAM_RANGES.matrixSide),
    height: clampInteger(source.height, defaults.height, PARAM_RANGES.matrixSide),
    /**
     * 单/双脚布局的探测窗口（毫秒）。
     *
     * **这是整个 numMatrix 里唯一一处运行期状态机**：左右脚是两条独立的数据流，
     * 谁在这个窗口内来过帧谁就算「在线」，两条都在线才铺双脚。窗口太短会在丢包时
     * 抖动成单脚，太长则拔掉一只脚后半天不收版面。原实现两份都写死 1200。
     */
    ttlMs: clampInteger(source.ttlMs, defaults.ttlMs, PARAM_RANGES.footTtlMs),
  };
}

function normalizeWebglRobot(raw, defaults) {
  const source = raw || {};
  return {
    /** 走不走分区布局。打开时 `changeWsData147` 转到 robot 通路。 */
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    /** `renderers/numMatrix/core/robotLayouts.js` 里的键；`parts` 非空时忽略它。 */
    name: source.name ? String(source.name) : defaults.name,
    /** 分区间距（格）。 */
    gap: clampInteger(source.gap, defaults.gap, PARAM_RANGES.robotGap),
    /** 机器人布局横向铺得开，视口占比比常规的 0.4 大。 */
    widthRatio: clampNumber(source.widthRatio, defaults.widthRatio, PARAM_RANGES.widthRatio),
    /**
     * 自定义分区表，形如 `ROBOT_LAYOUTS.robotSY`。
     *
     * 这是二开加一款机器人的入口：不用改渲染器，也不用往包里加表，
     * 在 manifest 里直接把 `{key, text, w, h, posArr}` 写出来即可。
     */
    parts: Array.isArray(source.parts) && source.parts.length > 0 ? source.parts : defaults.parts,
  };
}

/**
 * 归一化 `webgl` 后端的嵌套参数。
 *
 * @param {object} raw 用户填的 `params.webgl`。
 * @returns {object} 归一化结果。`variant` 保留在输出里只为便于排查，后端不读。
 */
function normalizeWebglParams(raw = {}) {
  const variant = raw.variant === 'original' ? 'original' : 'plain';
  const base = WEBGL_VARIANT_DEFAULTS[variant];

  return {
    variant,
    useMask: normalizeBoolean(raw.useMask, base.useMask),
    whiteOnZero: normalizeBoolean(raw.whiteOnZero, base.whiteOnZero),
    potTexture: normalizeBoolean(raw.potTexture, base.potTexture),
    maxFromThreshold: normalizeBoolean(raw.maxFromThreshold, base.maxFromThreshold),
    retintOnTuning: normalizeBoolean(raw.retintOnTuning, base.retintOnTuning),
    /** 裸数据是否转置。**只在 `width === height` 时生效**，这是原实现的条件。 */
    rawTranspose: normalizeBoolean(raw.rawTranspose, base.rawTranspose),
    widthRatio: clampNumber(raw.widthRatio, WEBGL_SHARED_DEFAULTS.widthRatio, PARAM_RANGES.widthRatio),
    cellPadding: clampInteger(
      raw.cellPadding, WEBGL_SHARED_DEFAULTS.cellPadding, PARAM_RANGES.cellPadding,
    ),
    /**
     * 格子边长写死值，0 表示按视口算。
     *
     * 只有 `Num2Doriginal` 的 `footVideo` 用它（`computeCellSize` 直接
     * `return 30`，不看视口）。留成参数而不是内联，是因为 6×10 的足底在
     * 4K 屏上按视口算会撑到一格 100 多像素，写死是有意的。
     */
    fixedCellSize: clampInteger(
      raw.fixedCellSize, WEBGL_SHARED_DEFAULTS.fixedCellSize, PARAM_RANGES.fixedCellSize,
    ),
    gridColor: raw.gridColor ? String(raw.gridColor) : base.gridColor,
    textColor: raw.textColor ? String(raw.textColor) : WEBGL_SHARED_DEFAULTS.textColor,
    /** 0 值格子的字色。`null` = 与 `textColor` 相同（`Num2D` 的行为）。 */
    zeroTextColor: raw.zeroTextColor === undefined
      ? base.zeroTextColor
      : (raw.zeroTextColor ? String(raw.zeroTextColor) : null),
    titleColor: raw.titleColor ? String(raw.titleColor) : WEBGL_SHARED_DEFAULTS.titleColor,
    indexRowColor: raw.indexRowColor
      ? String(raw.indexRowColor)
      : WEBGL_SHARED_DEFAULTS.indexRowColor,
    showNumbers: normalizeBoolean(raw.showNumbers, WEBGL_SHARED_DEFAULTS.showNumbers),
    showBorder: normalizeBoolean(raw.showBorder, WEBGL_SHARED_DEFAULTS.showBorder),
    indexRow: normalizeBoolean(raw.indexRow, base.indexRow),
    /** 叠加层画布比热场大出来的边（px）。列号带与分区标题画在这块地方。 */
    overlayPad: clampInteger(raw.overlayPad, base.overlayPad, PARAM_RANGES.overlayPad),
    /**
     * 纹理换尺寸时要不要重算格子边长。
     *
     * `Num2D.jsx:499-510` 的 `reinitGL` **只重建上下文，不动 `cellSizeRef`** ——
     * 所以手套从 16×16 变成 36×36 之后格子还是按 16×16 算出来的那么大，整张图
     * 撑到容器外。`Num2Doriginal.jsx:903-921` 的 `ensureFlatMatrixSize` 会
     * `calcCellSize` 重算。两份都照抄，**不统一** —— 统一就是改画面。
     */
    refitOnSizeChange: normalizeBoolean(raw.refitOnSizeChange, base.refitOnSizeChange),
    /**
     * 挂载时先推一帧全 0。
     *
     * 只有整包手套（`handGloveFullPacket`）需要：它上电到第一帧之间有好几秒，
     * 不先铺一张空网格的话那段时间是纯白，看着像坏了。
     */
    glovePrimeOnMount: normalizeBoolean(
      raw.glovePrimeOnMount, WEBGL_SHARED_DEFAULTS.glovePrimeOnMount,
    ),
    glove: normalizeWebglGlove(raw.glove, base.glove),
    foot: normalizeWebglFoot(raw.foot, { ...base.foot, ttlMs: WEBGL_SHARED_DEFAULTS.footTtlMs }),
    robot: normalizeWebglRobot(raw.robot, WEBGL_SHARED_DEFAULTS.robot),
  };
}

export function normalizeNumMatrixParams(params = {}) {
  return {
    /** 画法。见 `BACKENDS`。 */
    backend: BACKENDS.includes(params.backend) ? params.backend : 'sprite3d',
    /** 格子放大倍率。gridWidth/gridHeight 为 0 时用 64/size 推导网格。 */
    size: clampInteger(params.size, 2, PARAM_RANGES.size),
    /** 显式网格宽高；0 表示「由 size 推导」，对应原实现的 `64 / size`。 */
    gridWidth: clampInteger(params.gridWidth, 0, PARAM_RANGES.gridWidth),
    gridHeight: clampInteger(params.gridHeight, 0, PARAM_RANGES.gridHeight),
    canvasHeightRatio: normalizeRatio(params.canvasHeightRatio),
    /**
     * 精灵图覆盖的最大数值。0 表示自动：>255 时按 32 列铺，否则 16×16 的 256 格。
     *
     * **缺省就该是 0。** 原实现的三份文件都没有调用方传这一项，走的是
     * `decimalScale > 1 ? valuej1 * decimalScale : 255` 这条动态推导，
     * 拖 `valuej` 会重烘纹理。这里留出显式覆盖只为让 manifest 能锁死量程
     * （数据范围已知时省掉重烘），不是给内置预设用的。
     */
    textureValueMax: clampInteger(params.textureValueMax, 0, PARAM_RANGES.textureValueMax),
    /** 定点小数倍率。10 表示数据是放大 10 倍的定点数，显示时除回去并保留一位。 */
    decimalScale: clampInteger(params.decimalScale, 1, PARAM_RANGES.decimalScale),
    pressureRedistribution: normalizePressureRedistribution(params.pressureRedistribution),
    /**
     * 阈值（valuej）变化时是否重烘精灵图。
     * `NumThreeColor1024sit` 是唯一不重烘的 —— 它的纹理写死 `jet(0, 30)`，
     * 拖颜色滑块画面不动。照抄这个行为，要不要修单独决定。
     */
    retintOnThresholdChange: normalizeBoolean(params.retintOnThresholdChange, true),
    /** 是否装滚轮缩放与拖拽平移。`NumThreeColor1024sit` 没装。 */
    cameraControls: normalizeBoolean(params.cameraControls, true),
    /** 侧栏滚动曲线的窗口长度。三份原实现都是 20，`NumWs.jsx` 那份是 60。 */
    chartWindow: clampInteger(params.chartWindow, 20, PARAM_RANGES.chartWindow),
    /** 总压曲线的 Y 轴留白。12 位传感器用 5，其余 1000，`NumWs.jsx` 那份 20。 */
    chartPadding: clampInteger(params.chartPadding, 1000, PARAM_RANGES.chartPadding),
    /**
     * 受压点数曲线的 Y 轴留白。
     *
     * 以前是 `NumMatrixRenderer.jsx` 里的模块常量 `POINT_CHART_PADDING = 100`，
     * 提成参数是因为 `NumWs.jsx` 的 `layoutData` 两条曲线都用 20。
     */
    pointChartPadding: clampInteger(params.pointChartPadding, 100, PARAM_RANGES.pointChartPadding),
    /**
     * 画总压曲线前从每个采样点上减掉的常数（减完不小于 0）。
     *
     * `NumWs.jsx:369` 写的是 `totalArr.map(a => a - 1 > 0 ? a - 1 : 0)`，
     * 别处 7 份 `layoutData` 都没有这一下。**它只影响曲线，不影响画面。**
     */
    totalChartOffset: clampInteger(params.totalChartOffset, 0, PARAM_RANGES.totalChartOffset),
    /**
     * 侧栏统计取过滤前还是过滤后的帧。
     *
     * 默认 false（过滤后）= 三份 `NumThreeColor*` 的行为。`NumWs.jsx` 的
     * `layoutData` 收的是**原始帧**，所以 canvas2d 预设置 true —— 两者的
     * 「合力」读数会差一个 `valuef1 × 受压点数`，不是可以忽略的舍入差。
     */
    statsBeforeFilter: normalizeBoolean(params.statsBeforeFilter, false),
    /** `canvas2d` 后端专属参数；走别的后端时忽略。 */
    canvas2d: normalizeCanvas2dParams(params.canvas2d),
    /** `webgl` 后端专属参数；走别的后端时忽略。 */
    webgl: normalizeWebglParams(params.webgl),
    /** 侧栏「合力」读数取和还是取最大值。smallBed12B 取最大值。 */
    totalMetric: params.totalMetric === 'max' ? 'max' : 'sum',
    /** 是否由本渲染器回写侧栏统计。minzhen 那路由外层接管。 */
    manageSidebar: normalizeBoolean(params.manageSidebar, true),
    /**
     * 共享阈值对象的键。非空时不建实例私有阈值，改用那个模块级单例
     * —— Fast256 与 Bed4096 靠这个做到「切换模式时调参不重置」。
     */
    sharedTuningKey: params.sharedTuningKey ? String(params.sharedTuningKey) : null,
  };
}

/**
 * 推导实际渲染网格。
 *
 * 公式取自 `NumThreeColor1024.jsx:54-55`，逐字保留：显式宽高优先，
 * 否则 `64 / size`。
 *
 * @param {object} config 归一化后的参数。
 * @returns {{gridWidth: number, gridHeight: number, count: number}} 网格尺寸。
 */
export function deriveGrid(config) {
  const gridWidth = config.gridWidth > 0 ? config.gridWidth : 64 / config.size;
  const gridHeight = config.gridHeight > 0 ? config.gridHeight : 64 / config.size;
  return { gridWidth, gridHeight, count: gridWidth * gridHeight };
}

/**
 * 从 manifest 的 sensor 段推导参数。
 *
 * 用户在 Builder 里填过矩阵尺寸后，渲染器参数自动带出来，不必再填一遍。
 * 显式配置的 params 优先。
 *
 * @param {object} sensor manifest 的 sensor 段。
 * @param {object} params 用户显式配置的渲染器参数。
 * @returns {object} 归一化后的完整参数。
 */
export function paramsFromManifest(sensor = {}, params = {}) {
  const matrix = sensor.matrix || {};
  return normalizeNumMatrixParams({
    gridWidth: matrix.cols,
    gridHeight: matrix.rows,
    ...params,
  });
}

/**
 * 两份 webgl 原实现的侧栏统计口径。
 *
 * `Num2D.jsx:762-796` 与 `Num2Doriginal.jsx:1101-1134` 的 `layoutData`
 * **只差一处**：窗口 60（别处 7 份是 20）、两条曲线的留白都 +20 是共用的，
 * 但总压曲线每点先减 1 **只有 `Num2Doriginal` 有**
 * （`handleCharts(totalArr.map((a) => (a - 1 > 0 ? a - 1 : 0)), …)`），
 * `Num2D` 直接把 `totalArr` 递出去。所以下面分成两份，差的就是
 * `totalChartOffset`。
 *
 * 统计取的是**过滤前的原始帧**（`changeWsData147` / `changeWsData256` /
 * `changeWsDataRaw` 都是拿到手就 `layoutData([...wsPointData])`）。
 *
 * ⚠️ `changeWsData` 那条通路**根本不调 `layoutData`** —— 两份原实现都这样，
 * 而它在全仓也确实一个调用方都没有。照抄，不补。
 */
const WEBGL_CHART_BASE = {
  backend: 'webgl',
  chartWindow: 60,
  chartPadding: 20,
  pointChartPadding: 20,
  statsBeforeFilter: true,
};

/** `Num2D.jsx` 那份：总压曲线不减 1。 */
const WEBGL_CHART = { ...WEBGL_CHART_BASE, totalChartOffset: 0 };

/** `Num2Doriginal.jsx` 那份：总压曲线每点先减 1。 */
const WEBGL_CHART_RAW = { ...WEBGL_CHART_BASE, totalChartOffset: 1 };

/**
 * `webgl` 后端的预设表。
 *
 * 这一堆条目全部来自两份原实现开头那个 `if (props.matrixName == ...)` 尺寸表
 * （`Num2D.jsx:306-310` 两条、`Num2Doriginal.jsx:555-571` 六条）与
 * `changeWsData147` 里那串 `else if`。**它们本来就是数据**，只是以前长在代码里，
 * 二开换一种产品型号得改源码。搬成表之后加一款设备只要加一行。
 *
 * 命名：`webglNum*` 对应下拉框「数字」（走 `Num2D`），`webglRaw*` 对应
 * 「原始数据」里走 `Num2Doriginal` 的那一支。
 */
const WEBGL_PRESETS = {
  // ---- 「数字」= Num2D.jsx，plain 变体 ----

  /**
   * 32×32 常规矩阵。
   *
   * ⚠️ **`robot1` 在这条通路上也走它，而且画面是空的** ——
   * `Num2D.changeWsData147` 的 else 分支只处理 `isFoot`，机器人帧进来只更新
   * 侧栏读数，热场一格都不画。这不是搬漏了，是原实现如此；`robot.enabled`
   * 保持 false 就复现了这个空白。要修是另一件事（把它指到 `webglRawRobot1`）。
   */
  webglNumDefault: { ...WEBGL_CHART, gridWidth: 32, gridHeight: 32 },

  /** `Num2D.jsx:307-310` 的 `carCol` 一支。 */
  webglNumCarCol: { ...WEBGL_CHART, gridWidth: 10, gridHeight: 9 },

  /** 手套四型中的前三型：初始 16×16，147 点按点表散进 32×32 再补边到 36×36。 */
  webglNumGlove: {
    ...WEBGL_CHART,
    gridWidth: 16,
    gridHeight: 16,
    webgl: {
      variant: 'plain',
      glove: { enabled: true, mode: 'scatter32', width: 16, height: 16 },
    },
  },

  /** 整包手套：与上一条只差挂载时先铺一张空网格。 */
  webglNumGloveFullPacket: {
    ...WEBGL_CHART,
    gridWidth: 16,
    gridHeight: 16,
    webgl: {
      variant: 'plain',
      glovePrimeOnMount: true,
      glove: { enabled: true, mode: 'scatter32', width: 16, height: 16 },
    },
  },

  /** 足底：60 点散进 16×32 后做双向线性插值，左右脚两块画布。 */
  webglNumFoot: {
    ...WEBGL_CHART,
    gridWidth: 16,
    gridHeight: 32,
    webgl: {
      variant: 'plain',
      foot: { enabled: true, mode: 'interp', width: 16, height: 32 },
    },
  },

  // ---- 「原始数据」= Num2Doriginal.jsx，original 变体 ----

  /** 32×32 裸数据。 */
  webglRawDefault: {
    ...WEBGL_CHART_RAW, gridWidth: 32, gridHeight: 32, webgl: { variant: 'original' },
  },

  /**
   * 需要转置的裸数据。
   *
   * 原实现的 `RAW_TRANSPOSE_MATRIX_TYPES` 有四个键，但**只有 `jqbed` 走得到
   * 这条通路** —— `smallBed` 三型在 `Home.jsx` 更早的分支就进 sprite3d 后端了。
   * 转置**只在 `width === height` 时发生**，这是原实现的条件，不是遗漏。
   */
  webglRawTransposed: {
    ...WEBGL_CHART_RAW,
    gridWidth: 32,
    gridHeight: 32,
    webgl: { variant: 'original', rawTranspose: true },
  },

  webglRawCarCol: {
    ...WEBGL_CHART_RAW, gridWidth: 10, gridHeight: 9, webgl: { variant: 'original' },
  },
  webglRawDaliegu: {
    ...WEBGL_CHART_RAW, gridWidth: 14, gridHeight: 20, webgl: { variant: 'original' },
  },
  webglRawSmallSample: {
    ...WEBGL_CHART_RAW, gridWidth: 10, gridHeight: 10, webgl: { variant: 'original' },
  },
  webglRawTempFullBed: {
    ...WEBGL_CHART_RAW, gridWidth: 15, gridHeight: 12, webgl: { variant: 'original' },
  },

  /**
   * 64×64 = 4096 格。
   *
   * 一格一个数字，4096 个 `fillText` 每帧 —— 这条预设在原实现里就慢，
   * 而且 `Home.jsx` 现在把 `bed4096num` 指去了别的展示形式，走不到。
   * 留着是因为它是 `Num2Doriginal.jsx:568-570` 里明写的一支，删掉就是悄悄缩范围。
   */
  webglRawBed4096num: {
    ...WEBGL_CHART_RAW, gridWidth: 64, gridHeight: 64, webgl: { variant: 'original' },
  },

  /** 手套前三型：15 列，第 75 位插三个 0 凑成 15×10。 */
  webglRawGlove: {
    ...WEBGL_CHART_RAW,
    gridWidth: 15,
    gridHeight: 10,
    webgl: {
      variant: 'original',
      glove: { enabled: true, mode: 'rows15', width: 15, height: 10 },
    },
  },

  /** 整包手套：补/截到 195 = 15×13，且挂载时先铺空网格。 */
  webglRawGloveFullPacket: {
    ...WEBGL_CHART_RAW,
    gridWidth: 15,
    gridHeight: 13,
    webgl: {
      variant: 'original',
      glovePrimeOnMount: true,
      glove: { enabled: true, mode: 'rows15', width: 15, height: 13 },
    },
  },

  /** 足底：6×10 原样上屏，不插值，格子边长写死 30。 */
  webglRawFoot: {
    ...WEBGL_CHART_RAW,
    gridWidth: 6,
    gridHeight: 10,
    webgl: {
      variant: 'original',
      fixedCellSize: 30,
      foot: { enabled: true, mode: 'raw', width: 6, height: 10 },
    },
  },

  /** 机器人三款。分区表在 `renderers/numMatrix/core/robotLayouts.js`，这里只给名字。 */
  webglRawRobotSY: {
    ...WEBGL_CHART_RAW,
    webgl: { variant: 'original', robot: { enabled: true, name: 'robotSY' } },
  },
  webglRawRobotLCF: {
    ...WEBGL_CHART_RAW,
    webgl: { variant: 'original', robot: { enabled: true, name: 'robotLCF' } },
  },
  webglRawRobot1: {
    ...WEBGL_CHART_RAW,
    webgl: { variant: 'original', robot: { enabled: true, name: 'robot1' } },
  },
};

/**
 * 现有场景组件对应的参数预设。
 *
 * 这几组数字直接抄自原实现的常量区，是参数化前后逐帧一致性验证的基准。
 * **下拉框文案与后端的对应关系反直觉，写在这里备查**：
 *
 * | 下拉框 | 走的组件 | 本预设 |
 * | :--- | :--- | :--- |
 * | 原始数据 `numoriginal` | `NumThreeColor*`（真 three.js 精灵图） | `fast*` / `smallBed12B` |
 * | 3D数据 `num3D` | `num/NumWs.jsx`（2D canvas + CSS 透视，**不是** WebGL） | `num3dDefault` / `num3dCarCol` |
 * | 数字 `num` | `num/Num2D.jsx`（WebGL 热场 + 数字叠加层） | `webglNum*` |
 * | 原始数据 `numoriginal`（另一支） | `num/Num2Doriginal.jsx` | `webglRaw*` |
 *
 * 最后两行是同一个 `webgl` 后端的两套预设，差别全在 `params.webgl` 那十几个
 * 开关上 —— 见 `WEBGL_VARIANT_DEFAULTS` 的对照表。
 */
export const LEGACY_PRESETS = {
  /** `three/NumThreeColor copy.jsx` —— Home.jsx 里的 Fast256，16×16。 */
  fast256: {
    size: 4,
    canvasHeightRatio: { compact: 0.6, normal: 0.8 },
    sharedTuningKey: 'bed4096',
  },
  /** `three/NumThreeColor1024.jsx` —— Fast1024，矩阵尺寸由 manifest 决定。 */
  fast1024: {
    size: 2,
  },
  /** `three/NumThreeColor1024sit.jsx` —— Fast1024sit，23×23，带分压，无缩放。 */
  fast1024sit: {
    size: 2,
    gridWidth: 23,
    gridHeight: 23,
    canvasHeightRatio: { compact: 0.5, normal: 0.65 },
    pressureRedistribution: { enabled: true, rows: 23, cols: 23, axis: 'col' },
    retintOnThresholdChange: false,
    cameraControls: false,
  },
  /**
   * 12 位小床垫：定点数除 10 显示，合力读数取最大值。
   *
   * **不设 `textureValueMax`。** 原实现的式子是
   * `props.textureValueMax || (decimalScale > 1 ? valuej1 * decimalScale : 255)`，
   * 而全仓没有任何调用方传过 `textureValueMax` —— 所以它走的一直是右边那支
   * （默认 200×10 = 2000），且 `valuej` 变化时会跟着重烘纹理。写死一个常量会
   * 改掉 `classicTint` 的分母，是看得出来的配色变化。
   */
  smallBed12B: {
    size: 2,
    decimalScale: 10,
    chartPadding: 5,
    totalMetric: 'max',
  },

  /**
   * `num/NumWs.jsx` 的常规分支 —— 32×32，「3D数据」下拉项的默认形态。
   *
   * 四个非默认值都来自 `layoutData`（`NumWs.jsx:341-374`）：窗口 60 而不是 20，
   * 两条曲线的留白都是 20，受压点数走原始帧统计。
   */
  num3dDefault: {
    backend: 'canvas2d',
    gridWidth: 32,
    gridHeight: 32,
    chartWindow: 60,
    chartPadding: 20,
    pointChartPadding: 20,
    totalChartOffset: 1,
    statsBeforeFilter: true,
  },

  /**
   * `num/NumWs.jsx` 里 `props.matrixName == 'carCol'` 那一支（`NumWs.jsx:99`）。
   *
   * ⚠️ **只改网格，不改 `canvas2d.rotateWidth/rotateHeight`** —— 原实现的
   * `rotate90CW` 写死 32，`carCol` 走的也是它。见 `CANVAS2D_DEFAULTS.rotateHeight`
   * 的注释：这条预设现在的画面是有问题的，但要跟原实现逐帧一致就得照搬。
   * 想修的话把这两项设成 9 / 10 即可，不用改后端代码。
   */
  num3dCarCol: {
    backend: 'canvas2d',
    gridWidth: 10,
    gridHeight: 9,
    chartWindow: 60,
    chartPadding: 20,
    pointChartPadding: 20,
    totalChartOffset: 1,
    statsBeforeFilter: true,
  },

  ...WEBGL_PRESETS,
};
