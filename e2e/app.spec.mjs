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

test('初期表示: いまの判定・日別カード・時間別テーブルが描画される', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  await expect(page.locator('#status')).toContainText('予報を取得しました');
  // 屋外判定の大型バッジと、屋内の冷房要否バッジの両方が表示される
  await expect(page.locator('#now-card .now-headline .badge')).toBeVisible();
  await expect(page.locator('#now-card .now-indoor .badge')).toBeVisible();
  await expect(page.locator('#day-cards .day-card:not(.skeleton-card)')).toHaveCount(2);
  expect(await page.locator('#hours-body tr').count()).toBeGreaterThan(0);
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

test('活動プランナー: 時間帯の計画と日付切替でのクリア', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  await page.click('#plan-button');
  await expect(page.locator('#plan-result')).toContainText('10時〜16時の計画');
  expect(await page.locator('#plan-result .badge').count()).toBeGreaterThan(0);

  // 日付を切り替えると古い前提の計画は消える
  await page.click('#day-cards .day-card:nth-child(2) .day-card-button');
  await expect(page.locator('#plan-result')).toBeEmpty();
});

test('エラー時: 固定の日本語文が表示され、生の英語メッセージを出さない', async ({ page }) => {
  await page.unroute('**/api/forecast*');
  await page.route('**/api/forecast*', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#status-error')).toContainText('通信に失敗しました');
});
