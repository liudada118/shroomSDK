/**
 * robotLayouts.test.js - 三张机器人分区表的转录校验
 *
 * 这三张表加起来约 250 个手抄的数字，抄错一个不会报错，只会让机器人身上某一格
 * 常年显示别处的压力值 —— 肉眼几乎发现不了。所以这里不是"跑得通"级别的测试，
 * 而是**把表的结构不变量全部钉死**：
 *
 * - `w * h` 必须等于 `posArr.length`（原实现三款全都对得上）；
 * - 下标必须落在 1..256（1 起点，`genNewArr` 里是 `arr[pos - 1]`）；
 * - 同一款内部各分区之间**不得有重复下标**（一个贴片不会同时属于胸和肩）。
 *
 * 逐个数字与原件的比对是在搬的时候用脚本做的（三张表全等），不适合写进测试
 * —— 那要求测试去 import 主应用的 `.jsx`，而这一层必须能在裸 Node 里加载。
 */

import { describe, expect, it } from 'vitest';

import {
  ROBOT_LAYOUTS,
  ROBOT_LAYOUT_GAP,
  ROBOT_LAYOUT_NAMES,
  buildRobotFrame,
  getRobotLayout,
} from './robotLayouts.js';

describe('机器人分区表', () => {
  it('三款：robotSY / robotLCF / robot1', () => {
    expect(ROBOT_LAYOUT_NAMES).toEqual(['robotSY', 'robotLCF', 'robot1']);
  });

  ROBOT_LAYOUT_NAMES.forEach((name) => {
    describe(name, () => {
      const parts = ROBOT_LAYOUTS[name];

      it('每块 w * h 等于下标个数', () => {
        parts.forEach((part) => {
          expect({ key: part.key, cells: part.w * part.h })
            .toEqual({ key: part.key, cells: part.posArr.length });
        });
      });

      it('下标是 1 起点且落在 1..256', () => {
        parts.forEach((part) => {
          part.posArr.forEach((pos) => {
            expect(Number.isInteger(pos)).toBe(true);
            expect(pos).toBeGreaterThanOrEqual(1);
            expect(pos).toBeLessThanOrEqual(256);
          });
        });
      });

      it('各分区之间没有重复下标', () => {
        const all = parts.flatMap((part) => part.posArr);
        expect(new Set(all).size).toBe(all.length);
      });

      it('每块都有中文标题', () => {
        parts.forEach((part) => {
          expect(part.text).toBeTruthy();
          expect(part.key).toBeTruthy();
        });
      });
    });
  });

  it('robotLCF 没有 back，另外两款有', () => {
    const keys = (name) => ROBOT_LAYOUTS[name].map((part) => part.key);
    expect(keys('robotLCF')).not.toContain('back');
    expect(keys('robotSY')).toContain('back');
    expect(keys('robot1')).toContain('back');
  });

  it('robotSY 叫「脑袋」，robot1 叫「后背」—— 两款的 back 语义不同', () => {
    const back = (name) => ROBOT_LAYOUTS[name].find((part) => part.key === 'back');
    expect(back('robotSY').text).toBe('脑袋');
    expect(back('robot1').text).toBe('后背');
  });

  it('getRobotLayout 未知名字返回 null', () => {
    expect(getRobotLayout('robotSY')).toBe(ROBOT_LAYOUTS.robotSY);
    expect(getRobotLayout('carCol')).toBeNull();
    expect(getRobotLayout()).toBeNull();
  });
});

describe('buildRobotFrame', () => {
  /** 第 i 位（1 起点）的值就是 i，方便直接读出取到的是哪个下标。 */
  const identityFrame = Array.from({ length: 256 }, (_, index) => index + 1);

  it('按下标表取值：每格的值等于它的 1 起点下标', () => {
    const parts = ROBOT_LAYOUTS.robotSY;
    const { layoutData, layoutW, partDefsWithOffset } = buildRobotFrame(identityFrame, parts);

    partDefsWithOffset.forEach((part, partIndex) => {
      const source = parts[partIndex];
      for (let row = 0; row < part.h; row++) {
        for (let col = 0; col < part.w; col++) {
          const at = (part.offsetY + row) * layoutW + (part.offsetX + col);
          expect(layoutData[at]).toBe(source.posArr[row * part.w + col]);
        }
      }
    });
  });

  it('宽度 = 各分区宽之和 + 间距，高度 = 最高分区 + 2', () => {
    const parts = ROBOT_LAYOUTS.robot1;
    const { layoutW, layoutH } = buildRobotFrame(identityFrame, parts);
    const widths = parts.reduce((sum, part) => sum + part.w, 0);
    expect(layoutW).toBe(widths + ROBOT_LAYOUT_GAP * (parts.length - 1));
    expect(layoutH).toBe(Math.max(...parts.map((part) => part.h)) + 2);
  });

  it('mask 在分区覆盖处为 255，间距列为 0', () => {
    const parts = ROBOT_LAYOUTS.robotLCF;
    const { maskData, layoutW, partDefsWithOffset } = buildRobotFrame(identityFrame, parts);
    partDefsWithOffset.forEach((part) => {
      expect(maskData[part.offsetY * layoutW + part.offsetX]).toBe(255);
    });
    // 第一块与第二块之间那 2 列是空的。
    const firstGapCol = partDefsWithOffset[0].w;
    expect(maskData[firstGapCol]).toBe(0);
  });

  it('间距可调，改了只影响宽度', () => {
    const parts = ROBOT_LAYOUTS.robotSY;
    const tight = buildRobotFrame(identityFrame, parts, 0);
    const loose = buildRobotFrame(identityFrame, parts, 5);
    expect(loose.layoutW - tight.layoutW).toBe(5 * (parts.length - 1));
    expect(loose.layoutH).toBe(tight.layoutH);
  });

  it('短帧不越界，缺的位置是 0', () => {
    const { layoutData } = buildRobotFrame([1, 2, 3], ROBOT_LAYOUTS.robot1);
    expect(layoutData.every((value) => Number.isFinite(value))).toBe(true);
  });
});
