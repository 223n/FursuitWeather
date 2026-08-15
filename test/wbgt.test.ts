// WBGT推定のテスト
// 期待値は小野ら（2014）の式に手計算で代入した値

import { describe, expect, it } from 'vitest';
import { estimateIndoorWbgt, estimateOutdoorWbgt, roundWbgt } from '../src/logic/wbgt';

describe('estimateOutdoorWbgt', () => {
  it('真夏の晴天日中の条件で環境省相当のWBGTを返す', () => {
    // Ta=30℃, RH=60%, SR=800W/m², WS=2m/s
    // 0.735*30 + 0.0374*60 + 0.00292*30*60 + 7.619*0.8 - 4.557*0.64 - 0.0572*2 - 4.064
    expect(estimateOutdoorWbgt(30, 60, 800, 2)).toBeCloseTo(28.55, 1);
  });

  it('夜間（日射ゼロ）は日射項なしの値になる', () => {
    const night = estimateOutdoorWbgt(25, 70, 0, 1);
    // 0.735*25 + 0.0374*70 + 0.00292*25*70 - 0.0572*1 - 4.064
    expect(night).toBeCloseTo(21.98, 1);
  });

  it('日射量の負値（欠測由来）はゼロとして扱う', () => {
    expect(estimateOutdoorWbgt(25, 50, -10, 1)).toBeCloseTo(
      estimateOutdoorWbgt(25, 50, 0, 1),
      5,
    );
  });

  it('風速が強いほどWBGTは下がる', () => {
    const calm = estimateOutdoorWbgt(30, 60, 500, 0.5);
    const windy = estimateOutdoorWbgt(30, 60, 500, 5);
    expect(windy).toBeLessThan(calm);
  });
});

describe('estimateIndoorWbgt', () => {
  it('日射なし・室内想定風速で計算する', () => {
    // 0.735*30 + 0.0374*60 + 0.00292*30*60 - 0.0572*0.5 - 4.064
    expect(estimateIndoorWbgt(30, 60)).toBeCloseTo(25.46, 1);
  });

  it('同一気温・湿度なら屋外（日射あり）より低い', () => {
    expect(estimateIndoorWbgt(30, 60)).toBeLessThan(estimateOutdoorWbgt(30, 60, 800, 0.5));
  });
});

describe('roundWbgt', () => {
  it('小数1桁に丸める', () => {
    expect(roundWbgt(28.5503)).toBe(28.6);
    expect(roundWbgt(21.04)).toBe(21);
  });
});
