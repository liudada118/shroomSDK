/**
 * sceneFrame.js - 规范帧
 *
 * ## 这个文件在收谁
 *
 * Home.jsx 的 ws handler 里有大约 900 行 `if (matrixName == ...)` 阶梯
 * （2044–2940），替每个场景组件做数据整形，然后按各自的私有方法名推过去：
 *
 * ```js
 * this.com.current?.changeWsData147([...newArr])            // 映射点
 * this.com.current?.changeWsData256([...rawData])           // 原始 16×16
 * this.com.current?.changeWsDatafinger(newArr)              // 手指
 * this.com.current?.changeWsDatapalm(newArr)                // 手掌
 * this.com.current?.changeWsData147R({ left: [...newArr] }) // 左右手
 * ```
 *
 * 逐段读下来，那 900 行其实是**同一条阶梯的三份拷贝**（单手 / 左手 / 右手），
 * 每份里又有四个几乎一模一样的 `numMatrixFlag` 分支 —— 2186、2194、2212、2220
 * 四段的区别只有注释。真正不同的整形只有下面这几种，全部是纯函数。
 *
 * 把它们收进这里之后，Home 只需要 publish 一帧，渲染器自己从 `channels`
 * 里挑自己要的那条。Home 不再需要知道 `changeWsData147` 这个名字存在。
 *
 * ## 不收什么
 *
 * **遥操的五点折弯量和标定不在这里。** 那条链路（`fivePoints` → 标定基准 →
 * `com.calibration(bendArr)`）算的是机械手要弯多少度，不是要画什么，
 * 它带着跨帧累积状态（`bendArr[i] += (value - bendArr[i]) / 3`）。
 * 把它混进渲染帧会让「帧」这个概念同时意味着两件事。它属于命令通道。
 */

/**
 * 规范帧的通道名。
 *
 * 渲染器声明自己吃哪几条，宿主按声明喂 —— 这样加一条通道不需要改宿主。
 */
export const SCENE_CHANNELS = Object.freeze({
  /** 映射后的主数据（旧代码里的 147 点 / newArr） */
  SIT: 'sit',
  /** 背部 */
  BACK: 'back',
  /** 原始未映射矩阵（旧代码里的 256 点） */
  RAW: 'raw',
  /** 双手套的左手 */
  LEFT: 'left',
  /** 双手套的右手 */
  RIGHT: 'right',
  /** 手掌（拇指位补零后的数组） */
  PALM: 'palm',
  /** 手指（拇指位补零后的数组，与 PALM 同源） */
  FINGER: 'finger',
  /** 头部 */
  HEAD: 'head',
});

/** 拇指位的插入下标。旧代码写作 `5 * 15`，原样保留以便对照。 */
const THUMB_GAP_INDEX = 5 * 15;

/** 补零个数。旧代码是连着三行 `splice(5 * 15, 0, 0)`。 */
const THUMB_GAP_WIDTH = 3;

/**
 * 在拇指位补三个 0。
 *
 * 旧代码：
 * ```js
 * newArr.splice(5 * 15, 0, 0);
 * newArr.splice(5 * 15, 0, 0);
 * newArr.splice(5 * 15, 0, 0);
 * ```
 * 三次 splice 都插在同一个下标上，等价于一次插入三个 0。
 *
 * **返回新数组，不改入参。** 旧代码是原地改 `newArr`，而 `newArr` 在此之前
 * 已经被当作 `hand` 通道推给渲染器了 —— 原地改意味着推出去的那份也跟着变了。
 * 那是旧实现的一个隐患（渲染器如果留了引用就会读到补零后的数据），
 * 这里按「hand 拿不补零的、finger/palm 拿补零的」这个**实际意图**实现。
 *
 * @param {number[]} values 映射后的数据。
 * @returns {number[]} 补零后的新数组。
 */
export function padThumbGap(values) {
  if (!Array.isArray(values)) return [];
  const padded = [...values];
  padded.splice(THUMB_GAP_INDEX, 0, ...new Array(THUMB_GAP_WIDTH).fill(0));
  return padded;
}

/**
 * 取原始 16×16 矩阵。
 *
 * 旧代码（2200–2210）的三段处置逐条搬过来：
 * 1. 不是数组就 `JSON.parse` —— 后端有时发字符串；
 * 2. 长度够 256 才切前 256 个；
 * 3. 不够就**回落到映射数据**，而不是画一片空白。
 *
 * @param {number[]|string} rawPayload 原始数据，可能是数组也可能是 JSON 字符串。
 * @param {number[]} [fallbackValues] 长度不足时的回落数据。
 * @returns {number[]} 长度 256 的原始矩阵，或回落数据。
 */
export function toRaw256(rawPayload, fallbackValues = []) {
  let raw = rawPayload;
  if (raw && !Array.isArray(raw)) {
    try {
      raw = JSON.parse(raw);
    } catch {
      // 解析不出来就当没有 —— 走回落，不让一帧坏数据打断整条流。
      raw = null;
    }
  }
  if (Array.isArray(raw) && raw.length >= 256) return raw.slice(0, 256);
  return Array.isArray(fallbackValues) ? [...fallbackValues] : [];
}

/**
 * 组装一帧规范数据。
 *
 * 通道按需生成：没有 `showType` 就不算 palm/finger，没有 `side` 就不分左右手。
 * 这样 100Hz 下不会为用不上的通道每帧多分配几个数组。
 *
 * @param {object} input 入参。
 * @param {number[]} input.values 映射后的主数据。
 * @param {number[]|string} [input.rawPayload] 原始未映射数据。
 * @param {'left'|'right'} [input.side] 双手套时这一帧属于哪只手。
 * @param {'hand'|'palm'|'finger'} [input.showType] Num3D 的显示部位。
 * @param {number} [input.width] 矩阵宽度，供侧栏统计用。
 * @param {object} [input.meta] 附带信息（matrixName / numMatrixFlag / local 等）。
 * @returns {{values: number[], raw: number[]|null, width: number|undefined, meta: object, channels: object}} 规范帧。
 */
export function buildSceneFrame({
  values,
  rawPayload,
  side,
  showType,
  width,
  meta = {},
} = {}) {
  const safeValues = Array.isArray(values) ? values : [];
  const channels = { [SCENE_CHANNELS.SIT]: safeValues };

  if (rawPayload != null) {
    channels[SCENE_CHANNELS.RAW] = toRaw256(rawPayload, safeValues);
  }

  if (side === SCENE_CHANNELS.LEFT || side === SCENE_CHANNELS.RIGHT) {
    channels[side] = safeValues;
  }

  // palm 与 finger 同源：旧代码把同一个补零数组分别交给
  // changeWsDatapalm 和 changeWsDatafinger，这里共用一份，不重复分配。
  if (showType === SCENE_CHANNELS.PALM || showType === SCENE_CHANNELS.FINGER) {
    channels[showType] = padThumbGap(safeValues);
  }

  return {
    values: safeValues,
    raw: channels[SCENE_CHANNELS.RAW] || null,
    width,
    meta,
    channels,
  };
}

export default buildSceneFrame;
