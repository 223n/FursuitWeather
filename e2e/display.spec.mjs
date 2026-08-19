// 会場表示モード（public/display.html・display.js）のE2Eテスト
// APIはすべてモックし、上流ネットワークへは接続しない。
// このページ特有のリスクは「時間経過と復帰」に集中しているため、
// クロック偽装でスライドの自動送り・鮮度警告を検証する
import { expect, test } from '@playwright/test';

// 会場のモニターを想定した横長ビューポートで検証する
test.use({ viewport: { width: 1280, height: 720 } });

/** 予報系APIを同一オリジンのデモデータへ差し替える（上流不要で決定的） */
async function mockApisWithDemo(page) {
  for (const path of ['forecast', 'national']) {
    await page.route(`**/api/${path}*`, (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('demo') !== '1') {
        return route.continue({ url: `${url.origin}/api/${path}?demo=1` });
      }
      return route.continue();
    });
  }
}

/** 予報の描画完了（常時帯にバッジが出る）まで待つ */
async function waitForStrip(page) {
  await expect(page.locator('#display-now-strip .badge')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockApisWithDemo(page);
});

test('会場表示: 常時帯・スライドが描画され、時間経過で自動的に切り替わる', async ({ page }) => {
  await page.clock.install();
  await page.goto('/display?demo=1');
  await waitForStrip(page);

  // 常時帯: 判定バッジ+活動目安。ヘッダーには地点（デモ表示）と時計
  await expect(page.locator('#display-now-strip .display-now-minutes')).toBeVisible();
  await expect(page.locator('#display-location')).toContainText('デモ表示');
  await expect(page.locator('#display-clock')).toHaveText(/^\d{2}:\d{2}$/);

  // スライド1（いまの判定）だけが見えている
  await expect(page.locator('#slide-now .badge-large')).toBeVisible();
  await expect(page.locator('#slide-hours')).toBeHidden();
  await expect(page.locator('#display-slide-name')).toHaveText('いまの判定');

  // 更新時刻はデータの生成時刻ベースで表示される
  await expect(page.locator('#display-updated')).toHaveText(/^\d{2}:\d{2}時点$/);

  // 15秒+フェードで2枚目（この後の予報）へ自動で進む
  await page.clock.fastForward(17_000);
  await expect(page.locator('#slide-hours')).toBeVisible();
  await expect(page.locator('#slide-now')).toBeHidden();
  await expect(page.locator('#display-slide-name')).toHaveText('この後の予報');
  // 各セルは時刻・天気・気温に加えて判定を記号+文字のバッジで示す
  await expect(
    page.locator('#display-hours-grid .display-hour-cell .badge').first(),
  ).toBeVisible();
});

test('会場表示: 手動送り・一時停止・全国スライドが操作できる', async ({ page }) => {
  await page.goto('/display?demo=1');
  await waitForStrip(page);

  // 「次へ」ボタンで即時切り替え
  await page.click('#display-next');
  await expect(page.locator('#slide-hours')).toBeVisible();

  // 矢印キーで前後に送れる
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#slide-now')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#slide-national')).toBeVisible();

  // 全国スライド: 12都市のセルに都市名と判定バッジが出る
  await expect(page.locator('#display-national-grid .display-city-cell')).toHaveCount(12);
  await expect(page.locator('#display-national-grid .display-city-cell .badge')).toHaveCount(12);
  await expect(page.locator('#display-national-grid')).toContainText('札幌');

  // 画面タップでも次へ送れる（ボタン以外の場所）
  await page.locator('#display-main').click({ position: { x: 600, y: 400 } });
  await expect(page.locator('#slide-now')).toBeVisible();

  // 一時停止はトグルで、押している状態が読み上げにも伝わる
  await page.click('#display-pause');
  await expect(page.locator('#display-pause')).toHaveText('再開');
  await expect(page.locator('#display-pause')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#display-pause');
  await expect(page.locator('#display-pause')).toHaveText('一時停止');
});

test('会場表示: 取得が止まって1時間経つと鮮度の注意が出る', async ({ page }) => {
  await page.clock.install();
  await page.goto('/display?demo=1');
  await waitForStrip(page);

  // 以後の取得をすべて失敗させ、時間だけ進める（回線断の再現）
  await page.unroute('**/api/forecast*');
  await page.unroute('**/api/national*');
  await page.route('**/api/**', (route) => route.abort());

  await page.clock.fastForward(61 * 60 * 1000);
  await expect(page.locator('#display-alerts')).toContainText('時点の情報です');
  // 前回データでの表示は続く（画面を空にしない）
  await expect(page.locator('#display-now-strip .badge')).toBeVisible();
});

test('会場表示: 地点未指定のときは東京表示の注意が消えずに出る', async ({ page }) => {
  await page.goto('/display');
  await waitForStrip(page);
  await expect(page.locator('#display-alerts')).toContainText('地点が指定されていません');
  await expect(page.locator('#display-location')).toContainText('東京');
});
