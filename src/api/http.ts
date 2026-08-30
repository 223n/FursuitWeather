// APIレスポンスの共通契約
// 全/api/*エンドポイントが同じヘッダー構成（CORS・キャッシュ・Content-Type）で
// 応答するための単一情報源。エンドポイント固有の検証・処理は各ハンドラに置く

import { RESPONSE_CACHE_MAX_AGE_SECONDS } from '../constants';
import { round2 } from '../logic/round';
import { UpstreamError } from '../weather/upstream';

/**
 * 全APIエンドポイント共通のレスポンスヘッダーを組み立てる
 * （CORS・nosniff・キャッシュ方針の単一情報源。JSONのほかSVG・iCalの応答も使う）
 *
 * @param extra CSP・Content-Dispositionなどエンドポイント固有の追加ヘッダー
 */
export function apiHeaders(
  contentType: string,
  options: { cacheable?: boolean; extra?: Record<string, string> } = {},
): Record<string, string> {
  const { cacheable = false, extra = {} } = options;
  return {
    'Content-Type': contentType,
    // 個人開発の公開APIとして他サイトからの利用も許可する
    'Access-Control-Allow-Origin': '*',
    // Content-Typeを無視した推測実行を防ぐ（静的アセット側はpublic/_headersで設定）
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheable ? `public, max-age=${RESPONSE_CACHE_MAX_AGE_SECONDS}` : 'no-store',
    ...extra,
  };
}

/** デモモード指定（?demo=1）か。デモフラグの仕様（パラメータ名・値）の単一情報源 */
export function isDemoRequest(params: URLSearchParams): boolean {
  return params.get('demo') === '1';
}

/** JSONレスポンスを生成する */
export function json(
  body: unknown,
  options: { status?: number; cacheable?: boolean } = {},
): Response {
  const { status = 200, cacheable = false } = options;
  return new Response(JSON.stringify(body), {
    status,
    headers: apiHeaders('application/json; charset=utf-8', { cacheable }),
  });
}

/** エラーレスポンスを生成する（cacheableを渡さないことでエラー=no-storeの契約を保つ） */
export function jsonError(status: number, message: string): Response {
  return json({ error: message }, { status });
}

/** 数値クエリパラメータを解析する。欠落・非数値はnullを返す
 * （モジュール内専用。座標を受けるエンドポイントの共通入口はparseLatLonParams） */
function parseNumberParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * lat・lonクエリパラメータを解析・検証する（座標を受けるエンドポイント共通の契約）
 * 問題があれば400のエラーレスポンスを返す。しきい値・文言をここへ集約し、
 * エンドポイントごとに基準がずれる事故を防ぐ
 *
 * 受け取った座標は小数2桁（約1km四方）へ丸める。理由は2つある。
 * 1. 上流の無料枠を守る: 上流URLはエッジキャッシュのキーになるため、任意精度の
 *    座標を素通しすると、ほぼ同じ地点の問い合わせがユニークなキーへ際限なく
 *    分かれて上流を直接叩ける（/api/badge.svgが地点を12都市＋登録イベントへ
 *    限定しているのと同じ理由。座標を受ける経路にも同じ歯止めを置く）
 * 2. 画面の契約と揃える: public/app.jsのcoordQueryとpublic/display.jsは、
 *    プライバシー保護のため常に小数2桁しか送っていない。サーバー側で丸めても
 *    自前クライアントの表示は変わらず、公開APIの応答だけが約1kmへ量子化される
 */
export function parseLatLonParams(
  params: URLSearchParams,
): { latitude: number; longitude: number } | Response {
  const latitude = parseNumberParam(params, 'lat');
  const longitude = parseNumberParam(params, 'lon');
  if (latitude === null || longitude === null) {
    return jsonError(400, 'クエリパラメータlat（緯度）とlon（経度）を数値で指定してください');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return jsonError(400, '緯度は-90〜90、経度は-180〜180の範囲で指定してください');
  }
  // 丸めは範囲検証の後に行う。丸めで動くのは最大0.005度で、範囲の端
  // （±90・±180）へ寄る向きにしか動かないため、丸めた値が範囲を出ることはない
  return { latitude: round2(latitude), longitude: round2(longitude) };
}

/**
 * 上流障害（UpstreamError）を502レスポンスへ変換する。それ以外のエラーはnullを
 * 返す（ルーターの最終防衛線が500へフォールスルーする）。
 * 上流障害（レート制限・仕様変更など）を運用で検知できるよう、502もログに残す
 */
export function upstreamErrorResponse(error: unknown, url: URL): Response | null {
  if (error instanceof UpstreamError) {
    console.error('上流エラー:', url.pathname + url.search, error.message);
    return jsonError(502, error.message);
  }
  return null;
}

/** CORSプリフライト（OPTIONS）への応答を生成する */
function preflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * 全APIエンドポイント共通のメソッドガード（CORS契約の単一情報源）
 * OPTIONSにはプリフライト応答、GET以外には405を返し、GETはnull（処理続行）を返す
 */
export function methodGuard(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }
  if (request.method !== 'GET') {
    const response = jsonError(405, 'GETメソッドのみ対応しています');
    // RFC 9110 §15.5.6: 405には対応メソッドを示すAllowヘッダーを必ず付ける
    response.headers.set('Allow', 'GET');
    return response;
  }
  return null;
}
