// 静電気指数のテスト

import { describe, expect, it } from 'vitest';
import { STATIC_ELECTRICITY, STATIC_ELECTRICITY_ADVICE } from '../src/constants';
import { assessStaticElectricity } from '../src/logic/staticElectricity';
import type { HourlyWeather } from '../src/types';

/** 指定時刻の1時間分データを作る */
function hourAt(hour: number, overrides: Partial<HourlyWeather>): HourlyWeather {
  return {
    time: `2026-01-15T${String(hour).padStart(2, '0')}:00`,
    temperature: 8,
    humidity: 50,
    apparentTemperature: 6,
    precipitation: 0,
    precipitationProbability: null,
    weatherCode: 1,
    solarRadiation: 300,
    windSpeed: 3,
    ...overrides,
  };
}

describe('assessStaticElectricity', () => {
  it('冬の乾燥日（湿度25%未満）は気温によらず「高」で対策の一言が付く', () => {
    const result = assessStaticElectricity([hourAt(12, { humidity: 20, temperature: 25 })]);
    expect(result.level).toBe('high');
    expect(result.label).toBe('高');
    expect(result.advice).toBe(STATIC_ELECTRICITY_ADVICE);
  });

  it('湿度40%未満かつ気温20℃未満は「中」でadviceはnull', () => {
    const result = assessStaticElectricity([hourAt(12, { humidity: 35, temperature: 10 })]);
    expect(result.level).toBe('medium');
    expect(result.label).toBe('中');
    expect(result.advice).toBeNull();
  });

  it('乾燥していても気温20℃以上なら「低」（暖かいと帯電しにくい）', () => {
    const result = assessStaticElectricity([
      hourAt(12, { humidity: 35, temperature: STATIC_ELECTRICITY.mediumTemperature }),
    ]);
    expect(result.level).toBe('low');
    expect(result.label).toBe('低');
  });

  it('しきい値ちょうどの湿度は「未満」に含めない（25%は高でない・40%は中でない）', () => {
    expect(
      assessStaticElectricity([
        hourAt(12, { humidity: STATIC_ELECTRICITY.highHumidity, temperature: 10 }),
      ]).level,
    ).toBe('medium');
    expect(
      assessStaticElectricity([
        hourAt(12, { humidity: STATIC_ELECTRICITY.mediumHumidity, temperature: 10 }),
      ]).level,
    ).toBe('low');
  });

  it('日中の最も乾いた時間帯で判定する（夜間の乾燥は対象外）', () => {
    const result = assessStaticElectricity([
      hourAt(3, { humidity: 20 }), // 夜間の乾燥は無視される
      hourAt(10, { humidity: 60 }),
      hourAt(14, { humidity: 30, temperature: 10 }), // 日中の最少湿度→「中」
    ]);
    expect(result.level).toBe('medium');
  });

  it('日中データがない日は全時間帯で代替する', () => {
    const result = assessStaticElectricity([hourAt(22, { humidity: 20 })]);
    expect(result.level).toBe('high');
  });
});
