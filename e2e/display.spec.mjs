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

  // 一時停止⇄再開はラベル交換の2状態ボタン（ラベル変更とaria-pressedは併用しない）
  await page.click('#display-pause');
  await expect(page.locator('#display-pause')).toHaveText('再開');
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

test('会場表示: 設定パネルでスライドとお知らせを変更するとURLへ反映される', async ({ page }) => {
  await page.goto('/display?demo=1');
  await waitForStrip(page);

  await page.click('#display-settings-button');
  await expect(page.locator('#display-settings')).toBeVisible();

  // 「3日間の天気」を外すと進行ドットが3個になり、URLへslides=が反映される
  await page.uncheck('#settings-slide-days');
  await expect(page.locator('#display-progress .display-dot')).toHaveCount(3);
  await expect(page).toHaveURL(/slides=now(%2C|,)hours(%2C|,)national/);

  // お知らせを設定するとヘッダー下のループ帯が現れ、URLへmsg=が反映される
  await page.fill('#settings-message', '休憩スペースは2階です');
  await page.locator('#settings-message').blur();
  await expect(page.locator('#display-ticker')).toBeVisible();
  await expect(page.locator('#display-ticker-track')).toContainText('休憩スペースは2階です');
  await expect(page).toHaveURL(/msg=/);

  await page.click('#settings-close');
  await expect(page.locator('#display-settings')).toBeHidden();
});

test('会場表示: 都市の絞り込みと追加都市が全国スライドへ反映される', async ({ page }) => {
  await page.goto('/display?demo=1&cities=札幌,東京&add=34.69,135.50,ベイエリア');
  await waitForStrip(page);

  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#slide-national')).toBeVisible();
  // 選んだ2都市+追加1都市の3セル。外した都市は表示されない
  await expect(page.locator('#display-national-grid .display-city-cell')).toHaveCount(3);
  await expect(page.locator('#display-national-grid')).toContainText('札幌');
  await expect(page.locator('#display-national-grid')).toContainText('ベイエリア');
  await expect(page.locator('#display-national-grid')).not.toContainText('仙台');
});

test('会場表示: 追加4都市を含む16セルでも判定バッジが収まる', async ({ page }) => {
  await page.goto(
    '/display?demo=1&add=34.39,132.46,呉&add=33.24,131.61,別府&add=36.65,138.18,長野&add=43.77,142.36,旭川',
  );
  await waitForStrip(page);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#slide-national')).toBeVisible();
  await expect(page.locator('#display-national-grid .display-city-cell')).toHaveCount(16);
  const fits = await page
    .locator('.display-city-cell .badge')
    .evaluateAll((badges) =>
      badges.map((badge) => {
        const rect = badge.getBoundingClientRect();
        const cell = badge.closest('.display-city-cell').getBoundingClientRect();
        return rect.height > 0 && rect.bottom <= cell.bottom + 1;
      }),
    );
  expect(fits).toHaveLength(16);
  expect(fits.every(Boolean)).toBe(true);
});

test('会場表示: 設定パネル表示中はフォーカスが背景へ抜けず、リセットで設定が消える', async ({ page }) => {
  await page.goto('/display?demo=1&slides=now,hours&msg=テスト');
  await waitForStrip(page);
  await page.click('#display-settings-button');
  await expect(page.locator('#display-settings')).toBeVisible();

  // Tabを繰り返してもフォーカスはパネルの中に留まる（背景はinert）
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(
      () => document.getElementById('display-settings').contains(document.activeElement),
    );
    expect(inside).toBe(true);
  }

  // 「初期設定に戻す」でURLから設定パラメータが消え、全スライド表示へ戻る
  await page.click('#settings-reset');
  await expect(page.locator('#display-progress .display-dot')).toHaveCount(4);
  await expect(page).not.toHaveURL(/slides=|msg=/);
  await expect(page.locator('#display-ticker')).toBeHidden();
});

test.describe('縦画面（スマホ）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('会場表示: 縦画面でも全国の都市名と判定がセル内に収まる', async ({ page }) => {
    await page.goto('/display?demo=1');
    await waitForStrip(page);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#slide-national')).toBeVisible();

    // 全セルで都市名が見え、判定バッジがセルの中に収まっている（切れて消えない）
    await expect(page.locator('.display-city-cell .display-city-name')).toHaveCount(12);
    const fits = await page
      .locator('.display-city-cell .badge')
      .evaluateAll((badges) =>
        badges.map((badge) => {
          const rect = badge.getBoundingClientRect();
          const cell = badge.closest('.display-city-cell').getBoundingClientRect();
          return rect.height > 0 && rect.bottom <= cell.bottom + 1;
        }),
      );
    expect(fits).toHaveLength(12);
    expect(fits.every(Boolean)).toBe(true);
  });
});
