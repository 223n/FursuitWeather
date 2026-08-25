// /api/alert エンドポイント
// 環境省の熱中症警戒アラート発表状況CSVを取得し、表示地点の最寄りの
// 都道府県の当日の発表状況を返す。既存の「発表基準相当」の自前推定とは別に、
// 公式の発表そのものを画面へ届けるための突合（第1段: 発表有無の赤帯のみ）。
//
// 方針: 全経路ベストエフォート。取得失敗・提供期間外（ファイルなし）・
// 対象日ずれ（古いキャッシュ）・様式変更はすべて `alert: null`（=画面は非表示）へ
// 落とし、本体の予報表示を巻き込まない。様式変更などの異常はconsole.errorで
// 運用検知する（黙って機能が死ぬのを防ぐ。年次の様式確認はdocs/release.mdを参照）

import { ALERT_CACHE_TTL_SECONDS, WBGT_ALERT_BASE_URL } from '../constants';
import { alertForPrefecture, nearestPrefecture, parseAlertCsv } from '../logic/alert';
import { todayInJst } from '../logic/time';
import { fetchUpstream } from '../weather/upstream';
import { json, jsonError } from './http';

/** レスポンスのalertフィールド */
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

/** 数値クエリパラメータを解析する。欠落・非数値はnull（forecastと同じ基準） */
function parseNumberParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * 表示地点の最寄り都道府県の当日発表状況を取得する。あらゆる失敗はnull
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
async function fetchAlertFor(
  latitude: number,
  longitude: number,
  date: string,
  fetchImpl: typeof fetch,
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

/**
 * GET /api/alert?lat=35.68&lon=139.68
 * GET /api/alert?demo=1 （上流を呼ばず固定の発表例で応答。表示の死活確認用）
 * レスポンス: { alert: null } または { alert: { prefectureName, special, targetDate } }
 */
export async function handleAlert(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const date = todayInJst(new Date());

  if (params.get('demo') === '1') {
    const alert: AlertResult = { prefectureName: '東京都', special: false, targetDate: date };
    return json({ alert }, { cacheable: true });
  }

  const latitude = parseNumberParam(params, 'lat');
  const longitude = parseNumberParam(params, 'lon');
  if (latitude === null || longitude === null) {
    return jsonError(400, 'クエリパラメータlat（緯度）とlon（経度）を数値で指定してください');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return jsonError(400, '緯度は-90〜90、経度は-180〜180の範囲で指定してください');
  }

  const alert = await fetchAlertFor(latitude, longitude, date, fetch);
  return json({ alert }, { cacheable: true });
}
