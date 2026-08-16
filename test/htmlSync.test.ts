// 静的HTML・フロントJSとconstants.tsの同期テスト
//
// 注意事項と判定凡例は、初期描画のレイアウトシフト（CLS）防止のため
// index.htmlに静的に記載している（意図的な設計）。about.htmlも判定根拠の
// 説明としてしきい値・活動時間を静的に複製している。手動同期のため、
// 安全に関わる文言がconstants.tsの定義とずれていないかを機械検証する。
// 地点セレクト（index.html）とapp.jsのCITIES配列のインデックス結合も同様。
//
// このテストはHTML・JSの文言表現に依存する。凡例や説明の言い回しを変える
// 場合はこのテストも合わせて更新すること。

import { describe, expect, it } from 'vitest';
import aboutHtml from '../public/about.html?raw';
import appJs from '../public/app.js?raw';
import html from '../public/index.html?raw';
import {
  COLD_BANDS,
  COLD_SWITCH_TEMPERATURE,
  COOLING_LABELS,
  COOLING_RECOMMENDED_WBGT,
  COOLING_REQUIRED_WBGT,
  HEAT_BANDS,
  LAUNDRY,
  LAUNDRY_LEVEL_LABELS,
  SUIT_WBGT_ADJUSTMENT,
  YEAR_ROUND_NOTICES,
} from '../src/constants';

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

describe('aboutページとconstantsの同期', () => {
  it('WBGT対応表に暑熱5段階のすべてのラベルが記載されている', () => {
    for (const band of HEAT_BANDS) {
      expect(aboutHtml).toContain(band.label);
    }
  });

  it('WBGT対応表の活動時間はHEAT_BANDSのactivityMinutesと一致する', () => {
    // 「危険」帯（activityMinutes=0）は表中で「中止」表記のため対象外
    for (const band of HEAT_BANDS.filter((b) => b.activityMinutes > 0)) {
      expect(aboutHtml).toContain(`>${band.activityMinutes}分<`);
    }
  });

  it('WBGTしきい値の要約と表の境界端はHEAT_BANDSと一致する', () => {
    const bounds = HEAT_BANDS.filter((b) => Number.isFinite(b.upperBound)).map(
      (b) => b.upperBound,
    );
    expect(bounds.length).toBeGreaterThan(0);
    expect(aboutHtml).toContain(`5段階（${bounds.join('/')}℃）`);
    expect(aboutHtml).toContain(`${HEAT_BANDS[0]!.upperBound}℃未満`);
    expect(aboutHtml).toContain(`${bounds[bounds.length - 1]}℃以上`);
  });

  it('着衣補正値・低温切替気温・低温境界が記載されている', () => {
    expect(aboutHtml).toContain(`+${SUIT_WBGT_ADJUSTMENT}℃`);
    expect(aboutHtml).toContain(`気温${COLD_SWITCH_TEMPERATURE}℃未満`);
    // 低温境界はマイナスを全角記号（−）・区切りを全角スラッシュ（／）で表記している
    const coldBounds = COLD_BANDS.filter((b) => Number.isFinite(b.lowerBound))
      .map((b) => String(b.lowerBound).replace('-', '−'))
      .join('／');
    expect(coldBounds.length).toBeGreaterThan(0);
    expect(aboutHtml).toContain(`（${coldBounds}℃境界）`);
  });

  it('冷房要否のしきい値が記載されている', () => {
    expect(aboutHtml).toContain(`${COOLING_REQUIRED_WBGT}℃以上`);
    expect(aboutHtml).toContain(`${COOLING_RECOMMENDED_WBGT}℃以上`);
  });

  it('洗濯の例外レベルのラベルと低温しきい値が記載されている', () => {
    expect(aboutHtml).toContain(LAUNDRY_LEVEL_LABELS.noDryRain);
    expect(aboutHtml).toContain(LAUNDRY_LEVEL_LABELS.noDryCold);
    expect(aboutHtml).toContain(`平均気温${LAUNDRY.coldLimit}℃未満`);
  });
});

describe('地点セレクトとapp.jsのCITIES配列の同期', () => {
  // index.htmlのoption valueはapp.jsのCITIES配列インデックスに直結する
  // （CITIES[Number(citySelect.value)]で参照）。途中挿入などで片側だけ
  // 変わると、選んだ地点と異なる都市の座標で予報を取得してしまうため機械検証する
  it('optionの並び・valueとCITIESの定義が一致する', () => {
    const selectMatch = html.match(/<select id="city-select">([\s\S]*?)<\/select>/);
    expect(selectMatch).not.toBeNull();
    const options = [
      ...selectMatch![1]!.matchAll(/<option value="(\d+)"(?: selected)?>([^<]+)<\/option>/g),
    ];
    const cities = [...appJs.matchAll(/\{ name: '([^']+)'/g)].map((m) => m[1]!);

    // 正規表現が整形変更で空振りしたときに空配列同士で合格しないよう、非空を確認する
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((m) => m[2]!)).toEqual(cities);
    options.forEach((m, i) => {
      expect(Number(m[1])).toBe(i);
    });
  });
});

describe('app.jsのバッジ設定マップとレベルIDの同期', () => {
  // LAUNDRY_BADGES・COOLING_BADGESのキーはサーバー側union型の値に対応するが、
  // app.jsは素のJSのためコンパイラでは検証されない。レベル追加時にフロントが
  // フォールバック表示に落ちて色・記号が深刻度と食い違うのを防ぐため、
  // Record型（キー網羅をtscが強制する）のキー一覧を経由して突き合わせる
  it('LAUNDRY_BADGESに全洗濯レベルのキーがある', () => {
    for (const key of Object.keys(LAUNDRY_LEVEL_LABELS)) {
      expect(appJs).toContain(`${key}: {`);
    }
  });

  it('COOLING_BADGESに全冷房要否のキーがある', () => {
    for (const key of Object.keys(COOLING_LABELS)) {
      expect(appJs).toContain(`${key}: {`);
    }
  });
});
