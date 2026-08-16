// 着ぐるみ活動判定のテスト

import { describe, expect, it } from 'vitest';
import { assessCooling, assessIndoor, assessOutdoor } from '../src/logic/fursuit';
import type { HourlyWeather } from '../src/types';

/** テスト用の気象データを作る */
function weather(overrides: Partial<HourlyWeather>): HourlyWeather {
  return {
    time: '2026-08-15T12:00',
    temperature: 25,
    humidity: 60,
    apparentTemperature: 26,
    precipitation: 0,
    precipitationProbability: null,
    weatherCode: 1,
    solarRadiation: 500,
    windSpeed: 2,
    ...overrides,
  };
}

describe('assessOutdoor（暑熱側）', () => {
  it('真夏の炎天下は「危険」で活動中止になる', () => {
    const result = assessOutdoor(
      weather({ temperature: 35, humidity: 65, solarRadiation: 900, windSpeed: 1 }),
    );
    expect(result.level).toBe('danger');
    expect(result.activityMinutes).toBe(0);
    expect(result.grade).toBe(4);
  });

  it('着ぐるみ補正で素のWBGTより11℃高い値で判定する', () => {
    const result = assessOutdoor(weather({}));
    expect(result.suitWbgt).toBeCloseTo(result.wbgt + 11, 5);
  });

  it('穏やかな気温でも着ぐるみ補正により「注意」以上になる', () => {
    // Ta=16℃, RH=40%: 素のWBGT約11℃ → 補正後約22℃で「注意」帯
    const result = assessOutdoor(
      weather({ temperature: 16, humidity: 40, solarRadiation: 0, windSpeed: 1 }),
    );
    expect(result.level).toBe('caution');
    expect(result.activityMinutes).toBe(30);
  });

  it('補正後WBGTちょうど31℃は「危険」で活動中止になる（危険/厳重警戒の境界）', () => {
    // Ta=25℃, RH=52%, SR=0, WS=1: 素のWBGT=20.0 → 補正後ちょうど31.0℃。
    // classifyHeatは「上限値未満」で判定するため、境界値は上の帯に入る
    const result = assessOutdoor(
      weather({ temperature: 25, humidity: 52, solarRadiation: 0, windSpeed: 1 }),
    );
    // 入力が境界ちょうどを踏んでいることを自己文書化する
    // （将来係数が変わって境界から外れた場合に、テスト意図の空洞化を検出する）
    expect(result.suitWbgt).toBe(31);
    expect(result.level).toBe('danger');
    expect(result.activityMinutes).toBe(0);
  });

  it('気温15℃未満でも日射が強く補正後WBGTが高い場合は暑熱判定を優先する', () => {
    // Ta=14.9℃, RH=70%, SR=700W/m²: 素のWBGT約15.6℃ → 補正後約26.6℃で「警戒」帯。
    // 低温判定（快適）に切り替えると危険側の誤判定になるため、暑熱側を採用する
    const result = assessOutdoor(
      weather({
        temperature: 14.9,
        apparentTemperature: 13,
        humidity: 70,
        solarRadiation: 700,
        windSpeed: 1,
      }),
    );
    expect(result.level).toBe('warning');
    expect(result.activityMinutes).toBe(20);
  });
});

describe('assessOutdoor（低温側）', () => {
  it('気温15℃未満で暑熱リスクが低ければ体感温度による低温判定になる', () => {
    const result = assessOutdoor(weather({ temperature: 8, apparentTemperature: 5 }));
    expect(result.level).toBe('optimal');
    expect(result.activityMinutes).toBe(45);
  });

  it('体感温度0℃以下は低温注意', () => {
    const result = assessOutdoor(weather({ temperature: 2, apparentTemperature: -3 }));
    expect(result.level).toBe('coldCaution');
  });

  it('暑熱と低温が同じ深刻度なら活動時間の短い暑熱側を採用する', () => {
    // Ta=14℃, RH=60%, SR=300W/m²: 補正後WBGT約23.7℃で「注意」（grade 1・30分）。
    // 体感温度0℃の「低温注意」（grade 1・45分）と同格だが、活動時間の短い暑熱側が勝つ
    const result = assessOutdoor(
      weather({ temperature: 14, apparentTemperature: 0, humidity: 60, solarRadiation: 300, windSpeed: 1 }),
    );
    expect(result.level).toBe('caution');
    expect(result.activityMinutes).toBe(30);
  });

  it('体感温度ちょうど0℃は「低温注意」に入る（快適/低温注意の境界）', () => {
    // classifyColdは「下限値より大きい」で判定するため、境界値は下の帯に入る
    const result = assessOutdoor(weather({ temperature: 2, apparentTemperature: 0 }));
    expect(result.level).toBe('coldCaution');
  });

  it('体感温度ちょうど-10℃は「低温警戒」に入る（低温注意/低温警戒の境界）', () => {
    const result = assessOutdoor(weather({ temperature: -5, apparentTemperature: -10 }));
    expect(result.level).toBe('coldWarning');
    expect(result.activityMinutes).toBe(30);
  });

  it('体感温度ちょうど-20℃は「低温危険」に入る（低温警戒/低温危険の境界）', () => {
    const result = assessOutdoor(weather({ temperature: -15, apparentTemperature: -20 }));
    expect(result.level).toBe('coldDanger');
    expect(result.activityMinutes).toBe(0);
  });

  it('体感温度-10℃以下は低温警戒で活動30分', () => {
    const result = assessOutdoor(weather({ temperature: -5, apparentTemperature: -14 }));
    expect(result.level).toBe('coldWarning');
    expect(result.activityMinutes).toBe(30);
  });

  it('体感温度-20℃以下は屋外活動を推奨しない', () => {
    const result = assessOutdoor(weather({ temperature: -15, apparentTemperature: -25 }));
    expect(result.level).toBe('coldDanger');
    expect(result.activityMinutes).toBe(0);
  });
});

describe('assessIndoor', () => {
  it('真夏日相当の屋内は「危険」かつ冷房必須', () => {
    const result = assessIndoor(weather({ temperature: 30, humidity: 60 }));
    expect(result.level).toBe('danger');
    expect(result.cooling).toBe('required');
    expect(result.coolingLabel).toBe('冷房必須');
  });

  it('涼しい屋内は冷房なしでも可', () => {
    const result = assessIndoor(weather({ temperature: 12, humidity: 40 }));
    expect(result.cooling).toBe('none');
  });
});

describe('assessCooling', () => {
  it('しきい値どおりに冷房要否を返す', () => {
    expect(assessCooling(20.9)).toBe('none');
    expect(assessCooling(21)).toBe('recommended');
    expect(assessCooling(24.9)).toBe('recommended');
    expect(assessCooling(25)).toBe('required');
  });
});
