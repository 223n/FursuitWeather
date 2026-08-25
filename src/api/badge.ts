// /api/badge.svg エンドポイント
// イベント告知ページなどに<img>1行で貼れる、当日判定の埋め込みバッジを返す。
//
// 受け付ける地点は主要12都市（city=）と登録済みイベントの開催地（event=）に
// 限定する。任意座標を受けると、第三者サイトのPVごとに発火するトラフィックが
// ユニーク座標ごとに上流キャッシュキーを分けてしまい、Open-Meteoの無料枠を
// 第三者が直接圧迫できてしまう（本体サービスの巻き添え502を防ぐための制限）

import { NATIONAL_CITIES } from '../constants';
import { buildBadgeSvg } from '../logic/badge';
import { listValidEvents } from '../logic/events';
import { todayInJst } from '../logic/time';
import { demoWeather } from '../weather/demoData';
import { fetchGeocoding } from '../weather/geocoding';
import { fetchWeatherForDate, type WeatherResult } from '../weather/openMeteo';
import { fetchEventsJson, type AssetsEnv } from './assets';
import { requireDayForecast } from './daySummary';
import { apiHeaders, isDemoRequest, jsonError } from './http';

/** イベント名の指定を受け付ける上限長（イベント名の実長より十分大きい定数） */
const EVENT_NAME_MAX_LENGTH = 100;

/** バッジ対象地点の座標を解決する。解決できないときはエラーレスポンスを返す */
async function resolveLocation(
  url: URL,
  env: AssetsEnv,
): Promise<{ latitude: number; longitude: number } | Response> {
  const city = url.searchParams.get('city');
  const eventName = url.searchParams.get('event');
  if ((city === null) === (eventName === null)) {
    return jsonError(400, 'クエリパラメータcity（主要都市名）またはevent（イベント名）のどちらか一方を指定してください');
  }

  if (city !== null) {
    const found = NATIONAL_CITIES.find((entry) => entry.name === city);
    if (found === undefined) {
      return jsonError(400, `cityは主要都市名（${NATIONAL_CITIES.map((entry) => entry.name).join('・')}）のいずれかで指定してください`);
    }
    return { latitude: found.lat, longitude: found.lon };
  }

  if (eventName === '' || (eventName ?? '').length > EVENT_NAME_MAX_LENGTH) {
    return jsonError(400, 'eventはイベント一覧に登録されている名前で指定してください');
  }
  const event = listValidEvents(await fetchEventsJson(url, env)).find(
    (entry) => entry.name === eventName,
  );
  if (event === undefined) {
    return jsonError(404, '指定されたイベントは登録されていません');
  }

  // 開催地は郵便番号→座標で解決する（イベント予報のフロントと同じ経路。
  // 上流問い合わせはgeocoding.ts側でエッジに7日間キャッシュされる）
  const places = await fetchGeocoding(event.zip);
  const place = places[0];
  if (place === undefined) {
    return jsonError(404, 'イベントの開催地の座標を解決できませんでした');
  }
  return { latitude: place.latitude, longitude: place.longitude };
}

/**
 * GET /api/badge.svg?city=東京
 * GET /api/badge.svg?event=けもケット17
 * GET /api/badge.svg?demo=1 （上流を呼ばずデモデータで応答。表示確認用）
 */
export async function handleBadge(request: Request, env: AssetsEnv): Promise<Response> {
  const url = new URL(request.url);
  const date = todayInJst(new Date());

  let weather: WeatherResult;
  if (isDemoRequest(url.searchParams)) {
    weather = demoWeather(date);
  } else {
    const location = await resolveLocation(url, env);
    if (location instanceof Response) {
      return location;
    }
    // /api/nationalと同じ日付固定の取得（当日1日分。エッジキャッシュも共有される）
    weather = await fetchWeatherForDate(location.latitude, location.longitude, date);
  }

  // 当日の最も厳しい屋外判定をバッジに描く（対象日が空のときの上流エラー化を含めて
  // requireDayForecastが担う）
  const svg = buildBadgeSvg(requireDayForecast(weather.hours, date).outdoorWorst);
  return new Response(svg, {
    // 共通ヘッダー（CORS・nosniff・キャッシュ）はapiHeadersへ集約。
    // 埋め込み先のPVごとに上流へ向かわないよう、予報APIと同じブラウザキャッシュを付ける
    headers: apiHeaders('image/svg+xml; charset=utf-8', {
      cacheable: true,
      extra: {
        // 直接開かれてもスクリプトを実行させない（組み立てたSVGに実行要素はないが多層防御）
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    }),
  });
}
