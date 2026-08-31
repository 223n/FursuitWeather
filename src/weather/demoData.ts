// デモ用の気象データ生成
// 上流APIに接続できない環境での動作確認と、UIのプレビューに使用する
// 真夏の晴天日（1日目）・雨の日（2日目）・曇りの過ごしやすい日（3日目）を
// 模した決定的なデータを返す
//
// 日数はFORECAST_DAYS（3日）と同じにする。トップページの日付タブ
// （今日・明日・明後日）は取得できた日数に合わせて出し入れするため、デモが
// 2日分だと明後日タブだけが読み込み後に消え、タブ行の折り返しが変わって
// レイアウトシフトが起きる。E2Eの見た目・CLSの検証を本番と同じ形で行うため、
// デモも本番と同じ日数を返す

import { round1 } from '../logic/round';
import { nextDateOf } from '../logic/time';
import type { HourlyWeather } from '../types';
import type { WeatherResult } from './openMeteo';

/** 時刻（0〜23）に応じた日射量（W/m²）の近似カーブ */
function solarCurve(hour: number, peak: number): number {
  if (hour < 6 || hour > 18) {
    return 0;
  }
  // 正午をピークとする正弦半波
  return Math.round(peak * Math.sin(((hour - 6) / 12) * Math.PI));
}

/** 1日分の時間別データを生成する */
function buildDay(
  date: string,
  options: {
    minTemperature: number;
    maxTemperature: number;
    baseHumidity: number;
    peakSolar: number;
    rainHours: readonly number[];
    weatherCode: number;
  },
): HourlyWeather[] {
  const hours: HourlyWeather[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    // 午後2時をピークとする気温カーブ
    const phase = Math.cos(((hour - 14) / 24) * 2 * Math.PI);
    const temperature =
      options.minTemperature +
      ((options.maxTemperature - options.minTemperature) * (phase + 1)) / 2;
    const isRainy = options.rainHours.includes(hour);
    // 日中は湿度が下がり、雨天時は上がる傾向を再現する
    const humidity = Math.min(
      100,
      Math.round(options.baseHumidity - solarCurve(hour, 15) + (isRainy ? 20 : 0)),
    );

    hours.push({
      time: `${date}T${String(hour).padStart(2, '0')}:00`,
      temperature: round1(temperature),
      humidity,
      apparentTemperature: round1(temperature + 2),
      precipitation: isRainy ? 2.5 : 0,
      precipitationProbability: isRainy ? 80 : 10,
      weatherCode: isRainy ? 61 : options.weatherCode,
      solarRadiation: isRainy ? 50 : solarCurve(hour, options.peakSolar),
      windSpeed: 2.5,
    });
  }
  return hours;
}

/** 指定日から3日分のデモデータを返す */
export function demoWeather(startDate: string): WeatherResult {
  const nextDate = nextDateOf(startDate);
  const thirdDate = nextDateOf(nextDate);

  // 朝晩は警戒レベル、日中は危険レベルと段階が変化する晴天日を再現する
  const sunnyDay = buildDay(startDate, {
    minTemperature: 18,
    maxTemperature: 34,
    baseHumidity: 65,
    peakSolar: 850,
    rainHours: [],
    weatherCode: 1,
  });
  const rainyDay = buildDay(nextDate, {
    minTemperature: 22,
    maxTemperature: 26,
    baseHumidity: 85,
    peakSolar: 200,
    rainHours: [9, 10, 11, 12, 13],
    weatherCode: 61,
  });

  // 3日目は曇天日。日射が弱く洗濯の乾きも中程度になるため、晴天日・雨天日と
  // 並べると天気アイコン・洗濯乾燥指数の3通りをデモで見比べられる
  // （着衣補正+11℃のため真夏の気温では判定自体はどの日も危険になる）
  const cloudyDay = buildDay(thirdDate, {
    minTemperature: 20,
    maxTemperature: 28,
    baseHumidity: 70,
    peakSolar: 300,
    rainHours: [],
    weatherCode: 3,
  });

  return {
    hours: [...sunnyDay, ...rainyDay, ...cloudyDay],
    latitude: 35.6785,
    longitude: 139.6823,
    timezone: 'Asia/Tokyo',
    // 真夏の東京の典型的な日の出・日の入り（デモでも日没表示を確認できるようにする）
    sunTimes: new Map([
      [startDate, { sunrise: '05:00', sunset: '18:30' }],
      [nextDate, { sunrise: '05:01', sunset: '18:29' }],
      [thirdDate, { sunrise: '05:02', sunset: '18:28' }],
    ]),
    // 大気質（空気のよごれ指数用）。晴天日はやや高め、雨天日は洗い流されて低めの
    // 典型値にする（いずれも「低」の範囲。デモで行の表示を確認できるようにする）
    airQuality: new Map([
      [startDate, { pm25: [12, 15, 18], dust: [2, 5] }],
      [nextDate, { pm25: [6, 8], dust: [0] }],
      [thirdDate, { pm25: [9, 11], dust: [1, 3] }],
    ]),
  };
}
