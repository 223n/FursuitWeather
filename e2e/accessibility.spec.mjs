// アクセシビリティの自動検証（axe-core監査 + CLS測定）
//
// これまでaxe-core監査とCLS測定は「リリース時の手動確認」だった。手順書
// （docs/release.md）にその段が無く、対象も「トップ・about」に限られていたため、
// 応急対応ページの119番ボタンのコントラスト比が1.70:1（WCAG AAの大きい文字3:1の
// 半分ほど）まで落ちた状態が **v1.9.0〜v1.13.0の7リリースを通過した**。
// このリポジトリの他の約束（htmlSync・cssPurge・browserJsSync）と同じく、
// 人が覚えている必要のない形＝CIが落ちる形へ移した。
//
// 対象は配信する5ページすべて。sitemap登録の3ページ（/・/about・/emergency）に加え、
// noindexだが利用者へ配信される/displayと/404も含める（見逃しはページの
// 検索エンジン登録の有無とは関係ないため）。画面幅はPCとスマホの2種類を見る。
//
// axe-coreはTrusted Types（src/csp.tsの`require-trusted-types-for 'script'`）に
// よってscriptタグ経由の注入が弾かれる。page.evaluateはCDP経由でCSPの対象外の
// ため、そちらで読み込む（注入が弾かれること自体がCSPの動作確認にもなっている）。

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, test } from '@playwright/test';

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

/** 検証する規格。WCAG 2.0/2.1 の A と AA */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** 検証する画面幅（PCとスマホ。CLSの上限は画面幅ごとに置く） */
const VIEWPORTS = [
  { name: 'PC', width: 1280, height: 900 },
  { name: 'スマホ', width: 390, height: 844 },
];

/**
 * 配信する全ページと、読み込み完了までのCLS（レイアウトシフト量）の上限
 *
 * 上限は実測値に余裕を持たせた「悪化したら気付く」ための値で、目標値ではない。
 * 実測（v1.15.0・デモ応答固定・JST 9時固定）は次のとおり。デモを3日分にした
 * 変更（v1.15.0）より前のタグで測り直すと、トップは日付タブの出し入れで0.144になる:
 *
 * | ページ | PC | スマホ |
 * | --- | --- | --- |
 * | トップ | 0.005 | 0.000 |
 * | 判定の見方・応急対応・404 | 0.000 | 0.000 |
 * | 会場表示 | 0.114 | 0.209 |
 *
 * 0にならない2か所は、どちらも「出るか出ないかが予報で決まる領域」で、
 * 空の高さを確保すると常に余白が居座るため意図的に確保していない:
 * - トップの0.005: いまの判定カードの任意行（雷注意・応急対応への導線）。
 *   最大構成（雷+応急対応）はPCで235pxあり、常時確保すると穏やかな日に
 *   80px超の空白が出る。カード自体はmin-heightで4行分を確保済み
 * - 会場表示の0.1〜0.2: 熱中症警戒アラートの帯（.display-alerts）。
 *   掲示面の一等地を空欄で占有しないため確保しない。会場表示は起動後
 *   スライドを巡回し続ける掲示で、読み込みは1回きりのため影響も限られる
 */
const PAGES = [
  { path: '/?demo=1', name: 'トップ', cls: { PC: 0.02, スマホ: 0.02 } },
  { path: '/about', name: '判定の見方', cls: { PC: 0.01, スマホ: 0.01 } },
  { path: '/emergency', name: '応急対応', cls: { PC: 0.01, スマホ: 0.01 } },
  { path: '/404.html', name: '404', cls: { PC: 0.01, スマホ: 0.01 } },
  { path: '/display?demo=1', name: '会場表示', cls: { PC: 0.15, スマホ: 0.25 } },
];

/** 読み込み完了までのレイアウトシフト量を合算する（page.gotoの前に呼ぶ） */
async function observeLayoutShift(page) {
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__clsSources = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // 利用者の操作起点のシフトはCLSに数えない（タブ切り替えなど）
        if (entry.hadRecentInput) {
          continue;
        }
        window.__cls += entry.value;
        // 落ちたときに「どの要素が動いたか」まで出す（値だけだと調べ直しになる）
        for (const source of entry.sources ?? []) {
          const node = source.node;
          if (node && node.tagName) {
            const names = typeof node.className === 'string' ? node.className.trim() : '';
            window.__clsSources.push(
              node.tagName.toLowerCase() +
                (node.id ? `#${node.id}` : '') +
                (names ? `.${names.split(/\s+/).join('.')}` : ''),
            );
          }
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

/** APIを上流なしのデモ応答へ差し替える（他のE2Eと同じ方針） */
async function mockApiWithDemo(page) {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('demo') === '1') {
      return route.continue();
    }
    url.searchParams.set('demo', '1');
    return route.continue({ url: url.toString() });
  });
}

for (const viewport of VIEWPORTS) {
  for (const scheme of ['light', 'dark']) {
    const schemeLabel = scheme === 'light' ? 'ライト' : 'ダーク';
    test.describe(`アクセシビリティ（${viewport.name}・${schemeLabel}モード）`, () => {
      test.use({
        colorScheme: scheme,
        viewport: { width: viewport.width, height: viewport.height },
      });

      for (const target of PAGES) {
        const where = `${target.name}（${viewport.name}・${schemeLabel}）`;

        test(`${target.name}: axe-core違反0件・CLSが上限内`, async ({ page }) => {
          // 時刻で判定も表示も変わるため固定する（他のE2Eと同じ理由）
          const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          await page.clock.install({ time: new Date(`${jstToday}T09:00:00+09:00`) });
          await mockApiWithDemo(page);
          await observeLayoutShift(page);

          await page.goto(target.path, { waitUntil: 'load' });
          // 予報の描画とスライドの初期表示が終わるまで待つ（描画途中を測らない）
          await page.waitForTimeout(2500);

          await page.evaluate(axeSource);
          const result = await page.evaluate(
            async (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
            WCAG_TAGS,
          );

          // 落ちたときに「どの規則がどの要素で」まで出す（idだけだと調べ直しになる）
          const violations = result.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            targets: violation.nodes.map((node) => node.target.join(' ')),
          }));
          expect(violations, `${where}のaxe-core違反`).toEqual([]);

          const { cls, sources } = await page.evaluate(() => ({
            cls: window.__cls,
            sources: [...new Set(window.__clsSources)],
          }));
          expect(cls, `${where}のCLS（動いた要素: ${sources.join(' / ') || 'なし'}）`)
            .toBeLessThanOrEqual(target.cls[viewport.name]);
        });
      }
    });
  }
}

test.describe('色に依存しない表示の契約', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  // axe-coreはコントラスト比を見るが「この要素がこの色であること」までは見ない。
  // 119番ボタンの退行は`.emergency-call a`が詳細度で勝って文字色を奪ったもので、
  // 奪った先の色（濃紺）もパネル地色の上でならAAを満たすため、
  // コントラスト規則だけでは検出できない配置だった。要素と色を名指しで固定する
  test('119番ボタンは赤地に白抜きで、コントラスト比が3:1以上ある', async ({ page }) => {
    await page.goto('/emergency');
    const button = page.locator('.emergency-call-button');
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(button).toHaveCSS('background-color', 'rgb(204, 51, 17)');

    const ratio = await button.evaluate((el) => {
      const relativeLuminance = (color) => {
        const [r, g, b] = color
          .match(/\d+/g)
          .slice(0, 3)
          .map((v) => {
            const c = Number(v) / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const style = getComputedStyle(el);
      const [fg, bg] = [relativeLuminance(style.color), relativeLuminance(style.backgroundColor)];
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    // 1.3rem・太字は「大きい文字」でAAの基準は3:1（実測5.19:1）
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
