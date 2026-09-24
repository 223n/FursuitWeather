// /.well-known/api-catalog（RFC 9727）の契約テスト
// 静的ファイルのため実装から検証されず、JSONの破損やリンク切れに気付けない。
// 形式と、OpenAPI定義・ヘッダーとの整合をCIで機械検証する

import { describe, expect, it } from 'vitest';
import apiCatalog from '../public/.well-known/api-catalog?raw';
import headers from '../public/_headers?raw';
import openapiYaml from '../docs/openapi.yaml?raw';
// リンク先の実在はimportで担保する（消えるとこのテストファイルの読み込みで落ちる）
import '../docs/api.md?raw';
import '../public/llms.txt?raw';
import { HOME_LINK_HEADER } from '../src/csp';

const REPO_RAW = 'https://raw.githubusercontent.com/223n/FursuitWeather/main/';
const REPO_BLOB = 'https://github.com/223n/FursuitWeather/blob/main/';

interface Link {
  href: string;
  type?: string;
}
interface LinkContext {
  anchor: string;
  'service-desc': Link[];
  'service-doc': Link[];
}

const catalog = JSON.parse(apiCatalog) as { linkset: LinkContext[] };
const context = catalog.linkset[0]!;

describe('/.well-known/api-catalog', () => {
  it('linkset形式のJSONで、APIの文脈を1つ持つ', () => {
    expect(catalog.linkset).toHaveLength(1);
  });

  it('anchorはOpenAPI定義のserversと同じオリジンの/api/を指す', () => {
    const server = openapiYaml.match(/^servers:\s*\n\s*- url:\s*(\S+)/m)?.[1];
    expect(server).toBeDefined();
    expect(context.anchor).toBe(`${server}/api/`);
  });

  it('service-desc・service-docはリポジトリに実在するファイルを指す（リンク切れの検出）', () => {
    const desc = context['service-desc'][0]!;
    const doc = context['service-doc'][0]!;
    expect(desc.href).toBe(`${REPO_RAW}docs/openapi.yaml`);
    expect(doc.href).toBe(`${REPO_BLOB}docs/api.md`);
    expect(desc.type).toBe('application/vnd.oai.openapi');
  });

  it('_headersでRFC 9727のContent-Typeを付ける（拡張子が無く既定では型が付かない）', () => {
    expect(headers).toMatch(
      /^\/\.well-known\/api-catalog\s*\n\s+Content-Type: application\/linkset\+json; profile="https:\/\/www\.rfc-editor\.org\/info\/rfc9727"$/m,
    );
  });

  it('ホームページのLinkヘッダーが指す先は、public/に実在する配信ファイル', () => {
    // 実在はこのファイル冒頭のimport（api-catalog・llms.txt）で担保する
    const targets = [...HOME_LINK_HEADER.matchAll(/<([^>]+)>/g)].map((m) => m[1]);
    expect(targets).toEqual(['/.well-known/api-catalog', '/llms.txt']);
  });
});
