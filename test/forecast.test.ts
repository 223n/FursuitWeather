// 予報組み立てのテスト

import { describe, expect, it } from 'vitest';
import { buildDayForecast, buildForecast, buildHourForecast } from '../src/logic/forecast';
import { demoWeather } from '../src/weather/demoData';
import type { HourlyWeather } from '../src/types';

/** 1日分（24時間）のテストデータを作る */
function fullDay(date: string, overrides: Partial<HourlyWeather> = {}): HourlyWeather[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    time: `${date}T${String(hour).padStart(2, '0')}:00`,
    temperature: 24,
    humidity: 60,
    apparentTemperature: 25,
    precipitation: 0,
    weatherCode: 1,
    solarRadiation: hour >= 6 && hour <= 18 ? 500 : 0,
    windSpeed: 2,
    ...overrides,
  }));
}

describe('buildHourForecast', () => {
  it('屋外・屋内の判定と天気ラベルを含む', () => {
    const hour = buildHourForecast(fullDay('2026-08-15')[12]!);
    expect(hour.weatherLabel).toBe('晴れ');
    expect(hour.outdoor.suitWbgt).toBeGreaterThan(hour.outdoor.wbgt);
    expect(hour.indoor.coolingLabel).toBeTruthy();
  });
});

describe('buildDayForecast', () => {
  it('最高・最低気温と日中の最悪・最良レベルを集計する', () => {
    // 最低気温を日中帯（9〜18時）の外に置き、min/maxが全時間帯から集計される契約も固定する
    const raw = fullDay('2026-08-15');
    raw[3] = { ...raw[3]!, temperature: 18 };
    raw[14] = { ...raw[14]!, temperature: 30 };
    const hours = raw.map(buildHourForecast);
    const day = buildDayForecast('2026-08-15', hours);
    expect(day.temperatureMin).toBe(18);
    expect(day.temperatureMax).toBe(30);
    expect(day.outdoorWorst.grade).toBeGreaterThanOrEqual(day.outdoorBest.grade);
  });

  it('降水のある時間帯は活動推奨時間帯から除外する', () => {
    const raw = fullDay('2026-08-15', { temperature: 10, apparentTemperature: 8 });
    // 10時のみ降水させる
    raw[10] = { ...raw[10]!, precipitation: 2 };
    const hours = raw.map(buildHourForecast);
    const day = buildDayForecast('2026-08-15', hours);
    expect(day.recommendedHours).not.toContain('10:00');
    expect(day.recommendedHours).toContain('11:00');
  });

  it('猛暑日は冷房必須になる', () => {
    const hours = fullDay('2026-08-15', { temperature: 34, humidity: 65 }).map(buildHourForecast);
    const day = buildDayForecast('2026-08-15', hours);
    expect(day.coolingRequired).toBe(true);
  });

  it('最悪と最良の判定はそれぞれ別の時間帯から選ばれる', () => {
    // 既定の日中は猛暑（危険）のため、15時だけ涼しくして最良側が更新されることを確かめる
    const raw = fullDay('2026-08-15');
    raw[15] = {
      ...raw[15]!,
      temperature: 10,
      apparentTemperature: 8,
      solarRadiation: 0,
    };
    const hours = raw.map(buildHourForecast);
    const day = buildDayForecast('2026-08-15', hours);
    expect(day.outdoorWorst.grade).toBe(4);
    expect(day.outdoorBest.grade).toBe(0);
    expect(day.outdoorBest.level).toBe('optimal');
  });

  it('日中データがない日は全時間帯からサマリーを組み立てる', () => {
    // 取得初日が夜間のみのケース（19〜23時の5時間）。
    // 21時だけ猛暑・19時だけ曇りにして、集計元が夜間の時間帯であることを確かめる
    const raw = fullDay('2026-08-15').slice(19, 24);
    raw[0] = { ...raw[0]!, weatherCode: 3 };
    raw[2] = { ...raw[2]!, temperature: 34, humidity: 65 };
    const hours = raw.map(buildHourForecast);
    const day = buildDayForecast('2026-08-15', hours);

    // 例外なくサマリーが返り、最悪判定は夜間（21時）の猛暑から選ばれる
    expect(day.outdoorWorst.grade).toBe(4);
    expect(day.outdoorWorst.grade).toBeGreaterThan(day.outdoorBest.grade);
    // 活動推奨時間帯は日中（9〜18時）のみが対象のため空になる
    expect(day.recommendedHours).toEqual([]);
    // 代表天気コードは正午に最も近い19時の値
    expect(day.weatherCode).toBe(3);
  });
});

describe('buildForecast', () => {
  it('日付ごとにグループ化し、出典表記と注意事項を含む', () => {
    const twoDays = [...fullDay('2026-08-15'), ...fullDay('2026-08-16')];
    const forecast = buildForecast(
      twoDays,
      { latitude: 35.68, longitude: 139.68, timezone: 'Asia/Tokyo' },
      'test',
      '2026-08-15T00:00:00.000Z',
    );
    expect(forecast.days).toHaveLength(2);
    expect(forecast.hours).toHaveLength(48);
    expect(forecast.attribution.weatherData).toContain('Open-Meteo');
    expect(forecast.notices.length).toBeGreaterThan(0);
  });

  it('日付文字列が不完全でもデモデータは既定値で補って2日分を返す', () => {
    // demoWeatherの日付分解フォールバック（年のみ指定→1月1日扱い）の防御動作を固定する
    const demo = demoWeather('2026');
    expect(demo.hours).toHaveLength(48);
    expect(demo.hours[demo.hours.length - 1]!.time.startsWith('2026-01-02')).toBe(true);
  });

  it('デモデータから危険な猛暑日と雨天日の予報を組み立てられる', () => {
    const demo = demoWeather('2026-08-15');
    const forecast = buildForecast(
      demo.hours,
      { latitude: demo.latitude, longitude: demo.longitude, timezone: demo.timezone },
      'demo',
      '2026-08-15T00:00:00.000Z',
    );
    expect(forecast.days).toHaveLength(2);

    // 1日目: 猛暑の晴天日 → 日中の最悪レベルは危険、冷房必須
    const sunny = forecast.days[0]!;
    expect(sunny.outdoorWorst.grade).toBe(4);
    expect(sunny.coolingRequired).toBe(true);

    // 2日目: 雨天 → 洗濯は外干しNG
    const rainy = forecast.days[1]!;
    expect(rainy.laundry.level).toBe('noDryRain');
  });
});
