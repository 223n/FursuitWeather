// 環境省アラート発表状況の解析・突合と /api/alert エンドポイントのテスト
// フィクスチャは2026年度の実ファイル（alert_20260825_05.csv）を短縮したもの

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sampleCsv from './fixtures/alert-sample.csv?raw';
import { handleAlert } from '../src/api/alert';
import { buildAlertUrl } from '../src/weather/alert';
import { alertForPrefecture, nearestPrefecture, parseAlertCsv } from '../src/logic/alert';
import { todayInJst } from '../src/logic/time';

/** フィクスチャの対象日を差し替えたCSVを作る（ハンドラは当日と突合するため） */
function csvForDate(date: string): string {
  return sampleCsv.replaceAll('2026/08/25', date.replaceAll('-', '/'));
}

beforeEach(() => {
  // 失敗経路はconsole.errorへログするため、テスト出力を汚さないよう差し替える
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseAlertCsv', () => {
  it('メタ情報の対象日と府県予報区ごとの当日フラグを取り出す', () => {
    const report = parseAlertCsv(sampleCsv);
    expect(report.targetDate).toBe('2026-08-25');
    expect(report.rows).toHaveLength(8);
    expect(report.rows[0]).toEqual({ regionName: '宗谷地方', prefectureCode: '01', flag: 0 });
    expect(report.rows.find((row) => row.regionName === '東京都')).toEqual({
      regionName: '東京都',
      prefectureCode: '13',
      flag: 1,
    });
  });

  it('ヘッダー行がない・想定した列名がない様式は解析失敗として投げる（黙って誤読しない）', () => {
    expect(() => parseAlertCsv('Title,test\nEncoding,UTF-8\n')).toThrow('ヘッダー行');
    expect(() =>
      parseAlertCsv('府県予報区,別の列\n東京都,13\n'),
    ).toThrow('列構成');
  });

  it('データ行がない・コードやフラグの形式が崩れた行だけのときは失敗として投げる', () => {
    const header =
      '府県予報区,都府県・振興局表示番号,都府県・振興局表示番号サブ,府県予報区等コード,都道府県名,都道府県コード,TargetDate1フラグ,TargetDate2フラグ';
    expect(() => parseAlertCsv(`${header}\n`)).toThrow('データ行');
    expect(() => parseAlertCsv(`${header}\n東京都,44,0,130000,東京,壊,壊,9\n`)).toThrow('データ行');
  });

  it('対象日の形式が想定外のときはnullにする', () => {
    const report = parseAlertCsv(sampleCsv.replace('TargetDate1,2026/08/25', 'TargetDate1,25 Aug'));
    expect(report.targetDate).toBeNull();
  });
});

describe('alertForPrefecture', () => {
  const report = parseAlertCsv(sampleCsv);

  it('フラグ1（警戒アラート発表）の都道府県を発表中として返す', () => {
    expect(alertForPrefecture(report, '13')).toEqual({ special: false });
  });

  it('フラグ2・3は特別警戒として返す', () => {
    expect(alertForPrefecture(report, '30')).toEqual({ special: true });
  });

  it('複数予報区の県は1予報区でも発表があれば発表中（鹿児島: 本土1・奄美0）', () => {
    expect(alertForPrefecture(report, '46')).toEqual({ special: false });
  });

  it('発表なし（0）・発表時間外（9）のみの都道府県はnull', () => {
    expect(alertForPrefecture(report, '01')).toBeNull();
    expect(alertForPrefecture(report, '47')).toBeNull();
  });
});

describe('nearestPrefecture', () => {
  it('代表点（都道府県庁）に最も近い都道府県を返す', () => {
    expect(nearestPrefecture(35.68, 139.68).name).toBe('東京都');
    expect(nearestPrefecture(43.06, 141.35).name).toBe('北海道');
    expect(nearestPrefecture(26.21, 127.68).name).toBe('沖縄県');
  });
});

describe('buildAlertUrl', () => {
  it('年フォルダ+日付+5時発表版のURLを組み立てる', () => {
    expect(buildAlertUrl('2026-08-25')).toBe(
      'https://www.wbgt.env.go.jp/alert/dl/2026/alert_20260825_05.csv',
    );
  });
});

describe('handleAlert', () => {
  it('demo=1は上流を呼ばず固定の発表例を返す（表示の死活確認用）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await handleAlert(new Request('https://example.com/api/alert?demo=1'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { alert: { prefectureName: string } };
    expect(body.alert.prefectureName).toBe('東京都');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('発表中の都道府県ではalertを返す（当日のCSVと突合）', async () => {
    const today = todayInJst(new Date());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(csvForDate(today), { status: 200 })),
    );
    const response = await handleAlert(
      new Request('https://example.com/api/alert?lat=35.68&lon=139.68'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('max-age');
    const body = (await response.json()) as {
      alert: { prefectureName: string; special: boolean; targetDate: string };
    };
    expect(body.alert).toEqual({ prefectureName: '東京都', special: false, targetDate: today });
  });

  it('発表のない都道府県ではalert: nullを返す（札幌付近）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(csvForDate(todayInJst(new Date())), { status: 200 })),
    );
    const response = await handleAlert(
      new Request('https://example.com/api/alert?lat=43.06&lon=141.35'),
    );
    const body = (await response.json()) as { alert: unknown };
    expect(body.alert).toBeNull();
  });

  it('提供期間外（404）はalert: nullでログも出さない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const response = await handleAlert(
      new Request('https://example.com/api/alert?lat=35.68&lon=139.68'),
    );
    const body = (await response.json()) as { alert: unknown };
    expect(body.alert).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('404の本文の読み捨てに失敗しても例外にせずalert: nullを返す', async () => {
    // 読むとエラーになる本文（切断など）。読み捨ての.catchが握りつぶすことを確認する
    const brokenBody = new ReadableStream({
      start(controller): void {
        controller.error(new Error('切断'));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(brokenBody, { status: 404 })));
    const response = await handleAlert(
      new Request('https://example.com/api/alert?lat=35.68&lon=139.68'),
    );
    expect(((await response.json()) as { alert: unknown }).alert).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('404以外の応答異常はalert: nullにしてログへ残す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })));
    const response = await handleAlert(
      new Request('https://example.com/api/alert?lat=35.68&lon=139.68'),
    );
    expect(((await response.json()) as { alert: unknown }).alert).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('対象日が当日と異なる（古いキャッシュ等）はalert: nullにしてログへ残す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(csvForDate('2000-01-01'), { status: 200 })),
    );
    const response = await handleAlert(
      new Request('https://example.com/api/alert?lat=35.68&lon=139.68'),
    );
    expect(((await response.json()) as { alert: unknown }).alert).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      'アラート発表状況の対象日が不一致:',
      expect.any(String),
      '2000-01-01',
      expect.any(String),
    );
  });

  it('様式変更（解析失敗）・接続失敗はalert: nullにしてログへ残す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('壊れた内容', { status: 200 })));
    const parseResult = await handleAlert(
      new Request('https://example.com/api/alert?lat=35.68&lon=139.68'),
    );
    expect(((await parseResult.json()) as { alert: unknown }).alert).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    const networkResult = await handleAlert(
      new Request('https://example.com/api/alert?lat=35.68&lon=139.68'),
    );
    expect(((await networkResult.json()) as { alert: unknown }).alert).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('lat・lonの欠落・範囲外は400を返す', async () => {
    for (const query of ['', '?lat=35.68', '?lat=abc&lon=139.68', '?lat=91&lon=139.68']) {
      const response = await handleAlert(new Request(`https://example.com/api/alert${query}`));
      expect(response.status).toBe(400);
    }
  });
});
