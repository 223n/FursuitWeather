// 上流APIクライアントの共通基盤
// リクエスト初期化子と上流エラーの共通語彙を、気象データ取得（openMeteo.ts）と
// 地点検索（geocoding.ts）で共有する。エンドポイント固有の事情（TTLの選択理由・
// リトライの有無など）は各クライアント側に残す

import { UPSTREAM_TIMEOUT_MS } from '../constants';

/** 上流APIの取得失敗を表すエラー */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** 上流リクエスト共通のUser-Agent（提供元が連絡できるよう出典を明示する） */
const UPSTREAM_USER_AGENT = 'FursuitWeather (https://github.com/223n/FursuitWeather)';

/**
 * 上流リクエスト共通の初期化子（UA・エッジキャッシュ・タイムアウト）
 *
 * ステータスごとにTTLを分けるのが要点で、cacheTtl（一律）にすると上流の
 * エラー応答まで同じ時間キャッシュしてしまう。実際に上流が525を返した際、
 * 上流の復旧後もキャッシュされた525が返り続けて障害が長引いた
 *
 * @param cacheTtlSeconds 成功応答（2xx）のエッジキャッシュ時間（秒）
 */
export function upstreamInit(cacheTtlSeconds: number): RequestInit {
  return {
    headers: { 'User-Agent': UPSTREAM_USER_AGENT },
    cf: {
      cacheTtlByStatus: {
        '200-299': cacheTtlSeconds,
        // エラーは残さない。上流が直り次第すぐ取り直せるようにする
        '400-499': 0,
        '500-599': 0,
      },
      cacheEverything: true,
    },
    // 上流の応答停滞時にユーザーリクエストを長時間待たせないための打ち切り。
    // 中断はfetchのrejectとしてcatchに入り、既存のUpstreamError（502）分類に乗る
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  };
}

/**
 * 上流が非2xxを返したときに、利用者へ見せるメッセージを組み立てる
 *
 * HTTPステータスは利用者にとって意味がなく、対処の判断にも使えないため文面に
 * 含めない（ステータスと本文はconsole.errorへ残し、運用側の切り分けに使う）。
 * 5xxは提供元の障害で「待てば直る」ため、その旨が伝わる文面にする
 */
export function upstreamErrorMessage(subject: string, status: number): string {
  return status >= 500
    ? `${subject}の提供元で障害が発生しています。しばらく時間をおいてから再度お試しください`
    : `${subject}を取得できませんでした。時間をおいて再度お試しください`;
}

/**
 * 破棄する応答の本文を読み切り、ログ用に先頭200字を返す
 * 本文を消費することで、未読ストリームが上流接続を保持するのを防ぐ
 */
export async function readErrorDetail(response: Response): Promise<string> {
  return (await response.text().catch(() => '')).slice(0, 200);
}
