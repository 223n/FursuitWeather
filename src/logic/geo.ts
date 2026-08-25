// 地理の純粋ユーティリティ
// 距離の定義（緯度経度差の二乗和による簡易近似）をここへ集約する。
// 日本国内の代表点選び（都道府県・主要都市）には十分な精度で、
// 三角関数を使うハーバーサインより軽い

/** 緯度経度を持つ点（都道府県代表点・主要都市などの共通形） */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * 点集合から指定座標に最も近い1点を選ぶ
 * 距離二乗も返し、呼び出し側の「近さのしきい値」判定（OGPの「◯◯付近」など）が
 * 距離を再計算せずに済むようにする
 *
 * @param points 1点以上の点集合（空配列は呼び出し側の契約違反。reduceが例外を投げる）
 */
export function nearestPoint<T extends GeoPoint>(
  latitude: number,
  longitude: number,
  points: readonly T[],
): { point: T; distanceSquared: number } {
  const point = points.reduce((a, b) => {
    const distA = (latitude - a.lat) ** 2 + (longitude - a.lon) ** 2;
    const distB = (latitude - b.lat) ** 2 + (longitude - b.lon) ** 2;
    return distB < distA ? b : a;
  });
  return {
    point,
    distanceSquared: (latitude - point.lat) ** 2 + (longitude - point.lon) ** 2,
  };
}
