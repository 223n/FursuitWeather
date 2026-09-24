// /api/levels エンドポイント
// 活動判定のレベルID（暑熱側・低温側）の一覧を返す。
// クライアント（iOS・macOS版）が手で写したレベルIDを、CIで機械的に突き合わせるための
// もの（Issue #119）。値はsrc/constants/の判定表から組み立てるため、判定表を
// 変えればこの応答も自動で追従する

import { COLD_BANDS, HEAT_BANDS } from '../constants';
import type { LevelDefinition, LevelsResponse, OutdoorLevelId } from '../types';
import { json } from './http';

/** 判定表の1行から、公開する項目だけを取り出す（しきい値などの内部値は含めない） */
function toDefinition<Id extends OutdoorLevelId>(band: {
  id: Id;
  label: string;
  grade: number;
  activityMinutes: number;
}): LevelDefinition<Id> {
  return {
    id: band.id,
    label: band.label,
    grade: band.grade,
    activityMinutes: band.activityMinutes,
  };
}

/** GET /api/levels */
export async function handleLevels(): Promise<Response> {
  const body: LevelsResponse = {
    heat: HEAT_BANDS.map(toDefinition),
    cold: COLD_BANDS.map(toDefinition),
  };
  return json(body, { cacheable: true });
}
