// 静的HTMLとconstants.tsの同期テスト
//
// 注意事項と判定凡例は、初期描画のレイアウトシフト（CLS）防止のため
// index.htmlに静的に記載している（意図的な設計）。手動同期のため、
// 安全に関わる文言がconstants.tsの定義とずれていないかを機械検証する。
//
// このテストはHTMLの文言表現に依存する。凡例の言い回しを変える場合は
// このテストも合わせて更新すること。

import { describe, expect, it } from 'vitest';
import html from '../public/index.html?raw';
import { HEAT_BANDS, YEAR_ROUND_NOTICES } from '../src/constants';

describe('静的HTMLとconstantsの同期', () => {
  it('注意事項の静的コピーはYEAR_ROUND_NOTICESの全文と一致する', () => {
    for (const notice of YEAR_ROUND_NOTICES) {
      expect(html).toContain(notice);
    }
  });

  it('凡例に暑熱5段階のすべてのラベルが記載されている', () => {
    for (const band of HEAT_BANDS) {
      expect(html).toContain(band.label);
    }
  });

  it('凡例の連続活動時間はHEAT_BANDSのactivityMinutesと一致する', () => {
    // 「危険」帯（activityMinutes=0、分数表記なし）は対象外。
    // 低温側の凡例（低温注意）はCOLD_BANDS由来のため、ここでは検証しない
    for (const band of HEAT_BANDS.filter((b) => b.activityMinutes > 0)) {
      expect(html).toContain(`連続${band.activityMinutes}分`);
    }
  });
});
