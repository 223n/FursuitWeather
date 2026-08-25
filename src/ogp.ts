// リンクカード（OGP）用の動的サマリー
//
// SNS・チャットのリンクプレビューを描画するクローラーからのアクセスに限り、
// 共有URL（?lat=&lon=）の地点の当日判定をog:title・og:descriptionへ差し込む。
// 通常の閲覧者には静的なOGタグのまま返す（画面の表示はapp.jsが組み立てるため、
// 全リクエストで上流を呼ぶとエッジ配信の速さを損なうだけで益がない）。
// 取得はベストエフォート: 失敗時はnullを返し、静的タグのまま配信する

import { isDemoRequest, parseLatLonParams } from './api/http';
import { NATIONAL_CITIES } from './constants';
import { buildDayForecastFor } from './logic/forecast';
import { nearestPoint } from './logic/geo';
import { todayInJst } from './logic/time';
import type { DayForecast } from './types';
import { demoWeather } from './weather/demoData';
import { fetchWeatherForDate } from './weather/openMeteo';

/** OGタグへ差し込む動的サマリー */
export interface OgSummary {
  title: string;
  description: string;
}

/**
 * リンクプレビュー用クローラーのUAパターン
 * 主要SNS・チャットのカード取得UAを広めに拾う（Twitterbot・Discordbot・Slackbot・
 * LINEBotのような「bot」を含むもの、facebookexternalhit（Facebook・Messenger）、
 * Bluesky（cardyb）、Misskey（summaly）、Fediverse（mastodon・pleroma・misskey）、
 * その他preview・embed・crawler・spiderを名乗るもの）。
 * 判定漏れは静的タグ表示になるだけで安全側のため、厳密な網羅は狙わない
 */
const PREVIEW_BOT_PATTERN =
  /bot|crawler|spider|preview|embed|facebookexternalhit|summaly|cardyb|mastodon|pleroma|misskey/i;

/** 動的サマリーを差し込む対象パス（共有URLはトップページのみ） */
const OG_PATHS: readonly string[] = ['/', '/index.html'];

/**
 * 「都市名付近」と表示してよい距離の上限（度の二乗）
 * 最寄りの主要都市から緯度経度差の二乗和が1以内（約1度＝100km前後）なら
 * その都市名で代表させる。リンクカードの地点表現としての目安であり、
 * 予報自体は共有URLの座標そのままで計算する
 */
const NEARBY_DISTANCE_SQUARED = 1;

/** リンクプレビュー用クローラーからのアクセスか */
export function isPreviewBot(userAgent: string | null): boolean {
  return userAgent !== null && PREVIEW_BOT_PATTERN.test(userAgent);
}

/**
 * リンクカードに載せる地点表現を組み立てる
 * 共有URLは座標のみで地名を持たない（?nameはURLに含まれても表示注記用のため、
 * 攻撃者が任意文言をカードへ差し込めないよう使わない）。主要都市の近くは
 * 「◯◯付近」、それ以外は座標表記にする
 */
export function ogLocationLabel(latitude: number, longitude: number): string {
  const { point, distanceSquared } = nearestPoint(latitude, longitude, NATIONAL_CITIES);
  if (distanceSquared <= NEARBY_DISTANCE_SQUARED) {
    return `${point.name}付近`;
  }
  return `緯度${latitude.toFixed(2)}・経度${longitude.toFixed(2)}`;
}

/** 「M/D」表記（カードの文字数を抑えるため年は省く。当日の日付なので誤解の余地がない） */
function monthDayOf(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

/** 当日サマリーからOGタグの文言を組み立てる */
export function buildOgSummary(day: DayForecast, locationLabel: string): OgSummary {
  const monthDay = monthDayOf(day.date);
  const windowText =
    day.recommendedHours.length > 0
      ? '活動しやすい時間帯があります'
      : '活動しやすい時間帯はありません';
  return {
    title: `${locationLabel} ${monthDay}の着ぐるみ判定: ${day.outdoorWorst.label}`,
    description:
      `${monthDay}の${locationLabel}は${day.weatherLabel}・最高${day.temperatureMax}℃。` +
      `日中の最も厳しい判定は「${day.outdoorWorst.label}」で、${windowText}。` +
      '共有時点の予報のため、最新の判定はリンク先で確認してください。',
  };
}

/**
 * リクエストに応じた動的OGサマリーを返す
 * 対象パス（トップページ）×クローラーUA×有効な座標が揃ったときだけ上流を呼ぶ。
 * それ以外・取得失敗はnull（呼び出し側は静的タグのまま配信する）
 *
 * @param fetchImpl テスト時にモックを注入するためのfetch実装
 */
export async function ogSummaryFor(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<OgSummary | null> {
  const url = new URL(request.url);
  if (!OG_PATHS.includes(url.pathname)) {
    return null;
  }
  if (!isPreviewBot(request.headers.get('user-agent'))) {
    return null;
  }
  // 座標の解析・検証はAPI群と同じ基準（parseLatLonParams）を使い、
  // エラーレスポンスは返さずnull（=静的タグのまま）へ読み替える
  const coords = parseLatLonParams(url.searchParams);
  if (coords instanceof Response) {
    return null;
  }
  const { latitude, longitude } = coords;

  try {
    // /api/nationalと同じ日付固定の取得にする（当日1日分・エッジキャッシュも共有される）。
    // demo=1は上流なしのデモデータで応答する（/api/forecastと同じ死活確認手段）
    const date = todayInJst(new Date());
    const weather = isDemoRequest(url.searchParams)
      ? demoWeather(date)
      : await fetchWeatherForDate(latitude, longitude, date, fetchImpl);
    const day = buildDayForecastFor(weather.hours, date);
    if (day === null) {
      // 上流キャッシュの日付またぎで当日分が空になり得る。カードは静的タグへ退避する
      console.error('OGPサマリー: 対象日の気象データがありません:', date, url.search);
      return null;
    }
    return buildOgSummary(day, ogLocationLabel(latitude, longitude));
  } catch (error) {
    // カードが静的表示になるだけで実害は小さいが、上流異常の検知のためログには残す
    console.error('OGPサマリーの取得に失敗:', url.search, error);
    return null;
  }
}
