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
function upstreamInit(cacheTtlSeconds: number): RequestInit {
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
function upstreamErrorMessage(subject: string, status: number): string {
  return status >= 500
    ? `${subject}の提供元で障害が発生しています。しばらく時間をおいてから再度お試しください`
    : `${subject}を取得できませんでした。時間をおいて再度お試しください`;
}

/**
 * 上流リクエストの文言セット（ログラベルと利用者向けの固定日本語文）
 * 全上流クライアント（openMeteo・geocoding・alert）が共有する契約のため、
 * 名前付きの型を提供元のここで所有する
 */
export interface UpstreamMessages {
  logLabel: string;
  failure: string;
  /** タイムアウト専用の文言（省略時はfailureに合流する） */
  timeout?: string;
}

/**
 * 破棄する応答の本文を読み切り、ログ用に先頭200字を返す
 * 本文を消費することで、未読ストリームが上流接続を保持するのを防ぐ
 */
async function readErrorDetail(response: Response): Promise<string> {
  return (await response.text().catch(() => '')).slice(0, 200);
}

/**
 * 上流へのHTTPリクエスト1回分。トランスポート失敗はUpstreamErrorへ変換する
 *
 * 原因（英語のランタイムメッセージ）はログにのみ残し、利用者へ返すメッセージには
 * 呼び出し側から渡された固定の日本語文を使う。messages.timeoutを渡したクライアント
 * だけがタイムアウトを専用文言で区別する（渡さなければfailureに合流する）
 */
export async function fetchUpstream(
  url: string,
  cacheTtlSeconds: number,
  fetchImpl: typeof fetch,
  messages: UpstreamMessages,
): Promise<Response> {
  try {
    return await fetchImpl(url, upstreamInit(cacheTtlSeconds));
  } catch (error) {
    console.error(messages.logLabel, url, error);
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    throw new UpstreamError((isTimeout ? messages.timeout : undefined) ?? messages.failure);
  }
}

/** 非2xx応答をステータス・本文先頭付きでログへ残す（本文はreadErrorDetailで読み切る） */
export async function logUpstreamStatus(
  label: string,
  url: string,
  response: Response,
): Promise<void> {
  console.error(label, url, response.status, await readErrorDetail(response));
}

/**
 * 上流の非2xx応答をログへ残し、利用者向け文言のUpstreamErrorとして投げる
 * ログラベルは「<件名>APIエラー:」に統一する
 */
export async function throwUpstreamStatus(
  subject: string,
  url: string,
  response: Response,
): Promise<never> {
  await logUpstreamStatus(`${subject}APIエラー:`, url, response);
  throw new UpstreamError(upstreamErrorMessage(subject, response.status));
}

/**
 * 有限の数値のみを通す型ガード
 * 上流レスポンスの値は型主張（as）でしか保証されないため、null・undefinedに
 * 加えて数値文字列・NaNなど「数値でない値」も実行時に排除する
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 上流レスポンスの本文を読み取ってJSONとして解析する
 *
 * 200応答でも中身が想定外（仕様変更・不完全JSON・中間装置のHTML応答）になる障害が
 * 現実には最も起こりやすいため、原因の一次証拠（ボディ先頭200字）をログに残す。
 * 呼び出し側が後段の検証エラーでも一次証拠を出せるよう、生の本文も返す
 */
export async function readUpstreamJson(
  response: Response,
  url: string,
  subject: string,
): Promise<{ raw: string; data: unknown }> {
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    console.error(`${subject}APIレスポンスの読み取りに失敗:`, url, error);
    throw new UpstreamError(`${subject}APIのレスポンスを解析できませんでした`);
  }
  try {
    return { raw, data: JSON.parse(raw) };
  } catch {
    console.error(`${subject}APIレスポンスの解析に失敗:`, url, raw.slice(0, 200));
    throw new UpstreamError(`${subject}APIのレスポンスを解析できませんでした`);
  }
}
