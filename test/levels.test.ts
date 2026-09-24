// /api/levels（活動判定のレベルID一覧）のテスト

import { describe, expect, it } from 'vitest';
import openapiYaml from '../docs/openapi.yaml?raw';
import { handleLevels } from '../src/api/levels';
import { COLD_BANDS, HEAT_BANDS, RESPONSE_CACHE_MAX_AGE_SECONDS } from '../src/constants';
import type { LevelsResponse } from '../src/types';

async function fetchLevels(): Promise<{ response: Response; body: LevelsResponse }> {
  const response = await handleLevels();
  return { response, body: (await response.json()) as LevelsResponse };
}

/** OpenAPI定義の、指定スキーマ直下のlevelのenumを取り出す */
function openapiEnum(schemaName: string): string[] {
  const start = openapiYaml.indexOf(`    ${schemaName}:\n`);
  expect(start, schemaName).toBeGreaterThan(-1);
  const block = openapiYaml.slice(start).match(/enum:\n((?:\s+- \w+\n)+)/);
  expect(block, `${schemaName}のenum`).not.toBeNull();
  return [...block![1]!.matchAll(/- (\w+)/g)].map((m) => m[1]!);
}

describe('GET /api/levels', () => {
  it('暑熱側・低温側のレベルを判定表の順（深刻度の低い順）で返す', async () => {
    const { body } = await fetchLevels();
    expect(body.heat.map((l) => l.id)).toEqual(HEAT_BANDS.map((b) => b.id));
    expect(body.cold.map((l) => l.id)).toEqual(COLD_BANDS.map((b) => b.id));
  });

  it('各レベルのラベル・深刻度・連続活動時間は判定表と一致する', async () => {
    const { body } = await fetchLevels();
    for (const [levels, bands] of [
      [body.heat, HEAT_BANDS],
      [body.cold, COLD_BANDS],
    ] as const) {
      levels.forEach((level, i) => {
        const band = bands[i]!;
        expect(level).toEqual({
          id: band.id,
          label: band.label,
          grade: band.grade,
          activityMinutes: band.activityMinutes,
        });
      });
    }
  });

  it('レベルIDの一覧はOpenAPI定義（Assessment.level）のenumと一致する', async () => {
    const { body } = await fetchLevels();
    const ids = [...body.heat, ...body.cold].map((l) => l.id);
    expect(openapiEnum('Assessment')).toEqual(ids);
    expect(openapiEnum('LevelDefinition')).toEqual(ids);
  });

  it('CORS付きのJSONで、ブラウザに10分キャッシュさせる', async () => {
    const { response } = await fetchLevels();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe(
      `public, max-age=${RESPONSE_CACHE_MAX_AGE_SECONDS}`,
    );
  });
});
