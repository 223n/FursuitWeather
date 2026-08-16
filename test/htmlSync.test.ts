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
import apiMd from '../docs/api.md?raw';
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

  it('公開API仕様のレベルID列挙はunion型の全値を含む', () => {
    // 判定レベルを追加すると型・constants・凡例はコンパイルエラーとテストで
    // 更新が強制されるが、API仕様の列挙（about.html・docs/api.md）は手動同期のため検証する
    const ids = [
      ...HEAT_BANDS.map((b) => b.id),
      ...COLD_BANDS.map((b) => b.id),
      ...Object.keys(LAUNDRY_LEVEL_LABELS),
    ];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(aboutHtml).toContain(`<code>${id}</code>`);
      expect(apiMd).toContain(`\`${id}\``);
    }
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

  it('既定都市（selected）とAPI先読みURLはCITIESの座標と一致する', () => {
    // 先読み（link rel=preload）は初回fetchとURLがバイト単位で一致して初めて効く。
    // CITIESの並び替え・座標変更時にselectedとpreloadが取り残されるのを防ぐ
    const cities = [...appJs.matchAll(/\{ name: '([^']+)', lat: ([\d.]+), lon: ([\d.]+) \}/g)];
    expect(cities.length).toBeGreaterThan(0);

    const selectedMatch = html.match(/<option value="(\d+)" selected>([^<]+)<\/option>/);
    expect(selectedMatch).not.toBeNull();
    const defaultCity = cities[Number(selectedMatch![1])]!;
    expect(selectedMatch![2]).toBe(defaultCity[1]);

    const preloadMatch = html.match(/<link rel="preload" href="\/api\/forecast\?([^"]+)"/);
    expect(preloadMatch).not.toBeNull();
    // app.jsは数値をテンプレート文字列に埋め込むため、数値化してから期待クエリを作る
    expect(preloadMatch![1]).toBe(`lat=${Number(defaultCity[2])}&lon=${Number(defaultCity[3])}`);
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

  it('日別カードの冷房必須ラベルはCOOLING_LABELS.requiredと一致する', () => {
    // 日別サマリーAPI（coolingRequired: boolean）にはラベルが無くapp.jsが文言を
    // 複製しているため、constants側の変更時に時間別テーブル（API由来のcoolingLabel）と
    // 食い違わないよう検証する。「冷房なしでも可の時間帯あり」は日別固有の要約文のため対象外
    expect(appJs).toContain(`label: '${COOLING_LABELS.required}'`);
  });

  it('低温側レベルID（grade>0）は「cold」接頭辞を持つ', () => {
    // app.jsのcreateBadgeがレベルIDの'cold'接頭辞で青系配色+温度計アイコン
    // （色弱対応の形の区別）を判定するため、素のJSでは守れない命名契約を検証する。
    // 'optimal'（grade 0、快適）は低温スタイルを持たない意図的な例外
    for (const band of COLD_BANDS.filter((b) => b.grade > 0)) {
      expect(band.id.startsWith('cold')).toBe(true);
    }
    for (const band of HEAT_BANDS) {
      expect(band.id.startsWith('cold')).toBe(false);
    }
  });
});
