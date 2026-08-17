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
import pkg from '../package.json';
import apiMd from '../docs/api.md?raw';
import logicMd from '../docs/logic.md?raw';
import openapiYaml from '../docs/openapi.yaml?raw';
import notFoundHtml from '../public/404.html?raw';
import aboutHtml from '../public/about.html?raw';
import appJs from '../public/app.js?raw';
import html from '../public/index.html?raw';
import llmsTxt from '../public/llms.txt?raw';
import wbgtTool from '../public/wbgt-tool.js?raw';
import {
  COLD_BANDS,
  COLD_SWITCH_TEMPERATURE,
  HEAT_STROKE_ALERT_WBGT,
  COOLING_LABELS,
  COOLING_RECOMMENDED_WBGT,
  COOLING_REQUIRED_WBGT,
  DAYTIME_END_HOUR,
  DAYTIME_START_HOUR,
  DEFAULT_FORECAST_DAYS,
  GEOCODING_CACHE_TTL_SECONDS,
  GEOCODING_MAX_QUERY_LENGTH,
  GEOCODING_MAX_RESULTS,
  HEAT_BANDS,
  LAUNDRY,
  LAUNDRY_LEVEL_LABELS,
  MAX_FORECAST_DAYS,
  RECOMMENDED_MAX_GRADE,
  RESPONSE_CACHE_MAX_AGE_SECONDS,
  SUIT_WBGT_ADJUSTMENT,
  UPSTREAM_CACHE_TTL_SECONDS,
  YEAR_ROUND_NOTICES,
} from '../src/constants';

/** sr-only併記つきの範囲表記（視覚は「〜」・読み上げは「から」）を組み立てる */
const srRange = (from: number | string, to: number | string): string =>
  `${from}<span aria-hidden="true">〜</span><span class="sr-only">から</span>${to}`;

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
    // 低温側の凡例（低温注意）はCOLD_BANDS由来のため、次のテストで検証する
    for (const band of HEAT_BANDS.filter((b) => b.activityMinutes > 0)) {
      expect(html).toContain(`連続${band.activityMinutes}分`);
    }
  });

  it('凡例はグレード・ラベル・連続活動時間が同一項目内で対応している', () => {
    // ラベルと分数が「どこかにある」だけでなく、同じlegend-item内で対になって
    // いることを検証し、行の入れ替え編集ミスを検出する
    for (const band of HEAT_BANDS.filter((b) => b.activityMinutes > 0)) {
      const pattern = new RegExp(
        `badge-large grade-${band.grade}"[^]*?${band.label}</span>\\s*<p>連続${band.activityMinutes}分`,
      );
      expect(html).toMatch(pattern);
    }
  });

  it('凡例の低温バッジはcoldCautionのラベルとgradeに一致する', () => {
    const coldCaution = COLD_BANDS.find((b) => b.id === 'coldCaution');
    expect(coldCaution).toBeDefined();
    expect(html).toContain(`>${coldCaution!.label}</span>`);
    expect(html).toContain(`cold grade-${coldCaution!.grade}`);
  });

  it('API先読み（preload）はfetchと照合されるようcrossorigin属性を持つ', () => {
    // as="fetch"のプリロードはcrossoriginがないとmodeが一致せず照合されない
    expect(html).toMatch(/<link rel="preload" href="\/api\/forecast\?[^"]+" as="fetch" crossorigin>/);
  });

  it('時間別テーブルのsr-only captionは全列（降水確率を含む）を列挙している', () => {
    // captionの列挙はスクリーンリーダー利用者が列位置を把握する前提情報のため、
    // 列の追加時に実テーブルと乖離しないよう機械検証する
    const caption = html.match(/<table id="hours-table">[\s\S]*?<caption[^>]*>([\s\S]*?)<\/caption>/);
    expect(caption).not.toBeNull();
    for (const column of ['時刻', '天気', '気温', '湿度', '降水確率', '暑さ指数', '屋外判定', '屋内判定']) {
      expect(caption![1]).toContain(column);
    }
  });
});

describe('aboutページとconstantsの同期', () => {
  it('WBGT対応表に暑熱5段階のすべてのラベルが記載されている', () => {
    for (const band of HEAT_BANDS) {
      expect(aboutHtml).toContain(band.label);
    }
  });

  it('WBGT対応表の活動時間はHEAT_BANDSのactivityMinutesと行単位で一致する', () => {
    // 「危険」帯（activityMinutes=0）は表中で「中止」表記のため対象外。
    // 行の入れ替え編集ミスを検出するため、同一<tr>内でラベルと分数を対で検証する
    const rows = [...aboutHtml.matchAll(/<tr>([^]*?)<\/tr>/g)].map((m) => m[1]!);
    for (const band of HEAT_BANDS.filter((b) => b.activityMinutes > 0)) {
      const row = rows.find((r) => r.includes(`>${band.label}</span>`));
      expect(row, band.label).toBeDefined();
      expect(row!).toContain(`>${band.activityMinutes}分<`);
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

  it('干し時間帯と乾燥目安の数値がLAUNDRY定数と一致する', () => {
    // 範囲記号「〜」はsr-only併記のマークアップで分断されるため、実マークアップ込みで比較する
    expect(aboutHtml).toContain(
      `干し時間帯（${srRange(LAUNDRY.windowStartHour, `${LAUNDRY.windowEndHour}時`)}）`,
    );
    expect(aboutHtml).toContain(
      srRange(LAUNDRY.fursuitMinDryingHours, `${LAUNDRY.fursuitMaxDryingHours}時間`),
    );
  });

  it('weatherCodeの欠測番兵値（-1）が公開仕様に明記されている', () => {
    expect(aboutHtml).toContain('欠測時は<code>-1</code>');
    expect(apiMd).toContain('欠測時は`-1`');
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

describe('実測WBGTツール（wbgt-tool.js）とconstantsの同期', () => {
  // aboutページの簡易ツールは素のJSのため、しきい値・ラベル・補正値の複製を機械検証する
  it('着衣補正値と冷房しきい値が一致する', () => {
    expect(wbgtTool).toContain(`const SUIT_WBGT_ADJUSTMENT = ${SUIT_WBGT_ADJUSTMENT};`);
    expect(wbgtTool).toContain(`const COOLING_REQUIRED_WBGT = ${COOLING_REQUIRED_WBGT};`);
    expect(wbgtTool).toContain(`const COOLING_RECOMMENDED_WBGT = ${COOLING_RECOMMENDED_WBGT};`);
  });

  it('暑熱5段階のしきい値・ラベル・グレード・活動時間が件数・順序込みで一致する', () => {
    // toContainのみだと並び順の崩れ・余分な帯の混入を検出できないため、
    // 定義ブロックを抽出して全件をtoEqualで突き合わせる
    const block = wbgtTool.match(/const HEAT_BANDS = \[([\s\S]*?)\n {2}\];/);
    expect(block).not.toBeNull();
    const parsed = [
      ...block![1]!.matchAll(
        /\{ upperBound: ([\d.]+|Infinity), label: '([^']+)', grade: (\d), activityMinutes: (\d+) \}/g,
      ),
    ].map((m) => ({
      upperBound: m[1] === 'Infinity' ? Number.POSITIVE_INFINITY : Number(m[1]),
      label: m[2]!,
      grade: Number(m[3]),
      activityMinutes: Number(m[4]),
    }));
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed).toEqual(
      HEAT_BANDS.map((b) => ({
        upperBound: b.upperBound,
        label: b.label,
        grade: b.grade,
        activityMinutes: b.activityMinutes,
      })),
    );
    // 最終帯がInfinity終端であること（ツール側の??フォールバックが到達不能であること）も固定する
    expect(parsed[parsed.length - 1]!.upperBound).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('公開仕様（about・api.md・llms.txt）と定数の同期', () => {
  it('予報日数の上限と既定値が全公開仕様で一致する', () => {
    expect(aboutHtml).toContain(
      `予報日数（${srRange('<code>1</code>', `<code>${MAX_FORECAST_DAYS}</code>`)}、デフォルト<code>${DEFAULT_FORECAST_DAYS}</code>）`,
    );
    expect(aboutHtml).toContain(`予報日数の上限は${MAX_FORECAST_DAYS}日`);
    expect(apiMd).toContain(`予報日数（\`1\`〜\`${MAX_FORECAST_DAYS}\`、デフォルト\`${DEFAULT_FORECAST_DAYS}\`）`);
    expect(apiMd).toContain(`予報日数の上限は${MAX_FORECAST_DAYS}日`);
    expect(llmsTxt).toContain(`days（1〜${MAX_FORECAST_DAYS}、既定${DEFAULT_FORECAST_DAYS}）`);
    expect(llmsTxt).toContain(`最大${MAX_FORECAST_DAYS}日先`);
  });

  it('日中時間帯と活動推奨の深刻度しきい値が一致する', () => {
    expect(aboutHtml).toContain(`日中（${srRange(DAYTIME_START_HOUR, `${DAYTIME_END_HOUR}時`)}）`);
    expect(apiMd).toContain(`日中（${DAYTIME_START_HOUR}〜${DAYTIME_END_HOUR}時）`);
    expect(aboutHtml).toContain(`深刻度${RECOMMENDED_MAX_GRADE}以下`);
    expect(apiMd).toContain(`深刻度${RECOMMENDED_MAX_GRADE}以下`);
  });

  it('地点検索の制限値（文字数・件数・キャッシュ）が入力欄と公開仕様に一致する', () => {
    // 検索欄のmaxlengthはサーバー側の検証（GEOCODING_MAX_QUERY_LENGTH）と機能的に結合する
    expect(html).toContain(`maxlength="${GEOCODING_MAX_QUERY_LENGTH}"`);
    expect(apiMd).toContain(`${GEOCODING_MAX_QUERY_LENGTH}文字以内`);
    expect(llmsTxt).toContain(`${GEOCODING_MAX_QUERY_LENGTH}文字以内`);
    expect(apiMd).toContain(`最大${GEOCODING_MAX_RESULTS}件`);
    expect(llmsTxt).toContain(`最大${GEOCODING_MAX_RESULTS}件`);
    expect(apiMd).toContain(`${GEOCODING_CACHE_TTL_SECONDS / 86400}日間`);
  });

  it('キャッシュ時間と着衣補正値がllms.txt・キャッシュ解説と一致する', () => {
    expect(aboutHtml).toContain(`max-age=${RESPONSE_CACHE_MAX_AGE_SECONDS}`);
    expect(aboutHtml).toContain(`cacheTtl: ${UPSTREAM_CACHE_TTL_SECONDS}`);
    expect(aboutHtml).toContain(
      `エッジでの気象データキャッシュ（${UPSTREAM_CACHE_TTL_SECONDS / 60}分）`,
    );
    expect(apiMd).toContain(`エッジで${UPSTREAM_CACHE_TTL_SECONDS / 60}分キャッシュ`);
    expect(llmsTxt).toContain(`約${UPSTREAM_CACHE_TTL_SECONDS / 60}分エッジキャッシュ`);
    expect(llmsTxt).toContain(
      `ブラウザキャッシュ（${RESPONSE_CACHE_MAX_AGE_SECONDS / 60}分）`,
    );
    expect(llmsTxt).toContain(`+${SUIT_WBGT_ADJUSTMENT}℃`);
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
    // app.jsは座標を小数2桁（約1km）へ丸めてURLに埋め込むため、期待クエリも同じ丸めで作る
    expect(preloadMatch![1]).toBe(
      `lat=${Number(defaultCity[2]).toFixed(2)}&lon=${Number(defaultCity[3]).toFixed(2)}`,
    );
  });
});

describe('フッターのバージョン表記の同期', () => {
  it('全ページのバージョン表記はpackage.jsonのversionと一致する', () => {
    // フッターの表記は手動更新のため、リリース時の更新漏れをここで検出する
    // （リリース手順はdocs/release.mdを参照）
    for (const page of [html, aboutHtml, notFoundHtml]) {
      expect(page).toContain(`>v${pkg.version}</a>`);
    }
  });
});

describe('app.jsのバッジ設定マップとレベルIDの同期', () => {
  // LAUNDRY_BADGES・COOLING_BADGESのキーはサーバー側union型の値に対応するが、
  // app.jsは素のJSのためコンパイラでは検証されない。レベル追加時にフロントが
  // フォールバック表示に落ちて色・記号が深刻度と食い違うのを防ぐため、
  // Record型（キー網羅をtscが強制する）のキー一覧を経由して突き合わせる
  it('LAUNDRY_BADGESに全洗濯レベルのキーがある', () => {
    // ファイル全文ではなくマップ定義ブロックにスコープし、別オブジェクトの
    // 同名キーによる偶然の一致で空振りしないようにする
    const block = appJs.match(/const LAUNDRY_BADGES = \{([\s\S]*?)\n {2}\};/);
    expect(block).not.toBeNull();
    for (const key of Object.keys(LAUNDRY_LEVEL_LABELS)) {
      expect(block![1]).toContain(`${key}: {`);
    }
  });

  it('COOLING_BADGESに全冷房要否のキーがある', () => {
    const block = appJs.match(/const COOLING_BADGES = \{([\s\S]*?)\n {2}\};/);
    expect(block).not.toBeNull();
    for (const key of Object.keys(COOLING_LABELS)) {
      expect(block![1]).toContain(`${key}: {`);
    }
  });

  it('日別カードの冷房必須ラベルはCOOLING_LABELS.requiredと一致する', () => {
    // 日別サマリーAPI（coolingRequired: boolean）にはラベルが無くapp.jsが文言を
    // 複製しているため、constants側の変更時に時間別テーブル（API由来のcoolingLabel）と
    // 食い違わないよう検証する。「冷房なしでも可の時間帯あり」は日別固有の要約文のため対象外
    expect(appJs).toContain(`label: '${COOLING_LABELS.required}'`);
  });

  it('OpenAPI仕様（docs/openapi.yaml）の列挙・上限はconstantsと一致する', () => {
    // レベルIDの列挙（判定レベルの追加・改名時にYAML側の更新を強制する）
    for (const id of [...HEAT_BANDS.map((b) => b.id), ...COLD_BANDS.map((b) => b.id)]) {
      expect(openapiYaml).toContain(`- ${id}`);
    }
    for (const level of Object.keys(LAUNDRY_LEVEL_LABELS)) {
      expect(openapiYaml).toContain(level);
    }
    // パラメータの上限値
    expect(openapiYaml).toContain(`maximum: ${MAX_FORECAST_DAYS}, default: ${DEFAULT_FORECAST_DAYS}`);
    expect(openapiYaml).toContain(`maxLength: ${GEOCODING_MAX_QUERY_LENGTH}`);
    expect(openapiYaml).toContain(`maxItems: ${GEOCODING_MAX_RESULTS}`);
    expect(openapiYaml).toContain(`${HEAT_STROKE_ALERT_WBGT}以上は環境省の`);
    expect(openapiYaml).toContain(`max-age=${RESPONSE_CACHE_MAX_AGE_SECONDS}`);
  });

  it('熱中症警戒アラート基準（WBGT 33）の複製箇所はconstantsと一致する', () => {
    // app.jsの注意表示の判定・文言と、docsの記述を単一情報源に揃える
    expect(appJs).toContain(`d.maxWbgt >= ${HEAT_STROKE_ALERT_WBGT}`);
    expect(appJs).toContain(`暑さ指数（WBGT）${HEAT_STROKE_ALERT_WBGT}以上`);
    expect(apiMd).toContain(`${HEAT_STROKE_ALERT_WBGT}以上は環境省の熱中症警戒アラートの発表基準に相当`);
    expect(logicMd).toContain(`${HEAT_STROKE_ALERT_WBGT}以上は環境省・`);
  });

  it('判定ロジックの解説（docs/logic.md）のしきい値・係数はconstantsと一致する', () => {
    // 判定表・係数の複製が最も濃いドキュメントを、既存のhtml同期方式で機械検証する
    for (const band of HEAT_BANDS.filter((b) => b.activityMinutes > 0)) {
      expect(logicMd).toContain(`| ${band.label} | ${band.activityMinutes}分 |`);
    }
    expect(logicMd).toContain(`| ${COOLING_REQUIRED_WBGT}℃以上 | 冷房必須 |`);
    expect(logicMd).toContain(`| ${COOLING_RECOMMENDED_WBGT}℃以上 | 冷房推奨 |`);
    expect(logicMd).toContain(
      `干し時間帯（${LAUNDRY.windowStartHour}〜${LAUNDRY.windowEndHour}時）`,
    );
    expect(logicMd).toContain(`${LAUNDRY.windFactor} × 風速`);
    expect(logicMd).toContain(
      `${LAUNDRY.fursuitMinDryingHours}〜${LAUNDRY.fursuitMaxDryingHours}時間`,
    );
    expect(logicMd).toContain(`指数${LAUNDRY.moldWarningScore}未満`);
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
