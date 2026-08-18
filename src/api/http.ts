// APIレスポンスの共通契約
// 全/api/*エンドポイントが同じヘッダー構成（CORS・キャッシュ・Content-Type）で
// 応答するための単一情報源。エンドポイント固有の検証・処理は各ハンドラに置く

import { RESPONSE_CACHE_MAX_AGE_SECONDS } from '../constants';

/** JSONレスポンスを生成する */
export function json(body: unknown, status = 200, cacheable = false): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    // 個人開発の公開APIとして他サイトからの利用も許可する
    'Access-Control-Allow-Origin': '*',
    // Content-Typeを無視した推測実行を防ぐ（静的アセット側はpublic/_headersで設定）
    'X-Content-Type-Options': 'nosniff',
  };
  if (cacheable) {
    headers['Cache-Control'] = `public, max-age=${RESPONSE_CACHE_MAX_AGE_SECONDS}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/** エラーレスポンスを生成する */
export function jsonError(status: number, message: string): Response {
  return json({ error: message }, status);
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
    return jsonError(405, 'GETメソッドのみ対応しています');
  }
  return null;
}
