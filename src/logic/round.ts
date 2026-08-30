// 数値の丸めユーティリティ（純粋関数）
// 「小数1桁へ丸める」はWBGT・PM2.5・気温など複数ドメインが使うため、
// ここへ単一定義を置く（各所の再実装を防ぐ。ドメイン名付きの別名は各所で維持してよい）

/** 小数1桁に丸める（表示・比較用） */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 小数2桁に丸める（座標の精度そろえ用。約1km四方） */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
