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
import readmeMd from '../README.md?raw';
import apiMd from '../docs/api.md?raw';
import logicMd from '../docs/logic.md?raw';
import openapiYaml from '../docs/openapi.yaml?raw';
import notFoundHtml from '../public/404.html?raw';
import aboutHtml from '../public/about.html?raw';
import emergencyHtml from '../public/emergency.html?raw';
import appJs from '../public/app.js?raw';
import html from '../public/index.html?raw';
import llmsTxt from '../public/llms.txt?raw';
import wbgtTool from '../public/wbgt-tool.js?raw';
import displayHtml from '../public/display.html?raw';
import displayMd from '../docs/display.md?raw';
import displayJs from '../public/display.js?raw';
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
  NATIONAL_CITIES,
  RECOMMENDED_MAX_GRADE,
  RESPONSE_CACHE_MAX_AGE_SECONDS,
  SUDDEN_HEAT,
  SUIT_WBGT_ADJUSTMENT,
  THUNDER_WEATHER_CODE_MIN,
  UPSTREAM_CACHE_TTL_SECONDS,
  WIND_CAUTION_SPEED,
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

  it('日別サマリーのスケルトン枚数はFORECAST_DAYSと一致する', () => {
    // スケルトンは実カード枚数と一致して初めてCLS防止として機能する。
    // 日数変更時の取り残し（3bca691で4枚追加→7a0fc49で3日化の実例）を機械検出する
    const days = appJs.match(/const FORECAST_DAYS = (\d+);/);
    expect(days).not.toBeNull();
    const skeletons = html.match(/class="day-card skeleton-card"/g) ?? [];
    expect(skeletons.length).toBe(Number(days![1]));
    // 消し残しの検出: 行スケルトンはカードの内側にのみ現れる。単独行の閉じタグ
    // （カードの閉じ）の直後に行スケルトンが続く形は、カード削除時の取り残し。
    // カード内の連続する行スケルトン（…></div>で行が終わる形）は誤検出しない
    expect(html).not.toMatch(/\n\s*<\/div>\s*\n\s*<div class="skeleton-line/);
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
    for (const column of ['時刻', '天気', '気温', '湿度', '降水確率', '風速', '暑さ指数', '屋外判定', '屋内判定']) {
      expect(caption![1]).toContain(column);
    }
  });

  it('強風・雷のしきい値の複製（app.js）はconstantsと一致する', () => {
    // 注意表示のしきい値はフロントで再判定するため、片側だけの変更を検出する
    expect(appJs).toContain(`const WIND_CAUTION_SPEED = ${WIND_CAUTION_SPEED};`);
    expect(appJs).toContain(
      `const THUNDER_WEATHER_CODE_MIN = ${THUNDER_WEATHER_CODE_MIN};`,
    );
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
    // docs/api.mdのレスポンス例のラベル（excellent）も実ラベルと同期させる
    expect(apiMd).toContain(LAUNDRY_LEVEL_LABELS.excellent);
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
  // トップページの簡易ツール（実測WBGTタブ）は素のJSのため、しきい値・ラベル・補正値の複製を機械検証する
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
    expect(aboutHtml).toContain(`cacheTtlByStatus: ${UPSTREAM_CACHE_TTL_SECONDS}`);
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

describe('お気に入り未登録時の案内の同期', () => {
  // 案内はCLS対策でindex.htmlに静的に記載し、app.jsも同じ文言で描画し直す。
  // 片側だけ変えると再描画のたびに高さが変わってレイアウトシフトが出る
  it('index.htmlの案内文とapp.jsの描画文言が一致する', () => {
    const htmlMatch = html.match(/<li class="favorites-empty">([^<]+)<\/li>/);
    expect(htmlMatch).not.toBeNull();
    expect(appJs).toContain(`hint.textContent = '${htmlMatch![1]!}'`);
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
    // app.jsは座標を小数2桁（約1km）へ丸め、日数（FORECAST_DAYS）を付けてfetchする。
    // preloadはこの初回fetchとバイト一致して初めて効くため、日数も含めて検証する
    const daysMatch = appJs.match(/const FORECAST_DAYS = (\d+);/);
    expect(daysMatch).not.toBeNull();
    expect(preloadMatch![1]).toBe(
      `lat=${Number(defaultCity[2]).toFixed(2)}&lon=${Number(defaultCity[3]).toFixed(2)}&days=${daysMatch![1]}`,
    );
  });
});

describe('フッターのバージョン表記の同期', () => {
  it('全ページのバージョン表記はpackage.jsonのversionと一致する', () => {
    // フッターの表記は手動更新のため、リリース時の更新漏れをここで検出する
    // （リリース手順はdocs/release.mdを参照）
    for (const page of [html, aboutHtml, notFoundHtml, emergencyHtml]) {
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
    expect(appJs).toContain(`coolingBadge('required', '${COOLING_LABELS.required}')`);
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

  it('風・雷・急な暑さのしきい値の記述はconstantsと一致する', () => {
    // 注意表示のしきい値（風速10m/s・WMOコード95・+5℃/直近7日/25℃以上）の
    // docsの数値記述を単一情報源に揃える（app.js側の複製定数は上の
    // 「強風・雷のしきい値の複製」テストで宣言単位で検証している）
    expect(apiMd).toContain(
      `直近${SUDDEN_HEAT.baselineDays}日の平均最高気温を${SUDDEN_HEAT.temperatureRise}℃以上上回り`,
    );
    expect(apiMd).toContain(`最高気温${SUDDEN_HEAT.minTargetMax}℃以上`);
    expect(apiMd).toContain(`過去データが${SUDDEN_HEAT.minBaselineDays}日分未満`);
    expect(apiMd).toContain(`${WIND_CAUTION_SPEED}以上は気象庁の「やや強い風」に相当`);
    expect(logicMd).toContain(`最大風速が${WIND_CAUTION_SPEED}m/s以上の日`);
    expect(logicMd).toContain(`WMOコード${THUNDER_WEATHER_CODE_MIN}以上`);
    expect(logicMd).toContain(
      `直近${SUDDEN_HEAT.baselineDays}日の平均最高気温を`,
    );
    expect(logicMd).toContain(`${SUDDEN_HEAT.temperatureRise}℃以上上回り`);
    expect(logicMd).toContain(`最高気温が${SUDDEN_HEAT.minTargetMax}℃以上`);
    expect(logicMd).toContain(`過去データが${SUDDEN_HEAT.minBaselineDays}日分未満`);
    expect(llmsTxt).toContain(`強風（風速${WIND_CAUTION_SPEED}m/s以上）`);
    expect(openapiYaml).toContain(
      `直近${SUDDEN_HEAT.baselineDays}日の`,
    );
    expect(openapiYaml).toContain(`${SUDDEN_HEAT.temperatureRise}℃以上上回り`);
    expect(openapiYaml).toContain(`${SUDDEN_HEAT.minTargetMax}℃以上のときに付く`);
    expect(openapiYaml).toContain(`${WIND_CAUTION_SPEED}以上は気象庁の「やや強い風」に相当`);
    // app.jsの注意文の数値（フロントは定数を参照できないため文字列で検証する）
    expect(appJs).toContain(`より${SUDDEN_HEAT.temperatureRise}℃以上高い見込み`);
    // 凡例の強風マーク説明（index.html）
    expect(html).toContain(`風速${WIND_CAUTION_SPEED}m/s以上（気象庁の「やや強い風」以上）`);
    // READMEの機能説明の数値
    expect(readmeMd).toContain(`強風（${WIND_CAUTION_SPEED}m/s以上）`);
    expect(readmeMd).toContain(
      `直近${SUDDEN_HEAT.baselineDays}日の平均最高気温を${SUDDEN_HEAT.temperatureRise}℃以上上回り`,
    );
    expect(readmeMd).toContain(`${SUDDEN_HEAT.minTargetMax}℃以上の日`);
    // 部分欠測日の除外ルール（docs/logic.md）
    expect(logicMd).toContain(`1日あたり${SUDDEN_HEAT.minSamplesPerDay}時間分以上`);
  });

  it('about.htmlのAPI仕様に新フィールド（suddenHeat・maxWbgt・maxWindSpeed）が記載されている', () => {
    // docs/api.mdだけ更新されてaboutページが取り残されるのを防ぐ
    for (const field of ['suddenHeat', 'recentAverageMax', 'maxWbgt', 'maxWindSpeed']) {
      expect(aboutHtml).toContain(`<code>${field}</code>`);
    }
    expect(aboutHtml).toContain(
      `直近${SUDDEN_HEAT.baselineDays}日の平均最高気温を${SUDDEN_HEAT.temperatureRise}℃以上上回り`,
    );
    expect(aboutHtml).toContain(`${WIND_CAUTION_SPEED}以上は気象庁の「やや強い風」に相当`);
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

describe('会場表示モード（display.html・display.js）の同期', () => {
  it('NATIONAL_CITIESはapp.jsのCITIESと名前・座標・順序込みで一致する', () => {
    // 全国スライドの都市と地点セレクトのプリセットは同じ一覧を名乗るため、
    // 片側だけの追加・並び替えを検出する
    const appCities = [
      ...appJs.matchAll(/\{ name: '([^']+)', lat: ([\d.]+), lon: ([\d.]+) \}/g),
    ].map((m) => ({ name: m[1]!, lat: Number(m[2]), lon: Number(m[3]) }));
    expect(appCities.length).toBeGreaterThan(0);
    expect(NATIONAL_CITIES.map((c) => ({ name: c.name, lat: c.lat, lon: c.lon }))).toEqual(
      appCities,
    );
  });

  it('display.htmlのバージョンコメントはpackage.jsonのversionと一致する', () => {
    // 掲示ページのためフッターを持たない。保守用のHTMLコメントで同期する
    // （リリース時の更新対象。手順はdocs/release.mdを参照）
    expect(displayHtml).toContain(`バージョン: v${pkg.version}`);
  });

  it('GRADE_SYMBOLSの定義はapp.jsと完全一致する', () => {
    const symbolsOf = (source: string): string | undefined =>
      source.match(/const GRADE_SYMBOLS = (\[.*\]);/)?.[1];
    expect(symbolsOf(displayJs)).toBeDefined();
    expect(symbolsOf(displayJs)).toBe(symbolsOf(appJs));
    // wbgt-tool.jsも同じ判定記号を複製しているため併せて検証する
    expect(symbolsOf(wbgtTool)).toBe(symbolsOf(appJs));
  });

  it('天気コード→アイコンの対応規則はapp.jsと一致する', () => {
    // コメント・整形の違いを除いた判定行（if/return）で比較する
    const iconRules = (source: string): string[] =>
      (source.match(/function weatherIconName\(code\) \{([\s\S]*?)\n  \}/)?.[1] ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('if') || line.startsWith('return'));
    expect(iconRules(displayJs).length).toBeGreaterThan(0);
    expect(iconRules(displayJs)).toEqual(iconRules(appJs));
  });

  it('警戒アラートのしきい値はconstantsと一致する', () => {
    const match = displayJs.match(/const HEAT_STROKE_ALERT_WBGT = (\d+);/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(HEAT_STROKE_ALERT_WBGT);
    // 利用者向け警告文の数値も定数と同期する（表示文だけ取り残されるのを防ぐ）
    expect(displayJs).toContain(`（暑さ指数${HEAT_STROKE_ALERT_WBGT}以上）`);
    expect(displayMd).toContain(`暑さ指数${HEAT_STROKE_ALERT_WBGT}以上`);
  });

  it('docs/display.mdの更新間隔・鮮度・深夜リロードの数値はdisplay.jsと一致する', () => {
    const forecastPoll = displayJs.match(/const FORECAST_POLL_MS = (\d+) \* 60 \* 1000;/);
    const nationalPoll = displayJs.match(/const NATIONAL_POLL_MS = (\d+) \* 60 \* 1000;/);
    const stale = displayJs.match(/const STALE_WARNING_MS = (\d+) \* 60 \* 1000;/);
    const reloadHour = displayJs.match(/const NIGHTLY_RELOAD_HOUR = (\d+);/);
    expect(forecastPoll).not.toBeNull();
    expect(nationalPoll).not.toBeNull();
    expect(stale).not.toBeNull();
    expect(reloadHour).not.toBeNull();
    expect(displayMd).toContain(`約${forecastPoll![1]}分ごと`);
    expect(displayMd).toContain(`約${nationalPoll![1]}分ごと`);
    expect(displayMd).toContain(`${Number(stale![1]) / 60}時間以上`);
    expect(displayMd).toContain(`深夜${reloadHour![1]}時台`);
  });

  it('docs/display.mdのスライド表はSLIDES定義（名前・秒数・順序）と一致する', () => {
    const slides = [
      ...displayJs.matchAll(/\{ key: '[^']+', id: 'slide-[^']+', name: '([^']+)', seconds: (\d+),/g),
    ].map((m) => ({ name: m[1]!, seconds: Number(m[2]) }));
    expect(slides).toHaveLength(4);
    for (const slide of slides) {
      expect(displayMd).toMatch(new RegExp(`\\| ${slide.name} \\|[^|]*\\| ${slide.seconds}秒 \\|`));
    }
  });

  it('もしものときスライドの定義はdisplay.html・設定チェックボックス・docsと同期する', () => {
    // EMERGENCY_SLIDEは通常巡回（SLIDES・4枚検証）と別枠のため、個別に検証する
    const emergency = displayJs.match(
      /key: 'emergency',\s*\n\s*id: 'slide-emergency',\s*\n\s*name: '([^']+)',/,
    );
    expect(emergency).not.toBeNull();
    expect(displayHtml).toContain(`aria-label="${emergency![1]}"`);
    expect(displayHtml).toContain('id="slide-emergency"');
    expect(displayHtml).toContain('data-slide="emergency"');
    expect(displayMd).toContain('もしものとき');
    expect(displayMd).toContain('`emergency`');
  });

  it('公開仕様の「主要12都市」はNATIONAL_CITIESの件数と一致する', () => {
    for (const doc of [apiMd, openapiYaml, llmsTxt, displayMd]) {
      expect(doc).toContain(`主要${NATIONAL_CITIES.length}都市`);
    }
  });

  it('既定地点（東京）はNATIONAL_CITIESの座標と一致する', () => {
    const match = displayJs.match(
      /const DEFAULT_LOCATION = \{ name: '([^']+)', lat: ([\d.]+), lon: ([\d.]+) \};/,
    );
    expect(match).not.toBeNull();
    const tokyo = NATIONAL_CITIES.find((city) => city.name === '東京')!;
    expect(match![1]).toBe(tokyo.name);
    expect(Number(match![2])).toBe(tokyo.lat);
    expect(Number(match![3])).toBe(tokyo.lon);
  });

  it('スライド名はdisplay.htmlのセクションとaboutの説明に順序込みで現れる', () => {
    const names = [...displayJs.matchAll(/\{ key: '[^']+', id: 'slide-[^']+', name: '([^']+)'/g)].map(
      (m) => m[1]!,
    );
    expect(names).toHaveLength(4);
    for (const name of names) {
      expect(displayHtml).toContain(`aria-label="${name}"`);
    }
    // about.html・llms.txtの紹介文はスライド名を「・」区切りで列挙する
    expect(aboutHtml).toContain(names.join('・'));
    expect(llmsTxt).toContain(names.join('・'));
  });

  it('設定パネルのスライド選択チェックボックスはSLIDES定義（key・名前）と一致する', () => {
    const slides = [
      ...displayJs.matchAll(/\{ key: '([^']+)', id: 'slide-[^']+', name: '([^']+)'/g),
    ];
    expect(slides).toHaveLength(4);
    for (const [, key, name] of slides) {
      expect(displayHtml).toMatch(new RegExp(`data-slide="${key}" checked>${name}</label>`));
    }
  });
});
