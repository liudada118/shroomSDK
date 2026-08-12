/**
 * bed4096num（64*64高速）共享调参模块
 * Bed4096（3D点图）和 Fast256（原始数据）共用同一套调参变量
 * 切换模式时调参不重置
 *
 * 六个键的读取本身已经收进 `runtime/displayThresholds.js`（全仓唯一出口）。
 * 这个模块要单独留着的理由只剩那个「共用」—— 它是**模块级单例对象**，两个模式
 * 拿到的是同一个引用，所以在一边调完参切到另一边不会重置。各自调
 * `createThresholdState()` 就会各读各的，那正是这里要避免的。
 */
import { SINGLE_CHANNEL_DEFAULTS, createThresholdState } from './displayThresholds.js';

export const bed4096numParams = createThresholdState(SINGLE_CHANNEL_DEFAULTS);
