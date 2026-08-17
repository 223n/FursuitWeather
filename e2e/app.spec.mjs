// フロントエンド（public/app.js）のE2Eテスト
// src/はvitestでカバレッジ100%だが、ブラウザJSはここで実挙動を検証する。
// APIはすべてモックし、上流ネットワークへは接続しない
import { expect, test } from '@playwright/test';

/** /api/forecastを同一オリジンのデモデータへ差し替える（上流不要で決定的） */
async function mockForecastWithDemo(page) {
  await page.route('**/api/forecast*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('demo') !== '1') {
      return route.continue({ url: `${url.origin}/api/forecast?demo=1` });
    }
    return route.continue();
  });
}

/** 予報の描画完了（スケルトン消滅）まで待つ */
async function waitForForecast(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('#now-card .skeleton-line').length === 0,
  );
}

test.beforeEach(async ({ page }) => {
  await mockForecastWithDemo(page);
});

test('初期表示とタブ切り替え: 各タブの内容が描画される', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  await expect(page.locator('#status')).toContainText('予報を取得しました');
  // 既定タブ「現在の天気」: 屋外判定と冷房要否のバッジが表示される
  await expect(page.locator('#now-card .now-headline .badge')).toBeVisible();
  await expect(page.locator('#now-card .now-indoor .badge')).toBeVisible();
  await expect(page.locator('#days-section')).toBeHidden();

  // 「3日間の天気」タブ: 日別カード（デモは2日分）
  await page.click('#tab-days');
  await expect(page.locator('#days-section')).toBeVisible();
  await expect(page.locator('#now-section')).toBeHidden();
  await expect(page.locator('#day-cards .day-card:not(.skeleton-card)')).toHaveCount(2);

  // 「今日の天気」タブ: 時間別テーブル。デモは2日分のため明後日タブは非表示
  await page.click('#tab-day-0');
  await expect(page.locator('#hours-section')).toBeVisible();
  expect(await page.locator('#hours-body tr').count()).toBeGreaterThan(0);
  await expect(page.locator('#tab-day-2')).toBeHidden();

  // 日別カードのクリックはその日の時間別タブへの切り替えになる
  await page.click('#tab-days');
  await page.click('#day-cards .day-card:nth-child(2) .day-card-button');
  await expect(page.locator('#hours-section')).toBeVisible();
  await expect(page.locator('#tab-day-1')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#hours-title')).toContainText('時間別予報（');

  // 矢印キーでタブを移動できる（自動選択）
  await page.locator('#tab-day-1').press('ArrowLeft');
  await expect(page.locator('#tab-day-0')).toHaveAttribute('aria-selected', 'true');

  // 既定都市（東京）がURLへ小数2桁で反映される（共有URLの座標精度の契約）
  await expect(page).toHaveURL(/lat=35\.68&lon=139\.68/);
});

test('地点検索: 候補1件は自動選択され、複数件は一覧から選べる', async ({ page }) => {
  const one = {
    results: [{ name: '蒲郡', admin1: '愛知県', latitude: 34.8261, longitude: 137.2196 }],
  };
  const many = {
    results: [
      { name: '蒲郡', admin1: '愛知県', latitude: 34.8261, longitude: 137.2196 },
      { name: '豊橋', admin1: '愛知県', latitude: 34.7692, longitude: 137.3915 },
    ],
  };
  let body = one;
  await page.route('**/api/geocode*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }),
  );

  await page.goto('/');
  await waitForForecast(page);

  // 1件 → 選択なしで自動表示。座標は小数2桁へ丸められる
  await page.fill('#place-search', '蒲郡市');
  await page.click('#search-button');
  await expect(page.locator('#location-label')).toContainText('蒲郡');
  await expect(page).toHaveURL(/lat=34\.83&lon=137\.22/);

  // 複数件 → ラベル付きの枠に候補が並び、選択で表示が切り替わる
  body = many;
  await page.fill('#place-search', '愛知');
  await page.click('#search-button');
  await expect(page.locator('#search-results-box')).toBeVisible();
  await expect(page.locator('#search-results button')).toHaveCount(2);
  await page.click('#search-results li:last-child button');
  await expect(page.locator('#location-label')).toContainText('豊橋');
});

test('お気に入り: 追加・チップ切替・解除・再読み込み後の復元', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  await page.click('#favorite-toggle-button');
  await expect(page.locator('#favorites-list button')).toHaveCount(1);
  await expect(page.locator('#favorite-toggle-button')).toContainText('お気に入り解除');

  // 再読み込みしても localStorage から復元される
  await page.reload();
  await waitForForecast(page);
  await expect(page.locator('#favorites-list button')).toHaveCount(1);

  // チップで読み込み→解除
  await page.click('#favorites-list button');
  await waitForForecast(page);
  await page.click('#favorite-toggle-button');
  await expect(page.locator('#favorites-list button')).toHaveCount(0);
});

test('現在地: 座標が約1kmへ丸められ、URLにもお気に入りにも残らない', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 35.68123, longitude: 139.76789 });

  await page.goto('/');
  await waitForForecast(page);
  await page.click('#geolocation-button');
  await expect(page.locator('#location-label')).toContainText('現在地');

  // URLはパスへ戻り、お気に入りボタンは無効化される（位置情報は保存しない約束）
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#favorite-toggle-button')).toBeDisabled();

  // APIへ渡る座標も小数2桁（丸め済み）であること
  const requested = await page.evaluate(() => window.performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((n) => n.includes('/api/forecast?lat=')));
  expect(requested.some((n) => n.includes('lat=35.68&lon=139.77'))).toBe(true);
});

test('活動プランナー: 日付と時間帯を選んで計画を表示する', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  await page.click('#tab-planner');
  await expect(page.locator('#planner-section')).toBeVisible();
  // 日付候補は取得済みの日数分（デモは2日=今日・明日）
  await expect(page.locator('#plan-date option')).toHaveCount(2);

  await page.click('#plan-button');
  await expect(page.locator('#plan-result')).toContainText('10時〜16時の計画');
  expect(await page.locator('#plan-result .badge').count()).toBeGreaterThan(0);

  // 日付を明日へ変えて再作成すると、見出しの日付が変わる
  const tomorrow = await page.locator('#plan-date option').nth(1).getAttribute('value');
  await page.selectOption('#plan-date', tomorrow);
  await page.click('#plan-button');
  const day = Number.parseInt(tomorrow.split('-')[2], 10);
  await expect(page.locator('#plan-result h3')).toContainText(`${day}日`);
});

test('イベント: リストから選ぶと郵便番号で開催地を引き、開催日のタブが表示される', async ({
  page,
}) => {
  // 予報データ（デモ）はJSTの当日から始まるため、日付もJST基準で作る
  const jstDate = (offsetDays) =>
    new Date(Date.now() + (9 * 60 + offsetDays * 24 * 60) * 60 * 1000).toISOString().slice(0, 10);
  await page.route('**/events.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          {
            name: 'サマーコン',
            place: '東京ビッグサイト',
            zip: '135-0063',
            startDate: jstDate(0),
            startTime: '11:00',
            endTime: '17:30',
          },
          {
            name: 'ウィンターフェス',
            place: '幕張メッセ',
            zip: '261-0023',
            startDate: jstDate(10),
          },
        ],
      }),
    }),
  );
  // 郵便番号は/api/geocode（zipcloud→地名検索）経由で座標に解決される
  const byZip = {
    '135-0063': { name: '江東区', latitude: 35.6297, longitude: 139.7947 },
    '261-0023': { name: '千葉市美浜区', latitude: 35.6474, longitude: 140.0343 },
  };
  await page.route('**/api/geocode*', (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: byZip[query] ? [byZip[query]] : [] }),
    });
  });

  await page.goto('/');
  await waitForForecast(page);

  // 開催中のイベント → 開催地の予報+今日のタブへ切り替わる。座標は小数2桁
  await page.selectOption('#event-select', '0');
  await page.click('#event-button');
  await expect(page.locator('#location-label')).toContainText('サマーコン（東京ビッグサイト）');
  await expect(page.locator('#tab-day-0')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#status')).toContainText('「サマーコン」開催日');
  await expect(page).toHaveURL(/lat=35\.63&lon=139\.79/);
  // 開催時間はプランナーへ設定される（終了17:30は18時へ切り上げ）
  await expect(page.locator('#plan-start')).toHaveValue('11');
  await expect(page.locator('#plan-end')).toHaveValue('18');
  await expect(page.locator('#status')).toContainText('開催時間（11時〜18時）');

  // 開催日が予報範囲外のイベント → 直近の予報を表示し、開催までの日数を案内する
  await page.selectOption('#event-select', '1');
  await page.click('#event-button');
  await expect(page.locator('#location-label')).toContainText('ウィンターフェス（幕張メッセ）');
  await expect(page.locator('#status')).toContainText('開催まであと10日です');
});

test('イベント: 郵便番号で開催地が見つからないときは日本語の案内を出す', async ({ page }) => {
  const jstDate = (offsetDays) =>
    new Date(Date.now() + (9 * 60 + offsetDays * 24 * 60) * 60 * 1000).toISOString().slice(0, 10);
  await page.route('**/events.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          { name: '謎の集会', place: '未定の会場', zip: '999-9999', startDate: jstDate(1) },
        ],
      }),
    }),
  );
  await page.route('**/api/geocode*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [] }) }),
  );

  await page.goto('/');
  await waitForForecast(page);
  await page.click('#event-button');
  await expect(page.locator('#status-error')).toContainText('見つかりませんでした');
});

test('イベント: 定義が空のときはセレクトとボタンが無効のまま', async ({ page }) => {
  // 実ファイルの内容に依存させない（運営者がイベントを追加してもこのテストは維持される）
  await page.route('**/events.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ events: [] }) }),
  );
  await page.goto('/');
  await waitForForecast(page);
  await expect(page.locator('#event-select')).toBeDisabled();
  await expect(page.locator('#event-select')).toContainText('予定されているイベントはありません');
  await expect(page.locator('#event-button')).toBeDisabled();
});

test('エラー時: 固定の日本語文が表示され、生の英語メッセージを出さない', async ({ page }) => {
  await page.unroute('**/api/forecast*');
  await page.route('**/api/forecast*', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#status-error')).toContainText('通信に失敗しました');
});
