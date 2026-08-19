// 時刻文字列の切り出しと時間帯フィルタ
// 上流の時刻形式（YYYY-MM-DDTHH:mm、types.tsのHourlyWeather.timeの契約）を
// 位置ベースで切り出す知識を1箇所に集約する。形式の検証は取得時
// （openMeteo.tsのTIME_PATTERN）で済んでいるため、ここでは検証しない

/** 時刻文字列（YYYY-MM-DDTHH:mm）から時（0〜23）を取り出す */
export function hourOf(time: string): number {
  return Number.parseInt(time.slice(11, 13), 10);
}

/** 時刻文字列から日付（YYYY-MM-DD）を取り出す */
export function dateOf(time: string): string {
  return time.slice(0, 10);
}

/** 現在の日本時間の日付（YYYY-MM-DD）を返す */
export function todayInJst(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** 時刻が[startHour, endHour)の半開区間に入る要素だけ残す（開始を含み終了を含まない） */
export function filterByHourRange<T extends { time: string }>(
  items: readonly T[],
  startHour: number,
  endHour: number,
): T[] {
  return items.filter((item) => {
    const hour = hourOf(item.time);
    return hour >= startHour && hour < endHour;
  });
}
