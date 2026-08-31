// FursuitWeather 会場表示モード
// イベント会場のモニターへ常時掲示する自動表示ページ（display.html）。
// 予報を定期的に再取得しながら、4枚のスライドを自動で切り替える。
// 長時間稼働が前提のため、次の設計を守る:
// - タイマーは1秒ごとの単一tickで絶対時刻（期限）と比較する（バックグラウンドの
//   スロットリングで遅れても、表示復帰時のtickで即座に追いつく）
// - データ更新はin-flightガード+タイムアウト付きで、失敗しても前回データで表示を続ける
// - 鮮度はfetch時刻ではなくレスポンスのgeneratedAtを基準にし、古くなったら注意を出す
// - 深夜4時台に自動リロードし、デプロイ・メモリ・ズーム事故から毎日回復する

(() => {
  'use strict';

  /** 取得する予報日数（3日間スライドの日数） */
  const FORECAST_DAYS = 3;
  /** 「この後の予報」スライドに出す時間数 */
  const HOURS_AHEAD = 6;
  /** 地点予報の再取得間隔。APIのブラウザキャッシュ（10分）と空振りしないよう1分余裕を持たせる */
  const FORECAST_POLL_MS = 11 * 60 * 1000;
  /** 全国天気の再取得間隔（エッジキャッシュ30分に合わせる） */
  const NATIONAL_POLL_MS = 31 * 60 * 1000;
  /** 環境省の公式発表（/api/alert）の再取得間隔（エッジキャッシュ約30分に合わせる） */
  const ALERT_POLL_MS = 31 * 60 * 1000;
  /** 取得が失敗している間の再試行間隔 */
  const RETRY_MS = 60 * 1000;
  /** 予報がこれより古くなったら大きく注意を出す（回線断・上流障害の検知） */
  const STALE_WARNING_MS = 60 * 60 * 1000;
  /** 生成時刻がこれ以上「未来」にあるときは端末時計の遅れとみなして警告する */
  const CLOCK_BEHIND_WARNING_MS = 5 * 60 * 1000;
  /** 深夜の自動リロードを行う時（JST）。分は端末ごとにばらけさせる */
  const NIGHTLY_RELOAD_HOUR = 4;
  /** 焼き付き対策で表示全体を1pxずらす間隔 */
  const PIXEL_SHIFT_MS = 3 * 60 * 1000;
  /** 熱中症警戒アラートの発表基準となる暑さ指数（src/constants.tsと同期） */
  const HEAT_STROKE_ALERT_WBGT = 33;
  /** 日本時間の暦で読むためのオフセット（ミリ秒）。app.jsのJST_OFFSET_MSと同じ値 */
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  /** 地点未指定時の既定地点 */
  const DEFAULT_LOCATION = { name: '東京', lat: 35.6785, lon: 139.6823 };
  /** 全国スライドへ追加できる都市数の上限 */
  const EXTRA_CITY_LIMIT = 4;
  /** お知らせ文字列の上限（input側のmaxlengthと同じ値） */
  const MESSAGE_LIMIT = 100;
  /** 表示設定の保存キー。保存するのは表示の設定（スライド選択・全国の都市・
   * 追加都市・お知らせ）のみ。追加都市の座標は利用者が選んだ公開地点であり、
   * 表示地点や現在地の座標は保存しない */
  const SETTINGS_STORAGE_KEY = 'fursuitweather:display-settings';

  // ---- app.jsと共通の表示部品 ----
  // IIFE・ファイル分割なしの制約から複製している。変更するときはapp.js側と揃えること
  // （GRADE_SYMBOLSの形式はtest/htmlSync.test.tsが両ファイルの一致を検証する）

  /** 深刻度（grade）に対応する記号（テキストまたはSVGアイコン名の配列） */
  const GRADE_SYMBOLS = [['◎'], ['○'], ['△'], ['✕'], [{ icon: 'ban' }]];

  /** SVGスプライト（display.html内で定義）からアイコン要素を作る */
  function faIcon(name, extraClass) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', `fa-icon${extraClass ? ` ${extraClass}` : ''}`);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svgNs, 'use');
    use.setAttribute('href', `#fa-${name}`);
    svg.appendChild(use);
    return svg;
  }

  /** 記号設定（テキストと{icon}の混在配列）から表示要素群を作る */
  function renderSymbolParts(parts, container) {
    for (const part of parts) {
      if (typeof part === 'string') {
        container.appendChild(document.createTextNode(part));
      } else {
        container.appendChild(faIcon(part.icon));
      }
    }
  }

  /** WMO天気コードに対応するアイコン名 */
  function weatherIconName(code) {
    if (code === 0 || code === 1) return 'sun';
    if (code === 2) return 'cloud-sun';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'smog';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'cloud-rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowflake';
    if (code >= 95) return 'cloud-bolt';
    return 'circle-question';
  }

  /** 天気アイコン+ラベルの要素を作る */
  function weatherWithLabel(code, label) {
    const wrapper = document.createElement('span');
    wrapper.className = 'weather-line-content';
    const iconName = weatherIconName(code);
    wrapper.appendChild(faIcon(iconName, `weather-${iconName}`));
    wrapper.appendChild(document.createTextNode(` ${label}`));
    return wrapper;
  }

  /** 低温側の判定か（levelのcold接頭辞。types.tsのColdLevelIdの契約）
   * 判定規則の単一情報源。暑熱/低温の取り違えは安全に直結するため、
   * 個別のstartsWith複製は使わずここへ寄せる（levelの型崩れにも防御する。
   * public/app.jsの同名関数と同じ実装。ずれはtest/browserJsSync.test.tsが検出する） */
  function isColdLevel(levelSummary) {
    return String(levelSummary.level || '').startsWith('cold');
  }

  /** バッジ要素を作る（色+記号+文字の3要素。低温側は温度計アイコン+青系） */
  function createBadge(summary, large) {
    const badge = document.createElement('span');
    const isCold = isColdLevel(summary);
    badge.className = `badge grade-${summary.grade}${isCold ? ' cold' : ''}${large ? ' badge-large' : ''}`;
    const symbol = document.createElement('span');
    symbol.className = 'symbol';
    symbol.setAttribute('aria-hidden', 'true');
    const parts = (isCold ? [{ icon: 'temperature-low' }] : []).concat(
      GRADE_SYMBOLS[summary.grade] ?? ['?'],
    );
    renderSymbolParts(parts, symbol);
    badge.appendChild(symbol);
    badge.appendChild(document.createTextNode(summary.label));
    return badge;
  }

  /** 日本時間の現在日付（YYYY-MM-DD）・時・分を返す（端末のタイムゾーンに依存しない） */
  function nowInJst() {
    const jst = new Date(Date.now() + JST_OFFSET_MS);
    return {
      date: jst.toISOString().slice(0, 10),
      hour: jst.getUTCHours(),
      minute: jst.getUTCMinutes(),
    };
  }

  /** 時刻文字列（YYYY-MM-DDTHH:MM）から時の数値を取り出す */
  function hourNumberOf(time) {
    return Number.parseInt(time.slice(11, 13), 10);
  }

  // ---- DOM参照 ----
  const locationLabel = document.getElementById('display-location');
  const clockElement = document.getElementById('display-clock');
  const nowStrip = document.getElementById('display-now-strip');
  const alertsElement = document.getElementById('display-alerts');
  const mainElement = document.getElementById('display-main');
  const progressElement = document.getElementById('display-progress');
  const slideNameElement = document.getElementById('display-slide-name');
  const pauseButton = document.getElementById('display-pause');
  const nextButton = document.getElementById('display-next');
  const updatedElement = document.getElementById('display-updated');
  const tickerElement = document.getElementById('display-ticker');
  const tickerTrack = document.getElementById('display-ticker-track');
  const tickerSr = document.getElementById('display-ticker-sr');
  const settingsButton = document.getElementById('display-settings-button');
  const settingsOverlay = document.getElementById('display-settings');
  const settingsPanel = settingsOverlay.querySelector('.display-settings-panel');
  const settingsTitle = document.getElementById('display-settings-title');
  const settingsCityList = document.getElementById('settings-city-list');
  const settingsSearchInput = document.getElementById('settings-city-search');
  const settingsSearchButton = document.getElementById('settings-city-search-button');
  const settingsSearchResults = document.getElementById('settings-search-results');
  const settingsExtraList = document.getElementById('settings-extra-list');
  const settingsMessageInput = document.getElementById('settings-message');
  const settingsCopyButton = document.getElementById('settings-copy-url');
  const settingsResetButton = document.getElementById('settings-reset');
  const settingsCloseButton = document.getElementById('settings-close');
  const settingsStatus = document.getElementById('settings-status');

  // ---- URLパラメータ ----
  const params = new URLSearchParams(window.location.search);
  const demo = params.get('demo') === '1';
  // ?theme=light: 会場PCのOS設定がダークでも明色で掲示する（style.cssのダーク変数を無効化）
  if (params.get('theme') === 'light') {
    document.documentElement.dataset.theme = 'light';
  }

  /** URLの座標指定を解析する。プライバシー契約に合わせて小数2桁へ丸める */
  function parseLocationParams() {
    const lat = Number.parseFloat(params.get('lat') ?? '');
    const lon = Number.parseFloat(params.get('lon') ?? '');
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    ) {
      // URL由来の地点名から制御文字・書式文字を除去する（改行による表示崩れ、
      // U+202E等の双方向制御文字による名前偽装への対策。掲示用のため
      // ZWJ絵文字合成が崩れる副作用は許容する。除去規則はsanitizeTextに単一化）
      const urlName = sanitizeText(params.get('name') ?? '').slice(0, 80);
      return {
        name: urlName || '指定地点',
        // URLへ書き戻す名前（サニタイズ済み。空なら書かない）。「指定地点」の
        // 補完表示をURLへ流さないよう画面用のnameと分ける
        urlName,
        lat: Math.round(lat * 100) / 100,
        lon: Math.round(lon * 100) / 100,
        specified: true,
      };
    }
    return { ...DEFAULT_LOCATION, urlName: '', specified: false };
  }
  const place = parseLocationParams();

  // ---- スライド定義（描画関数は後方で定義。スライド表示の直前に毎回最新データで描き直す） ----
  const SLIDES = [
    { key: 'now', id: 'slide-now', name: 'いまの判定', seconds: 15, render: renderNowSlide },
    { key: 'hours', id: 'slide-hours', name: 'この後の予報', seconds: 20, render: renderHoursSlide },
    { key: 'days', id: 'slide-days', name: '3日間の天気', seconds: 15, render: renderDaysSlide },
    { key: 'national', id: 'slide-national', name: '全国の天気', seconds: 20, render: renderNationalSlide },
  ];
  // もしものとき（熱中症の応急対応）スライド。通常の巡回（SLIDES）とは別枠で、
  // 設定でONにしたとき、または現在の屋外判定が厳重警戒以上のときだけ末尾へ加わる
  const EMERGENCY_SLIDE = {
    key: 'emergency',
    id: 'slide-emergency',
    name: 'もしものとき',
    seconds: 20,
    render: renderEmergencySlide,
  };
  /** 全スライド定義（hidden切り替えの走査用。表示対象の選別はactiveSlides） */
  const ALL_SLIDES = SLIDES.concat(EMERGENCY_SLIDE);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  // ---- 表示の設定（スライドの選択・全国の都市・お知らせ） ----
  // 優先順: URLの設定パラメータ（1つでもあればURLを採用）→ この端末の保存分 → 既定。
  // 設定パネルでの変更は保存とURL反映（history.replaceState）の両方を行うため、
  // URLをコピーすればどの端末でも同じ表示を再現できる

  /** 制御文字・書式文字を除いた表示用テキストにする（nameパラメータと同じ対策） */
  function sanitizeText(text) {
    return String(text).replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  }

  /** 追加都市1件の形を検証して正規化する。不正はnull */
  function normalizeExtra(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    const name = sanitizeText(raw.name ?? '').slice(0, 40);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !name) {
      return null;
    }
    return { name, lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
  }

  /** 設定の形を検証して正規化する（URL・localStorageのどちら由来にも使う） */
  function normalizeSettings(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const slides = Array.isArray(raw.slides)
      ? SLIDES.map((slide) => slide.key).filter((key) => raw.slides.includes(key))
      : [];
    const cities = Array.isArray(raw.cities)
      ? raw.cities.map((city) => sanitizeText(city).slice(0, 40)).filter(Boolean).slice(0, 50)
      : null;
    const extras = Array.isArray(raw.extras)
      ? raw.extras.map(normalizeExtra).filter(Boolean).slice(0, EXTRA_CITY_LIMIT)
      : [];
    return {
      // すべて外した保存値・URLは「全スライド表示」として扱う（真っ黒な画面を作らない）
      slides: slides.length > 0 ? slides : SLIDES.map((slide) => slide.key),
      // もしものときスライドは通常巡回と別のON/OFF（URLではslides内のキーとして運ぶ）
      emergency:
        raw.emergency === true ||
        (Array.isArray(raw.slides) && raw.slides.includes(EMERGENCY_SLIDE.key)),
      cities,
      extras,
      message: typeof raw.message === 'string' ? sanitizeText(raw.message).slice(0, MESSAGE_LIMIT) : '',
    };
  }

  /** URLの設定パラメータを読む。設定系が1つもなければnull */
  function parseSettingsFromUrl() {
    if (!params.has('slides') && !params.has('cities') && !params.has('add') && !params.has('msg')) {
      return null;
    }
    return normalizeSettings({
      slides: (params.get('slides') ?? '').split(','),
      cities: params.has('cities')
        ? (params.get('cities') ?? '').split(',').filter((city) => city !== '')
        : null,
      extras: params.getAll('add').map((value) => {
        const [lat, lon, ...nameParts] = value.split(',');
        return { lat, lon, name: nameParts.join(',') };
      }),
      message: params.get('msg') ?? '',
    });
  }

  /** この端末に保存した設定を読む（壊れた保存値・保存不可の環境はnull） */
  function readStoredSettings() {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? ''));
    } catch {
      return null;
    }
  }

  /** 設定をこの端末へ保存する（プライベートモード等で保存できなくても表示は続ける） */
  function writeStoredSettings() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 保存できない環境ではURL反映だけが設定の持ち回り手段になる
    }
  }

  /** 表示設定の既定値（起動時フォールバックとリセットの単一情報源。
   * 設定項目を増やすときはここへ足せば両方に効く） */
  function defaultSettings() {
    return {
      slides: SLIDES.map((slide) => slide.key),
      emergency: false,
      cities: null,
      extras: [],
      message: '',
    };
  }

  const settings = parseSettingsFromUrl() ?? readStoredSettings() ?? defaultSettings();

  /** もしものときスライドを表示するか（設定ON、または現在判定が厳重警戒以上）。
   * 低温側の危険（coldDanger）はgradeが同値でも熱中症の手順ではないため自動表示しない */
  function emergencySlideActive() {
    if (settings.emergency) {
      return true;
    }
    const target = currentHourTarget();
    return Boolean(target) && target.outdoor.grade >= 3 && !isColdLevel(target.outdoor);
  }

  /** 表示対象のスライド（設定で絞り込んだもの。空にはならない） */
  function activeSlides() {
    const active = SLIDES.filter((slide) => settings.slides.includes(slide.key));
    const base = active.length > 0 ? active : SLIDES;
    // 設定OFFでも厳重警戒以上の間は自動で加える（応急対応の手順を探させない）
    return emergencySlideActive() ? base.concat(EMERGENCY_SLIDE) : base;
  }

  /** 設定をURLへ反映する（地点・デモ・テーマの既存パラメータは維持する） */
  function updateSettingsUrl() {
    const query = new URLSearchParams();
    // 座標・名前は受信URLの生値ではなく正規化済みの値を書き戻す
    // （「URLに現れる座標はすべて小数2桁」の契約。高精度座標入りのURLで
    //  開かれても、以後のURL・コピーされるURLは丸めた値になる）
    if (place.specified) {
      query.set('lat', place.lat.toFixed(2));
      query.set('lon', place.lon.toFixed(2));
      if (place.urlName) {
        query.set('name', place.urlName);
      }
    }
    for (const key of ['demo', 'theme']) {
      const value = params.get(key);
      if (value !== null) {
        query.set(key, value);
      }
    }
    if (settings.slides.length < SLIDES.length || settings.emergency) {
      query.set(
        'slides',
        settings.slides.concat(settings.emergency ? [EMERGENCY_SLIDE.key] : []).join(','),
      );
    }
    if (settings.cities !== null) {
      query.set('cities', settings.cities.join(','));
    }
    for (const extra of settings.extras) {
      query.append('add', `${extra.lat},${extra.lon},${extra.name}`);
    }
    if (settings.message) {
      query.set('msg', settings.message);
    }
    const text = query.toString();
    window.history.replaceState(null, '', text ? `?${text}` : window.location.pathname);
  }

  // ---- 可変状態 ----
  let forecast = null;
  /** 予報の生成時刻（ms）。鮮度表示・警告の基準 */
  let forecastTime = 0;
  /** 表示中の予報がService Workerの保存分（オフライン応答）かどうか */
  let forecastFromCache = false;
  let national = null;
  /** 設定で追加した都市の当日サマリー（全国スライドの末尾に並べる） */
  let extraSummaries = [];
  /** 追加都市取得の世代番号（遅れて解決した古い取得が新しい設定を上書きしないため。
   * app.jsのrequestSeqと同じ「最後の明示操作が勝つ」方式） */
  let extrasSeq = 0;
  /** 表示中のスライドのkey（設定でスライド構成が変わってもkeyで追跡する） */
  let currentKey = 'now';
  /** 次の自動送り時刻（絶対時刻ms）。tickが期限と比較する */
  let slideDeadline = 0;
  let paused = false;
  let fadeTimer = null;
  let refreshingForecast = false;
  let refreshingNational = false;
  let refreshingAlert = false;
  let nextForecastAt = 0;
  let nextNationalAt = 0;
  let nextAlertAt = 0;
  /** 環境省の公式発表（/api/alertの突合結果）。nullは非表示（未取得・発表なし・取得失敗） */
  let officialAlert = null;
  let lastJstDate = nowInJst().date;
  /** 共通表示を最後に描画したJSTの分（時間境界・鮮度警告の毎分再評価用） */
  let lastSharedMinute = nowInJst().minute;
  /** スライド本体を最後に描画した「いま」の時間行（時間帯境界の検出用） */
  let lastHourTargetTime = null;
  /** 深夜リロードの分（端末ごとにばらけさせ、全端末同時のアクセス集中を避ける） */
  const reloadMinute = Math.floor(Math.random() * 60);
  const startedAt = Date.now();
  let pixelShiftIndex = 0;
  let nextPixelShiftAt = Date.now() + PIXEL_SHIFT_MS;

  // ---- データ取得 ----

  /**
   * JSONを取得する。失敗（HTTPエラー・タイムアウト・JSONでない応答）はnullを返す。
   * 会場Wi-Fiのキャプティブポータルがログイン画面のHTMLを200で返す
   * 「成功に見える失敗」もここでJSON解析に失敗してnullに落ちる
   */
  async function fetchJson(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, ...init });
      if (!response.ok) {
        return null;
      }
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') {
        return null;
      }
      return { data, fromCache: response.headers.get('X-Served-From-Cache') === '1' };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 地点予報を再取得する。失敗時は前回データを保持して表示を続ける
   * @param bypassCache 日付跨ぎ直後など、ブラウザキャッシュ（10分）の
   *   前日データを避けたいときにtrue（URLは変えないためSWキャッシュのキーは安定する） */
  async function refreshForecast(bypassCache) {
    if (refreshingForecast) {
      return;
    }
    refreshingForecast = true;
    try {
      const url = demo
        ? '/api/forecast?demo=1'
        : `/api/forecast?lat=${place.lat}&lon=${place.lon}&days=${FORECAST_DAYS}`;
      const result = await fetchJson(url, bypassCache ? { cache: 'no-cache' } : undefined);
      const ok = Boolean(
        result && Array.isArray(result.data.hours) && Array.isArray(result.data.days),
      );
      if (ok) {
        forecast = result.data;
        forecastTime = Date.parse(forecast.generatedAt) || Date.now();
        forecastFromCache = result.fromCache;
      }
      // 失敗している間は短い間隔で再試行する（成功したら通常間隔へ戻る）
      nextForecastAt = Date.now() + (ok ? FORECAST_POLL_MS : RETRY_MS);
      renderShared();
      renderCurrentSlide();
    } finally {
      refreshingForecast = false;
    }
  }

  /** 全国天気を再取得する。失敗時は前回データを保持する */
  async function refreshNational() {
    if (refreshingNational) {
      return;
    }
    refreshingNational = true;
    try {
      const result = await fetchJson(demo ? '/api/national?demo=1' : '/api/national');
      const ok = Boolean(
        result && Array.isArray(result.data.cities) && result.data.cities.length > 0,
      );
      if (ok) {
        national = result.data;
      }
      nextNationalAt = Date.now() + (ok ? NATIONAL_POLL_MS : RETRY_MS);
      await refreshExtras();
      if (ok && settingsOpen) {
        // パネルを開いたまま全国データが届いたら、都市の選択肢を差し込む
        renderSettingsCityList();
      }
      if (currentSlide().key === 'national') {
        renderCurrentSlide();
      }
    } finally {
      refreshingNational = false;
    }
  }

  /** 環境省の公式発表（/api/alertの突合結果）を再取得する。
   * ベストエフォート: 取得失敗・発表なし・提供期間外は非表示のまま、本体の表示を巻き込まない */
  async function refreshAlert() {
    if (refreshingAlert) {
      return;
    }
    refreshingAlert = true;
    try {
      const url = demo ? '/api/alert?demo=1' : `/api/alert?lat=${place.lat}&lon=${place.lon}`;
      const result = await fetchJson(url);
      if (result) {
        officialAlert =
          result.data.alert && typeof result.data.alert.prefectureName === 'string'
            ? result.data.alert
            : null;
      }
      // 取得に失敗した間は前回の発表を保持する（安全側の情報のため消さない）。
      // ただし対象日を過ぎた発表は表示し続けない（終夜運転の日付またぎ対策）
      if (officialAlert && officialAlert.targetDate !== nowInJst().date) {
        officialAlert = null;
      }
      nextAlertAt = Date.now() + (result ? ALERT_POLL_MS : RETRY_MS);
      renderShared();
    } finally {
      refreshingAlert = false;
    }
  }

  /** 設定で追加した都市の当日サマリーを取得する（都市単位のベストエフォート。
   * /api/forecastの日別サマリーを全国スライドと同じ形に整える） */
  async function refreshExtras() {
    const seq = ++extrasSeq;
    const results = await Promise.all(
      settings.extras.map(async (extra) => {
        const url = demo
          ? '/api/forecast?demo=1'
          : `/api/forecast?lat=${extra.lat}&lon=${extra.lon}&days=1`;
        const result = await fetchJson(url);
        const day = result?.data?.days?.[0];
        if (!day || !day.outdoorWorst) {
          return null;
        }
        return {
          name: extra.name,
          weatherCode: day.weatherCode,
          weatherLabel: day.weatherLabel,
          temperatureMax: day.temperatureMax,
          outdoorWorst: day.outdoorWorst,
        };
      }),
    );
    if (seq !== extrasSeq) {
      // この取得より後に設定が変わっている（古い結果は捨てる）
      return;
    }
    // 一時的な取得失敗（会場Wi-Fiの不調など）の都市は前回のサマリーを引き継ぐ。
    // 他の取得系（地点予報・全国・公式発表）と同じ「失敗時は前回データを保持」の
    // 方針で、次のポーリングまで約31分スライドから黙って消えるのを防ぐ
    extraSummaries = results.map((result, index) => {
      if (result) {
        return result;
      }
      const extra = settings.extras[index];
      return extraSummaries.find((summary) => summary.name === extra.name) ?? null;
    }).filter(Boolean);
  }

  /** 追加都市の変更後の共通後処理: サマリーを取り直し、全国スライド表示中なら
   * 即時反映する（削除・追加の両ハンドラーが同じ後処理を共有する） */
  function refreshExtrasAndRerender() {
    refreshExtras().then(() => {
      if (currentSlide().key === 'national') {
        renderCurrentSlide();
      }
    });
  }

  // ---- 共通表示（常時帯・警告・更新時刻・時計） ----

  /** スライド内の案内文（読み込み中・取得失敗）を作る */
  function slideNote(text) {
    const note = document.createElement('p');
    note.className = 'display-slide-note';
    note.textContent = text;
    return note;
  }

  /** 現在時刻の時間行を返す。現在時刻のデータがなければ当日の直近未来で代替する
   * （app.jsのrenderNowCardと同じ選び方） */
  function currentHourTarget() {
    if (!forecast) {
      return null;
    }
    const now = nowInJst();
    const todayHours = forecast.hours.filter((h) => h.time.startsWith(now.date));
    return (
      todayHours.find((h) => hourNumberOf(h.time) === now.hour) ??
      todayHours.find((h) => hourNumberOf(h.time) > now.hour) ??
      null
    );
  }

  /** 常時表示帯（現在の判定）を更新する */
  function updateNowStrip() {
    const target = currentHourTarget();
    if (!target) {
      nowStrip.replaceChildren(
        slideNote(forecast ? '本日のこれからの時間帯の予報データがありません。' : '予報を読み込んでいます…'),
      );
      return;
    }
    const minutes = document.createElement('span');
    minutes.className = 'display-now-minutes';
    minutes.textContent =
      target.outdoor.activityMinutes > 0
        ? `連続${target.outdoor.activityMinutes}分まで`
        : '着用中止';
    nowStrip.replaceChildren(createBadge(target.outdoor, true), minutes);
  }

  /** 警告帯の1行を作る */
  /** スクリーンリーダー専用テキストのspanを組み立てる（app.jsのsrOnlySpanの複製部品） */
  function srOnlySpan(text) {
    const span = document.createElement('span');
    span.className = 'sr-only';
    span.textContent = text;
    return span;
  }

  /** 読み上げから除外する視覚専用spanを組み立てる（app.jsのhiddenSpanの複製部品） */
  function hiddenSpan(text) {
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.textContent = text;
    return span;
  }

  /** 読みを補正する語句（app.jsのYOMI_PATTERNの複製部品）。
   * 「着ぐるみ」は「ちゃくぐるみ」、曜日「（水）」は「みず」と誤読されるため */
  const YOMI_PATTERN = /着ぐるみ|（[日月火水木金土]）/gu;

  /** 視覚表記に対する読み上げ用テキストを返す（app.jsのyomiOfの複製部品） */
  function yomiOf(visible) {
    if (visible === '着ぐるみ') {
      return 'きぐるみ';
    }
    return `（${visible.slice(1, 2)}曜日）`;
  }

  /** 読み補正付きでテキストのフラグメントを組み立てる
   * （app.jsのyomiTextの複製部品。視覚は元の表記のまま読み上げだけを分離する） */
  function yomiText(text) {
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(YOMI_PATTERN)) {
      fragment.append(
        text.slice(last, match.index),
        hiddenSpan(match[0]),
        srOnlySpan(yomiOf(match[0])),
      );
      last = match.index + match[0].length;
    }
    fragment.append(text.slice(last));
    return fragment;
  }

  function alertRow(text, heat) {
    const row = document.createElement('p');
    row.className = `display-alert${heat ? ' display-alert-heat' : ''}`;
    row.appendChild(faIcon('triangle-exclamation'));
    row.appendChild(yomiText(text));
    return row;
  }

  /** 時刻（ms）を日本時間のHH:MM表記にする（前日以前は「M/D HH:MM」で日付も示す） */
  function jstClockText(ms) {
    const jst = new Date(ms + JST_OFFSET_MS);
    const time = `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
    if (jst.toISOString().slice(0, 10) === nowInJst().date) {
      return time;
    }
    return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${time}`;
  }

  /** 最後に描画した警告帯の内容（同一内容の再描画を避けるためのキー） */
  let lastAlertsKey = '';

  /** 警告帯（地点未指定・鮮度・時計ずれ・警戒アラート・オフライン表示）を更新する */
  function updateAlerts() {
    const rows = [];
    // 環境省の公式発表（突合結果。表示地点の最寄りの都道府県）は最優先で先頭に出す。
    // 会場のモニターは遠くから読むため文は短く保つ（詳細はdocs/display.md）
    if (officialAlert) {
      const label = officialAlert.special ? '熱中症特別警戒アラート' : '熱中症警戒アラート';
      const advice = officialAlert.special
        ? '着ぐるみの着用は中止してください。'
        : '休憩と水分・塩分補給を最優先してください。';
      rows.push(
        alertRow(`環境省発表: ${officialAlert.prefectureName}に${label}。${advice}`, true),
      );
    }
    // 警戒アラート相当は安全に直結するため先頭で表示し続ける
    // （公式発表の帯が出ている間は推定の重ね掛けをせず、帯の積み上げで本体を潰さない）
    if (
      !officialAlert &&
      forecast &&
      forecast.days[0] &&
      forecast.days[0].maxWbgt >= HEAT_STROKE_ALERT_WBGT
    ) {
      rows.push(
        alertRow(
          '熱中症警戒アラートの基準（暑さ指数33以上）に相当する予測です。環境省の発表そのものではありません。着ぐるみの着用は最小限にしてください。',
          true,
        ),
      );
    }
    if (!place.specified && !demo) {
      rows.push(alertRow('地点が指定されていません（東京を表示中）。会場のURLをご確認ください。'));
    }
    if (forecastTime > 0) {
      const age = Date.now() - forecastTime;
      if (age > STALE_WARNING_MS) {
        rows.push(
          alertRow(
            `この表示は${jstClockText(forecastTime)}時点の情報です。最新の予報を取得できていません。`,
          ),
        );
      }
      if (forecastTime - Date.now() > CLOCK_BEHIND_WARNING_MS) {
        rows.push(
          alertRow('モニター端末の時計がずれている可能性があります。端末の時刻設定をご確認ください。'),
        );
      }
    }
    if (forecastFromCache) {
      rows.push(alertRow('通信できないため、保存済みの予報を表示しています。'));
    }
    // 内容が変わらない限り警告帯のDOMを差し替えない（スクリーンリーダーの読み上げ
    // 位置の喪失と、毎分の無駄な再構築を防ぐ。鮮度警告は文中の時刻が変われば
    // キーも変わり再描画される）
    const key = rows.map((row) => `${row.className}|${row.textContent}`).join('\n');
    if (key === lastAlertsKey) {
      return;
    }
    lastAlertsKey = key;
    alertsElement.replaceChildren(...rows);
  }

  /** 更新時刻表示（予報の生成時刻ベース。fetch時刻ではなくデータの実年齢を示す） */
  function updateUpdatedLabel() {
    updatedElement.textContent =
      forecastTime > 0 ? `${jstClockText(forecastTime)}時点` : '--:--時点';
  }

  /** ヘッダーの時計を更新する */
  function updateClock() {
    const now = nowInJst();
    clockElement.textContent = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;
  }

  /** 常時表示の共通部分（帯・警告・更新時刻）をまとめて更新する */
  function renderShared() {
    updateNowStrip();
    updateAlerts();
    updateUpdatedLabel();
  }

  // ---- スライドの描画 ----

  /** ①いまの判定 */
  function renderNowSlide(container) {
    const target = currentHourTarget();
    if (!target) {
      container.replaceChildren(
        slideNote(forecast ? '本日のこれからの時間帯の予報データがありません。' : '予報を読み込んでいます…'),
      );
      return;
    }
    const now = nowInJst();
    const hourNumber = hourNumberOf(target.time);

    const timeLine = document.createElement('p');
    timeLine.className = 'now-time';
    timeLine.appendChild(
      document.createTextNode(
        `${hourNumber === now.hour ? `${hourNumber}時` : `本日${hourNumber}時（直近の時間帯）`}・`,
      ),
    );
    timeLine.appendChild(weatherWithLabel(target.weather.weatherCode, target.weatherLabel));
    timeLine.appendChild(document.createTextNode(`・${target.weather.temperature.toFixed(1)}℃`));

    const badge = createBadge(target.outdoor, true);

    const minutes = document.createElement('p');
    minutes.className = 'now-minutes';
    minutes.textContent =
      target.outdoor.activityMinutes > 0
        ? `連続${target.outdoor.activityMinutes}分まで`
        : '着用中止';

    const advice = document.createElement('p');
    advice.className = 'now-advice';
    advice.appendChild(yomiText(target.outdoor.advice));

    // 表示値は着ぐるみ着衣補正後であることを明示する（会場据付のWBGT計との食い違い防止）
    const wbgtNote = document.createElement('p');
    wbgtNote.className = 'display-wbgt-note';
    wbgtNote.appendChild(
      yomiText(`暑さ指数（WBGT）${target.outdoor.wbgt}℃・着ぐるみ補正後${target.outdoor.suitWbgt}℃（推定値）`),
    );

    container.replaceChildren(timeLine, badge, minutes, advice, wbgtNote);
  }

  /** ②この後の予報（現在時刻から6時間分。日をまたいでもよい） */
  function renderHoursSlide(container) {
    const target = currentHourTarget();
    if (!forecast || !target) {
      container.replaceChildren(slideNote('予報を読み込んでいます…'));
      return;
    }
    const startIndex = forecast.hours.findIndex((h) => h.time === target.time);
    const upcoming = forecast.hours.slice(startIndex, startIndex + HOURS_AHEAD);
    const today = nowInJst().date;

    const cells = upcoming.map((hour) => {
      const cell = document.createElement('div');
      cell.className = 'display-hour-cell';

      const time = document.createElement('span');
      time.className = 'display-hour-time';
      const hourNumber = hourNumberOf(hour.time);
      time.textContent = hour.time.startsWith(today) ? `${hourNumber}時` : `翌${hourNumber}時`;

      const weather = document.createElement('span');
      weather.className = 'display-cell-weather';
      weather.appendChild(weatherWithLabel(hour.weather.weatherCode, hour.weatherLabel));

      const temp = document.createElement('span');
      temp.className = 'display-cell-temp';
      temp.textContent = `${hour.weather.temperature.toFixed(0)}℃`;

      cell.replaceChildren(time, weather, temp, createBadge(hour.outdoor));
      return cell;
    });
    container.replaceChildren(...cells);
  }

  /** 日付（YYYY-MM-DD）を「今日 8/19（水）」の形にする。相対ラベルは配列位置では
   * なくJST今日との日付差で決める（キャッシュや取得障害でデータが古いまま日付を
   * 跨いだとき、昨日の行を「今日」と誤表示しないため）。
   * 掲示は幅が限られるため視覚は短い「8/19（水）」のまま、読み上げだけ
   * 「8月19日（水曜日）」へ分離する（「/」と単漢字曜日はどちらも誤読される） */
  function formatDayLabel(dateText) {
    const dayDiff = Math.round(
      (Date.parse(`${dateText}T00:00:00Z`) - Date.parse(`${nowInJst().date}T00:00:00Z`)) / 86400000,
    );
    const relative = ['今日', '明日', '明後日'][dayDiff] ?? '';
    const weekday = ['日', '月', '火', '水', '木', '金', '土'][
      new Date(`${dateText}T00:00:00Z`).getUTCDay()
    ];
    const month = Number.parseInt(dateText.slice(5, 7), 10);
    const day = Number.parseInt(dateText.slice(8, 10), 10);
    const fragment = document.createDocumentFragment();
    if (relative) {
      fragment.append(`${relative} `);
    }
    fragment.append(
      hiddenSpan(`${month}/${day}（${weekday}）`),
      srOnlySpan(`${month}月${day}日（${weekday}曜日）`),
    );
    return fragment;
  }

  /** ③3日間の天気 */
  function renderDaysSlide(container) {
    if (!forecast) {
      container.replaceChildren(slideNote('予報を読み込んでいます…'));
      return;
    }
    const cells = forecast.days.slice(0, FORECAST_DAYS).map((day) => {
      const cell = document.createElement('div');
      cell.className = 'display-day-cell';

      const date = document.createElement('p');
      date.className = 'display-day-date';
      date.replaceChildren(formatDayLabel(day.date));

      const weather = document.createElement('span');
      weather.className = 'display-cell-weather';
      weather.appendChild(weatherWithLabel(day.weatherCode, day.weatherLabel));

      const temp = document.createElement('span');
      temp.className = 'display-cell-temp';
      // 「／」は「スラッシュ」と読まれるため、区切りは「・」を使う（読み上げ対応）
      temp.textContent = `最高${day.temperatureMax.toFixed(0)}℃・最低${day.temperatureMin.toFixed(0)}℃`;

      const laundry = document.createElement('span');
      laundry.className = 'display-day-laundry';
      laundry.textContent = `洗濯: ${day.laundry.label}`;

      cell.replaceChildren(date, weather, temp, createBadge(day.outdoorWorst, true), laundry);
      return cell;
    });
    container.replaceChildren(...cells);
  }

  /** ④全国の天気（設定で選んだ都市+追加都市。列数は都市数に合わせる） */
  function renderNationalSlide(container) {
    if (!national) {
      container.replaceChildren(slideNote('全国の天気を読み込んでいます…'));
      return;
    }
    const selected = national.cities
      .filter((city) => settings.cities === null || settings.cities.includes(city.name))
      .concat(extraSummaries);
    if (selected.length === 0) {
      container.className = 'display-national-grid';
      container.replaceChildren(
        slideNote('表示する都市が選ばれていません。「設定」から都市を選んでください。'),
      );
      return;
    }
    // 少ない都市数では列を減らして1セルを大きく表示する（縦画面はCSS側で上書き）。
    // 13セル以上は1セルが低くなりすぎるため、CSS側で文字サイズを1段階下げる
    const cols = selected.length <= 4 ? 2 : selected.length <= 9 ? 3 : 4;
    const compact = selected.length > 12 ? ' display-grid-compact' : '';
    container.className = `display-national-grid display-grid-cols-${cols}${compact}`;
    const cells = selected.map((city) => {
      const cell = document.createElement('div');
      cell.className = 'display-city-cell';

      const name = document.createElement('span');
      name.className = 'display-city-name';
      name.textContent = city.name;

      const weather = document.createElement('span');
      weather.className = 'display-cell-weather';
      weather.appendChild(weatherWithLabel(city.weatherCode, city.weatherLabel));

      const temp = document.createElement('span');
      temp.className = 'display-cell-temp';
      temp.textContent = `最高${city.temperatureMax.toFixed(0)}℃`;

      cell.replaceChildren(name, weather, temp, createBadge(city.outdoorWorst));
      return cell;
    });
    container.replaceChildren(...cells);
  }

  /** ⑤もしものとき（熱中症の応急対応の要点。設定ON時と厳重警戒以上のときに表示） */
  function renderEmergencySlide(container) {
    // 内容は静的（データ不要）。文言は/emergencyページの手順の要約と同期させる
    const steps = [
      ['意識を確認', '反応がない・おかしいときは、ためらわず119番通報'],
      ['着ぐるみから出す', 'ヘッド → ハンド → ジッパーの順で脱がせる'],
      ['涼しい場所へ', '冷房の効いた室内か、風通しのよい日陰へ'],
      ['体を冷やす', '首・脇の下・足の付け根を冷却。水をかけてあおぐ'],
      ['水分・塩分', '意識がはっきりして自力で飲めるときだけ少しずつ'],
    ];
    const list = document.createElement('ol');
    list.className = 'display-emergency-steps';
    steps.forEach(([title, detail], index) => {
      const item = document.createElement('li');
      // 番号はCSSカウンターではなくDOMに置き、読み上げにも順序が伝わるようにする
      const number = document.createElement('span');
      number.className = 'display-emergency-number';
      number.textContent = String(index + 1);
      const heading = document.createElement('span');
      heading.className = 'display-emergency-title';
      heading.appendChild(yomiText(title));
      const note = document.createElement('span');
      note.className = 'display-emergency-detail';
      // 「→」は「右矢印」と読まれ手順の流れが伝わらないため、読みは読点に分ける
      // （emergency.htmlの手順見出しと同じ方針。視覚の文言は同期を保つ）
      detail.split(' → ').forEach((step, stepIndex) => {
        if (stepIndex > 0) {
          note.append(hiddenSpan(' → '), srOnlySpan('、'));
        }
        note.append(step);
      });
      item.replaceChildren(number, heading, note);
      list.appendChild(item);
    });
    const link = document.createElement('p');
    link.className = 'display-emergency-link';
    link.textContent = '詳しい手順: fursuit-weather.223n.tech/emergency';
    container.replaceChildren(list, link);
  }

  /** スライドの中身のコンテナ（h2の次の要素）を返す */
  function slideContainer(slide) {
    return document.getElementById(slide.id).querySelector('h2 + *');
  }

  /** 表示中のスライド定義を返す（設定変更で非表示になっていたら先頭へ寄せる） */
  function currentSlide() {
    const slides = activeSlides();
    return slides.find((slide) => slide.key === currentKey) ?? slides[0];
  }

  /** 現在のスライドを最新データで描き直す */
  function renderCurrentSlide() {
    const slide = currentSlide();
    slide.render(slideContainer(slide));
  }

  // ---- スライドショー制御 ----

  /** 進行ドットとスライド名を更新する（表示対象のスライドだけをドットにする） */
  function updateProgress() {
    const slides = activeSlides();
    const dots = slides.map((slide) => {
      const dot = document.createElement('span');
      dot.className = `display-dot${slide.key === currentKey ? ' current' : ''}`;
      return dot;
    });
    progressElement.replaceChildren(...dots);
    slideNameElement.textContent = currentSlide().name;
  }

  /**
   * スライドを切り替える。自動送りはフェード（0.5秒で消える→現れる）、
   * 手動送り・reduced-motionは即時切り替え。
   * hiddenの付け替えで支援技術上は常に1枚だけ存在させる
   */
  function showSlide(key, immediate) {
    const previous = currentSlide();
    const slides = activeSlides();
    const next = slides.find((slide) => slide.key === key) ?? slides[0];
    currentKey = next.key;
    slideDeadline = Date.now() + next.seconds * 1000;

    // 表示の直前に最新データで描き直す（表示中のスライドは描き換えない方針）
    next.render(slideContainer(next));
    updateProgress();

    const previousElement = document.getElementById(previous.id);
    const nextElement = document.getElementById(next.id);
    if (fadeTimer !== null) {
      // フェード進行中の手動送りは前回の切り替えを即時確定してから進める
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
    for (const slide of ALL_SLIDES) {
      const element = document.getElementById(slide.id);
      if (element !== previousElement && element !== nextElement) {
        element.hidden = true;
        element.classList.remove('fading');
      }
    }
    if (previousElement === nextElement) {
      nextElement.hidden = false;
      nextElement.classList.remove('fading');
      return;
    }
    if (immediate || reducedMotion) {
      previousElement.hidden = true;
      previousElement.classList.remove('fading');
      nextElement.classList.remove('fading');
      nextElement.hidden = false;
      return;
    }
    previousElement.classList.add('fading');
    fadeTimer = setTimeout(() => {
      fadeTimer = null;
      previousElement.hidden = true;
      previousElement.classList.remove('fading');
      // 透明の状態で表示してからクラスを外し、フェードインさせる
      nextElement.classList.add('fading');
      nextElement.hidden = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          nextElement.classList.remove('fading');
        });
      });
    }, 520);
  }

  /** 次（または前）のスライドへ送る */
  function advance(step, manual) {
    const slides = activeSlides();
    const index = slides.findIndex((slide) => slide.key === currentSlide().key);
    showSlide(slides[(index + step + slides.length) % slides.length].key, manual);
  }

  /** スライド領域内にキーボードフォーカスがある間は自動送りを止める（WCAG 2.2.2） */
  function focusWithinSlides() {
    return mainElement.contains(document.activeElement);
  }

  // ---- お知らせ帯（ループスクロール） ----

  /** お知らせの流れる速さ（px/秒）。文字数に依らず一定の読みやすい速度にする */
  const TICKER_SPEED_PX_PER_SECOND = 90;

  /** 進行中のループアニメーション（Web Animations API）。停止中・非対応環境はnull */
  let tickerAnimation = null;

  /**
   * お知らせ帯を設定に合わせて表示・更新する
   *
   * 文字数に関係なく途切れず流れ続けるよう、テキストを「画面幅を埋めるのに
   * 必要な数×2グループ」複製し、トラック半分（1グループ分）の移動でループさせる
   * （半分動いた時点の並びが先頭と一致するためシームレスに繰り返す）。
   * 速度はトラック幅から所要秒数を計算して一定に保つ。
   * 動きを抑える設定の端末では複製せず1つだけ静止表示する。
   * トラック全体は装飾扱いで、読み上げは隣の静的テキストが1回だけ担う。
   *
   * 駆動はWeb Animations APIで行い、移動距離をピクセルで明示する。
   * 以前のstylesheetのCSSアニメーション（translateX(-50%)+CSSOMでの
   * animationDuration上書き）はSafari（WebKit）で流れないことがあった。
   * 非対応環境ではdisplay.cssのCSSアニメーションがそのまま代替として働く
   */
  function applyTicker() {
    if (tickerAnimation) {
      tickerAnimation.cancel();
      tickerAnimation = null;
    }
    if (!settings.message) {
      tickerElement.hidden = true;
      tickerTrack.replaceChildren();
      tickerSr.textContent = '';
      return;
    }
    tickerSr.textContent = `お知らせ: ${settings.message}`;
    tickerElement.hidden = false;

    const item = document.createElement('span');
    item.className = 'display-ticker-item';
    item.textContent = settings.message;
    if (reducedMotion) {
      tickerTrack.replaceChildren(item);
      return;
    }

    // 1複製の幅（複製間の間隔padding-right込み）を実測して必要な複製数を決める
    tickerTrack.replaceChildren(item);
    const itemWidth = item.getBoundingClientRect().width;
    const perGroup =
      itemWidth > 0 ? Math.max(1, Math.ceil(window.innerWidth / itemWidth)) : 1;
    const items = [item];
    for (let i = 1; i < perGroup * 2; i += 1) {
      items.push(item.cloneNode(true));
    }
    tickerTrack.replaceChildren(...items);
    // 移動距離は1グループ分（トラック幅の半分）、時間は距離÷一定速度。
    // element.styleへの代入はCSSOM操作のためCSPのstyle属性制限には触れない
    const distance = itemWidth * perGroup;
    const durationSeconds = Math.max(6, distance / TICKER_SPEED_PX_PER_SECOND);
    if (typeof tickerTrack.animate === 'function') {
      // CSS側のアニメーションと二重に動かないよう無効化してからAPIで駆動する
      tickerTrack.style.animation = 'none';
      tickerAnimation = tickerTrack.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(-${distance}px)` }],
        { duration: durationSeconds * 1000, iterations: Infinity },
      );
      if (paused) {
        tickerAnimation.pause();
      }
    } else {
      tickerTrack.style.animationDuration = `${durationSeconds}s`;
    }
  }

  // 画面の幅が変わると必要な複製数も変わるため、落ち着いたタイミングで作り直す
  // （サイネージでは稀だが、スマホの縦横回転で起こる）
  let tickerResizeTimer = null;
  window.addEventListener('resize', () => {
    if (tickerResizeTimer !== null) {
      clearTimeout(tickerResizeTimer);
    }
    tickerResizeTimer = setTimeout(() => {
      tickerResizeTimer = null;
      applyTicker();
    }, 300);
  });

  // ---- 表示の設定パネル ----
  let settingsOpen = false;

  /** 設定変更を画面・URL・保存へ反映する共通処理 */
  function applySettings() {
    writeStoredSettings();
    updateSettingsUrl();
    applyTicker();
    // 表示中のスライドが設定で外れた場合は先頭スライドへ寄せる
    showSlide(currentSlide().key, true);
  }

  /** 全国の都市チェックボックス一覧を描き直す（全国データ取得後に呼ぶ） */
  function renderSettingsCityList() {
    if (!national) {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = '全国の天気を読み込むと都市を選べます…';
      settingsCityList.replaceChildren(note);
      return;
    }
    const labels = national.cities.map((city) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = city.name;
      checkbox.checked = settings.cities === null || settings.cities.includes(city.name);
      checkbox.addEventListener('change', () => {
        const checked = [...settingsCityList.querySelectorAll('input:checked')].map(
          (input) => input.value,
        );
        // 全都市選択は「絞り込みなし」として保存する（将来の都市追加にも追従する）
        settings.cities = checked.length === national.cities.length ? null : checked;
        applySettings();
      });
      label.append(checkbox, document.createTextNode(city.name));
      return label;
    });
    settingsCityList.replaceChildren(...labels);
  }

  /** 追加済み都市の一覧を描き直す（ボタンで削除できる） */
  function renderSettingsExtraList() {
    const items = settings.extras.map((extra) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${extra.name} ✕`;
      button.setAttribute('aria-label', `追加した都市「${extra.name}」を外す`);
      button.addEventListener('click', () => {
        settings.extras = settings.extras.filter((entry) => entry !== extra);
        // 表示中のサマリーも同期して絞り込む（取得の解決を待たず画面と設定を一致させる）
        extraSummaries = extraSummaries.filter((summary) => summary.name !== extra.name);
        renderSettingsExtraList();
        applySettings();
        refreshExtrasAndRerender();
      });
      item.appendChild(button);
      return item;
    });
    settingsExtraList.replaceChildren(...items);
  }

  /** 設定パネル内の状態表示 */
  function setSettingsStatus(text) {
    settingsStatus.textContent = text;
  }

  /** 都市検索の世代番号（連続検索で古い応答が新しい結果を上書きしないため。
   * app.jsのsearchSeqと同じ「最後の明示操作が勝つ」方式） */
  let citySearchSeq = 0;

  /** 都市検索（/api/geocode）の結果から追加候補ボタンを並べる */
  async function searchCityForExtra() {
    const query = sanitizeText(settingsSearchInput.value).slice(0, 100);
    if (!query) {
      setSettingsStatus('追加したい都市名または郵便番号を入力してください。');
      return;
    }
    if (settings.extras.length >= EXTRA_CITY_LIMIT) {
      setSettingsStatus(`追加できるのは${EXTRA_CITY_LIMIT}都市までです。既存の都市を外してから追加してください。`);
      return;
    }
    setSettingsStatus('検索しています…');
    const seq = ++citySearchSeq;
    const result = await fetchJson(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (seq !== citySearchSeq) {
      // この検索より後に新しい検索が始まっている（古い応答は捨てる）
      return;
    }
    const candidates = Array.isArray(result?.data?.results) ? result.data.results : null;
    if (!candidates) {
      setSettingsStatus('検索できませんでした。通信環境を確認して再度お試しください。');
      return;
    }
    if (candidates.length === 0) {
      setSettingsStatus('該当する地点が見つかりませんでした。別の表記でお試しください。');
      return;
    }
    setSettingsStatus('候補を選ぶと全国の天気へ追加されます。');
    const items = candidates.map((candidate) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = candidate.admin1 ? `${candidate.name}（${candidate.admin1}）` : candidate.name;
      button.addEventListener('click', () => {
        // 同名の別都市（例: 東京都と広島県の府中）を区別できるよう、名前が
        // 既存の都市と重なるときは都道府県を付けた表示名で保存する
        const nameTaken =
          settings.extras.some((entry) => entry.name === candidate.name) ||
          (national?.cities ?? []).some((city) => city.name === candidate.name);
        const extra = normalizeExtra({
          name: nameTaken && candidate.admin1 ? `${candidate.name}（${candidate.admin1}）` : candidate.name,
          lat: candidate.latitude,
          lon: candidate.longitude,
        });
        if (!extra || settings.extras.length >= EXTRA_CITY_LIMIT) {
          return;
        }
        // 重複は名前ではなく丸め後の座標で判定する（同名異都市を誤って弾かない）
        const duplicate = settings.extras.find(
          (entry) => entry.lat === extra.lat && entry.lon === extra.lon,
        );
        if (duplicate) {
          setSettingsStatus(`この地点は「${duplicate.name}」として追加済みです。`);
          return;
        }
        settings.extras = settings.extras.concat(extra);
        settingsSearchResults.replaceChildren();
        settingsSearchInput.value = '';
        setSettingsStatus(`「${extra.name}」を追加しました。`);
        renderSettingsExtraList();
        applySettings();
        refreshExtrasAndRerender();
      });
      item.appendChild(button);
      return item;
    });
    settingsSearchResults.replaceChildren(...items);
  }

  /** スライド選択チェックボックスを設定の状態へ揃える */
  function syncSlideCheckboxes() {
    for (const checkbox of document.querySelectorAll('#display-settings input[data-slide]')) {
      checkbox.checked =
        checkbox.dataset.slide === EMERGENCY_SLIDE.key
          ? settings.emergency
          : settings.slides.includes(checkbox.dataset.slide);
    }
  }

  /** パネル表示中は背景を操作・読み上げの対象から外す（フォーカスが
   * 暗幕の裏へ抜けて見えなくなるのを防ぐ。inert未対応の環境では無視されるだけ） */
  function setBackgroundInert(inert) {
    for (const element of document.body.children) {
      if (element !== settingsOverlay) {
        element.inert = inert;
      }
    }
  }

  /** 設定パネルを開く（開いている間は自動送りを止める） */
  function openSettings() {
    settingsOpen = true;
    settingsButton.setAttribute('aria-expanded', 'true');
    syncSlideCheckboxes();
    settingsMessageInput.value = settings.message;
    renderSettingsCityList();
    renderSettingsExtraList();
    setSettingsStatus('');
    setBackgroundInert(true);
    settingsOverlay.hidden = false;
    // 先頭（見出し）から読み始められるようにする（最下部のボタンへ飛ばすと
    // 縦長のスマホでパネルが最下部までスクロールした状態で開いてしまう）
    settingsPanel.scrollTop = 0;
    settingsTitle.focus();
  }

  /** 設定パネルを閉じる */
  function closeSettings() {
    settingsOpen = false;
    settingsButton.setAttribute('aria-expanded', 'false');
    settingsOverlay.hidden = true;
    settingsSearchResults.replaceChildren();
    // inert解除はフォーカス復帰より先に行う（inertな要素はfocus()が効かない）
    setBackgroundInert(false);
    settingsButton.focus();
    slideDeadline = Date.now() + currentSlide().seconds * 1000;
  }

  settingsButton.addEventListener('click', () => {
    if (settingsOpen) {
      closeSettings();
    } else {
      openSettings();
    }
  });
  // Tabキーをパネル内で循環させる（背景のinert化はフォーカスの抜け先を
  // 消すだけでループはしないため、末尾からのTabがパネル外へ出るのを防ぐ）
  settingsOverlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') {
      return;
    }
    const focusables = [...settingsOverlay.querySelectorAll('button, input, a')].filter(
      (element) => !element.disabled && element.offsetParent !== null,
    );
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const current = document.activeElement;
    if (!focusables.includes(current)) {
      // 見出し（tabindex=-1）などからのTabは先頭・末尾へ寄せる
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  });
  settingsCloseButton.addEventListener('click', closeSettings);
  // 背景（パネルの外）をタップしても閉じられる。パネル内で文字選択を始めて
  // 背景の上で指を離した場合に閉じないよう、押下と解放の両方が背景のときだけ閉じる
  let overlayPressedOnBackground = false;
  settingsOverlay.addEventListener('pointerdown', (event) => {
    overlayPressedOnBackground = event.target === settingsOverlay;
  });
  settingsOverlay.addEventListener('pointerup', (event) => {
    if (overlayPressedOnBackground && event.target === settingsOverlay) {
      closeSettings();
    }
    overlayPressedOnBackground = false;
  });
  for (const checkbox of document.querySelectorAll('#display-settings input[data-slide]')) {
    checkbox.addEventListener('change', () => {
      settings.slides = SLIDES.map((slide) => slide.key).filter((key) =>
        [...document.querySelectorAll('#display-settings input[data-slide]:checked')].some(
          (input) => input.dataset.slide === key,
        ),
      );
      settings.emergency = document.querySelector(
        `#display-settings input[data-slide="${EMERGENCY_SLIDE.key}"]`,
      ).checked;
      // すべて外したときは全スライド表示に戻す（normalizeSettingsと同じ扱い）。
      // チェックボックスも内部状態へ揃え、告知して唐突さを避ける
      if (settings.slides.length === 0) {
        settings.slides = SLIDES.map((slide) => slide.key);
        syncSlideCheckboxes();
        setSettingsStatus('スライドは最低1枚必要なため、すべて表示に戻しました。');
      }
      applySettings();
    });
  }
  settingsSearchButton.addEventListener('click', searchCityForExtra);
  settingsSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchCityForExtra();
    }
  });
  settingsMessageInput.addEventListener('change', () => {
    settings.message = sanitizeText(settingsMessageInput.value).slice(0, MESSAGE_LIMIT);
    applySettings();
  });
  settingsResetButton.addEventListener('click', () => {
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // 保存を消せない環境でも、以降の既定値適用とURL反映で表示は初期化される
    }
    // settingsはconstで参照が各所に配られているため、差し替えではなく上書きする
    Object.assign(settings, defaultSettings());
    extraSummaries = [];
    syncSlideCheckboxes();
    settingsMessageInput.value = '';
    renderSettingsCityList();
    renderSettingsExtraList();
    settingsSearchResults.replaceChildren();
    applySettings();
    setSettingsStatus('表示の設定を初期状態に戻しました。');
  });
  settingsCopyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setSettingsStatus('この設定のURLをコピーしました。会場の端末で開いてください。');
    } catch {
      setSettingsStatus('コピーできませんでした。アドレスバーのURLをご利用ください。');
    }
  });

  // ---- 一時停止・手動送り ----
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    // 一時停止⇄再開はラベル交換の2状態ボタン（ラベル変更とaria-pressedは併用しない）
    pauseButton.textContent = paused ? '再開' : '一時停止';
    // お知らせの流れも一緒に止める（WCAG 2.2.2。クラスは速度クラスを
    // 書き換えるtrackではなく親要素へ付ける。クラスはCSSアニメーション代替用で、
    // 通常はWeb Animations APIのpause/playが実際の停止・再開を担う）
    tickerElement.classList.toggle('ticker-paused', paused);
    if (tickerAnimation) {
      if (paused) {
        tickerAnimation.pause();
      } else {
        tickerAnimation.play();
      }
    }
    if (!paused) {
      slideDeadline = Date.now() + currentSlide().seconds * 1000;
    }
  });
  nextButton.addEventListener('click', () => advance(1, true));
  // 画面のどこをタップしても次へ送れる（ボタン・リンクの操作は除く）。
  // 誤タップしても次の期限で自動進行へ戻るため、案内は表示しない
  mainElement.addEventListener('pointerup', (event) => {
    if (!event.target.closest('button, a')) {
      advance(1, true);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (settingsOpen) {
      // パネル内の入力操作と衝突しないよう、スライド送りは無効化する
      if (event.key === 'Escape') {
        closeSettings();
      }
      return;
    }
    if (event.key === 'ArrowRight') {
      advance(1, true);
    } else if (event.key === 'ArrowLeft') {
      advance(-1, true);
    }
  });

  // ---- Wake Lock（画面スリープ防止。非対応環境・省電力設定では諦める） ----
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      return;
    }
    try {
      await navigator.wakeLock.request('screen');
    } catch {
      // 取得できなくても表示は続ける（設置手順書でOS側のスリープ無効化を案内している）
    }
  }

  // ---- 表示への復帰・回線復旧で即時更新 ----
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Wake Lockは非表示になると解除されるため取り直す
      requestWakeLock();
      slideDeadline = Date.now() + currentSlide().seconds * 1000;
      renderShared();
      renderCurrentSlide();
      refreshForecast();
      refreshNational();
    }
  });
  window.addEventListener('online', () => {
    refreshForecast();
    refreshNational();
  });

  // ---- 単一スケジューラ ----

  /** JST日付が変わったら当日基準の表示（今日・明日ラベル、いまの判定）を作り直す */
  function checkDateRollover() {
    const today = nowInJst().date;
    if (today !== lastJstDate) {
      lastJstDate = today;
      // ブラウザキャッシュ（10分）に残る前日データを避けて取り直す
      refreshForecast(true);
      refreshNational();
      // 環境省の公式発表も取り直す。取得に失敗してもrefreshAlert内の対象日
      // チェックが走り、前日の警戒帯が最大31分残り続けるのを防ぐ（終夜運転対策）
      refreshAlert();
      renderShared();
      renderCurrentSlide();
    }
  }

  /** 深夜4時台の自動リロード。デプロイの反映・メモリ回収・SW更新・
   * ピンチズーム事故からの復帰を毎日1回の安価な仕組みでまとめて行う。
   * 上流障害・キャプティブポータル失効中にリロードすると、保持している
   * 前回データの表示まで失うため、予報が新鮮（鮮度警告前）な夜だけ行う */
  function checkNightlyReload() {
    const now = nowInJst();
    if (
      now.hour === NIGHTLY_RELOAD_HOUR &&
      now.minute === reloadMinute &&
      Date.now() - startedAt > 2 * 60 * 60 * 1000 &&
      navigator.onLine !== false &&
      forecast !== null &&
      Date.now() - forecastTime < STALE_WARNING_MS
    ) {
      window.location.reload();
    }
  }

  /** 焼き付き対策: 表示全体を数分ごとに1pxずらす（クラス切り替えのみ） */
  function checkPixelShift() {
    if (Date.now() >= nextPixelShiftAt) {
      nextPixelShiftAt = Date.now() + PIXEL_SHIFT_MS;
      pixelShiftIndex = (pixelShiftIndex + 1) % 4;
      document.body.className = `display-body display-shift-${pixelShiftIndex}`;
    }
  }

  /** 1秒ごとの単一tick。すべての定期処理は絶対時刻の期限と比較して発火する */
  function tick() {
    const now = Date.now();
    updateClock();
    // 判定の変化でactiveSlidesから外れたスライド（自動追加のもしものとき等）を
    // 表示し続けない。1枚構成では自動送りが止まるため、ここで先頭へ寄せないと
    // 外れたスライドが出たまま固まる
    if (!activeSlides().some((slide) => slide.key === currentKey)) {
      showSlide(currentSlide().key, true);
    }
    if (
      !paused &&
      !settingsOpen &&
      !focusWithinSlides() &&
      activeSlides().length > 1 &&
      now >= slideDeadline
    ) {
      advance(1, false);
    }
    if (now >= nextForecastAt) {
      refreshForecast();
    }
    if (now >= nextNationalAt) {
      refreshNational();
    }
    if (now >= nextAlertAt) {
      refreshAlert();
    }
    // 鮮度警告と常時帯は取得が止まっていても時間経過で変わる（毎時00分の境界で
    // 現在時間帯の判定が入れ替わる）ため、分が変わるたびに共通表示を描き直す。
    // 剰余の窓判定はtickの遅延で取り逃すことがあるため、分の変化で検出する
    const minute = nowInJst().minute;
    if (minute !== lastSharedMinute) {
      lastSharedMinute = minute;
      renderShared();
      // 毎時00分の境界で「いま」の時間行が入れ替わったら、スライド本体も描き直す。
      // スライドが1枚だけの構成では自動送りによる再描画が走らないため、
      // ここで描かないと常時帯と本体の判定が食い違ったまま残る
      const target = currentHourTarget();
      if ((target?.time ?? null) !== lastHourTargetTime) {
        lastHourTargetTime = target?.time ?? null;
        renderCurrentSlide();
      }
    }
    checkDateRollover();
    checkNightlyReload();
    checkPixelShift();
  }

  // ---- Service Worker登録（app.jsと同じ方針。オフライン時に保存分で表示を続ける） ----
  if ('serviceWorker' in navigator) {
    let swUrl = '/sw.js';
    try {
      if (window.trustedTypes && window.trustedTypes.createPolicy) {
        swUrl = window.trustedTypes
          .createPolicy('fursuitweather-sw', { createScriptURL: () => '/sw.js' })
          .createScriptURL('/sw.js');
      }
    } catch {
      swUrl = null;
    }
    if (swUrl !== null) {
      navigator.serviceWorker.register(swUrl).catch(() => {
        // 登録できない環境でも通常表示には影響しない
      });
    }
  }

  // ---- 起動 ----
  locationLabel.replaceChildren(
    faIcon('location-dot'),
    document.createTextNode(` ${demo ? 'デモ表示' : place.name}`),
  );
  document.title = `${demo ? 'デモ表示' : place.name}の会場表示 - FursuitWeather 着ぐるみ天気予報`;
  updateClock();
  updateAlerts();
  currentKey = activeSlides()[0].key;
  slideDeadline = Date.now() + currentSlide().seconds * 1000;
  applyTicker();
  updateSettingsUrl();
  showSlide(currentKey, true);
  nextForecastAt = Date.now() + FORECAST_POLL_MS;
  nextNationalAt = Date.now() + NATIONAL_POLL_MS;
  nextAlertAt = Date.now() + ALERT_POLL_MS;
  refreshForecast();
  refreshNational();
  refreshAlert();
  requestWakeLock();
  setInterval(tick, 1000);
})();
