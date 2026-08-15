// 洗濯乾燥指数のテスト

import { describe, expect, it } from 'vitest';
import {
  assessLaundry,
  fursuitDryingHours,
  saturationVaporPressure,
  vaporPressureDeficit,
} from '../src/logic/laundry';
import type { HourlyWeather } from '../src/types';

/** 干し時間帯（9〜14時）の6時間分のデータを作る */
function dryingWindow(overrides: Partial<HourlyWeather>): HourlyWeather[] {
  return [9, 10, 11, 12, 13, 14].map((hour) => ({
    time: `2026-08-15T${String(hour).padStart(2, '0')}:00`,
    temperature: 30,
    humidity: 50,
    apparentTemperature: 32,
    precipitation: 0,
    weatherCode: 1,
    solarRadiation: 700,
    windSpeed: 3,
    ...overrides,
  }));
}

describe('saturationVaporPressure', () => {
  it('20℃の飽和水蒸気圧は約23.4hPa（理科年表の値と一致）', () => {
    expect(saturationVaporPressure(20)).toBeCloseTo(23.4, 0);
  });

  it('0℃の飽和水蒸気圧は約6.1hPa', () => {
    expect(saturationVaporPressure(0)).toBeCloseTo(6.11, 1);
  });
});

describe('vaporPressureDeficit', () => {
  it('湿度100%なら飽差はゼロ', () => {
    expect(vaporPressureDeficit(25, 100)).toBeCloseTo(0, 5);
  });

  it('湿度が低いほど飽差は大きい', () => {
    expect(vaporPressureDeficit(25, 30)).toBeGreaterThan(vaporPressureDeficit(25, 80));
  });
});

describe('assessLaundry', () => {
  it('真夏の晴天は「大変よく乾く」', () => {
    const result = assessLaundry(dryingWindow({ temperature: 33, humidity: 50 }));
    expect(result.level).toBe('excellent');
    expect(result.score).toBe(100);
    expect(result.moldWarning).toBe(false);
  });

  it('干し時間帯に降水があれば「外干しNG（雨）」', () => {
    const hours = dryingWindow({});
    hours[2] = { ...hours[2]!, precipitation: 1.5 };
    const result = assessLaundry(hours);
    expect(result.level).toBe('noDryRain');
    expect(result.score).toBe(0);
    expect(result.moldWarning).toBe(true);
  });

  it('平均気温5℃未満は「乾きにくい（低温）」', () => {
    const result = assessLaundry(
      dryingWindow({ temperature: 2, humidity: 40, windSpeed: 2 }),
    );
    expect(result.level).toBe('noDryCold');
  });

  it('高湿度の日は部屋干し推奨でカビ警告が付く', () => {
    const result = assessLaundry(
      dryingWindow({ temperature: 22, humidity: 85, windSpeed: 1 }),
    );
    expect(result.level).toBe('indoorDry');
    expect(result.moldWarning).toBe(true);
    expect(result.advice).toContain('カビ');
  });

  it('干し時間帯のデータがない場合は判定不能として返す', () => {
    const evening: HourlyWeather[] = [
      {
        time: '2026-08-15T18:00',
        temperature: 28,
        humidity: 60,
        apparentTemperature: 30,
        precipitation: 0,
        weatherCode: 1,
        solarRadiation: 100,
        windSpeed: 2,
      },
    ];
    const result = assessLaundry(evening);
    expect(result.advice).toContain('判定できません');
  });

  it('乾燥機を使わないよう常に注意書きを含む', () => {
    const result = assessLaundry(dryingWindow({}));
    expect(result.advice).toContain('乾燥機');
  });

  it('欠測で干し時間帯が部分的でも、同条件のフル時間帯と同じ指数になる', () => {
    const full = assessLaundry(dryingWindow({}));
    // 6時間のうち3時間分が欠測したケース
    const partial = assessLaundry(dryingWindow({}).slice(0, 3));
    expect(partial.score).toBe(full.score);
  });
});

describe('fursuitDryingHours', () => {
  it('指数100で最短24時間、指数0で最長48時間', () => {
    expect(fursuitDryingHours(100)).toBe(24);
    expect(fursuitDryingHours(0)).toBe(48);
  });

  it('中間の指数は線形に補間される', () => {
    expect(fursuitDryingHours(50)).toBe(36);
  });
});
