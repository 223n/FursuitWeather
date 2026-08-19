// 時刻文字列の切り出し（src/logic/time.ts）のテスト
// 上流の時刻形式（YYYY-MM-DDTHH:mm）を位置ベースで切り出す契約を境界値で検証する

import { describe, expect, it } from 'vitest';
import { dateOf, filterByHourRange, hourOf } from '../src/logic/time';

describe('hourOf', () => {
  it('時刻文字列から時を取り出す（0時・23時の境界）', () => {
    expect(hourOf('2026-08-15T00:00')).toBe(0);
    expect(hourOf('2026-08-15T09:00')).toBe(9);
    expect(hourOf('2026-08-15T23:00')).toBe(23);
  });
});

describe('dateOf', () => {
  it('時刻文字列から日付を取り出す', () => {
    expect(dateOf('2026-08-15T00:00')).toBe('2026-08-15');
    expect(dateOf('2026-12-31T23:00')).toBe('2026-12-31');
  });
});

describe('filterByHourRange', () => {
  it('開始時刻を含み、終了時刻を含まない（半開区間）', () => {
    const items = [
      { time: '2026-08-15T08:00' },
      { time: '2026-08-15T09:00' },
      { time: '2026-08-15T14:00' },
      { time: '2026-08-15T15:00' },
    ];
    expect(filterByHourRange(items, 9, 15).map((i) => i.time)).toEqual([
      '2026-08-15T09:00',
      '2026-08-15T14:00',
    ]);
  });
});
