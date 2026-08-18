// 時刻文字列の切り出し
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
