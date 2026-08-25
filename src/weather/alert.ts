// 環境省の熱中症警戒アラート発表状況の上流クライアント
// 発表状況CSVの取得と、表示地点の最寄り都道府県への突合を担う
// （CSVの解析はsrc/logic/alert.tsの純粋関数。応答整形はsrc/api/alert.ts）
//
// 方針: 全経路ベストエフォート。取得失敗・提供期間外（ファイルなし）・
// 対象日ずれ（古いキャッシュ）・様式変更はすべてnull（=画面は非表示）へ落とし、
// 本体の予報表示を巻き込まない。様式変更などの異常はconsole.errorで運用検知する
// （黙って機能が死ぬのを防ぐ。年次の様式確認はdocs/release.mdを参照）

import { ALERT_CACHE_TTL_SECONDS, WBGT_ALERT_BASE_URL } from '../constants';
import { alertForPrefecture, nearestPrefecture, parseAlertCsv } from '../logic/alert';
import { fetchUpstream } from './upstream';

/** 突合結果（/api/alertのレスポンスのalertフィールド） */
export interface AlertResult {
  /** 突合した都道府県名（表示地点の最寄りの代表点） */
  prefectureName: string;
  /** 熱中症特別警戒アラート（警戒より深刻な段階）か */
  special: boolean;
  /** 対象日（YYYY-MM-DD） */
  targetDate: string;
}

/** 当日の発表状況CSVのURL（5時発表版。当日の発表はこの1ファイルに集約される） */
export function buildAlertUrl(date: string): string {
  const compact = date.replaceAll('-', '');
  return `${WBGT_ALERT_BASE_URL}/${date.slice(0, 4)}/alert_${compact}_05.csv`;
}

/**
 * 表示地点の最寄り都道府県の当日発表状況を取得する。あらゆる失敗はnull
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
export async function fetchAlertFor(
  latitude: number,
  longitude: number,
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AlertResult | null> {
  const url = buildAlertUrl(date);
  try {
    const response = await fetchUpstream(url, ALERT_CACHE_TTL_SECONDS, fetchImpl, {
      logLabel: 'アラート発表状況の取得失敗:',
      failure: 'アラート発表状況を取得できませんでした',
    });
    if (!response.ok) {
      // 提供期間外・当日5時の発表前はファイルが無い（404）。異常ではないためログも出さない
      if (response.status !== 404) {
        console.error('アラート発表状況の応答異常:', url, response.status);
      }
      return null;
    }
    const report = parseAlertCsv(await response.text());
    // 対象日の検証: 上流エッジキャッシュの日付またぎ等で前日のファイルを
    // 「本日の発表」と誤表示しないための防御
    if (report.targetDate !== date) {
      console.error('アラート発表状況の対象日が不一致:', url, report.targetDate, date);
      return null;
    }
    const prefecture = nearestPrefecture(latitude, longitude);
    const issued = alertForPrefecture(report, prefecture.code);
    if (issued === null) {
      return null;
    }
    return { prefectureName: prefecture.name, special: issued.special, targetDate: date };
  } catch (error) {
    // 様式変更・接続失敗など。黙って機能が死んだことに気づけるようログには残す
    console.error('アラート発表状況の解析失敗:', url, error);
    return null;
  }
}
