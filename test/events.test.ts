// public/events.json（イベント予報の定義ファイル）の形式検証
//
// events.jsonは運営者が手で編集するデータファイルのため、定義ミス
// （必須項目の欠落・座標や日付の書式誤り）をCIで検出する。
// フロント（public/app.js）は不正な項目を黙って表示から除外する防御を
// 持つが、このテストが先に落ちることで「登録したのに表示されない」を防ぐ。
// 形式の説明はdocs/events.mdを参照。

import { describe, expect, it } from 'vitest';
import eventsFile from '../public/events.json';

interface EventEntry {
  name: string;
  place: string;
  lat: number;
  lon: number;
  startDate: string;
  endDate?: string;
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
      expect(
        Number.isFinite(event.lat) && event.lat >= -90 && event.lat <= 90,
        context,
      ).toBe(true);
      expect(
        Number.isFinite(event.lon) && event.lon >= -180 && event.lon <= 180,
        context,
      ).toBe(true);
      expect(isRealDate(event.startDate), context).toBe(true);
      if (event.endDate !== undefined) {
        expect(isRealDate(event.endDate), context).toBe(true);
        // 終了日は開始日以降（YYYY-MM-DD形式のため文字列比較で正しく判定できる）
        expect(event.endDate >= event.startDate, context).toBe(true);
      }
    }
  });
});
