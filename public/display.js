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
  /** 地点未指定時の既定地点 */
  const DEFAULT_LOCATION = { name: '東京', lat: 35.6785, lon: 139.6823 };

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

  /** バッジ要素を作る（色+記号+文字の3要素。低温側は温度計アイコン+青系） */
  function createBadge(summary, large) {
    const badge = document.createElement('span');
    const isCold = String(summary.level || '').startsWith('cold');
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
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
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
      // ZWJ絵文字合成が崩れる副作用は許容する）
      const name =
        (params.get('name') ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 80) ||
        '指定地点';
      return {
        name,
        lat: Math.round(lat * 100) / 100,
        lon: Math.round(lon * 100) / 100,
        specified: true,
      };
    }
    return { ...DEFAULT_LOCATION, specified: false };
  }
  const place = parseLocationParams();

  // ---- スライド定義（描画関数は後方で定義。スライド表示の直前に毎回最新データで描き直す） ----
  const SLIDES = [
    { id: 'slide-now', name: 'いまの判定', seconds: 15, render: renderNowSlide },
    { id: 'slide-hours', name: 'この後の予報', seconds: 20, render: renderHoursSlide },
    { id: 'slide-days', name: '3日間の天気', seconds: 15, render: renderDaysSlide },
    { id: 'slide-national', name: '全国の天気', seconds: 20, render: renderNationalSlide },
  ];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- 可変状態 ----
  let forecast = null;
  /** 予報の生成時刻（ms）。鮮度表示・警告の基準 */
  let forecastTime = 0;
  /** 表示中の予報がService Workerの保存分（オフライン応答）かどうか */
  let forecastFromCache = false;
  let national = null;
  let currentIndex = 0;
  /** 次の自動送り時刻（絶対時刻ms）。tickが期限と比較する */
  let slideDeadline = 0;
  let paused = false;
  let fadeTimer = null;
  let refreshingForecast = false;
  let refreshingNational = false;
  let nextForecastAt = 0;
  let nextNationalAt = 0;
  let lastJstDate = nowInJst().date;
  /** 共通表示を最後に描画したJSTの分（時間境界・鮮度警告の毎分再評価用） */
  let lastSharedMinute = nowInJst().minute;
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
      if (SLIDES[currentIndex].id === 'slide-national') {
        renderCurrentSlide();
      }
    } finally {
      refreshingNational = false;
    }
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
  function alertRow(text, heat) {
    const row = document.createElement('p');
    row.className = `display-alert${heat ? ' display-alert-heat' : ''}`;
    row.appendChild(faIcon('triangle-exclamation'));
    row.appendChild(document.createTextNode(text));
    return row;
  }

  /** 時刻（ms）を日本時間のHH:MM表記にする（前日以前は「M/D HH:MM」で日付も示す） */
  function jstClockText(ms) {
    const jst = new Date(ms + 9 * 60 * 60 * 1000);
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
    // 警戒アラート相当は安全に直結するため先頭で表示し続ける
    if (forecast && forecast.days[0] && forecast.days[0].maxWbgt >= HEAT_STROKE_ALERT_WBGT) {
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
    advice.textContent = target.outdoor.advice;

    // 表示値は着ぐるみ着衣補正後であることを明示する（会場据付のWBGT計との食い違い防止）
    const wbgtNote = document.createElement('p');
    wbgtNote.className = 'display-wbgt-note';
    wbgtNote.textContent = `暑さ指数（WBGT）${target.outdoor.wbgt}℃・着ぐるみ補正後${target.outdoor.suitWbgt}℃（推定値）`;

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
   * 跨いだとき、昨日の行を「今日」と誤表示しないため） */
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
    return `${relative ? `${relative} ` : ''}${month}/${day}（${weekday}）`;
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
      date.textContent = formatDayLabel(day.date);

      const weather = document.createElement('span');
      weather.className = 'display-cell-weather';
      weather.appendChild(weatherWithLabel(day.weatherCode, day.weatherLabel));

      const temp = document.createElement('span');
      temp.className = 'display-cell-temp';
      temp.textContent = `最高${day.temperatureMax.toFixed(0)}℃／最低${day.temperatureMin.toFixed(0)}℃`;

      const laundry = document.createElement('span');
      laundry.className = 'display-day-laundry';
      laundry.textContent = `洗濯: ${day.laundry.label}`;

      cell.replaceChildren(date, weather, temp, createBadge(day.outdoorWorst, true), laundry);
      return cell;
    });
    container.replaceChildren(...cells);
  }

  /** ④全国の天気 */
  function renderNationalSlide(container) {
    if (!national) {
      container.replaceChildren(slideNote('全国の天気を読み込んでいます…'));
      return;
    }
    const cells = national.cities.map((city) => {
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

  /** スライドの中身のコンテナ（h2の次の要素）を返す */
  function slideContainer(slide) {
    return document.getElementById(slide.id).querySelector('h2 + *');
  }

  /** 現在のスライドを最新データで描き直す */
  function renderCurrentSlide() {
    const slide = SLIDES[currentIndex];
    slide.render(slideContainer(slide));
  }

  // ---- スライドショー制御 ----

  /** 進行ドットとスライド名を更新する */
  function updateProgress() {
    const dots = SLIDES.map((_, index) => {
      const dot = document.createElement('span');
      dot.className = `display-dot${index === currentIndex ? ' current' : ''}`;
      return dot;
    });
    progressElement.replaceChildren(...dots);
    slideNameElement.textContent = SLIDES[currentIndex].name;
  }

  /**
   * スライドを切り替える。自動送りはフェード（0.5秒で消える→現れる）、
   * 手動送り・reduced-motionは即時切り替え。
   * hiddenの付け替えで支援技術上は常に1枚だけ存在させる
   */
  function showSlide(index, immediate) {
    const previous = SLIDES[currentIndex];
    currentIndex = index;
    const next = SLIDES[currentIndex];
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
    for (const slide of SLIDES) {
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
    showSlide((currentIndex + step + SLIDES.length) % SLIDES.length, manual);
  }

  /** スライド領域内にキーボードフォーカスがある間は自動送りを止める（WCAG 2.2.2） */
  function focusWithinSlides() {
    return mainElement.contains(document.activeElement);
  }

  // ---- 一時停止・手動送り ----
  pauseButton.addEventListener('click', () => {
    paused = !paused;
    // 一時停止⇄再開はラベル交換の2状態ボタン（ラベル変更とaria-pressedは併用しない）
    pauseButton.textContent = paused ? '再開' : '一時停止';
    if (!paused) {
      slideDeadline = Date.now() + SLIDES[currentIndex].seconds * 1000;
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
      slideDeadline = Date.now() + SLIDES[currentIndex].seconds * 1000;
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
    if (!paused && !focusWithinSlides() && now >= slideDeadline) {
      advance(1, false);
    }
    if (now >= nextForecastAt) {
      refreshForecast();
    }
    if (now >= nextNationalAt) {
      refreshNational();
    }
    // 鮮度警告と常時帯は取得が止まっていても時間経過で変わる（毎時00分の境界で
    // 現在時間帯の判定が入れ替わる）ため、分が変わるたびに共通表示を描き直す。
    // 剰余の窓判定はtickの遅延で取り逃すことがあるため、分の変化で検出する
    const minute = nowInJst().minute;
    if (minute !== lastSharedMinute) {
      lastSharedMinute = minute;
      renderShared();
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
  updateProgress();
  updateAlerts();
  slideDeadline = Date.now() + SLIDES[0].seconds * 1000;
  nextForecastAt = Date.now() + FORECAST_POLL_MS;
  nextNationalAt = Date.now() + NATIONAL_POLL_MS;
  refreshForecast();
  refreshNational();
  requestWakeLock();
  setInterval(tick, 1000);
})();
