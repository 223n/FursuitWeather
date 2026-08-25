// iCalendar（RFC 5545）形式のイベントカレンダー組み立て（純粋ロジック）
//
// /api/events.ics がpublic/events.jsonの内容から組み立てる。RFC 5545の要点:
// - 行末はCRLF。75オクテットを超える行はCRLF+スペースで折り返す（§3.1。
//   UTF-8のマルチバイト文字の途中で切らないよう、オクテット数は文字単位で数える）
// - TEXT値のバックスラッシュ・セミコロン・カンマ・改行はエスケープする（§3.3.11）
// - 通知（VALARM）は付けない（カレンダー登録は予定の情報提供であり、
//   熱中症対策の判断を通知で急かす設計にはしない）
// - 時刻はJST→UTC（末尾Z）で書く。TZID方式はVTIMEZONE定義の同梱が必須になるため
//   使わない（JSTは夏時間がなく-9時間の固定変換で正確）

/** カレンダーへ載せる1イベント（検証済み。endDateは単日開催でもstartDateと同値で埋まっている） */
export interface CalendarEvent {
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

/** 1行の上限オクテット数（RFC 5545 §3.1。CRLFは含まない） */
const LINE_OCTET_LIMIT = 75;

/** TEXT値のエスケープ（RFC 5545 §3.3.11） */
export function escapeIcalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 75オクテットを超える行をCRLF+スペースで折り返す（RFC 5545 §3.1） */
export function foldIcalLine(line: string): string {
  const encoder = new TextEncoder();
  const folded: string[] = [];
  let current = '';
  let octets = 0;
  // for...ofはコードポイント単位のため、サロゲートペア（絵文字など）も途中で切らない
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > LINE_OCTET_LIMIT) {
      folded.push(current);
      // 折り返し行の先頭スペースも75オクテットに数える
      current = ' ';
      octets = 1;
    }
    current += char;
    octets += size;
  }
  folded.push(current);
  return folded.join('\r\n');
}

/** YYYY-MM-DD → YYYYMMDD（VALUE=DATE用） */
function icalDate(date: string): string {
  return date.replaceAll('-', '');
}

/** YYYY-MM-DD の翌日 → YYYYMMDD（終日予定のDTENDは最終日の翌日を指す排他表現） */
function icalNextDay(date: string): string {
  const nextMs = Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000;
  return icalDate(new Date(nextMs).toISOString().slice(0, 10));
}

/** Date → YYYYMMDDTHHMMSSZ（UTC） */
export function icalTimestamp(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** JSTの日付+時刻 → YYYYMMDDTHHMMSSZ（UTC） */
function icalUtcDateTime(date: string, time: string): string {
  return icalTimestamp(new Date(Date.parse(`${date}T${time}:00+09:00`)));
}

/** 1イベント分のVEVENT行を組み立てる */
function eventLines(event: CalendarEvent, origin: string, dtstamp: string): string[] {
  const host = new URL(origin).host;
  const forecastUrl = `${origin}/?event=${encodeURIComponent(event.name)}`;
  const lines = [
    'BEGIN:VEVENT',
    // 再取り込みで予定が重複しないよう、UIDは内容から決まる安定値にする
    `UID:${icalDate(event.startDate)}-${encodeURIComponent(event.name)}@${host}`,
    `DTSTAMP:${dtstamp}`,
    `SUMMARY:${escapeIcalText(event.name)}`,
    `LOCATION:${escapeIcalText(`${event.place}（〒${event.zip}）`)}`,
  ];

  // 単日開催で開始・終了時刻が揃っているときだけ時刻付きの予定にする
  // （複数日開催の時刻は期間全体の開始・終了で、日ごとの開催時間が決まらない。
  //   終了が開始以前の不正な定義も終日扱いへ落とす。HH:MM形式はゼロ埋めのため
  //   文字列比較で前後を正しく判定できる）
  if (
    event.startDate === event.endDate &&
    event.startTime !== undefined &&
    event.endTime !== undefined &&
    event.startTime < event.endTime
  ) {
    lines.push(
      `DTSTART:${icalUtcDateTime(event.startDate, event.startTime)}`,
      `DTEND:${icalUtcDateTime(event.endDate, event.endTime)}`,
    );
  } else {
    // 終日予定のDTENDは最終日の翌日（排他区間。RFC 5545 §3.6.1）
    lines.push(
      `DTSTART;VALUE=DATE:${icalDate(event.startDate)}`,
      `DTEND;VALUE=DATE:${icalNextDay(event.endDate)}`,
    );
  }

  lines.push(
    `URL:${forecastUrl}`,
    'DESCRIPTION:' +
      escapeIcalText(
        `開催地の着ぐるみ予報: ${forecastUrl}\n` +
          'この予定は取り込んだ時点の情報です。開催の詳細は主催者の告知を、' +
          '最新のイベント一覧と予報はFursuitWeatherのサイト側を正としてください。',
      ),
    'END:VEVENT',
  );
  return lines;
}

/**
 * イベント一覧からiCalendar文書全体を組み立てる
 *
 * @param origin リンク・UIDに使うオリジン（例: https://fursuit-weather.223n.tech）
 * @param now DTSTAMP（この文書を作った時刻）に使う現在時刻
 */
export function buildEventsCalendar(
  events: readonly CalendarEvent[],
  origin: string,
  now: Date,
): string {
  const dtstamp = icalTimestamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FursuitWeather//events//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:着ぐるみイベント（FursuitWeather）',
    'X-WR-TIMEZONE:Asia/Tokyo',
    ...events.flatMap((event) => eventLines(event, origin, dtstamp)),
    'END:VCALENDAR',
  ];
  // 最終行にもCRLFを付ける（RFC 5545はcontentlineをCRLF終端と定義している）
  return lines.map(foldIcalLine).join('\r\n') + '\r\n';
}
