// iCalendar（RFC 5545）組み立ての純粋ロジックのテスト

import { describe, expect, it } from 'vitest';
import type { EventDefinition } from '../src/logic/events';
import {
  buildEventsCalendar,
  escapeIcalText,
  foldIcalLine,
  icalTimestamp,
} from '../src/logic/ical';

/** テスト用イベント */
function calendarEvent(overrides: Partial<EventDefinition> = {}): EventDefinition {
  return {
    name: 'けもケット17',
    place: 'TRC東京流通センター',
    zip: '143-0006',
    startDate: '2026-09-20',
    endDate: '2026-09-20',
    startTime: '12:00',
    endTime: '17:00',
    ...overrides,
  };
}

const ORIGIN = 'https://fursuit-weather.223n.tech';
const NOW = new Date('2026-08-25T01:23:45.678Z');

/** 折り返し（CRLF+スペース）を展開して1論理行へ戻す */
function unfoldLines(calendar: string): string[] {
  return calendar.replace(/\r\n[ ]/g, '').split('\r\n');
}

describe('escapeIcalText', () => {
  it('バックスラッシュ・セミコロン・カンマ・改行をエスケープする（RFC 5545 §3.3.11）', () => {
    expect(escapeIcalText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(escapeIcalText('1行目\n2行目')).toBe('1行目\\n2行目');
    expect(escapeIcalText('1行目\r\n2行目')).toBe('1行目\\n2行目');
  });
});

describe('foldIcalLine', () => {
  it('75オクテット以内の行はそのまま返す', () => {
    const line = 'SUMMARY:short';
    expect(foldIcalLine(line)).toBe(line);
  });

  it('75オクテットを超える行はCRLF+スペースで折り返す', () => {
    const line = `SUMMARY:${'a'.repeat(100)}`;
    const folded = foldIcalLine(line);
    expect(folded.split('\r\n')[0]).toHaveLength(75);
    expect(folded.split('\r\n')[1]!.startsWith(' ')).toBe(true);
    // 折り返しを展開すると元の行へ戻る
    expect(folded.replace(/\r\n[ ]/g, '')).toBe(line);
  });

  it('マルチバイト文字（UTF-8）の途中では折り返さない', () => {
    const line = `SUMMARY:${'着'.repeat(60)}`;
    const folded = foldIcalLine(line);
    const encoder = new TextEncoder();
    for (const physical of folded.split('\r\n')) {
      expect(encoder.encode(physical).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n[ ]/g, '')).toBe(line);
  });
});

describe('icalTimestamp', () => {
  it('UTCのYYYYMMDDTHHMMSSZ形式にする', () => {
    expect(icalTimestamp(new Date('2026-08-25T12:34:56.789Z'))).toBe('20260825T123456Z');
  });
});

describe('buildEventsCalendar', () => {
  it('カレンダー全体の枠組み・CRLF行末・末尾CRLFを守る', () => {
    const calendar = buildEventsCalendar([calendarEvent()], ORIGIN, NOW);
    expect(calendar.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(calendar.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // CRLF以外の生の改行が混ざっていない
    expect(calendar.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const lines = unfoldLines(calendar);
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines).toContain('X-WR-TIMEZONE:Asia/Tokyo');
  });

  it('全物理行が75オクテット以内に収まる', () => {
    const longName = 'とても長い名前のイベント'.repeat(8);
    const calendar = buildEventsCalendar([calendarEvent({ name: longName })], ORIGIN, NOW);
    const encoder = new TextEncoder();
    for (const physical of calendar.split('\r\n')) {
      expect(encoder.encode(physical).length).toBeLessThanOrEqual(75);
    }
  });

  it('単日開催で時刻が揃っていればJST→UTC変換した時刻付き予定にする', () => {
    const lines = unfoldLines(buildEventsCalendar([calendarEvent()], ORIGIN, NOW));
    // 12:00 JST = 03:00 UTC
    expect(lines).toContain('DTSTART:20260920T030000Z');
    expect(lines).toContain('DTEND:20260920T080000Z');
  });

  it('複数日開催は終日予定（DTENDは最終日の翌日の排他表現）にする', () => {
    const event = calendarEvent({
      startDate: '2026-11-06',
      endDate: '2026-11-08',
      startTime: '15:00',
      endTime: '21:00',
    });
    const lines = unfoldLines(buildEventsCalendar([event], ORIGIN, NOW));
    expect(lines).toContain('DTSTART;VALUE=DATE:20261106');
    expect(lines).toContain('DTEND;VALUE=DATE:20261109');
  });

  it('時刻のない単日開催は終日予定にする（年またぎの翌日も正しい）', () => {
    const event = calendarEvent({
      startDate: '2026-12-31',
      endDate: '2026-12-31',
      startTime: undefined,
      endTime: undefined,
    });
    const lines = unfoldLines(buildEventsCalendar([event], ORIGIN, NOW));
    expect(lines).toContain('DTSTART;VALUE=DATE:20261231');
    expect(lines).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('終了時刻が開始時刻以前の不正な定義は終日扱いへ落とす', () => {
    const event = calendarEvent({ startTime: '17:00', endTime: '12:00' });
    const lines = unfoldLines(buildEventsCalendar([event], ORIGIN, NOW));
    expect(lines).toContain('DTSTART;VALUE=DATE:20260920');
    expect(lines.some((line) => line.startsWith('DTSTART:2026'))).toBe(false);
  });

  it('イベント名・場所のTEXT値をエスケープする', () => {
    const event = calendarEvent({ name: 'A,B;C', place: '会場\n別館' });
    const lines = unfoldLines(buildEventsCalendar([event], ORIGIN, NOW));
    expect(lines).toContain('SUMMARY:A\\,B\\;C');
    expect(lines).toContain('LOCATION:会場\\n別館（〒143-0006）');
  });

  it('UIDは内容から決まる安定値で、再生成しても変わらない', () => {
    const first = unfoldLines(buildEventsCalendar([calendarEvent()], ORIGIN, NOW));
    const second = unfoldLines(
      buildEventsCalendar([calendarEvent()], ORIGIN, new Date('2027-01-01T00:00:00Z')),
    );
    const uidOf = (lines: string[]): string => lines.find((line) => line.startsWith('UID:'))!;
    expect(uidOf(first)).toBe(uidOf(second));
    expect(uidOf(first)).toContain('@fursuit-weather.223n.tech');
  });

  it('予報リンクと「サイト側が正」の注記をDESCRIPTIONに入れ、VALARMは付けない', () => {
    const calendar = buildEventsCalendar([calendarEvent()], ORIGIN, NOW);
    const lines = unfoldLines(calendar);
    expect(lines).toContain(
      `URL:${ORIGIN}/?event=${encodeURIComponent('けもケット17')}`,
    );
    const description = lines.find((line) => line.startsWith('DESCRIPTION:'))!;
    expect(description).toContain('サイト側を正としてください');
    expect(calendar).not.toContain('VALARM');
  });

  it('イベントがないときも枠組みだけのカレンダーを返す', () => {
    const calendar = buildEventsCalendar([], ORIGIN, NOW);
    expect(calendar).not.toContain('BEGIN:VEVENT');
    expect(calendar.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  });
});
