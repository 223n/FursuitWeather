// sitemap.xmlと公開ページの整合テスト
// ページを増やしたときの「sitemapへの登録漏れ」と、
// 「noindexのページをsitemapへ載せてしまう矛盾」を機械検証する

import { describe, expect, it } from 'vitest';
import sitemapXml from '../public/sitemap.xml?raw';
import indexHtml from '../public/index.html?raw';
import aboutHtml from '../public/about.html?raw';
import emergencyHtml from '../public/emergency.html?raw';
import displayHtml from '../public/display.html?raw';
import notFoundHtml from '../public/404.html?raw';
import robotsTxt from '../public/robots.txt?raw';
import { HTML_PATHS } from '../src/csp';

const SITE_ORIGIN = 'https://fursuit-weather.223n.tech';

/** 公開HTMLページ（拡張子なしの正規パスと中身の対応） */
const PAGES: ReadonlyArray<{ path: string; html: string }> = [
  { path: '/', html: indexHtml },
  { path: '/about', html: aboutHtml },
  { path: '/emergency', html: emergencyHtml },
  { path: '/display', html: displayHtml },
  { path: '/404.html', html: notFoundHtml },
];

/** そのページが検索対象か（noindexを持たないか） */
function isIndexable(html: string): boolean {
  return !/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);
}

/** sitemapに登録されているパス（オリジンを除いたもの） */
function sitemapPaths(): string[] {
  return [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1]!.replace(SITE_ORIGIN, ''),
  );
}

describe('sitemap.xmlと公開ページの整合', () => {
  it('検索対象のページはすべてsitemapに登録されている（登録漏れの検出）', () => {
    const indexable = PAGES.filter((page) => isIndexable(page.html)).map((page) => page.path);
    expect(indexable.length).toBeGreaterThan(0);
    expect(sitemapPaths().sort()).toEqual(indexable.sort());
  });

  it('noindexのページはsitemapに載せない（矛盾したシグナルの検出）', () => {
    const noindex = PAGES.filter((page) => !isIndexable(page.html)).map((page) => page.path);
    // 会場表示モードと404は掲示・エラー用のため検索対象外
    expect(noindex).toContain('/display');
    for (const path of noindex) {
      expect(sitemapPaths(), `${path}はnoindexのためsitemapへ載せない`).not.toContain(path);
    }
  });

  it('noindexのページはcanonicalを持たない（noindexとcanonicalの併記を防ぐ）', () => {
    for (const page of PAGES.filter((p) => !isIndexable(p.html))) {
      expect(page.html, `${page.path}のcanonical`).not.toMatch(/rel="canonical"/);
    }
  });

  it('検索対象のページはcanonicalに自分の正規URLを持つ', () => {
    for (const page of PAGES.filter((p) => isIndexable(p.html))) {
      expect(page.html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}${page.path}">`);
    }
  });

  it('sitemapのURLはHTML_PATHS（Workerが配信するパス）に含まれる', () => {
    for (const path of sitemapPaths()) {
      expect(HTML_PATHS, `${path}がHTML_PATHSにない`).toContain(path);
    }
  });

  it('各URLにlastmodがYYYY-MM-DD形式で入っている', () => {
    const locs = sitemapPaths();
    const lastmods = [...sitemapXml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]!);
    expect(lastmods).toHaveLength(locs.length);
    for (const lastmod of lastmods) {
      expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('robots.txtはsitemapの場所を指している', () => {
    expect(robotsTxt).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });
});
