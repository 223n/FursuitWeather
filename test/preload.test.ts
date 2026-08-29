// API先読み（link rel=preload）の書き換え規則
// 先読みは初回fetchとURLがバイト単位で一致して初めて効くため、
// 丸め・パラメータの順序・daysの引き継ぎまで固定して検証する
import { describe, expect, it } from 'vitest';

import { forecastPreloadHref, forecastPreloadQuery } from '../src/preload';

const queryOf = (search: string): ReturnType<typeof forecastPreloadQuery> =>
  forecastPreloadQuery(new URL(`https://example.com/${search}`));

describe('forecastPreloadQuery（先読み先の決定）', () => {
  it('地点の指定が無ければHTMLのまま（既定都市）にする', () => {
    expect(queryOf('')).toBeUndefined();
  });

  it('共有URLの座標は小数2桁へ丸める（app.jsのcoordQueryと同じ）', () => {
    expect(queryOf('?lat=35.5555&lon=139.7199')).toBe('lat=35.56&lon=139.72');
  });

  it('デモ表示はデモのクエリにする', () => {
    expect(queryOf('?demo=1')).toBe('demo=1');
  });

  it('デモ表示は座標より優先する（app.jsの初期表示の優先順位と同じ）', () => {
    expect(queryOf('?demo=1&lat=35.56&lon=139.72')).toBe('demo=1');
  });

  it('イベント固定リンクは取得先が決まらないためnull（リンクごと外す）', () => {
    expect(queryOf('?event=けもケット')).toBeNull();
  });

  it('空白だけのeventは指定なしと同じ扱いにする', () => {
    expect(queryOf('?event=%20%20')).toBeUndefined();
  });

  it.each([
    ['範囲外の緯度', '?lat=91&lon=139.68'],
    ['範囲外の経度', '?lat=35.68&lon=181'],
    ['数値でない座標', '?lat=abc&lon=139.68'],
    ['片方だけの座標', '?lat=35.68'],
  ])('%s はapp.jsも無視するため既定都市のままにする', (_label, search) => {
    expect(queryOf(search)).toBeUndefined();
  });

  it('座標が妥当でなければeventがあっても既定都市のまま（座標の判定を先に打ち切る）', () => {
    // app.jsも座標の分岐に入って失敗した場合はイベント分岐へ進まないため揃える
    expect(queryOf('?lat=999&lon=0&event=けもケット')).toBeUndefined();
  });
});

describe('forecastPreloadHref（先読みURLの組み立て）', () => {
  it('HTMLに書かれたdaysを引き継ぐ（daysの複製を増やさないため）', () => {
    expect(
      forecastPreloadHref('/api/forecast?lat=35.68&lon=139.68&days=3', 'lat=35.56&lon=139.72'),
    ).toBe('/api/forecast?lat=35.56&lon=139.72&days=3');
  });

  it('daysの指定が無いhrefでは付けずに組み立てる', () => {
    expect(forecastPreloadHref('/api/forecast?lat=35.68&lon=139.68', 'demo=1')).toBe(
      '/api/forecast?demo=1',
    );
  });
});
