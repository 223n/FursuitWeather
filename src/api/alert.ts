// /api/alert エンドポイント
// 環境省の熱中症警戒アラート発表状況を、表示地点の最寄りの都道府県で突合して返す。
// 既存の「発表基準相当」の自前推定とは別に、公式の発表そのものを画面へ届ける
// （第1段: 当日5時発表分の発表有無の赤帯のみ）。取得・突合はsrc/weather/alert.tsが
// 担い、ここではパラメータ検証と応答整形のみを行う
//
// 次段の課題: 警戒アラートは前日17時にも翌日分が発表される（特別警戒の判定は
// 前日14時）。主催者が中止・短縮を判断する前日夕方に公式発表を届けるには、
// 17時発表版CSV（alert_YYYYMMDD_17.csvと推定）のTargetDate2フラグの突合が
// 必要になるが、17時版の実ファイル様式が未確認のため実装していない
// （様式確認の手順はdocs/release.mdの年次確認を参照。推測実装はしない方針）

import { fetchAlertFor, type AlertResult } from '../weather/alert';
import { todayInJst } from '../logic/time';
import { isDemoRequest, json, parseLatLonParams } from './http';

/**
 * GET /api/alert?lat=35.68&lon=139.68
 * GET /api/alert?demo=1 （上流を呼ばず固定の発表例で応答。表示の死活確認用）
 * レスポンス: { alert: null } または { alert: { prefectureName, special, targetDate } }
 * （発表なし・取得失敗・提供期間外はすべてalert: nullの200。ベストエフォート）
 */
export async function handleAlert(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const date = todayInJst(new Date());

  if (isDemoRequest(params)) {
    const alert: AlertResult = { prefectureName: '東京都', special: false, targetDate: date };
    return json({ alert }, { cacheable: true });
  }

  const coords = parseLatLonParams(params);
  if (coords instanceof Response) {
    return coords;
  }

  const alert = await fetchAlertFor(coords.latitude, coords.longitude, date);
  return json({ alert }, { cacheable: true });
}
