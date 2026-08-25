// /api/alert エンドポイント
// 環境省の熱中症警戒アラート発表状況を、表示地点の最寄りの都道府県で突合して返す。
// 既存の「発表基準相当」の自前推定とは別に、公式の発表そのものを画面へ届ける
// （第1段: 発表有無の赤帯のみ）。取得・突合はsrc/weather/alert.tsが担い、
// ここではパラメータ検証と応答整形のみを行う

import { fetchAlertFor, type AlertResult } from '../weather/alert';
import { todayInJst } from '../logic/time';
import { json, parseLatLonParams } from './http';

/**
 * GET /api/alert?lat=35.68&lon=139.68
 * GET /api/alert?demo=1 （上流を呼ばず固定の発表例で応答。表示の死活確認用）
 * レスポンス: { alert: null } または { alert: { prefectureName, special, targetDate } }
 * （発表なし・取得失敗・提供期間外はすべてalert: nullの200。ベストエフォート）
 */
export async function handleAlert(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const date = todayInJst(new Date());

  if (params.get('demo') === '1') {
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
