// 空気のよごれ（黄砂・PM2.5）指数のテスト

import { describe, expect, it } from 'vitest';
import { AIR_QUALITY, AIR_QUALITY_ADVICE } from '../src/constants';
import { assessAirQuality } from '../src/logic/airQuality';

describe('assessAirQuality', () => {
  it('PM2.5の日平均が70以上は「高」で注意の一言が付く', () => {
    const result = assessAirQuality({ pm25: [60, 80], dust: [0] });
    expect(result).not.toBeNull();
    expect(result!.level).toBe('high');
    expect(result!.label).toBe('高');
    expect(result!.pm25Mean).toBe(70);
    expect(result!.advice).toBe(AIR_QUALITY_ADVICE);
  });

  it('黄砂の最大濃度が500以上は「高」（PM2.5が低くても）', () => {
    const result = assessAirQuality({ pm25: [10], dust: [100, 520] });
    expect(result!.level).toBe('high');
    expect(result!.dustMax).toBe(520);
  });

  it('PM2.5の日平均が35以上は「中」でadviceはnull', () => {
    const result = assessAirQuality({ pm25: [30, 40], dust: [0] });
    expect(result!.level).toBe('medium');
    expect(result!.advice).toBeNull();
  });

  it('黄砂の最大濃度が100以上は「中」', () => {
    const result = assessAirQuality({ pm25: [5], dust: [50, 100] });
    expect(result!.level).toBe('medium');
  });

  it('どちらのしきい値も下回る日は「低」', () => {
    const result = assessAirQuality({ pm25: [10, 12], dust: [20] });
    expect(result!.level).toBe('low');
    expect(result!.label).toBe('低');
  });

  it('しきい値ちょうどは「以上」に含める', () => {
    expect(
      assessAirQuality({ pm25: [AIR_QUALITY.pm25MediumMean], dust: [] })!.level,
    ).toBe('medium');
    expect(assessAirQuality({ pm25: [AIR_QUALITY.pm25HighMean], dust: [] })!.level).toBe('high');
  });

  it('PM2.5だけ欠測でも黄砂で判定できる（欠測側はnull）', () => {
    const result = assessAirQuality({ pm25: [], dust: [150] });
    expect(result!.level).toBe('medium');
    expect(result!.pm25Mean).toBeNull();
    expect(result!.dustMax).toBe(150);
  });

  it('黄砂だけ欠測でもPM2.5で判定できる', () => {
    const result = assessAirQuality({ pm25: [80], dust: [] });
    expect(result!.level).toBe('high');
    expect(result!.dustMax).toBeNull();
  });

  it('両方欠測の日は判定できないためnull', () => {
    expect(assessAirQuality({ pm25: [], dust: [] })).toBeNull();
  });

  it('平均・最大は小数1桁へ丸める', () => {
    const result = assessAirQuality({ pm25: [10, 11, 11], dust: [33.33] });
    expect(result!.pm25Mean).toBe(10.7);
    expect(result!.dustMax).toBe(33.3);
  });
});
