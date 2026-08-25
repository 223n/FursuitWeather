// 静的アセット（public/）をWorker側から読むエンドポイント共通の基盤
// events.jsonを使うハンドラ（/api/events.ics・/api/badge.svg）が共有する

/** 静的アセットのバインディング（Workerの全Envのうちハンドラが必要とする部分） */
export interface AssetsEnv {
  ASSETS: Fetcher;
}

/**
 * events.json（イベント予報の定義）をリクエストと同じオリジンのアセットから読む
 * アセットの取得・解析の失敗は例外のまま投げる（自サイト内の配信物のため、
 * 失敗は上流障害ではなく実装・配置の異常。ルーターの最終防衛線が500にする）
 */
export async function fetchEventsJson(url: URL, env: AssetsEnv): Promise<unknown> {
  const asset = await env.ASSETS.fetch(new Request(new URL('/events.json', url).toString()));
  if (!asset.ok) {
    throw new Error(`events.jsonを読み込めませんでした（HTTP ${asset.status}）`);
  }
  return asset.json();
}
