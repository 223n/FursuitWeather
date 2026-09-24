// ページのMarkdown版の出し分け（src/markdown.ts）のテスト

import { describe, expect, it, vi } from 'vitest';
import {
  markdownAlternateLink,
  markdownPathFor,
  markdownResponse,
  prefersMarkdown,
} from '../src/markdown';

describe('prefersMarkdown', () => {
  it.each([
    ['text/markdown', true],
    ['text/markdown, text/html;q=0.9', true],
    ['text/html;q=0.5, text/markdown;q=0.8', true],
    // 同じq値ならMarkdownを明示したクライアントを優先する
    ['text/html, text/markdown', true],
    ['TEXT/MARKDOWN', true],
  ])('%s → Markdown', (accept, expected) => {
    expect(prefersMarkdown(accept)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    // ブラウザの典型的なAccept
    ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],
    ['*/*'],
    ['text/*'],
    ['text/markdown;q=0'],
    ['text/markdown;q=0.5, text/html'],
    ['text/markdown;q=abc'],
  ])('%s → HTML', (accept) => {
    expect(prefersMarkdown(accept)).toBe(false);
  });
});

describe('markdownPathFor', () => {
  it('拡張子あり・なしの両方のパスを同じMarkdown版へ対応付ける', () => {
    expect(markdownPathFor('/')).toBe('/index.md');
    expect(markdownPathFor('/index.html')).toBe('/index.md');
    expect(markdownPathFor('/about')).toBe('/about.md');
    expect(markdownPathFor('/emergency.html')).toBe('/emergency.md');
    expect(markdownPathFor('/display')).toBe('/display.md');
  });

  it('404ページと未登録のパスは対象外', () => {
    expect(markdownPathFor('/404.html')).toBeUndefined();
    expect(markdownPathFor('/unknown')).toBeUndefined();
  });
});

describe('markdownResponse', () => {
  it('Markdown版をtext/markdownで返し、Acceptでの出し分けを宣言する', async () => {
    const assets = {
      fetch: vi.fn(async () => new Response('# 本文', { headers: { 'Content-Type': 'text/plain' } })),
    } as unknown as Fetcher;
    const response = await markdownResponse(assets, 'https://example.com/about', '/about.md');

    expect(response!.status).toBe(200);
    expect(response!.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response!.headers.get('Vary')).toBe('Accept');
    expect(await response!.text()).toBe('# 本文');
    expect(String(vi.mocked(assets.fetch).mock.calls[0]![0])).toBe('https://example.com/about.md');
  });

  it('Markdown版を取得できないときはnullを返す', async () => {
    const assets = {
      fetch: vi.fn(async () => new Response('', { status: 404 })),
    } as unknown as Fetcher;
    expect(await markdownResponse(assets, 'https://example.com/', '/index.md')).toBeNull();
  });
});

describe('markdownAlternateLink', () => {
  it('Markdown版をrel=alternateで示す', () => {
    expect(markdownAlternateLink('/about.md')).toBe(
      '</about.md>; rel="alternate"; type="text/markdown"',
    );
  });
});
