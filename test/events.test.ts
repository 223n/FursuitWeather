// public/events.json（イベント予報の定義ファイル）の形式検証
//
// events.jsonは運営者が手で編集するデータファイルのため、定義ミス
// （必須項目の欠落・郵便番号や日付の書式誤り）をCIで検出する。
// フロント（public/app.js）は不正な項目を黙って表示から除外する防御を
// 持つが、このテストが先に落ちることで「登録したのに表示されない」を防ぐ。
// 形式の説明はdocs/events.mdを参照。

import { describe, expect, it } from 'vitest';
import eventsFile from '../public/events.json';

interface EventEntry {
  name: string;
  place: string;
  zip: string;
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
}

const events = (eventsFile as { events: EventEntry[] }).events;

/** YYYY-MM-DD形式かつ実在する日付かを判定する（2月30日などの誤記を検出する） */
function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

describe('public/events.json', () => {
  it('eventsが配列である', () => {
    expect(Array.isArray(events)).toBe(true);
  });

  it('各イベントの必須項目と形式が正しい', () => {
    for (const event of events) {
      const context = `イベント: ${JSON.stringify(event)}`;
      expect(typeof event.name === 'string' && event.name !== '', context).toBe(true);
      expect(typeof event.place === 'string' && event.place !== '', context).toBe(true);
      // 郵便番号はハイフン区切り（123-4567）か7桁の数字（どちらも/api/geocodeが受け付ける）
      expect(typeof event.zip === 'string' && /^\d{3}-?\d{4}$/.test(event.zip), context).toBe(true);
      expect(isRealDate(event.startDate), context).toBe(true);
      if (event.endDate !== undefined) {
        expect(isRealDate(event.endDate), context).toBe(true);
        // 終了日は開始日以降（YYYY-MM-DD形式のため文字列比較で正しく判定できる）
        expect(event.endDate >= event.startDate, context).toBe(true);
      }
      for (const time of [event.startTime, event.endTime]) {
        if (time !== undefined) {
          expect(/^([01]\d|2[0-3]):[0-5]\d$/.test(time), context).toBe(true);
        }
      }
      // 単日開催で開始・終了の時刻がそろっている場合は、終了が開始より後であること
      if (
        event.startTime !== undefined &&
        event.endTime !== undefined &&
        (event.endDate ?? event.startDate) === event.startDate
      ) {
        expect(event.endTime > event.startTime, context).toBe(true);
      }
    }
  });

  it('イベント名が重複していない（選択時に取り違えないため）', () => {
    const names = events.map((event) => event.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
