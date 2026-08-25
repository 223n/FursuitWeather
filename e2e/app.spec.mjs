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

test('地点の選び方タブ: 1つのパネルだけが表示され、キーボードで移動できる', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  // 既定は「主な都市」。他の選び方のパネルは隠れている
  await expect(page.locator('#picker-city')).toBeVisible();
  await expect(page.locator('#picker-event')).toBeHidden();
  await expect(page.locator('#picker-search')).toBeHidden();
  await expect(page.locator('#picker-favorites')).toBeHidden();

  // 矢印キーで隣のタブへ移動して自動選択される（WAI-ARIAタブパターン）
  await page.locator('#picker-tab-city').press('ArrowRight');
  await expect(page.locator('#picker-tab-event')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#picker-event')).toBeVisible();
  await expect(page.locator('#picker-city')).toBeHidden();

  // Endで末尾、Homeで先頭へ
  await page.locator('#picker-tab-event').press('End');
  await expect(page.locator('#picker-favorites')).toBeVisible();
  await page.locator('#picker-tab-favorites').press('Home');
  await expect(page.locator('#picker-city')).toBeVisible();

  // 予報の表示切り替えタブとは独立して動く
  await page.click('#picker-tab-search');
  await page.click('#tab-days');
  await expect(page.locator('#days-section')).toBeVisible();
  await expect(page.locator('#picker-search')).toBeVisible();
});

test('キーボード操作: フォーカスが失われず、非表示パネルへ入り込まない', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  // 日別カードのボタンを押すとパネルが切り替わり、押したボタン自体が隠れる。
  // フォーカスがbodyへ落ちないよう、選択された日付タブへ移ること
  await page.click('#tab-days');
  await page.click('#day-cards .day-card:nth-child(2) .day-card-button');
  await expect(page.locator('#tab-day-1')).toBeFocused();
  await expect(page.locator('#tab-day-1')).toHaveAttribute('aria-selected', 'true');

  // Tabキーで到達する要素が、非表示パネルの中に含まれないこと
  await page.evaluate(() => document.body.focus());
  const reached = [];
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return { id: el.id || el.tagName, inHidden: !!el.closest('[hidden]') };
    });
    if (!info) break;
    reached.push(info);
  }
  expect(reached.length).toBeGreaterThan(5);
  expect(reached.filter((e) => e.inHidden)).toEqual([]);
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
  // 地点の選び方はタブで分かれている（検索欄は「検索・現在地」タブの中）
  await page.click('#picker-tab-search');

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

  // 登録ボタンは表示中の地点の操作のため、タブに関係なく常に押せる
  await page.click('#favorite-toggle-button');
  await page.click('#picker-tab-favorites');
  await expect(page.locator('#favorites-list button')).toHaveCount(1);
  await expect(page.locator('#favorite-toggle-button')).toContainText('お気に入り解除');

  // 再読み込みしても localStorage から復元される
  await page.reload();
  await waitForForecast(page);
  await page.click('#picker-tab-favorites');
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
  await page.click('#picker-tab-search');
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
    '135-0063': { name: '江東区', admin1: '東京都', latitude: 35.6297, longitude: 139.7947 },
    '261-0023': { name: '千葉市', admin1: '千葉県', latitude: 35.6474, longitude: 140.0343 },
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
  await page.click('#picker-tab-event');

  // 開催中のイベント → 開催地の予報+今日のタブへ切り替わる。座標は小数2桁
  await page.selectOption('#event-select', '0');
  await page.click('#event-button');
  // ラベルには郵便番号から解決された実際の地名も併記される（取り違えの検知）
  await expect(page.locator('#location-label')).toContainText(
    'サマーコン（東京ビッグサイト・江東区（東京都）付近）',
  );
  await expect(page.locator('#tab-day-0')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#status')).toContainText('「サマーコン」開催日');
  // 開催日の予報が出せているので注意表示にはしない
  await expect(page.locator('#status')).not.toHaveClass(/status-warning/);
  await expect(page).toHaveURL(/lat=35\.63&lon=139\.79/);
  // 開催時間はプランナーへ設定される（終了17:30は18時へ切り上げ）
  await expect(page.locator('#plan-start')).toHaveValue('11');
  await expect(page.locator('#plan-end')).toHaveValue('18');
  await expect(page.locator('#status')).toContainText('開催時間（11時〜18時）');
  // 記憶する地点名はイベント名ではなく解決した地名（イベントは日付を過ぎると意味を失う）
  const stored = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('fursuitweather:lastLocation') ?? '{}'),
  );
  expect(stored.locationName).toBe('江東区（東京都）');

  // 開催日が予報範囲外のイベント → 表示中の予報の対象日を明示して誤読を防ぐ
  await page.selectOption('#event-select', '1');
  await page.click('#event-button');
  await expect(page.locator('#location-label')).toContainText('ウィンターフェス（幕張メッセ');
  await expect(page.locator('#status')).toContainText('予報の範囲外です（あと10日）');
  await expect(page.locator('#status')).toContainText('開催日の予報ではありません');
  // 誤読を防ぐため、注意配色（黄）と△!アイコンで通常の案内と区別する
  await expect(page.locator('#status')).toHaveClass(/status-warning/);
  await expect(page.locator('#status use[href="#fa-triangle-exclamation"]')).toBeAttached();

  // 開催日の予報が出せるイベントへ戻すと注意表示は解除される
  await page.selectOption('#event-select', '0');
  await page.click('#event-button');
  await expect(page.locator('#status')).toContainText('「サマーコン」開催日');
  await expect(page.locator('#status')).not.toHaveClass(/status-warning/);
  await expect(page.locator('#status use[href="#fa-triangle-exclamation"]')).toHaveCount(0);
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
  await page.click('#picker-tab-event');
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
  await page.click('#picker-tab-event');
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

test('共有URL: 注記は画面だけに出し、URLの地点名には積み重ねない', async ({ page }) => {
  // 注記付きのラベルをURLへ書き戻すと、共有が1往復するたびに「（共有・…）」が
  // 増えて名前が伸び、80文字で切られて壊れる（本番ログで発生を確認済み）
  await page.goto('/?lat=35.68&lon=139.68&name=' + encodeURIComponent('テスト会場'));
  await waitForForecast(page);

  // 画面には偽装リンクに気付けるよう座標由来の注記を併記する
  await expect(page.locator('#location-label')).toContainText('テスト会場（共有・');

  // URLに書き戻る名前は注記なしのまま
  const name = await page.evaluate(() => new URLSearchParams(window.location.search).get('name'));
  expect(name).toBe('テスト会場');

  // 共有ボタンが作るURLも同じ（クリップボード経由の分岐を使う）
  await page.evaluate(() => {
    delete window.navigator.share;
    window.__copied = null;
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text) => {
          window.__copied = text;
          return Promise.resolve();
        },
      },
    });
  });
  await page.click('#share-button');
  const shared = await page.evaluate(() => window.__copied);
  expect(new URL(shared).searchParams.get('name')).toBe('テスト会場');
});

test('共有URL: 地点名が無ければURLにも名前を載せない', async ({ page }) => {
  await page.goto('/?lat=35.68&lon=139.68');
  await waitForForecast(page);

  await expect(page.locator('#location-label')).toContainText('共有された地点（');
  const search = await page.evaluate(() => window.location.search);
  expect(new URLSearchParams(search).has('name')).toBe(false);
});

test('上流障害時: 提供元の障害と分かる案内を出し、HTTPステータスは見せない', async ({ page }) => {
  // Open-Meteoが落ちるとWorkerは502を返す。利用者には原因と対処が伝わる文面を出す
  await page.unroute('**/api/forecast*');
  await page.route('**/api/forecast*', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        error: '気象データの提供元で障害が発生しています。しばらく時間をおいてから再度お試しください',
      }),
    }),
  );
  await page.goto('/');
  await expect(page.locator('#status-error')).toContainText('提供元で障害が発生しています');
  await expect(page.locator('#status-error')).not.toContainText('HTTP');
  await expect(page.locator('#status-error')).not.toContainText('502');

  // 予報が無いとき、プランナーは空のセレクトではなく理由の分かる状態にする
  // （空のままだと「画面が壊れている」と見える）
  await page.click('#tab-planner');
  await expect(page.locator('#plan-date')).toBeDisabled();
  await expect(page.locator('#plan-date')).toContainText('予報を読み込むと選べます');
  await expect(page.locator('#plan-button')).toBeDisabled();
});

test('実測WBGT: トップページのタブで判定でき、ハッシュから直接開ける', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  await page.click('#tab-measured');
  await expect(page.locator('#measured-section')).toBeVisible();
  await page.fill('#wbgt-input', '31');
  await page.click('#wbgt-judge-button');
  await expect(page.locator('#wbgt-result')).not.toBeEmpty();

  // aboutページからの「/#tab-measured」で、クリックせずにタブが開く
  await page.goto('/#tab-measured');
  await expect(page.locator('#tab-measured')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#measured-section')).toBeVisible();
});

test('実測WBGT: 予報が取得できないときでも判定できる', async ({ page }) => {
  // 上流障害中でも、実測値からの判定はapp.jsの予報取得と独立して動く
  await page.unroute('**/api/forecast*');
  await page.route('**/api/forecast*', (route) => route.abort());
  await page.goto('/#tab-measured');
  await page.fill('#wbgt-input', '31');
  await page.click('#wbgt-judge-button');
  await expect(page.locator('#wbgt-result')).not.toBeEmpty();
});

test('活動時の注意と位置情報の扱い: 注意は常時見え、位置情報の詳細は折りたためる', async ({
  page,
}) => {
  await page.goto('/');
  await waitForForecast(page);

  // 活動時の注意は安全に関わるため、注意配色と△!で常に見える状態にする
  const notices = page.locator('#notices-section');
  await expect(notices).toBeVisible();
  await expect(notices.locator('h2 use[href="#fa-triangle-exclamation"]')).toBeAttached();
  await expect(notices.locator('#notices-list li').first()).toBeVisible();

  // 位置情報の扱いは折りたたみ。閉じていても「保存しません」の約束は読める
  const privacy = page.locator('.control-note-details');
  await expect(privacy.locator('summary')).toContainText('現在地は保存しません');
  await expect(privacy.locator('.control-note')).toBeHidden();

  await privacy.locator('summary').click();
  await expect(privacy.locator('.control-note')).toContainText('約1kmの精度に丸めた');
  await expect(privacy.locator('.control-note')).toContainText('このブラウザ内にのみ保存');

  await privacy.locator('summary').click();
  await expect(privacy.locator('.control-note')).toBeHidden();
});

test('注意文: どのページでも同じ黄色系の枠と左上の△!でそろえる', async ({ page }) => {
  // 注意文の見た目はページをまたいで1つの決まりに従う。枠の太さ・色・地色と、
  // 色だけに頼らせないための△!の位置（枠の左上）をまとめて確認する
  const readPanels = () =>
    page.locator('.notice-panel').evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        const icon = element.querySelector('.fa-icon');
        const panelBox = element.getBoundingClientRect();
        const iconBox = icon ? icon.getBoundingClientRect() : null;
        return {
          borderWidth: style.borderTopWidth,
          borderColor: style.borderTopColor,
          background: style.backgroundColor,
          iconColor: icon ? getComputedStyle(icon).color : null,
          iconOffsetX: iconBox ? iconBox.left - panelBox.left : null,
          iconOffsetY: iconBox ? iconBox.top - panelBox.top : null,
        };
      }),
    );

  await page.goto('/');
  await waitForForecast(page);
  // 活動時の注意と、この予報についての注意文
  const topPanels = await readPanels();
  expect(topPanels).toHaveLength(2);

  await page.goto('/about');
  // 利用上の注意と免責事項
  const aboutPanels = await readPanels();
  expect(aboutPanels).toHaveLength(2);

  const panels = [...topPanels, ...aboutPanels];
  for (const panel of panels) {
    expect(panel.borderWidth).toBe('2px');
    expect(panel.borderColor).toBe(panels[0].borderColor);
    expect(panel.background).toBe(panels[0].background);
    // アイコンは枠と同じ注意色で、枠の左上に置く
    expect(panel.iconColor).toBe(panel.borderColor);
    expect(panel.iconOffsetX).toBeLessThan(40);
    expect(panel.iconOffsetY).toBeLessThan(60);
  }
});

test('about: 見出しアイコンが描画され、レスポンス例が有効なJSONになっている', async ({ page }) => {
  await page.goto('/about');

  // アイコンはパスデータを直接埋め込んでいる（スプライト無し）。
  // パスが壊れると幅0で「消えたことに気付けない」ため、実寸で確認する
  const icons = page.locator('.heading-icon');
  expect(await icons.count()).toBeGreaterThan(0);
  const widths = await icons.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().width),
  );
  expect(widths.every((w) => w > 0)).toBe(true);

  // レスポンス例は整形ツールへそのまま貼れる有効なJSONにしておく
  const json = await page.locator('pre.formula').last().textContent();
  expect(() => JSON.parse(json)).not.toThrow();
});

test('風速列と応急対応ページ: 時間別に風速が出て、/emergencyの手順が開ける', async ({
  page,
}) => {
  await page.goto('/');
  await waitForForecast(page);

  // 時間別テーブル: 「風速」列ヘッダーとセル値（デモデータは2.5m/s固定）
  await page.click('#tab-day-0');
  await expect(page.locator('#hours-table thead th', { hasText: '風速' })).toBeVisible();
  await expect(page.locator('#hours-body tr').first().locator('td').nth(4)).toHaveText(
    '2.5m/s',
  );

  // 日別カード: 最大風速の行が出る
  await page.click('#tab-days');
  const firstCard = page.locator('#day-cards .day-card:not(.skeleton-card)').first();
  await expect(firstCard).toContainText('最大風速');
  await expect(firstCard).toContainText('2.5m/s');

  // 応急対応ページ: 5つの手順・119発信リンク・免責が表示される
  await page.goto('/emergency');
  await expect(page.locator('.emergency-call-button')).toHaveAttribute('href', 'tel:119');
  await expect(page.locator('.emergency-steps > li')).toHaveCount(5);
  await expect(page.locator('.emergency-steps')).toContainText('ヘッド');
  await expect(page.locator('main')).toContainText('医療上の助言に代わるものではありません');
});

test('日の入り: 日別カード・時間別の目印・プランナーの日没またぎ注意に表示される', async ({
  page,
}) => {
  await page.goto('/');
  await waitForForecast(page);

  // 日別カード（デモデータの初日は18:30固定）
  await page.click('#tab-days');
  const firstCard = page.locator('#day-cards .day-card:not(.skeleton-card)').first();
  await expect(firstCard).toContainText('日の入り');
  await expect(firstCard).toContainText('18:30');

  // 静電気行（デモデータは真夏日のため「低」）
  await expect(firstCard).toContainText('静電気');
  await expect(firstCard).toContainText('低');

  // 空気のよごれ行（デモデータは典型値のため「低」）
  await expect(firstCard).toContainText('空気のよごれ（黄砂・PM2.5）');

  // 明日の時間別テーブルには日の入りの目印が出る（今日は時間帯により行が隠れるため明日で確認）
  await page.click('#tab-day-1');
  await expect(page.locator('#hours-body .sunset-note')).toHaveText('日の入り 18:29');

  // プランナー: 終了20時は日の入り（18:30）の後 → 照明・冷え込みの注意が出る
  await page.click('#tab-planner');
  await page.selectOption('#plan-start', '15');
  await page.selectOption('#plan-end', '20');
  await page.click('#plan-button');
  await expect(page.locator('#plan-result')).toContainText('日の入り（18:30）の後です');
});

test('共有URLの日付・時間帯（date/from/to）がタブとプランナーへ反映される', async ({ page }) => {
  const jstDate = (offsetDays) =>
    new Date(Date.now() + (9 * 60 + offsetDays * 24 * 60) * 60 * 1000).toISOString().slice(0, 10);
  const tomorrow = jstDate(1);
  await page.goto(`/?lat=35.68&lon=139.68&date=${tomorrow}&from=9&to=15`);
  await waitForForecast(page);
  await expect(page.locator('#tab-day-1')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#plan-date')).toHaveValue(tomorrow);
  await expect(page.locator('#plan-start')).toHaveValue('9');
  await expect(page.locator('#plan-end')).toHaveValue('15');
  await expect(page.locator('#status')).toContainText('9時〜15時');

  // 予報範囲外の日付は固定の日本語文で案内し、地点のみの表示へフォールバック
  await page.goto('/?lat=35.68&lon=139.68&date=2030-01-01');
  await waitForForecast(page);
  await expect(page.locator('#status')).toContainText('予報の範囲外');
});

test('イベント固定リンク（?event=）で開くと該当イベントの予報まで自動で進む', async ({
  page,
}) => {
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
        ],
      }),
    }),
  );
  await page.route('**/api/geocode*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ name: '江東区', admin1: '東京都', latitude: 35.6297, longitude: 139.7947 }],
      }),
    }),
  );

  await page.goto(`/?event=${encodeURIComponent('サマーコン')}`);
  await waitForForecast(page);
  await expect(page.locator('#location-label')).toContainText('サマーコン（東京ビッグサイト');
  await expect(page.locator('#status')).toContainText('「サマーコン」開催日');

  // 一覧に無い名前は案内を出して通常の予報へフォールバック
  await page.goto(`/?event=${encodeURIComponent('存在しないイベント')}`);
  await waitForForecast(page);
  await expect(page.locator('#status')).toContainText('一覧にありません');
  await expect(page.locator('#status')).toHaveClass(/status-warning/);
});

test('前回見た予報との差分: 判定が変わっていればバナーで知らせ、閉じると再表示しない', async ({
  page,
}) => {
  await page.goto('/');
  await waitForForecast(page);

  // 前回の閲覧（4時間前・全日grade 0）をこの端末の保存として作る
  await page.evaluate(() => {
    const query = new URLSearchParams(window.location.search);
    const key = `lat=${query.get('lat')}&lon=${query.get('lon')}`;
    const snapshot = {
      [key]: {
        at: Date.now() - 4 * 60 * 60 * 1000,
        days: [0, 1, 2].map((offset) => {
          const date = new Date(Date.now() + (9 * 60 + offset * 24 * 60) * 60 * 1000)
            .toISOString()
            .slice(0, 10);
          return { date, grade: 0, label: 'ほぼ安全' };
        }),
      },
    };
    window.localStorage.setItem('fursuitweatherForecastSnapshots', JSON.stringify(snapshot));
    window.localStorage.removeItem('fursuitweatherDiffDismissed');
  });

  // 再読み込み → デモデータの判定（grade>0）と食い違うため差分バナーが出る
  await page.reload();
  await waitForForecast(page);
  await expect(page.locator('#diff-banner')).toBeVisible();
  await expect(page.locator('#diff-banner')).toContainText('判定が変わりました');

  // 閉じると消え、同じ差分は再読み込みでも再表示されない
  await page.click('#diff-banner .diff-close');
  await expect(page.locator('#diff-banner')).toBeHidden();
  await page.reload();
  await waitForForecast(page);
  await expect(page.locator('#diff-banner')).toBeHidden();
});

test('プランナー連動: 休憩の質ガイドと持ち物リストが表示され、チェックと追加が保存される', async ({
  page,
}) => {
  await page.goto('/');
  await waitForForecast(page);
  await page.click('#tab-planner');
  await page.click('#plan-button');

  // 休憩の質ガイド（デモの日中は厳しい帯を含むため保冷剤の手順まで出る）
  await expect(page.locator('.rest-guide')).toContainText('休憩の質ガイド');
  await expect(page.locator('.rest-guide')).toContainText('首・脇の下・足の付け根');

  // 持ち物リスト（警戒以上の時間帯がある日は保冷剤などが自動生成される）
  await expect(page.locator('#packing-section')).toBeVisible();
  await expect(page.locator('#packing-list')).toContainText('保冷剤');

  // チェックと自由入力の追加はこの端末に保存され、再読み込み後も残る
  await page.locator('#packing-list input[type="checkbox"]').first().check();
  await page.fill('#packing-custom-input', '名刺');
  await page.click('#packing-add-button');
  await expect(page.locator('#packing-list')).toContainText('名刺');

  await page.reload();
  await waitForForecast(page);
  await page.click('#tab-planner');
  await page.click('#plan-button');
  await expect(page.locator('#packing-list input[type="checkbox"]').first()).toBeChecked();
  await expect(page.locator('#packing-list')).toContainText('名刺');

  // 自由入力は削除できる
  await page.click('#packing-list .packing-remove');
  await expect(page.locator('#packing-list')).not.toContainText('名刺');
});

test('印刷用シート: 発行情報が用意され、印刷専用ブロックは画面に出ない', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);
  // 印刷専用ブロック（応急対応の要点・連絡先欄）は画面では非表示
  await expect(page.locator('.print-only')).toBeHidden();
  // 発行情報（いつ・どの地点か）は読み込み時に埋まっている
  const meta = await page.locator('#print-meta').textContent();
  expect(meta).toContain('発行:');
  expect(meta).toContain('東京');
  await expect(page.locator('#print-button')).toBeVisible();
});

test('見やすさ設定・音声ボタン・ホーム画面案内が動く', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  // Aaボタンで標準→大。root font-sizeが変わり、別ページでも適用される（prefs.js）
  await page.click('#font-size-button');
  await expect(page.locator('#font-size-button')).toHaveText('Aa 大');
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('115%');
  await page.goto('/about');
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('115%');

  // 戻っても選択が保持され、特大→標準まで巡回する
  await page.goto('/');
  await waitForForecast(page);
  await expect(page.locator('#font-size-button')).toHaveText('Aa 大');
  await page.click('#font-size-button');
  await page.click('#font-size-button');
  await expect(page.locator('#font-size-button')).toHaveText('Aa 標準');
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('');

  // 音声読み上げボタン（Chromiumは音声合成対応のため表示される）
  await expect(page.locator('#speak-button')).toBeVisible();
  await expect(page.locator('#speak-button')).toHaveText('今日の要点を聞く');

  // ホーム画面追加の案内（この環境では一般的な文言が出る）
  await page.getByText('ホーム画面に追加して毎日見る').click();
  await expect(page.locator('#a2hs-generic')).toBeVisible();
});

/** 予報の全時間帯を指定時刻（'05'・'14'など）の内容へ固定する。
 * デモデータは時間帯で判定が変わるため、現在時刻に連動する機能（いまの判定・
 * 着用タイマー）をテストの実行時刻に依存させないために使う */
async function mockForecastFixedHour(page, templateHour) {
  await page.route('**/api/forecast*', async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('demo', '1');
    const response = await route.fetch({ url: url.toString() });
    const body = await response.json();
    const template = body.hours.find((hour) => hour.time.endsWith(`T${templateHour}:00`));
    body.hours = body.hours.map((hour) => ({ ...template, time: hour.time }));
    await route.fulfill({ json: body });
  });
}

test('実測WBGTの会場ログ: 記録・リロード保持・削除・CSV書き出しができる', async ({ page }) => {
  await page.goto('/#tab-measured');

  // 判定するまでは記録ボタンが押せない（未判定の記録を防ぐ）
  await expect(page.locator('#wbgt-log-button')).toBeDisabled();
  await page.fill('#wbgt-input', '20');
  await page.click('#wbgt-judge-button');
  await page.fill('#wbgt-place', 'ステージ横');
  await page.click('#wbgt-log-button');

  // 記録すると履歴の表に場所・実測・補正後・判定バッジが並ぶ
  await expect(page.locator('#wbgt-log-section')).toBeVisible();
  await expect(page.locator('#wbgt-log-body tr')).toHaveCount(1);
  await expect(page.locator('#wbgt-log-body')).toContainText('ステージ横');
  await expect(page.locator('#wbgt-log-body')).toContainText('20℃');
  await expect(page.locator('#wbgt-log-body')).toContainText('31℃');
  await expect(page.locator('#wbgt-log-body .badge')).toBeVisible();

  // 記録はこの端末に保存され、リロード後も残る
  // （予報の読み込みでURLは地点パラメータへ置き換わりハッシュが消えるため、
  //   タブは明示的に開き直す）
  await page.reload();
  await page.click('#tab-measured');
  await expect(page.locator('#wbgt-log-section')).toBeVisible();
  await expect(page.locator('#wbgt-log-body tr')).toHaveCount(1);

  // CSV書き出しはBOM付きUTF-8のファイルをダウンロードする
  const downloadPromise = page.waitForEvent('download');
  await page.click('#wbgt-log-csv-button');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^wbgt-log-\d{4}-\d{2}-\d{2}\.csv$/);

  // 行の削除で表から消え、0件になると履歴ごと隠れる
  await page.click('#wbgt-log-body button');
  await expect(page.locator('#wbgt-log-section')).toBeHidden();
});

test('シェア画像: Web Share非対応環境ではPNGのダウンロードになる', async ({ page }) => {
  await page.goto('/');
  await waitForForecast(page);

  const downloadPromise = page.waitForEvent('download');
  await page.click('#share-image-button');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('fursuit-weather.png');
  // 保存の案内（説明文のコピーは環境の許可に依存するため文頭のみ検証する）
  await expect(page.locator('#status')).toContainText('画像を保存し');
});

test('着用タイマー: 開始→リロード継続→休憩→終了ができる', async ({ page }) => {
  // 早朝（着用可能な判定）に固定し、実行時刻に依存させない
  await mockForecastFixedHour(page, '05');
  await page.goto('/');
  await waitForForecast(page);

  await page.click('#timer-start-button');
  await expect(page.locator('#timer-overlay')).toBeVisible();
  await expect(page.locator('#timer-mode')).toHaveText('着用中');
  await expect(page.locator('#timer-limit')).toContainText('上限');
  await expect(page.locator('#timer-clock')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator('#timer-judgment .badge')).toBeVisible();

  // 開始時刻はこの端末に保存され、リロードしても継続する
  await page.reload();
  await waitForForecast(page);
  await expect(page.locator('#timer-overlay')).toBeVisible();
  await expect(page.locator('#timer-mode')).toHaveText('着用中');

  // 休憩へ切り替えるとカウントアップになり、同じ長さ以上の休憩を促す
  await page.click('#timer-rest-button');
  await expect(page.locator('#timer-mode')).toHaveText('休憩中');
  await expect(page.locator('#timer-limit')).toContainText('同じ長さ以上の休憩');
  await expect(page.locator('#timer-rest-button')).toHaveText('着用を再開');

  // 終了で閉じ、保存も消える（リロードしても再表示されない）
  await page.click('#timer-stop-button');
  await expect(page.locator('#timer-overlay')).toBeHidden();
  await page.reload();
  await waitForForecast(page);
  await expect(page.locator('#timer-overlay')).toBeHidden();

  // 活動ふりかえり: 休憩切り替えで1回分の着用セッションが記録され、
  // 当日サマリーが表示される（この端末のみの保存でリロード後も残る）
  await expect(page.locator('#wear-log-section')).toBeVisible();
  await expect(page.locator('#wear-log-summary')).toContainText('着用1回');
  await expect(page.locator('#wear-log-summary')).toContainText('計1分');

  // プランナーには前回実績が「短めから」の注意付きで参考表示される
  await page.click('#tab-planner');
  await page.click('#plan-button');
  await expect(page.locator('#plan-result')).toContainText('参考: 前回の着用');
  await expect(page.locator('#plan-result')).toContainText('緩める根拠にしないでください');
});

test('当日コンディションチェック: 2段階の注意が出て、回答はどこにも保存されない', async ({
  page,
}) => {
  await page.goto('/');
  await waitForForecast(page);

  await page.getByText('今日のコンディションチェック').click();
  // 通常の該当（睡眠不足）→「1段階慎重に」の黄系注意
  await page.getByText('睡眠が6時間未満だった', { exact: true }).click();
  await expect(page.locator('#condition-note')).toContainText('1段階慎重に');
  await expect(page.locator('#condition-note')).toHaveClass(/condition-note-warning/);

  // 発熱・下痢の該当 →「活動の見送りを検討」の赤系警戒（他の該当より優先）
  await page.getByText('発熱・下痢など体調不良がある', { exact: true }).click();
  await expect(page.locator('#condition-note')).toContainText('見送りを検討');
  await expect(page.locator('#condition-note')).toHaveClass(/condition-note-severe/);

  // 全部外すと帯は消える
  await page.getByText('睡眠が6時間未満だった', { exact: true }).click();
  await page.getByText('発熱・下痢など体調不良がある', { exact: true }).click();
  await expect(page.locator('#condition-note')).toBeEmpty();

  // プライバシー: 回答はlocalStorageのどこにも保存されない
  const stored = await page.evaluate(() => Object.keys(window.localStorage).join(','));
  expect(stored).not.toContain('ondition');

  // 暑熱順化: プランナーの計画（デモは暑熱日）に慣らしの注意と啓発パネルが出る
  await page.click('#tab-planner');
  await page.click('#plan-button');
  await expect(page.locator('#plan-result')).toContainText('目安のおよそ半分から段階的に');
  await page.getByText('しばらく着ていない人へ').click();
  await expect(page.locator('.acclimatization-note')).toContainText('暑熱順化');
});

test('低温の日: 休憩ガイドと持ち物が保温側になり、冷却の手順・保冷剤を出さない', async ({
  page,
}) => {
  // 全時間帯を低温警戒（grade 2）へ差し替える（デモデータは夏日のため）
  await page.route('**/api/forecast*', async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('demo', '1');
    const response = await route.fetch({ url: url.toString() });
    const body = await response.json();
    body.hours = body.hours.map((hour) => ({
      ...hour,
      outdoor: {
        ...hour.outdoor,
        level: 'coldWarning',
        label: '低温警戒',
        grade: 2,
        activityMinutes: 20,
        advice: '防寒と休憩を優先してください。',
      },
    }));
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await waitForForecast(page);
  await page.click('#tab-planner');
  await page.click('#plan-button');

  // 低温警戒（grade 2）で熱中症向けの冷却手順が混ざらないこと
  await expect(page.locator('.rest-guide')).toContainText('温かい飲み物');
  await expect(page.locator('.rest-guide')).not.toContainText('冷たい水');
  await expect(page.locator('.rest-guide')).not.toContainText('冷房の効いた室内');
  await expect(page.locator('#packing-list')).not.toContainText('保冷剤');
  await expect(page.locator('#packing-list')).toContainText('カイロ');
  // 暑熱順化の慣らし注意は暑熱リスクのある計画のみ（冬の計画には出さない）
  await expect(page.locator('#plan-result')).not.toContainText('目安のおよそ半分');
});

test('着用タイマー: 判定が「着用中止」のときは開始できない', async ({ page }) => {
  // 昼14時（危険レベル・着用中止）に固定する
  await mockForecastFixedHour(page, '14');
  await page.goto('/');
  await waitForForecast(page);

  await page.click('#timer-start-button');
  await expect(page.locator('#timer-overlay')).toBeHidden();
  await expect(page.locator('#status-error')).toContainText('タイマーは開始できません');
});
