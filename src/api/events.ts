// /api/events.ics エンドポイント
// public/events.json（イベント予報の定義）をiCalendar（RFC 5545）へ変換して返す。
// 利用者はカレンダーアプリへの取り込みで、着ぐるみイベントの予定を管理できる

import { RESPONSE_CACHE_MAX_AGE_SECONDS } from '../constants';
import { buildEventsCalendar, type CalendarEvent } from '../logic/ical';
import { todayInJst } from '../logic/time';

/** このエンドポイントが必要とするバインディング（Workerの全Envのうち静的アセットのみ） */
export interface AssetsEnv {
  ASSETS: Fetcher;
}

/** 郵便番号の形式（public/app.jsのisValidZipTextと同じ基準） */
const ZIP_PATTERN = /^\d{3}-?\d{4}$/;

/** 時刻の形式（00:00〜23:59。public/app.jsのisValidTimeTextと同じ基準） */
const TIME_TEXT_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 日付文字列がYYYY-MM-DD形式かつ実在する日付か
 * （2026-02-30のような書き間違いを弾く。public/app.jsのisValidDateTextと同じ基準） */
function isValidDateText(text: unknown): text is string {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month ?? 0) - 1 &&
    date.getUTCDate() === day
  );
}

/** events.jsonの1項目として有効か（フロント（public/app.js）のフィルタと同じ基準） */
function isValidEvent(entry: unknown): entry is Omit<CalendarEvent, 'endDate'> & {
  endDate?: string;
} {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const event = entry as Record<string, unknown>;
  return (
    typeof event.name === 'string' &&
    event.name !== '' &&
    typeof event.place === 'string' &&
    event.place !== '' &&
    typeof event.zip === 'string' &&
    ZIP_PATTERN.test(event.zip) &&
    isValidDateText(event.startDate) &&
    (event.endDate === undefined || isValidDateText(event.endDate)) &&
    (event.startTime === undefined ||
      (typeof event.startTime === 'string' && TIME_TEXT_PATTERN.test(event.startTime))) &&
    (event.endTime === undefined ||
      (typeof event.endTime === 'string' && TIME_TEXT_PATTERN.test(event.endTime)))
  );
}

/**
 * events.jsonの内容から掲載対象イベントを取り出す
 * 形式が不正な項目は黙って除外し、終了済みイベントも載せない
 * （フロントの一覧と同じ基準。定義はtest/events.test.tsがCIで検証するため、
 * ここでの除外は配信中の定義ミスへの防御）
 */
export function parseCalendarEvents(body: unknown, today: string): CalendarEvent[] {
  const rawEvents =
    typeof body === 'object' && body !== null && Array.isArray((body as { events?: unknown }).events)
      ? ((body as { events: unknown[] }).events)
      : [];
  return rawEvents
    .filter(isValidEvent)
    .map((event) => ({ ...event, endDate: event.endDate ?? event.startDate }))
    .filter((event) => event.endDate >= event.startDate && event.endDate >= today)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}

/**
 * GET /api/events.ics
 * 静的アセットのevents.jsonを読み、text/calendarで返す。
 * アセットの取得・解析の失敗はルーターの最終防衛線（500）に委ねる
 * （自サイト内の配信物のため、失敗は上流障害ではなく実装・配置の異常）
 */
export async function handleEventsCalendar(request: Request, env: AssetsEnv): Promise<Response> {
  const url = new URL(request.url);
  const asset = await env.ASSETS.fetch(new Request(new URL('/events.json', url).toString()));
  if (!asset.ok) {
    throw new Error(`events.jsonを読み込めませんでした（HTTP ${asset.status}）`);
  }

  const now = new Date();
  const events = parseCalendarEvents(await asset.json(), todayInJst(now));
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
