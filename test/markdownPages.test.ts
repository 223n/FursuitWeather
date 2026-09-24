// ページのMarkdown版（public/*.md）とHTMLの同期テスト
//
// Markdown版はAIエージェントなど向けに手書きしたもので、HTMLを直しても自動では
// 追従しない。見出しの増減・判定の文言・説明ページへのリンク切れを機械検出する。
// 文言の細部までは追わないため、節を足したり言い換えたりしたときは両方を直すこと

import { describe, expect, it } from 'vitest';
import indexHtml from '../public/index.html?raw';
import aboutHtml from '../public/about.html?raw';
import emergencyHtml from '../public/emergency.html?raw';
import indexMd from '../public/index.md?raw';
import aboutMd from '../public/about.md?raw';
import emergencyMd from '../public/emergency.md?raw';
import displayMd from '../public/display.md?raw';
import { HEAT_BANDS, YEAR_ROUND_NOTICES } from '../src/constants';

const SITE_ORIGIN = 'https://fursuit-weather.223n.tech';

/**
 * HTML片の表示テキスト。タグで区切ったテキストのうち、アイコン（svg）と
 * 読み上げ専用テキスト（sr-only）の内側を除いて連結する。
 * タグを置換で消す方式はCodeQLが不完全なサニタイズとして検出するため、
 * テキスト部分だけを拾い出す方式にしている（入力はリポジトリ内のHTMLのみ）
 */
function visibleText(fragment: string): string {
  let text = '';
  let hiddenDepth = 0;
  for (const [, tag = '', chunk = ''] of fragment.matchAll(/(<[^>]*>)?([^<]*)/g)) {
    if (tag.startsWith('<svg') || tag.startsWith('<span class="sr-only"')) {
      hiddenDepth += 1;
    } else if (hiddenDepth > 0 && (tag === '</svg>' || tag === '</span>')) {
      hiddenDepth -= 1;
    }
    if (hiddenDepth === 0) {
      text += chunk;
    }
  }
  return text.replace(/\s+/g, '');
}

/** h2・h3見出しの表示テキスト */
function headings(html: string): string[] {
  const pattern = /<h([23])[^>]*>([^]*?)<\/h\1>/g;
  return [...html.matchAll(pattern)].map((m) => visibleText(m[2]!));
}

/** Markdownの見出しの本文（番号付きの「1. 」は外して比べる） */
function markdownHeadings(md: string): string[] {
  return [...md.matchAll(/^#{2,3} (.+)$/gm)].map((m) =>
    m[1]!.replace(/^\d+\.\s*/, '').replace(/\s+/g, ''),
  );
}

describe('Markdown版の見出しはHTMLと一致する（節の追加・削除の追従漏れの検出）', () => {
  it.each([
    ['about', aboutHtml, aboutMd],
    ['emergency', emergencyHtml, emergencyMd],
  ])('%s', (_name, html, md) => {
    const mdHeadings = markdownHeadings(md);
    const htmlHeadings = headings(html);
    // 抽出の空振り（正規表現の破損）で検証が素通りしないようにする
    expect(htmlHeadings.length).toBeGreaterThan(3);
    for (const heading of htmlHeadings) {
      // HTMLの手順番号（1着ぐるみから出す）はMarkdownでは「1. 」表記
      expect(mdHeadings, heading).toContain(heading.replace(/^\d+/, ''));
    }
  });
});

describe('トップページのMarkdown版と判定・注意事項の同期', () => {
  it('活動時の注意はYEAR_ROUND_NOTICESの全文を載せる', () => {
    for (const notice of YEAR_ROUND_NOTICES) {
      expect(indexMd).toContain(`- ${notice}`);
    }
  });

  it('判定の見方の各行は、HTMLの凡例と同じラベルと説明の組になっている', () => {
    const legend = [
      ...indexHtml.matchAll(/badge-large[^"]*"><span class="symbol"[^]*?<\/span>([^<]+)<\/span>\s*<p>([^<]+)<\/p>/g),
    ].map((m) => [m[1]!, m[2]!] as const);
    // 暑熱5段階+低温注意
    expect(legend).toHaveLength(HEAT_BANDS.length + 1);
    for (const [label, text] of legend) {
      expect(indexMd).toContain(`| ${label} | ${text} |`);
    }
  });
});

describe('aboutページのMarkdown版と判定表の同期', () => {
  it('対応表の各行は、HEAT_BANDSのラベルと連続活動時間を同じ行に持つ', () => {
    const rows = aboutMd.split('\n').filter((line) => line.startsWith('|'));
    for (const band of HEAT_BANDS.filter((b) => b.activityMinutes > 0)) {
      const row = rows.find((r) => r.includes(`${band.label} |`));
      expect(row, band.label).toBeDefined();
      expect(row!).toContain(`${band.activityMinutes}分`);
    }
  });
});

describe('Markdown版のリンク', () => {
  const pages = [indexMd, aboutMd, emergencyMd, displayMd];

  it('説明ページ（about）への節リンクの飛び先が実在する', () => {
    const ids = new Set([...aboutHtml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    for (const md of pages) {
      for (const [, id] of md.matchAll(/\/about#([\w-]+)/g)) {
        expect(ids, id).toContain(id);
      }
    }
  });

  it('サイト内リンクは絶対URLで書く（Markdown版は単体で読まれるため）', () => {
    for (const md of pages) {
      expect(md).not.toMatch(/\]\(\/[^)]*\)/);
      expect(md).not.toMatch(/\]\(#[^)]*\)/);
    }
  });

  it('冒頭でHTML版の場所を示す', () => {
    for (const md of pages) {
      expect(md).toMatch(new RegExp(`^> HTML版: <${SITE_ORIGIN}/[^>]*>$`, 'm'));
    }
  });
});
