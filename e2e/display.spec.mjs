// 会場表示モード（public/display.html・display.js）のE2Eテスト
// APIはすべてモックし、上流ネットワークへは接続しない。
// このページ特有のリスクは「時間経過と復帰」に集中しているため、
// クロック偽装でスライドの自動送り・鮮度警告を検証する
import { expect, test } from '@playwright/test';

// 会場のモニターを想定した横長ビューポートで検証する
test.use({ viewport: { width: 1280, height: 720 } });

/** 予報系APIを同一オリジンのデモデータへ差し替える（上流不要で決定的）。
 * 地点予報は全時間帯を14時（危険レベル）の内容へ揃え、テストの実行時刻に
 * 依存しない判定にする（デモデータは時間帯で判定が変わるため、現在時刻に
 * 連動する表示（常時帯・もしものときスライドの自動表示）が実行時刻次第で
 * 変わってしまう。危険レベルに固定すると自動表示は常に働く側で検証できる） */
async function mockApisWithDemo(page) {
  await page.route('**/api/forecast*', async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('demo', '1');
    const response = await route.fetch({ url: url.toString() });
    const body = await response.json();
    const template = body.hours.find((hour) => hour.time.endsWith('T14:00'));
    body.hours = body.hours.map((hour) => ({ ...template, time: hour.time }));
    await route.fulfill({ json: body });
  });
  await page.route('**/api/national*', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('demo') !== '1') {
      return route.continue({ url: `${url.origin}/api/national?demo=1` });
    }
    return route.continue();
  });
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

  // 矢印キーで前後に送れる（危険レベル固定のモックのため、巡回の末尾には
  // もしものときスライドが自動で加わっている: now→…→national→emergency）
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#slide-now')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#slide-emergency')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#slide-national')).toBeVisible();

  // 全国スライド: 12都市のセルに都市名と判定バッジが出る
  await expect(page.locator('#display-national-grid .display-city-cell')).toHaveCount(12);
  await expect(page.locator('#display-national-grid .display-city-cell .badge')).toHaveCount(12);
  await expect(page.locator('#display-national-grid')).toContainText('札幌');

  // 画面タップでも次へ送れる（ボタン以外の場所）
  await page.locator('#display-main').click({ position: { x: 600, y: 400 } });
  await expect(page.locator('#slide-emergency')).toBeVisible();
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

  // 「3日間の天気」を外すと進行ドットが4個（選択3枚+自動のもしものとき）に
  // なり、URLへslides=が反映される（自動表示分はURLに載らない）
  await page.uncheck('#settings-slide-days');
  await expect(page.locator('#display-progress .display-dot')).toHaveCount(4);
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

  // 末尾は自動追加のもしものときスライドのため、2回戻して全国スライドへ
  await page.keyboard.press('ArrowLeft');
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

// 全国スライドが3行になる構成（9都市以上）では、セル内の縦積みが行の高さを超え、
// overflow:hiddenで都市名の上と判定バッジの下が黙って切れていた。
// 会場のモニターとPCでよく使う横長サイズを実寸で検証する（既定の12都市）
test('会場表示: 横長画面の12都市でも都市名と判定がセルに収まる', async ({ page }) => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 780 },
    { width: 1366, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/display?demo=1&slides=national');
    await waitForStrip(page);
    await expect(page.locator('#slide-national')).toBeVisible();
    await expect(page.locator('#display-national-grid .display-city-cell')).toHaveCount(12);

    const fits = await page.locator('.display-city-cell').evaluateAll((cells) =>
      cells.map((cell) => {
        const box = cell.getBoundingClientRect();
        return ['.display-city-name', '.badge'].every((selector) => {
          const rect = cell.querySelector(selector).getBoundingClientRect();
          return rect.height > 0 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
        });
      }),
    );
    expect(fits, `${viewport.width}x${viewport.height}`).toEqual(new Array(12).fill(true));
  }
});

// 追加都市の名前は40文字まで許容されるため、長い会場名でセルが縦に破裂しうる。
// 見た目は2行で打ち切って省略記号を出し、安全情報である判定バッジは必ず残す
// （読み上げ用に名前の全文はDOMへ残す）
test('会場表示: 長い名前の追加都市でも判定バッジが押し出されない', async ({ page }) => {
  const longName = '幕張メッセ国際展示場9〜11ホール';
  await page.goto(`/display?demo=1&slides=national&add=${encodeURIComponent(`35.63,140.03,${longName}`)}`);
  await waitForStrip(page);
  await expect(page.locator('#slide-national')).toBeVisible();
  await expect(page.locator('#display-national-grid .display-city-cell')).toHaveCount(13);

  // 画面上は切り詰められても、名前の全文はDOMに残る（読み上げは省略されない）
  const longCell = page.locator('.display-city-cell').filter({ hasText: '幕張メッセ' });
  await expect(longCell.locator('.display-city-name')).toHaveText(longName);

  const fits = await page
    .locator('.display-city-cell .badge')
    .evaluateAll((badges) =>
      badges.map((badge) => {
        const rect = badge.getBoundingClientRect();
        const cell = badge.closest('.display-city-cell').getBoundingClientRect();
        return rect.height > 0 && rect.top >= cell.top - 1 && rect.bottom <= cell.bottom + 1;
      }),
    );
  expect(fits).toHaveLength(13);
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
  // （危険レベル固定のモックのため、もしものときの自動追加で5個になる）
  await page.click('#settings-reset');
  await expect(page.locator('#display-progress .display-dot')).toHaveCount(5);
  await expect(page).not.toHaveURL(/slides=|msg=/);
  await expect(page.locator('#display-ticker')).toBeHidden();
});

test('会場表示: 短いお知らせでも複製が画面幅を埋め、途切れず流れ続ける', async ({ page }) => {
  await page.goto('/display?demo=1&msg=テスト');
  await waitForStrip(page);
  await expect(page.locator('#display-ticker')).toBeVisible();

  // 複製が画面幅ぶん敷き詰められている（2グループなのでトラック幅は画面幅以上×2相当）
  const counts = await page.evaluate(() => {
    const track = document.getElementById('display-ticker-track');
    return { items: track.children.length, width: track.scrollWidth, viewport: window.innerWidth };
  });
  expect(counts.items).toBeGreaterThanOrEqual(2);
  expect(counts.width).toBeGreaterThanOrEqual(counts.viewport);

  // アニメーションが実際に進んでいる（transformが時間経過で変わる）
  const transformOf = () =>
    page.evaluate(() => getComputedStyle(document.getElementById('display-ticker-track')).transform);
  const before = await transformOf();
  await page.waitForTimeout(600);
  const after = await transformOf();
  expect(after).not.toBe(before);

  // 一時停止でお知らせの流れも止まり、再開で再び流れる（WCAG 2.2.2）。
  // Web Animations APIのpause()は次フレームで確定する（pause-pending）ため、
  // 確定を待ってから停止位置を基準にする
  await page.click('#display-pause');
  await page.waitForTimeout(100);
  const pausedAt = await transformOf();
  await page.waitForTimeout(500);
  expect(await transformOf()).toBe(pausedAt);
  await page.click('#display-pause');
  await page.waitForTimeout(500);
  expect(await transformOf()).not.toBe(pausedAt);
});

test.describe('縦画面（スマホ）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('会場表示: 縦画面でも全国の都市名と判定がセル内に収まる', async ({ page }) => {
    await page.goto('/display?demo=1');
    await waitForStrip(page);
    await page.keyboard.press('ArrowLeft');
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

test('会場表示: もしものときスライドは設定ONで巡回に加わり、OFFでURLからも消える', async ({
  page,
}) => {
  await page.goto('/display?demo=1&slides=now,emergency');
  await waitForStrip(page);

  // 進行ドットは2個（いまの判定+もしものとき）。次へ送ると応急対応の要点が出る
  await expect(page.locator('#display-progress .display-dot')).toHaveCount(2);
  await page.click('#display-next');
  await expect(page.locator('#slide-emergency')).toBeVisible();
  await expect(page.locator('#display-slide-name')).toHaveText('もしものとき');
  await expect(page.locator('.display-emergency-steps > li')).toHaveCount(5);
  await expect(page.locator('#slide-emergency')).toContainText('119');

  // 設定パネルではONとして表示され、OFFにするとURLからは消える。
  // ただし危険レベル固定のモックのため、巡回には自動表示で残り続ける
  // （設定OFFでも厳重警戒以上は自動表示する仕様）
  await page.click('#display-settings-button');
  await expect(page.locator('#settings-slide-emergency')).toBeChecked();
  await page.uncheck('#settings-slide-emergency');
  await expect(page.locator('#settings-slide-emergency')).not.toBeChecked();
  await expect(page.locator('#display-progress .display-dot')).toHaveCount(2);
  await expect(page).not.toHaveURL(/emergency/);
});

test('会場表示: 3日間スライドの日付は視覚「8/19（水）」と読み上げ「8月19日（水曜日）」に分かれる', async ({
  page,
}) => {
  await page.goto('/display?demo=1&slides=days');
  await waitForStrip(page);

  const date = page.locator('#slide-days .display-day-date').first();
  // 掲示は幅が限られるため視覚は短い表記のまま、読み上げだけ書き下す
  await expect(date.locator('span[aria-hidden="true"]')).toHaveText(
    /^\d{1,2}\/\d{1,2}（[日月火水木金土]）$/,
  );
  await expect(date.locator('span.sr-only')).toHaveText(
    /^\d{1,2}月\d{1,2}日（[日月火水木金土]曜日）$/,
  );
});
