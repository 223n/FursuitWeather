// /api/events.ics エンドポイント
// public/events.json（イベント予報の定義）をiCalendar（RFC 5545）へ変換して返す。
// 利用者はカレンダーアプリへの取り込みで、着ぐるみイベントの予定を管理できる。
// 定義の検証・整列はsrc/logic/events.ts、iCalendarの組み立てはsrc/logic/ical.tsが担う

import { RESPONSE_CACHE_MAX_AGE_SECONDS } from '../constants';
import { parseCalendarEvents } from '../logic/events';
import { buildEventsCalendar } from '../logic/ical';
import { todayInJst } from '../logic/time';
import { fetchEventsJson, type AssetsEnv } from './assets';

/**
 * GET /api/events.ics
 * 静的アセットのevents.jsonを読み、text/calendarで返す。
 * アセットの取得・解析の失敗はルーターの最終防衛線（500）に委ねる
 */
export async function handleEventsCalendar(request: Request, env: AssetsEnv): Promise<Response> {
  const url = new URL(request.url);
  const now = new Date();
  const events = parseCalendarEvents(await fetchEventsJson(url, env), todayInJst(now));
  const calendar = buildEventsCalendar(events, url.origin, now);
  return new Response(calendar, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // カレンダーアプリへの取り込みを促す（ブラウザでの生テキスト表示を避ける）
      'Content-Disposition': 'attachment; filename="fursuit-weather-events.ics"',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      // イベント定義の更新はデプロイ時のみのため、予報APIと同じブラウザキャッシュで十分
      'Cache-Control': `public, max-age=${RESPONSE_CACHE_MAX_AGE_SECONDS}`,
    },
  });
}
