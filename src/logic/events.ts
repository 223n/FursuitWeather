// events.json（イベント予報の定義）の検証・整列（純粋ロジック）
// /api/events.ics（カレンダー配信）と/api/badge.svg（開催地の解決）が共有する。
// 検証基準はフロント（public/app.jsのフィルタ）・CIのtest/events.test.tsと
// 同じにする（正規表現の一致はtest/htmlSync.test.tsが機械検証する）

/**
 * events.json の1イベント（検証済み）
 *
 * events.jsonの形を決めているのは本モジュール（検証・整列の所有者）のため、
 * 型もここが持つ。利用側はiCalendar出力（logic/ical.ts）と開催地の解決
 * （api/badge.ts）で、どちらもカレンダー専用ではない。
 * endDateは単日開催でもstartDateと同値で埋まっている（listValidEventsが補う）
 */
export interface EventDefinition {
  readonly name: string;
  readonly place: string;
  readonly zip: string;
  /** 開催初日（YYYY-MM-DD） */
  readonly startDate: string;
  /** 開催最終日（YYYY-MM-DD） */
  readonly endDate: string;
  /** 開催初日の開始時刻（HH:MM）。未定義は終日扱い */
  readonly startTime?: string;
  /** 開催最終日の終了時刻（HH:MM）。未定義は終日扱い */
  readonly endTime?: string;
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
function isValidEvent(entry: unknown): entry is Omit<EventDefinition, 'endDate'> & {
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
 * events.jsonの内容から形式が有効なイベントを取り出す
 * 不正な項目は黙って除外する（フロントの一覧と同じ基準。定義は
 * test/events.test.tsがCIで検証するため、ここでの除外は配信中の定義ミスへの防御）。
 * 開催終了によるフィルタは行わない（バッジ（/api/badge.svg）は告知ページに
 * 貼られたまま残るため、終了後も開催地の解決に使う）
 */
export function listValidEvents(body: unknown): EventDefinition[] {
  const rawEvents =
    typeof body === 'object' && body !== null && Array.isArray((body as { events?: unknown }).events)
      ? ((body as { events: unknown[] }).events)
      : [];
  return rawEvents
    .filter(isValidEvent)
    .map((event) => ({ ...event, endDate: event.endDate ?? event.startDate }))
    .filter((event) => event.endDate >= event.startDate);
}

/**
 * events.jsonの内容からカレンダー掲載対象イベントを取り出す
 * 有効なイベントのうち終了済みを除き、開催が近い順に並べる（フロントの一覧と同じ基準）
 */
export function parseCalendarEvents(body: unknown, today: string): EventDefinition[] {
  return listValidEvents(body)
    .filter((event) => event.endDate >= today)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}
