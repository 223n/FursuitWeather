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

/** 全国の判定ラベルを4文字（「ほぼ安全」等）へ差し替える。
 * デモデータは全都市が2文字の「危険」だが、本番では ほぼ安全・厳重警戒・低温危険 の
 * 4文字が普通に出る。半幅の列では文字数がそのままセルの高さに効くため、
 * 収まりの検証は最長のラベルで行う（mockApisWithDemoの後に呼ぶ） */
async function useLongestBadgeLabel(page) {
  await page.unroute('**/api/national*');
  await page.route('**/api/national*', async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('demo', '1');
    const response = await route.fetch({ url: url.toString() });
    const body = await response.json();
    body.cities = body.cities.map((city) => ({
      ...city,
      outdoorWorst: { ...city.outdoorWorst, label: 'ほぼ安全', grade: 0 },
    }));
    await route.fulfill({ json: body });
  });
}

/** 各セルで、都市名・天気・最高気温・判定がセルの内側に収まっているかを返す
 * （表示されていない要素＝間引かれたものは対象外） */
async function cellFits(page) {
  return page.locator('.display-city-cell').evaluateAll((cells) =>
    cells.map((cell) => {
      const style = getComputedStyle(cell);
      const box = cell.getBoundingClientRect();
      const top = box.top + parseFloat(style.borderTopWidth);
      const bottom = box.bottom - parseFloat(style.borderBottomWidth);
      return ['.display-city-name', '.display-cell-weather', '.display-cell-temp', '.badge'].every(
        (selector) => {
          const element = cell.querySelector(selector);
          if (!element || getComputedStyle(element).display === 'none') {
            return true;
          }
          const rect = element.getBoundingClientRect();
          return rect.height > 0 && rect.top >= top - 1 && rect.bottom <= bottom + 1;
        },
      );
    }),
  );
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

test('会場表示: いまの判定の中身がカード内で上下中央に収まる', async ({ page }) => {
  // 5行の縦積み（時刻・判定・連続活動時間・助言・暑さ指数）は、低い画面だと
  // 合計がカード高さを超える。あふれると justify-content: center が効かず、
  // 下端の行が overflow: hidden で切れる（実機で報告あり）。
  // 800x480は5行が入らないため、優先度の低い行（暑さ指数→助言）を落として収める
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 1024, height: 600 },
    // 5行がぎりぎり入らない中間の高さ。ここを外すと、暑さ指数を落とす縮退が
    // 効いているかを誰も見ておらず、不要な規則と誤解して消してしまう
    { width: 900, height: 520 },
    { width: 800, height: 480 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/display?demo=1&slides=now');
    await page.waitForSelector('#slide-now .now-minutes');
    const gaps = await page.evaluate(() => {
      const card = document.querySelector('#slide-now .display-now-card');
      const box = card.getBoundingClientRect();
      const children = [...card.children]
        .map((child) => child.getBoundingClientRect())
        .filter((rect) => rect.height > 0);
      return {
        top: Math.min(...children.map((rect) => rect.top)) - box.top,
        bottom: box.bottom - Math.max(...children.map((rect) => rect.bottom)),
      };
    });
    const label = `${size.width}x${size.height}`;
    // あふれない（＝負にならない）こと。判定バッジと連続活動時間は常に残す
    expect(gaps.top, `${label}で上へあふれている`).toBeGreaterThanOrEqual(-1);
    expect(gaps.bottom, `${label}で下へあふれている`).toBeGreaterThanOrEqual(-1);
    expect(Math.abs(gaps.top - gaps.bottom), `${label}で上下の余白が非対称`).toBeLessThanOrEqual(2);
    await expect(page.locator('#slide-now .badge-large')).toBeVisible();
    await expect(page.locator('#slide-now .now-minutes')).toBeVisible();
  }
});

test('会場表示: 全国セルの中身がセル内で上下中央に収まる', async ({ page }) => {
  // セル内は「都市名・天気・最高気温」の行と「判定」の行の2段。1段目を1frにすると
  // 余白を1段目が全部吸い、判定バッジがセル下端へ張り付いて間延びする（実機で報告あり）。
  // 上下の余白が対称であること＝ひとかたまりとして中央に置かれていることを見る
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1024, height: 600 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.goto('/display?demo=1&slides=national');
    await page.waitForSelector('#display-national-grid .display-city-cell');
    const worst = await page.evaluate(() => {
      let worstAsymmetry = 0;
      for (const cell of document.querySelectorAll('.display-city-cell')) {
        const box = cell.getBoundingClientRect();
        const children = [...cell.children]
          .map((child) => child.getBoundingClientRect())
          .filter((rect) => rect.height > 0);
        if (children.length === 0) continue;
        const gapTop = Math.min(...children.map((rect) => rect.top)) - box.top;
        const gapBottom = box.bottom - Math.max(...children.map((rect) => rect.bottom));
        worstAsymmetry = Math.max(worstAsymmetry, Math.abs(gapTop - gapBottom));
      }
      return worstAsymmetry;
    });
    expect(worst, `${size.width}x${size.height}で上下の余白が非対称`).toBeLessThanOrEqual(2);
  }
});

// 全国スライドが3行になる構成（9都市以上）では、セル内の縦積みが行の高さを超え、
// overflow:hiddenで都市名の上と判定バッジの下が黙って切れていた。
// 会場のモニターとPCでよく使う横長サイズを実寸で検証する（既定の12都市）
test('会場表示: 横長画面の12都市でも中身がセルに収まる（4:3・5:4を含む）', async ({ page }) => {
  await useLongestBadgeLabel(page);
  // 16:9だけでなく4:3・5:4も回す。これらはvminが高さ基準になるため列幅に対して
  // 文字が過大になりやすく、16:9だけの検証では破綻を取り逃がす
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 780 },
    { width: 1366, height: 640 },
    { width: 1024, height: 768 },
    { width: 1280, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/display?demo=1&slides=national');
    await waitForStrip(page);
    await expect(page.locator('#slide-national')).toBeVisible();
    await expect(page.locator('#display-national-grid .display-city-cell')).toHaveCount(12);

    const fits = await cellFits(page);
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

  // 判定だけでなく都市名の収まりも見る（バッジだけだと、名前の打ち切りを
  // 外しても2行目が先に確保されるぶんバッジは無事で、テストが素通しになる）
  const fits = await cellFits(page);
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

  // 縦画面は端末の高さの幅が広く、警告帯やお知らせが出るとセルがさらに低くなる。
  // 1サイズだけの検証では「判定は必ず残る」を主張できないため、代表的なスマホ幅を回す
  test('会場表示: 縦画面でも全国の中身がセルに収まる（警告帯・お知らせ込み）', async ({ page }) => {
    await useLongestBadgeLabel(page);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 375, height: 667 },
      { width: 360, height: 640 },
    ]) {
      for (const msg of ['', '&msg=' + encodeURIComponent('休憩スペースは2階です')]) {
        await page.setViewportSize(viewport);
        await page.goto(`/display?demo=1&slides=national${msg}`);
        await waitForStrip(page);
        await expect(page.locator('#slide-national')).toBeVisible();
        await expect(page.locator('.display-city-cell .display-city-name')).toHaveCount(12);

        const fits = await cellFits(page);
        const where = `${viewport.width}x${viewport.height}${msg ? '+お知らせ' : ''}`;
        expect(fits, where).toEqual(new Array(12).fill(true));
      }
    }
  });

  // 都市を追加するとセルがさらに低くなり、縦画面では判定バッジが下から切れていた。
  // セルの実寸が足りないときは天気・最高気温を落とし、判定は必ず残す
  test('会場表示: 縦画面で16セルでも判定が残り、天気・気温が代わりに落ちる', async ({ page }) => {
    await useLongestBadgeLabel(page);
    const longName = '幕張メッセ国際展示場9〜11ホール';
    const extras = [`35.63,140.03,${longName}`, '33.24,131.61,別府', '36.65,138.18,長野', '43.77,142.36,旭川'];
    await page.goto(
      `/display?demo=1&slides=national&${extras.map((e) => `add=${encodeURIComponent(e)}`).join('&')}`,
    );
    await waitForStrip(page);
    await expect(page.locator('#slide-national')).toBeVisible();
    await expect(page.locator('#display-national-grid .display-city-cell')).toHaveCount(16);

    // 判定バッジを含め、表示されている要素は全セルで欠けずに収まる
    const fits = await cellFits(page);
    expect(fits).toHaveLength(16);
    expect(fits.every(Boolean)).toBe(true);

    // 代わりに天気と最高気温が落ちている（セルの実寸に反応するコンテナクエリ）
    await expect(page.locator('.display-city-cell .display-cell-weather').first()).toBeHidden();
    await expect(page.locator('.display-city-cell .display-cell-temp').first()).toBeHidden();

    // 都市名は見た目こそ省略されるが、読み上げ用に全文がDOMへ残る
    const longCell = page.locator('.display-city-cell').filter({ hasText: '幕張' });
    await expect(longCell.locator('.display-city-name')).toHaveText(longName);
  });
});

/** 全国セルで表示されている都市名・判定の最小の文字サイズ（px）を返す */
async function cityFontSizes(page) {
  return page.evaluate(() => {
    const shown = (el) => el && getComputedStyle(el).display !== 'none';
    const sizes = (selector) =>
      [...document.querySelectorAll(`.display-city-cell ${selector}`)]
        .filter(shown)
        .map((el) => parseFloat(getComputedStyle(el).fontSize));
    return {
      minName: Math.min(...sizes('.display-city-name')),
      minBadge: Math.min(...sizes('.badge')),
    };
  });
}

// 「欠けてはいないが読めない」状態を検出する。文字の頭打ち（min()）に下限がなく、
// 判定バッジが390x844で10px、360x640で3.1px、320x568で0pxまで縮んでいた。
// 収まりだけを見るcellFitsでは0pxも「収まっている」と判定されるため素通ししていた
test('会場表示: 縦画面でも全国セルの都市名と判定が読める大きさを保つ', async ({ page }) => {
  await useLongestBadgeLabel(page);
  for (const viewport of [
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 360, height: 640 },
  ]) {
    for (const msg of ['', '&msg=' + encodeURIComponent('休憩スペースは2階です')]) {
      await page.setViewportSize(viewport);
      await page.goto(`/display?demo=1&slides=national${msg}`);
      await waitForStrip(page);
      await expect(page.locator('#slide-national')).toBeVisible();
      // 全国セルの描画完了まで待つ。常時帯のバッジ（waitForStrip）とスライドの
      // 可視化は先に済むため、待たないと空のグリッドを測ってしまう。
      // cityFontSizesはMath.min(...[])がInfinityになり空でも素通りするので、
      // 取りこぼしはcellFitsが空配列を返すまで表面化しない
      await expect(page.locator('.display-city-cell .display-city-name')).toHaveCount(12);

      const where = `${viewport.width}x${viewport.height}${msg ? '+お知らせ' : ''}`;
      const fonts = await cityFontSizes(page);
      expect(fonts.minName, where).toBeGreaterThanOrEqual(11.2);
      expect(fonts.minBadge, where).toBeGreaterThanOrEqual(11.2);
      // 下限を入れたぶん、外形（枠線・余白）を削って収まりは保つ
      expect(await cellFits(page), where).toEqual(new Array(12).fill(true));
    }
  }
});

// 会場のモニターでも縦の詰まる比率がある。1024x600に警告帯とお知らせが重なると
// 判定バッジが下から欠けていた（4文字ラベルのときだけ出る）
test('会場表示: 縦に詰まる会場モニター（1024x600）でも判定が欠けない', async ({ page }) => {
  await useLongestBadgeLabel(page);
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/display?demo=1&slides=national&msg=' + encodeURIComponent('休憩スペースは2階です'));
  await waitForStrip(page);
  await expect(page.locator('#slide-national')).toBeVisible();

  expect(await cellFits(page)).toEqual(new Array(12).fill(true));
  const fonts = await cityFontSizes(page);
  expect(fonts.minBadge).toBeGreaterThanOrEqual(11.2);
});

/** 時間別・3日間の判定を4文字ラベルへ差し替える（全国のuseLongestBadgeLabelと同じ理由。
 * 本番では「厳重警戒」などが普通に出るが、デモは全時間帯が2文字の「危険」で、
 * 文字数がそのままセルの高さに効くため最長のラベルで収まりを見る） */
async function useLongestForecastLabel(page) {
  await page.unroute('**/api/forecast*');
  await page.route('**/api/forecast*', async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('demo', '1');
    const response = await route.fetch({ url: url.toString() });
    const body = await response.json();
    const template = body.hours.find((hour) => hour.time.endsWith('T14:00'));
    const long = { label: '厳重警戒', level: 'strict', grade: 3 };
    body.hours = body.hours.map((hour) => ({
      ...template,
      time: hour.time,
      outdoor: { ...template.outdoor, ...long },
      indoor: { ...template.indoor, ...long },
    }));
    body.days = body.days.map((day) => ({
      ...day,
      outdoorWorst: { ...day.outdoorWorst, ...long },
      outdoorBest: { ...day.outdoorBest, ...long },
    }));
    await route.fulfill({ json: body });
  });
}

/** スライドの枠からグリッドがはみ出していないか、セル内の要素が欠けていないか、
 * 判定バッジが読める大きさ（0.7rem以上）かを返す */
async function slideFits(page, slideId, cellSelector) {
  return page.evaluate(
    ({ slideId: id, cellSelector: sel }) => {
      const slide = document.getElementById(id);
      const grid = slide.querySelector('.display-hours-grid, .display-days-grid');
      const slideBox = slide.getBoundingClientRect();
      const cells = [...slide.querySelectorAll(sel)];
      const shown = (el) => el && getComputedStyle(el).display !== 'none';
      let clipped = 0;
      let minBadgePx = Infinity;
      for (const cell of cells) {
        const style = getComputedStyle(cell);
        const box = cell.getBoundingClientRect();
        const top = box.top + parseFloat(style.borderTopWidth);
        const bottom = box.bottom - parseFloat(style.borderBottomWidth);
        const badge = cell.querySelector('.badge, .badge-large');
        if (shown(badge)) {
          minBadgePx = Math.min(minBadgePx, parseFloat(getComputedStyle(badge).fontSize));
        }
        for (const element of cell.querySelectorAll('*')) {
          if (!shown(element) || element.classList.contains('sr-only')) continue;
          const rect = element.getBoundingClientRect();
          if (rect.height === 0) continue;
          if (rect.top < top - 1 || rect.bottom > bottom + 1) clipped++;
        }
      }
      return {
        cells: cells.length,
        gridOverflow: Math.round(grid.getBoundingClientRect().bottom - slideBox.bottom),
        clipped,
        minBadgePx,
      };
    },
    { slideId, cellSelector },
  );
}

// グリッドがスライドの高さを突き抜け、下のセルが.display-slideのoverflow:hiddenで
// 切れていた（390x844で120px、360x640で267pxはみ出し）。原因はflexの既定
// min-height:autoで、全国グリッドにだけ入っていたmin-height:0が漏れていた
test('会場表示: 縦画面でこの後の予報・3日間がスライドから途切れない', async ({ page }) => {
  await useLongestForecastLabel(page);
  for (const viewport of [
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 360, height: 640 },
  ]) {
    for (const msg of ['', '&msg=' + encodeURIComponent('休憩スペースは2階です')]) {
      for (const [key, cellSelector] of [
        ['hours', '.display-hour-cell'],
        ['days', '.display-day-cell'],
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`/display?demo=1&slides=${key}${msg}`);
        await waitForStrip(page);
        await expect(page.locator(`#slide-${key}`)).toBeVisible();

        const where = `${viewport.width}x${viewport.height}${msg ? '+お知らせ' : ''} ${key}`;
        const fit = await slideFits(page, `slide-${key}`, cellSelector);
        expect(fit.cells, where).toBeGreaterThan(0);
        expect(fit.gridOverflow, where).toBeLessThanOrEqual(1);
        expect(fit.clipped, where).toBe(0);
        // 収まらないときは天気・気温を落として判定を残す。判定は0.7remが下限
        expect(fit.minBadgePx, where).toBeGreaterThanOrEqual(11.2);
      }
    }
  }
});

// タブレットの縦画面はセルが低いのに幅が広く、vw基準の文字がセルに対して過大になる。
// セルの実寸（cqh）でも頭打ちにしていないと、ここだけ中身が欠ける
test('会場表示: タブレットの縦画面でも時間別セルの中身が欠けない', async ({ page }) => {
  await useLongestForecastLabel(page);
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/display?demo=1&slides=hours');
    await waitForStrip(page);
    await expect(page.locator('#slide-hours')).toBeVisible();

    const where = `${viewport.width}x${viewport.height}`;
    const fit = await slideFits(page, 'slide-hours', '.display-hour-cell');
    expect(fit.gridOverflow, where).toBeLessThanOrEqual(1);
    expect(fit.clipped, where).toBe(0);
  }
});

/** もしものときスライドを表示する（危険レベル固定のモックのため末尾に加わる） */
async function gotoEmergency(page, msg = '') {
  await page.goto(`/display?demo=1&slides=now,emergency${msg}`);
  await waitForStrip(page);
  await page.click('#display-next');
  await expect(page.locator('#slide-emergency')).toBeVisible();
}

/** 手順の一覧がスライドの内側に収まっているか（はみ出すと下の手順が切れ、
 * 参照リンクと重なって読めなくなる）と、見出しの最小の文字サイズを返す */
async function emergencyFit(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.display-emergency-steps');
    const titles = [...document.querySelectorAll('.display-emergency-title')];
    return {
      overflow: list.scrollHeight - list.clientHeight,
      minTitlePx: Math.min(...titles.map((t) => parseFloat(getComputedStyle(t).fontSize))),
      shownSteps: [...document.querySelectorAll('.display-emergency-steps > li')].filter(
        (li) => li.getBoundingClientRect().height > 0,
      ).length,
    };
  });
}

// 応急手順が切れると、いちばん必要な場面で処置の順序が読めない。
// 高さは「画面サイズ×警告帯×お知らせ帯」で決まるため、縦画面の代表サイズを回す
// （修正前は390x844で168px、360x640で351pxはみ出し、参照リンクと重なっていた）
test('会場表示: 縦画面でも応急手順5件が切れずに残る（警告帯・お知らせ込み）', async ({ page }) => {
  for (const viewport of [
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 360, height: 640 },
  ]) {
    for (const msg of ['', '&msg=' + encodeURIComponent('休憩スペースは2階です')]) {
      await page.setViewportSize(viewport);
      await gotoEmergency(page, msg);

      const where = `${viewport.width}x${viewport.height}${msg ? '+お知らせ' : ''}`;
      const fit = await emergencyFit(page);
      expect(fit.shownSteps, where).toBe(5);
      expect(fit.overflow, where).toBeLessThanOrEqual(1);
      // 収まらないときに文字を詰めるが、読めない大きさ（0.9rem未満）にはしない
      expect(fit.minTitlePx, where).toBeGreaterThanOrEqual(14.4);
    }
  }
});

// 会場のモニターは本来の用途。お知らせ帯が出ても、処置の内容（説明文）まで
// 残るだけの高さがある。余白を詰めるのが先で、説明文を落とすのは最後にする
test('会場表示: 会場のモニターではお知らせ帯が出ても手順の説明文が残る', async ({ page }) => {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await gotoEmergency(page, '&msg=' + encodeURIComponent('休憩スペースは2階です'));

    const where = `${viewport.width}x${viewport.height}`;
    const fit = await emergencyFit(page);
    expect(fit.shownSteps, where).toBe(5);
    expect(fit.overflow, where).toBeLessThanOrEqual(1);
    await expect(page.locator('.display-emergency-detail').first(), where).toBeVisible();
  }
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
