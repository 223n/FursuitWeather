// index.htmlのAPI先読み（link rel=preload）を、そのリクエストで実際に取得される
// URLへ合わせる
//
// 先読みは初回のfetchとURLがバイト単位で一致して初めて効く。HTMLに書ける値は
// 既定都市の1つだけのため、共有URL（?lat=&lon=）やデモ表示で開かれると、
// 東京の予報を1回取ってそのまま捨てることになる（実測でリクエストが2本になり、
// ブラウザのコンソールにも「preloaded but not used」が出る）。
// HTMLはWorkerがnonceを差し込むため元から書き換えており、リクエストのクエリから
// 取得先が決まる場合はここで先読み先も合わせる。
//
// 記憶した地点（localStorage）はサーバーからは見えないため、そのぶんの取り違えは
// 残る（既定都市のまま先読みする）。既定都市で開く初回訪問は先読みが効いており、
// そこを遅くしないことを優先している。

import { isDemoRequest, parseLatLonParams } from './api/http';

/** 先読みリンクへの指示
 * - string: このクエリで先読みする（`lat=..&lon=..` または `demo=1`）
 * - null: 取得先が決められないため先読みリンクごと外す
 * - undefined: HTMLに書かれたまま（既定都市）にする */
export type PreloadQuery = string | null | undefined;

/** 先読みリンクのhrefがこの接頭辞のときだけ書き換える（他のpreloadを巻き込まない） */
export const FORECAST_PRELOAD_PREFIX = '/api/forecast';

/**
 * リクエストURLから、先読みリンクに載せるべきクエリを決める
 *
 * 分岐の順序はpublic/app.jsの初期表示の優先順位（demo → 共有URLの座標 →
 * イベント固定リンク → 記憶した地点・既定都市）と合わせている。
 * 座標の小数2桁への丸めはapp.jsのcoordQueryと同じで、受け付ける範囲は
 * parseLatLonParams（/api/forecastと共通の契約）に委ねてずれを防ぐ。
 */
export function forecastPreloadQuery(url: URL): PreloadQuery {
  const params = url.searchParams;
  if (isDemoRequest(params)) {
    return 'demo=1';
  }

  // 座標が妥当なときだけ合わせる。妥当でない座標はapp.jsも無視して
  // 記憶・既定へ落ちるため、HTMLに書かれた既定都市のままでよい
  if (params.has('lat') || params.has('lon')) {
    const coords = parseLatLonParams(params);
    if (!(coords instanceof Response)) {
      return `lat=${coords.latitude.toFixed(2)}&lon=${coords.longitude.toFixed(2)}`;
    }
    return undefined;
  }

  // イベント固定リンクは会場の郵便番号を解決してから取得するため、
  // この時点では取得先が分からない。既定都市を先読みしても必ず捨てられる
  if ((params.get('event') ?? '').trim() !== '') {
    return null;
  }

  return undefined;
}

/**
 * 先読みリンクのhrefを組み立てる
 *
 * 予報日数（days）はHTMLに書かれている値をそのまま引き継ぐ。
 * daysの単一情報源はapp.jsのFORECAST_DAYSとindex.htmlのpreload URLで、
 * その一致はtest/htmlSync.test.tsが検証している。ここで値を持つと
 * 3か所目の複製になるため持たない。
 */
export function forecastPreloadHref(currentHref: string, query: string): string {
  const days = /[?&](days=\d+)/.exec(currentHref)?.[1];
  return `${FORECAST_PRELOAD_PREFIX}?${query}${days ? `&${days}` : ''}`;
}
