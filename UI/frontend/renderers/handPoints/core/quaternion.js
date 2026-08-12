/**
 * renderers/handPoints/core/quaternion.js - IMU 四元数的「首帧归零」跟踪器
 *
 * 手套上的 IMU 每帧发一个四元数，但它的零位是任意的（上电时手怎么放，那就是零位）。
 * 原实现（`client/src/components/three/hand0205Point.jsx:56-84`，147 变体里逐字重复
 * 一遍）的做法是：**把第一帧当基准**，之后每帧返回 `q0⁻¹ * qn`，于是画面里的手总是
 * 从「正放」开始转。
 *
 * ## 为什么在 core/ 而且不 import three
 *
 * 这是纯四元数代数 —— 没有 DOM、没有场景图。原实现用的是 `THREE.Quaternion`，
 * 但用到的只有 `clone` / `invert` / `multiplyQuaternions` / `lengthSq` 四个方法，
 * 手写十几行就够，换来的是**可以在裸 Node 里逐点测**（`smoke-core.mjs` 接了两项）。
 * 渲染器那边把返回的 `[x, y, z, w]` 灌进 `THREE.Quaternion` 即可。
 *
 * ## 状态是实例的，不是模块的
 *
 * 原实现的 `baseQuaternion` / `baseQuaternionInv` 是**模块级变量** —— 同页挂两块手套
 * 就会互相覆盖基准（主应用里每种展示形式独占整屏，所以从没暴露过）。这里做成
 * `createQuaternionTracker()` 返回的闭包，一个渲染器实例一份。契约第 2 条要求如此。
 */

/**
 * 四元数乘法 `a * b`，分量顺序 `[x, y, z, w]`（与 `THREE.Quaternion` 一致）。
 *
 * @param {number[]} a 左乘数。
 * @param {number[]} b 右乘数。
 * @returns {number[]} 新数组 `[x, y, z, w]`。
 */
export function multiplyQuaternions(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * 四元数的逆。
 *
 * ⚠️ **照抄 `THREE.Quaternion.invert()` 的行为，它做的是共轭而不是真正的逆** ——
 * three 的实现只翻转 x/y/z 的符号，**不除以模长平方**。对单位四元数两者等价，
 * IMU 发来的确实是单位四元数，所以画面一致；但如果喂非单位四元数，这个函数
 * 给出的不是数学意义上的逆。原实现如此，别"顺手修正"。
 *
 * @param {number[]} q `[x, y, z, w]`。
 * @returns {number[]} 新数组 `[x, y, z, w]`。
 */
export function invertQuaternion(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

/**
 * 模长平方。
 *
 * @param {number[]} q `[x, y, z, w]`。
 * @returns {number} `x² + y² + z² + w²`。
 */
export function lengthSq(q) {
  return q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
}

/** 单位四元数 `[0, 0, 0, 1]`。每次返回**新数组**，调用方可以随便改。 */
export function identityQuaternion() {
  return [0, 0, 0, 1];
}

/**
 * 建一个「首帧归零」跟踪器。
 *
 * 逐行对应原实现的 `transformQuaternion(a)`，四处必须照抄的行为：
 *
 * 1. **入参前两位会被交换**（`[a[0], a[1]] = [a[1], a[0]]`）—— 而且原实现是
 *    **就地改调用方传进来的数组**。这里改成不就地改（先复制再交换），因为调用方
 *    `changeHandAngle` 收到的数组来自 `page/home/util.js` 现场构造的字面量，
 *    没有第二个读者；就地改只是原实现的随手写法，不是被依赖的行为。
 * 2. **首帧返回单位四元数**，同时把首帧存为基准与它的逆。
 * 3. **返回值的 x 分量取负**（`qTransformed.x = -qTransformed.x`）—— 这是把 IMU
 *    的手系坐标翻到 three 的坐标系，去掉手就会左右反着转。
 * 4. `baseQuaternion` 模长为 0 时返回单位四元数并告警。实际收不到全零四元数，
 *    但这条分支原样保留。
 *
 * `reset()` 把基准清空，下一帧重新取基准 —— 就是渲染器 `resetHand` 命令做的事。
 *
 * @param {{ warn?: (message: string) => void }} [options] `warn` 默认走 `console.warn`；
 *   传 `() => {}` 可以在测试里静音。
 * @returns {{ transform: (a: number[]) => number[], reset: () => void, hasBase: () => boolean }}
 */
export function createQuaternionTracker(options = {}) {
  const warn = typeof options.warn === 'function'
    ? options.warn
    /* eslint-disable-next-line no-console */
    : (message) => console.warn(message);

  let base = null;
  let baseInv = null;

  return {
    transform(a) {
      // 原实现就地交换前两位；这里复制一份再换，见文档第 1 条。
      const swapped = [a[1], a[0], a[2], a[3]];

      if (!base) {
        base = swapped.slice();
        baseInv = invertQuaternion(base);
        return identityQuaternion();
      }

      if (lengthSq(base) === 0) {
        warn('Base quaternion is zero, cannot invert.');
        return identityQuaternion();
      }

      const out = multiplyQuaternions(baseInv, swapped);
      out[0] = -out[0];
      return out;
    },
    reset() {
      base = null;
      baseInv = null;
    },
    hasBase() {
      return base !== null;
    },
  };
}
