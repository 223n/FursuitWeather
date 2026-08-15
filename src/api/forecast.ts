// /api/forecast エンドポイント
// クエリパラメータを検証し、気象データの取得と予報の組み立てを行う

import {
  DEFAULT_FORECAST_DAYS,
  MAX_FORECAST_DAYS,
  RESPONSE_CACHE_MAX_AGE_SECONDS,
} from '../constants';
import { buildForecast } from '../logic/forecast';
import { demoWeather } from '../weather/demoData';
import { fetchWeather, UpstreamError, type WeatherResult } from '../weather/openMeteo';

/** JSONレスポンスを生成する */
function json(body: unknown, status = 200, cacheable = false): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    // 個人開発の公開APIとして他サイトからの利用も許可する
    'Access-Control-Allow-Origin': '*',
  };
  if (cacheable) {
    headers['Cache-Control'] = `public, max-age=${RESPONSE_CACHE_MAX_AGE_SECONDS}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/** エラーレスポンスを生成する */
function jsonError(status: number, message: string): Response {
  return json({ error: message }, status);
}

/** 数値クエリパラメータを解析する。欠落・非数値はnullを返す */
function parseNumberParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** 現在の日本時間の日付（YYYY-MM-DD）を返す */
function todayInJst(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * GET /api/forecast?lat=35.68&lon=139.68&days=4
 * GET /api/forecast?demo=1 （デモデータで応答）
 */
export async function handleForecast(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonError(405, 'GETメソッドのみ対応しています');
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const now = new Date();

  let weather: WeatherResult;
  let model: string;

  if (params.get('demo') === '1') {
    weather = demoWeather(todayInJst(now));
    model = 'demo';
  } else {
    const latitude = parseNumberParam(params, 'lat');
    const longitude = parseNumberParam(params, 'lon');
    if (latitude === null || longitude === null) {
      return jsonError(400, 'クエリパラメータlat（緯度）とlon（経度）を指定してください');
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return jsonError(400, '緯度は-90〜90、経度は-180〜180の範囲で指定してください');
    }

    const days = parseNumberParam(params, 'days') ?? DEFAULT_FORECAST_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > MAX_FORECAST_DAYS) {
      return jsonError(400, `daysは1〜${MAX_FORECAST_DAYS}の整数で指定してください`);
    }

    try {
      weather = await fetchWeather(latitude, longitude, days);
    } catch (error) {
      if (error instanceof UpstreamError) {
        return jsonError(502, error.message);
      }
      throw error;
    }
    model = 'jma_seamless（気象庁MSM/GSM）';
  }

  const forecast = buildForecast(
    weather.hours,
    {
      latitude: weather.latitude,
      longitude: weather.longitude,
      timezone: weather.timezone,
    },
    model,
    now.toISOString(),
  );

  return json(forecast, 200, true);
}
