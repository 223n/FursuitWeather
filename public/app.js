// FursuitWeather トップページのフロントエンド一式
// 予報の取得と描画・地点の選択/検索/お気に入り・イベント予報・活動プランナー・
// 共有と会場表示モードへの導線・Service Worker登録

(() => {
  'use strict';

  /** 地点プリセット（主要都市） */
  const CITIES = [
    { name: '札幌', lat: 43.0618, lon: 141.3545 },
    { name: '仙台', lat: 38.2682, lon: 140.8694 },
    { name: '東京', lat: 35.6785, lon: 139.6823 },
    { name: '新潟', lat: 37.9026, lon: 139.0236 },
    { name: '金沢', lat: 36.5613, lon: 136.6562 },
    { name: '名古屋', lat: 35.1815, lon: 136.9066 },
    { name: '大阪', lat: 34.6937, lon: 135.5023 },
    { name: '広島', lat: 34.3853, lon: 132.4553 },
    { name: '高松', lat: 34.3428, lon: 134.0466 },
    { name: '福岡', lat: 33.5902, lon: 130.4017 },
    { name: '鹿児島', lat: 31.5966, lon: 130.5571 },
    { name: '那覇', lat: 26.2124, lon: 127.6809 },
  ];

  /** 深刻度（grade）に対応する記号（テキストまたはSVGアイコン名の配列）
   * ◎○△✕は通常のテキスト文字なのでどの環境でも同一表示。
   * 絵文字は環境依存のため、絵柄はFont AwesomeのSVGアイコン（自前配信）で表示する */
  const GRADE_SYMBOLS = [['◎'], ['○'], ['△'], ['✕'], [{ icon: 'ban' }]];

  /** 取得する予報日数。タブ構成（今日・明日・明後日）に合わせて3日にする
   * （index.htmlのpreload URLと同期。ずれはhtmlSyncテストが検出する） */
  const FORECAST_DAYS = 3;

  /** 強風の注意を出す1時間平均風速のしきい値（m/s）
   * src/constants.tsのWIND_CAUTION_SPEEDと同期（ずれはhtmlSyncテストが検出する） */
  const WIND_CAUTION_SPEED = 10;

  /** 雷を含む天気とみなすWMO天気コードの下限
   * src/constants.tsのTHUNDER_WEATHER_CODE_MINと同期（ずれはhtmlSyncテストが検出する） */
  const THUNDER_WEATHER_CODE_MIN = 95;

  /** SVGスプライト（index.html内で定義）からアイコン要素を作る */
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
    // 霧雨・雨（51〜67）とにわか雨（80〜82）は非連続だが同じ雨アイコン
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

  const statusElement = document.getElementById('status');
  const statusErrorElement = document.getElementById('status-error');
  const srAnnounce = document.getElementById('sr-announce');
  const locationLabel = document.getElementById('location-label');
  const citySelect = document.getElementById('city-select');
  const dayCardsElement = document.getElementById('day-cards');
  const hoursBody = document.getElementById('hours-body');
  const hoursTitle = document.getElementById('hours-title');
  const noticesList = document.getElementById('notices-list');

  // 描画が参照する可変状態はこのブロックに集約する（イベント一覧の可変状態はイベント予報セクションのeventListを参照）
  let currentForecast = null;
  let selectedDate = null;
  /** 最後に予報を要求したクエリ（「予報を更新」で同じ条件を再取得するために保持） */
  let lastQuery = null;
  /** 最後に要求した地点の名前（「予報を更新」でラベルを維持するために保持） */
  let lastLocationName = null;
  /** 最後に要求したロードのオプション（「予報を更新」で記憶可否などを引き継ぐ） */
  let lastOptions = null;
  /** 表示に成功した地点のクエリと名前（共有ボタンはこちらを使う。失敗中のlastQueryとは別） */
  let displayedQuery = null;
  let displayedName = null;
  /** 表示中の予報がService Workerの保存分（オフライン表示）かどうか。
   * 追加の案内を出すときも、鮮度の注記を消さずに前置きするために保持する */
  let displayedFromCache = false;
  /** オフライン表示中の予報の取得時刻の表示文（印刷・シェア画像へ「いつの予報か」を
   * 刻むために保持する。オンライン表示中はnull） */
  let displayedCachedAtText = null;
  /** 表示中の地点がお気に入りに登録可能か（現在地=persist:falseは不可）と、登録に使う情報 */
  let displayedStorable = false;
  let displayedStoredName = null;
  let displayedCityIndex = null;
  /** 進行中リクエストの識別番号（古い応答で表示が上書きされるのを防ぐ） */
  let requestSeq = 0;
  /** 進行中の地点検索・イベント開催地解決の識別番号。古い応答が候補やステータスを
   * 上書きするのを防ぎ、確定ロード時（loadForecast）は加算して保留中の検索応答を無効化する */
  let searchSeq = 0;
  /** 地点セレクトのデバウンス用タイマー */
  let cityChangeTimer = null;
  /** 利用者による明示的なタブ操作の通し番号。イベント予報の完了後の自動切り替えが、
   * 読み込み待ちの間に利用者が選んだタブを上書きしないためのガード
   * （「最後の明示操作が勝つ」不変条件をタブ切り替えにも適用する） */
  let manualTabSeq = 0;
  /** イベント固定リンク（?event=）で指定された名前。一覧の読み込み後に自動選択する */
  let pendingEventName = null;

  /**
   * 保留中のセレクトデバウンスを解除する
   * nullへの再代入までがワンセット（現在地コールバックのcityChangeTimer !== null
   * ガードが「保留操作の有無」を正しく判定できるようにする）
   */
  function cancelPendingCitySelect() {
    clearTimeout(cityChangeTimer);
    cityChangeTimer = null;
  }

  /** 文字列ならtextContentで置き、ノードなら子として追加する（セル・値欄の中身設定で共通） */
  function appendContent(parent, content) {
    if (typeof content === 'string') {
      parent.textContent = content;
    } else {
      parent.appendChild(content);
    }
  }

  /** スクリーンリーダー専用テキストのspanを組み立てる */
  function srOnlySpan(text) {
    const span = document.createElement('span');
    span.className = 'sr-only';
    span.textContent = text;
    return span;
  }

  /** class=hintの案内文（p要素）を組み立てる（データ無し時の表示で共通） */
  function hintParagraph(text) {
    const paragraph = document.createElement('p');
    paragraph.className = 'hint';
    paragraph.textContent = text;
    return paragraph;
  }

  /**
   * APIへ問い合わせ、レスポンスと解析済みボディを返す
   * 通信失敗（ネットワーク断）はブラウザ固有の英語メッセージになるため、
   * 呼び出し側から渡された日本語の定型文へ差し替える。
   * 非JSON応答（エッジのエラーページなど）でパースエラーの生メッセージを
   * 出さないよう、パース失敗はbody=nullに落とす。エラー判定は呼び出し側が行う
   */
  async function fetchJsonBody(url, networkErrorMessage) {
    const response = await fetch(url).catch(() => {
      throw new Error(networkErrorMessage);
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  }

  /** HTTPエラー応答を利用者向けメッセージの例外にする（APIのerrorフィールドを優先） */
  function throwIfHttpError(response, body, label) {
    if (!response.ok) {
      // ステータス番号は利用者の対処に役立たないため画面に出さず、切り分け用にconsoleへ残す
      console.error(`${label}失敗: HTTP ${response.status}`);
      throw new Error(
        (body && body.error) || `${label}に失敗しました。しばらくたってからもう一度お試しください。`,
      );
    }
  }

  /**
   * セレクトを「理由が分かる選択肢1件だけ」の無効状態にする
   * （イベント選択とプランナーの日付で共通。空のセレクトのままだと
   *   上流障害中などに「画面が壊れている」と見えてしまうため）
   */
  function disablePicker(select, button, message) {
    select.replaceChildren(new Option(message, ''));
    select.disabled = true;
    button.disabled = true;
  }

  /**
   * 地点リストの項目（li > button、location-dotアイコン+ラベル）を組み立てる
   * お気に入りチップと検索候補で共通。クリック時の処理はクロージャで受け取る
   */
  function createLocationItem(label, onClick) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.appendChild(faIcon('location-dot', 'btn-icon'));
    button.appendChild(document.createTextNode(label));
    button.addEventListener('click', onClick);
    item.appendChild(button);
    return item;
  }

  /** 「地名（都道府県）」形式のラベルを作る（検索候補と郵便番号解決で共通の表示形式） */
  function placeLabel(name, admin1) {
    return typeof admin1 === 'string' && admin1 !== '' ? `${name}（${admin1}）` : name;
  }

  /**
   * 座標を予報クエリ文字列にする（プライバシー契約の単一実装）
   * URLに現れる座標はすべて小数2桁（約1km）に統一する。予報は約5kmメッシュの
   * ため結果への影響はなく、自宅を特定できる精度の位置がURLへ流れない
   */
  function coordQuery(lat, lon) {
    return `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`;
  }

  /** 共有URL用のクエリ文字列を組み立てる（名前があればname=を付ける） */
  function shareQueryString(query, name) {
    const params = new URLSearchParams(query);
    if (name) {
      params.set('name', name);
    }
    return params.toString();
  }

  /** 2地点間の距離（km）をハーバーサイン公式で求める */
  function distanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
  }

  /** 座標から最寄りのプリセット都市との位置関係を説明する文を作る */
  function nearestCityText(lat, lon) {
    let nearest = null;
    let nearestKm = Number.POSITIVE_INFINITY;
    for (const city of CITIES) {
      const km = distanceKm(lat, lon, city.lat, city.lon);
      if (km < nearestKm) {
        nearest = city;
        nearestKm = km;
      }
    }
    const rounded = Math.round(nearestKm);
    const relative = rounded < 5 ? `${nearest.name}付近` : `${nearest.name}から約${rounded}km`;
    return `緯度${lat.toFixed(2)}・経度${lon.toFixed(2)}、${relative}`;
  }

  /** 座標から「現在地」の説明文を作る */
  function describeCurrentLocation(lat, lon) {
    return `現在地（${nearestCityText(lat, lon)}）`;
  }

  /** 共有URLで開かれた地点の説明文を作る（URLに地点名がない場合の代替） */
  function describeSharedLocation(lat, lon) {
    return `共有された地点（${nearestCityText(lat, lon)}）`;
  }

  // 最後に表示した地点の記憶（このブラウザ内にのみ保存する）。
  // プライベートモードなどlocalStorageが使えない環境では黙って無効になる
  const LOCATION_STORAGE_KEY = 'fursuitweather:lastLocation';

  // localStorageに保存する地点クエリの受け入れ形式（記憶とお気に入りで共通）
  const STORED_QUERY_PATTERN = /^lat=-?[\d.]+&lon=-?[\d.]+$/;

  // デモ表示を示す予報クエリ（記憶・お気に入り・共有URLの各分岐が同じ値で判定する）
  const DEMO_QUERY = 'demo=1';

  /** localStorageからJSONを読み出す。未保存・破損・使えない環境ではnullを返す */
  function readStorageJson(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** localStorageへJSONを書き込む */
  function writeStorageJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 保存できなくても予報表示自体には影響しないため無視する
    }
  }

  /** 記憶済みの地点を読み出す。形式が不正・破損している場合はnullを返す */
  function readStoredLocation() {
    const stored = readStorageJson(LOCATION_STORAGE_KEY);
    if (
      !stored ||
      typeof stored.query !== 'string' ||
      !STORED_QUERY_PATTERN.test(stored.query) ||
      typeof stored.locationName !== 'string'
    ) {
      return null;
    }
    return {
      query: stored.query,
      locationName: stored.locationName,
      cityIndex: Number.isInteger(stored.cityIndex) ? stored.cityIndex : null,
    };
  }

  /** 表示に成功した地点を記憶する */
  function writeStoredLocation(query, locationName, cityIndex) {
    writeStorageJson(LOCATION_STORAGE_KEY, { query, locationName, cityIndex });
  }

  // お気に入り地点（このブラウザ内にのみ保存する）。
  // 現在地はプライバシー約束（位置情報は保存しません）のため登録できない
  const FAVORITES_STORAGE_KEY = 'fursuitweather:favorites';
  const MAX_FAVORITES = 6;

  /** お気に入り一覧を読み出す。形式が不正・破損している場合は空配列を返す */
  function readFavorites() {
    const list = readStorageJson(FAVORITES_STORAGE_KEY);
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .filter(
        (item) =>
          item &&
          typeof item.query === 'string' &&
          STORED_QUERY_PATTERN.test(item.query) &&
          typeof item.name === 'string' &&
          item.name !== '',
      )
      .slice(0, MAX_FAVORITES)
      .map((item) => ({
        query: item.query,
        name: item.name,
        cityIndex: Number.isInteger(item.cityIndex) ? item.cityIndex : null,
      }));
  }

  /** お気に入り一覧を保存する */
  function writeFavorites(list) {
    writeStorageJson(FAVORITES_STORAGE_KEY, list);
  }

  /** スクリーンリーダー向けに、その日の予報を文章で組み立てる
   * 表やバッジを順に辿らなくても、読み込み直後に要点が音声で伝わるようにする */
  function buildSpokenSummary(forecast, locationName) {
    const today = forecast.days[0];
    if (!today) {
      return `${locationName}の予報を読み込みました。`;
    }
    const parts = [
      `${locationName}の予報を読み込みました。`,
      `${formatDate(today.date)}の天気は${today.weatherLabel}、` +
        `気温は${Math.round(today.temperatureMin)}度から${Math.round(today.temperatureMax)}度です。`,
      `屋外の着ぐるみ判定は「${today.outdoorWorst.label}」。`,
      today.recommendedHours.length > 0
        ? // 「09:00」のままだと日本語音声合成で時刻として読まれないため「9時」形式にする
          `活動しやすい時間帯は${today.recommendedHours.map((h) => `${Number.parseInt(h, 10)}時`).join('、')}です。`
        : '屋外活動に適した時間帯はありません。休憩と冷却を最優先にしてください。',
      `空調のない屋内は${today.coolingRequired ? '冷房必須です' : '冷房なしでも活動できる時間帯があります'}。`,
      `洗濯指数は「${today.laundry.label}」、着ぐるみの乾燥目安は約${today.laundry.fursuitDryingHours}時間です。`,
      '詳しくは「3日間の天気」タブや「今日の天気」などの各タブの表をご確認ください。',
    ];
    return parts.join('');
  }

  /** 表示中の地点ラベルを更新する */
  function setLocationLabel(name) {
    if (!name) {
      locationLabel.replaceChildren();
      return;
    }
    locationLabel.replaceChildren(
      faIcon('location-dot'),
      document.createTextNode(` ${name}の予報を表示中`),
    );
  }

  /** ステータスメッセージを表示する */
  function setStatus(message, isError, isWarning) {
    // エラーはrole=alert領域に書き、スクリーンリーダーへ即時に通知する
    // （politeの#statusだと他の読み上げ待ちで遅延・埋没するため）
    statusElement.textContent = isError ? '' : message;
    statusErrorElement.textContent = isError ? message : '';
    // 注意状態（開催日の予報ではない、など）は黄系の配色と△!アイコンで区別する。
    // 色だけに頼らせないため、アイコンは装飾（aria-hidden）で、意味は本文が担う
    const warn = !isError && Boolean(isWarning) && Boolean(message);
    statusElement.classList.toggle('status-warning', warn);
    if (warn) {
      statusElement.prepend(faIcon('triangle-exclamation'));
    }
    // エラーも色だけに頼らせない（グレースケール・色覚多様性の環境でも枠の意味が
    // 伝わるよう△!を付ける）。アイコンは装飾（aria-hidden）で、意味は本文が担う
    if (Boolean(isError) && Boolean(message)) {
      statusErrorElement.prepend(faIcon('triangle-exclamation'));
    }
  }

  /** バッジ要素を作る
   * 色弱の方にも判別できるよう、色+記号（形）+文字の3要素で段階を表す
   * 低温側の判定には温度計アイコンを付けて暑熱側と形で区別する
   * summary.symbol（テキストと{icon}の混在配列）で記号、summary.cold=trueで青系配色を明示的に指定できる */
  function createBadge(summary, large) {
    const badge = document.createElement('span');
    const isCold = summary.cold === true || String(summary.level || '').startsWith('cold');
    badge.className = `badge grade-${summary.grade}${isCold ? ' cold' : ''}${large ? ' badge-large' : ''}`;

    const symbol = document.createElement('span');
    symbol.className = 'symbol';
    symbol.setAttribute('aria-hidden', 'true');
    const parts =
      summary.symbol ??
      (isCold ? [{ icon: 'temperature-low' }] : []).concat(GRADE_SYMBOLS[summary.grade] ?? ['?']);
    renderSymbolParts(parts, symbol);
    badge.appendChild(symbol);
    badge.appendChild(document.createTextNode(summary.label));
    return badge;
  }

  /** バッジ+補足テキストを横に並べた要素を作る */
  function badgeWithText(badgeConfig, text) {
    const wrapper = document.createElement('span');
    wrapper.className = 'badge-line';
    wrapper.appendChild(createBadge(badgeConfig));
    if (text) {
      wrapper.appendChild(document.createTextNode(` ${text}`));
    }
    return wrapper;
  }

  /** 補足情報（指数など）の囲み表示を作る */
  function createInfoChip(text) {
    const chip = document.createElement('span');
    chip.className = 'info-chip';
    chip.textContent = text;
    return chip;
  }

  /** 注意書き（黄色の囲み+注意アイコン）を作る
   * アイコンは装飾のため読み上げ対象外とし、代わりに「注意:」を読み上げさせる */
  function createWarningNote(text) {
    const note = document.createElement('span');
    note.className = 'warning-note';
    note.appendChild(faIcon('triangle-exclamation'));
    note.appendChild(srOnlySpan('注意: '));
    note.appendChild(document.createTextNode(text));
    return note;
  }

  /** 洗濯乾燥レベルごとのバッジ設定（色+記号）
   * 雨・低温は青系（雨雲・温度計アイコン付き）、乾きにくいほど暖色に近づける。
   * gradeの既定記号（GRADE_SYMBOLS）と同じ場合はsymbolを省略する */
  const LAUNDRY_BADGES = {
    excellent: { grade: 0 },
    veryGood: { grade: 0, symbol: ['○'] },
    good: { grade: 1 },
    fair: { grade: 2 },
    indoorDry: { grade: 3 },
    noDryRain: { grade: 3, symbol: [{ icon: 'cloud-rain' }, '✕'], cold: true },
    noDryCold: { grade: 3, symbol: [{ icon: 'temperature-low' }, '✕'], cold: true },
  };

  /** 静電気レベルごとのバッジ設定（色+記号）。ラベルはAPIのlabelを使う。
   * 低（対策不要）=◎緑、中=△橙、高（対策推奨）=✕赤系で、悪いほど暖色に寄せる */
  const STATIC_BADGES = {
    low: { grade: 0 },
    medium: { grade: 2 },
    high: { grade: 3 },
  };

  /** 空気のよごれ（黄砂・PM2.5）レベルごとのバッジ設定（静電気と同じ3段階の配色） */
  const AIR_BADGES = {
    low: { grade: 0 },
    medium: { grade: 2 },
    high: { grade: 3 },
  };

  /** 冷房要否ごとのバッジ設定（色+記号）。ラベルはAPIのcoolingLabelを使う */
  const COOLING_BADGES = {
    required: { grade: 3, symbol: [{ icon: 'snowflake' }, '✕'] },
    recommended: { grade: 1, symbol: [{ icon: 'snowflake' }, '○'] },
    none: { grade: 0 },
  };

  /** 冷房要否のバッジを組み立てる（日別カード・いまの判定・時間別テーブルで共通） */
  function coolingBadge(cooling, label) {
    return createBadge({ ...(COOLING_BADGES[cooling] ?? COOLING_BADGES.none), label });
  }

  /** 着ぐるみ乾燥目安のバッジを組み立てる */
  function fursuitDryingBadge(laundry) {
    const hours = laundry.fursuitDryingHours;
    if (laundry.moldWarning) {
      return createBadge({ grade: 3, label: `約${hours}時間・カビ注意` });
    }
    const grade = hours <= 30 ? 0 : hours <= 40 ? 1 : 2;
    return createBadge({ grade, label: `約${hours}時間` });
  }

  /** YYYY-MM-DD文字列を数値成分とUTCミリ秒に解析する（日付計算の共通基準） */
  function parseDateText(text) {
    const [year, month, day] = text.split('-').map(Number);
    return { year, month, day, utc: Date.UTC(year, month - 1, day) };
  }

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  /** 日付文字列（YYYY-MM-DD）を「8月15日（土）」形式にする
   * 予報の日付はJST基準のため、閲覧環境のタイムゾーンに依存しないようUTC基準で曜日を求める */
  function formatDate(dateText) {
    const { month, day, utc } = parseDateText(dateText);
    return `${month}月${day}日（${WEEKDAYS[new Date(utc).getUTCDay()]}）`;
  }

  /** 選択状態の見た目とARIA属性を更新する（カードは再生成せずフォーカスを保つ） */
  function updateSelectedCard() {
    for (const card of dayCardsElement.querySelectorAll('.day-card')) {
      const isSelected = card.dataset.date === selectedDate;
      card.classList.toggle('selected', isSelected);
      const button = card.querySelector('.day-card-button');
      if (button) {
        button.setAttribute('aria-pressed', String(isSelected));
      }
    }
  }

  /** 気温レンジ（最低〜最高℃）の要素を作る
   * 「〜」は音声合成で読まれ方が環境依存（無音になることもある）ため、
   * 見た目は「〜」のままスクリーンリーダーには「から」と読ませる */
  function createTemperatureRange(min, max) {
    const tilde = document.createElement('span');
    tilde.setAttribute('aria-hidden', 'true');
    tilde.textContent = '〜';
    const tildeReading = srOnlySpan('から');
    const range = document.createElement('span');
    range.append(`${Math.round(min)}`, tilde, tildeReading, `${Math.round(max)}℃`);
    return range;
  }

  /** 日別カード1枚を作る
   * カード本体はarticleにし、選択操作は見出し内のbutton（aria-pressed付き）が担う。
   * button内に見出しやリストを入れるとスクリーンリーダーで平坦化されるため */
  function createDayCard(day) {
    const card = document.createElement('article');
    card.className = 'day-card';
    card.dataset.date = day.date;

    const title = document.createElement('h3');
    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.className = 'day-card-button';
    titleButton.textContent = formatDate(day.date);
    // スクリーンリーダーにはボタンの目的（時間別予報の切り替え）も読み上げる
    titleButton.appendChild(srOnlySpan('の時間別予報を表示'));
    title.appendChild(titleButton);
    card.appendChild(title);

    const weatherLine = document.createElement('p');
    weatherLine.className = 'weather-line';
    const weatherContent = weatherWithLabel(day.weatherCode, day.weatherLabel);
    weatherContent.appendChild(createTemperatureRange(day.temperatureMin, day.temperatureMax));
    weatherLine.appendChild(weatherContent);
    // 代表天気が雷でなくても、その日に雷を含む時間帯があれば天気行で知らせる
    // （中止級の情報を注意欄まで読み進めなくても気付けるようにする）
    if (hoursOnDate(day.date).some((h) => h.weather.weatherCode >= THUNDER_WEATHER_CODE_MIN)) {
      weatherLine.appendChild(createWarningNote('雷予想あり'));
    }
    card.appendChild(weatherLine);

    const list = document.createElement('dl');

    const addRow = (label, valueNode) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      appendContent(dd, valueNode);
      list.appendChild(dt);
      list.appendChild(dd);
    };

    // その日の屋外判定（最も厳しい時間帯）を大きなアイコン+文字で表示する
    // （項目名のフォントを他項目と揃えるため、専用の段落ではなくdlの1行にする）
    addRow('屋外判定（日中の最も厳しい時間帯）', createBadge(day.outdoorWorst, true));

    const hasRecommended = day.recommendedHours.length > 0;
    const activityValue = badgeWithText(
      hasRecommended ? { grade: 0, label: 'あり' } : { grade: 3, label: 'なし' },
      hasRecommended ? day.recommendedHours.join('、') : null,
    );
    if (!hasRecommended) {
      activityValue.appendChild(createWarningNote('休憩と冷却を最優先に'));
    }
    addRow('活動しやすい時間帯', activityValue);
    // 日別サマリーのAPIレスポンス（coolingRequired）にはラベルが無いため、ここの文言はフロントで持つ
    addRow(
      '屋内（空調なしの場合）',
      day.coolingRequired
        ? coolingBadge('required', '冷房必須')
        : coolingBadge('none', '冷房なしでも可の時間帯あり'),
    );
    // 最大風速（配信済みの古いレスポンスには無い場合があるため有無を確認する）
    if (typeof day.maxWindSpeed === 'number') {
      const windValue = document.createElement('span');
      windValue.textContent = `${day.maxWindSpeed.toFixed(1)}m/s`;
      if (day.maxWindSpeed >= WIND_CAUTION_SPEED) {
        windValue.appendChild(createWarningNote('看板・テントの固定を確認'));
      }
      addRow('最大風速', windValue);
    }
    // 日の入り（上流が提供しない場合は行ごと出さない）。イベントの終了時刻の
    // 判断や撤収計画に使えるよう、日の出も括弧書きで添える
    if (day.sunset) {
      addRow('日の入り', day.sunrise ? `${day.sunset}（日の出 ${day.sunrise}）` : day.sunset);
    }
    const laundryValue = badgeWithText(
      { ...(LAUNDRY_BADGES[day.laundry.level] ?? { grade: 2 }), label: day.laundry.label },
      null,
    );
    laundryValue.appendChild(createInfoChip(`指数${day.laundry.score}`));
    addRow('洗濯・乾燥', laundryValue);
    addRow('着ぐるみ乾燥目安', fursuitDryingBadge(day.laundry));
    // 静電気（配信済みの古いレスポンスには無い場合があるため有無を確認する）。
    // 「高」の日はAPIのadvice（帯電防止スプレーの一言）を添える
    if (day.staticElectricity) {
      addRow(
        '静電気',
        badgeWithText(
          {
            ...(STATIC_BADGES[day.staticElectricity.level] ?? { grade: 2 }),
            label: day.staticElectricity.label,
          },
          day.staticElectricity.advice,
        ),
      );
    }
    // 空気のよごれ（黄砂・PM2.5）。取得失敗・欠測（null）の日は行ごと出さない。
    // CAMS推定値に基づく目安のため、注記はaboutページ側に記載している
    if (day.airQuality) {
      addRow(
        '空気のよごれ（黄砂・PM2.5）',
        badgeWithText(
          { ...(AIR_BADGES[day.airQuality.level] ?? { grade: 2 }), label: day.airQuality.label },
          day.airQuality.advice,
        ),
      );
    }

    card.appendChild(list);

    const selectDay = () => {
      // カードの選択はその日の時間別タブへの切り替えとして扱う（明示操作として数える）
      manualTabSeq += 1;
      selectedDate = day.date;
      updateSelectedCard();
      const dayTab = dayTabForDate(day.date);
      if (dayTab) {
        forecastTabs.activate(dayTab.tabId, false);
      }
    };
    titleButton.addEventListener('click', selectDay);
    // カードのどこをクリックしても選択できるようにする（ボタン自身のクリックは二重処理しない）
    card.addEventListener('click', (event) => {
      if (!titleButton.contains(event.target)) {
        selectDay();
      }
    });

    return card;
  }

  /** 日別カードを描画する */
  function renderDayCards() {
    dayCardsElement.replaceChildren();
    for (const day of currentForecast.days) {
      dayCardsElement.appendChild(createDayCard(day));
    }
    updateSelectedCard();
  }

  /** 日本時間の現在日付（YYYY-MM-DD）と時（0〜23）を返す
   * 予報データの時刻はAsia/Tokyoのため、端末のタイムゾーンに依存せずJSTで比較する */
  function nowInJst() {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return { date: jst.toISOString().slice(0, 10), hour: jst.getUTCHours() };
  }

  // タブ切り替え（WAI-ARIAタブパターン・自動選択）。
  // 時間別の3タブ（今日/明日/明後日）は同じパネルを日付を変えて共有する
  const TABS = [
    { tabId: 'tab-now', panelId: 'now-section' },
    { tabId: 'tab-days', panelId: 'days-section' },
    { tabId: 'tab-day-0', panelId: 'hours-section', dayIndex: 0 },
    { tabId: 'tab-day-1', panelId: 'hours-section', dayIndex: 1 },
    { tabId: 'tab-day-2', panelId: 'hours-section', dayIndex: 2 },
    { tabId: 'tab-planner', panelId: 'planner-section' },
    { tabId: 'tab-measured', panelId: 'measured-section' },
  ];

  /** 日付に対応する日別タブを返す。予報範囲外の日付はundefined（呼び出し側で防御する） */
  function dayTabForDate(date) {
    const index = currentForecast.days.findIndex((d) => d.date === date);
    return TABS.find((t) => t.dayIndex === index);
  }
  /** WAI-ARIAタブパターンの共通実装（予報の切り替えと地点の選び方で共用する）
   *
   * 選択状態・パネルの表示・キーボード操作（矢印キーで隣へ移動して自動選択、
   * Home/Endで先頭・末尾）だけを担い、選択時の追加処理はonActivateへ委ねる。
   * hidden属性の付いたタブはキーボード移動の対象から外す（日数不足の日付タブ）
   *
   * @param {string} tabListId タブバーの要素ID
   * @param {{tabId: string, panelId: string}[]} tabs タブとパネルの対応（複数タブで同じパネルを共有してよい）
   * @param {string} initialTabId 初期選択のタブID
   * @param {(target: object) => void} [onActivate] 選択確定後に呼ばれる処理
   */
  function createTabs(tabListId, tabs, initialTabId, onActivate) {
    const tabList = document.getElementById(tabListId);
    let activeTabId = initialTabId;

    const activate = (tabId, focusTab) => {
      const target = tabs.find((t) => t.tabId === tabId);
      if (!target) {
        return;
      }
      activeTabId = tabId;
      for (const { tabId: id, panelId } of tabs) {
        const tab = document.getElementById(id);
        const selected = id === tabId;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        // パネルは複数タブで共有されうるため、表示判定はパネル単位でまとめて行う
        document.getElementById(panelId).hidden = panelId !== target.panelId;
      }
      // 共有パネル（時間別）は選択中のタブをラベルにする
      document.getElementById(target.panelId).setAttribute('aria-labelledby', tabId);
      if (onActivate) {
        onActivate(target);
      }
      // 切り替えでフォーカス中の要素が隠れる場合は、選択したタブへフォーカスを移す。
      // 放置するとフォーカスがbodyへ落ち、キーボード利用者が位置を見失う
      // （例: 日別カードのボタンを押すとその日の時間別タブへ切り替わり、
      //   押したボタン自体が非表示のパネルの中に入る）
      const active = document.activeElement;
      const focusLost =
        active && active !== document.body && (active.hidden || active.closest('[hidden]'));
      if (focusTab || focusLost) {
        document.getElementById(tabId).focus();
      }
    };

    tabList.addEventListener('click', (event) => {
      const tab = event.target.closest('[role="tab"]');
      if (tab) {
        manualTabSeq += 1;
        activate(tab.id, false);
      }
    });

    tabList.addEventListener('keydown', (event) => {
      const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
      if (!keys.includes(event.key)) {
        return;
      }
      event.preventDefault();
      const visible = tabs.filter((t) => !document.getElementById(t.tabId).hidden);
      // 移動の起点はフォーカス中のタブ（選択と食い違う場合もフォーカス優先）。
      // 見つからないときは選択中のタブを起点にする
      const focusedId = event.target.closest('[role="tab"]')?.id;
      const fromIndex = visible.findIndex((t) => t.tabId === focusedId);
      const index = fromIndex >= 0 ? fromIndex : visible.findIndex((t) => t.tabId === activeTabId);
      let next = index;
      if (event.key === 'ArrowRight') {
        next = (index + 1) % visible.length;
      } else if (event.key === 'ArrowLeft') {
        next = (index - 1 + visible.length) % visible.length;
      } else if (event.key === 'Home') {
        next = 0;
      } else {
        next = visible.length - 1;
      }
      manualTabSeq += 1;
      activate(visible[next].tabId, true);
    });

    return { activate, getActiveTabId: () => activeTabId };
  }

  const forecastTabs = createTabs('forecast-tabs', TABS, 'tab-now', (target) => {
    if (target.dayIndex !== undefined && currentForecast) {
      const date = currentForecast.days[target.dayIndex]?.date;
      if (date) {
        selectedDate = date;
        renderHours();
      }
    }
  });

  // aboutページなどから「/#tab-measured」のように直接タブを開けるようにする。
  // 予報の取得を待たずに開けるため、上流障害中でも実測WBGTの判定は使える
  const hashTabId = window.location.hash.slice(1);
  if (TABS.some((tab) => tab.tabId === hashTabId)) {
    // 利用者の明示操作と同じ扱いにし、後から届く自動切り替えに上書きされないようにする
    manualTabSeq += 1;
    forecastTabs.activate(hashTabId, false);
  }

  /** 取得済みの日数に合わせて日付タブの表示を切り替える */
  function updateDayTabs() {
    for (const target of TABS) {
      if (target.dayIndex === undefined) {
        continue;
      }
      const tab = document.getElementById(target.tabId);
      tab.hidden = !currentForecast || currentForecast.days[target.dayIndex] === undefined;
    }
    // 表示中のタブが日数不足で消えた場合は「現在の天気」へ戻す
    if (document.getElementById(forecastTabs.getActiveTabId()).hidden) {
      forecastTabs.activate('tab-now', false);
    }
  }

  // 地点の選び方のタブ（主な都市／イベント／検索・現在地／お気に入り）。
  // 選び方ごとに操作をまとめ、操作エリアが縦に伸びないようにする
  createTabs(
    'picker-tabs',
    [
      { tabId: 'picker-tab-city', panelId: 'picker-city' },
      { tabId: 'picker-tab-event', panelId: 'picker-event' },
      { tabId: 'picker-tab-search', panelId: 'picker-search' },
      { tabId: 'picker-tab-favorites', panelId: 'picker-favorites' },
    ],
    'picker-tab-city',
  );

  // いまの判定: 現在時刻（JST）の時間別判定を大きく1枚で表示する
  const nowCard = document.getElementById('now-card');

  /** 時刻文字列（YYYY-MM-DDTHH:MM）から時の数値を取り出す */
  function hourNumberOf(time) {
    return Number.parseInt(time.slice(11, 13), 10);
  }

  /** 表示中の予報から指定日（YYYY-MM-DD）の時間行だけを返す */
  function hoursOnDate(date) {
    return currentForecast.hours.filter((h) => h.time.startsWith(date));
  }

  /** 表示中の予報から「現在の時間帯」の行を取り出す
   * （現在時刻のデータがなければ当日の直近未来で代替。該当なしはnull。
   *   now-cardと見守りモードの変化検知が同じ規則を共有する） */
  function currentHourEntry() {
    const now = nowInJst();
    const todayHours = hoursOnDate(now.date);
    return (
      todayHours.find((h) => hourNumberOf(h.time) === now.hour) ??
      todayHours.find((h) => hourNumberOf(h.time) > now.hour) ??
      null
    );
  }

  /** 現在時刻の判定カードを描画する。現在時刻のデータがなければ当日の直近未来で代替する */
  function renderNowCard() {
    const now = nowInJst();
    const target = currentHourEntry();
    if (!target) {
      nowCard.replaceChildren(
        hintParagraph('本日のこれからの時間帯の予報データがありません。「3日間の天気」タブで日別の予報をご確認ください。'),
      );
      return;
    }

    const hourNumber = hourNumberOf(target.time);
    const timeLine = document.createElement('p');
    timeLine.className = 'now-time';
    // 現在時刻ちょうどのデータがない場合（深夜の欠測など）は代替時刻を明示する
    timeLine.appendChild(
      document.createTextNode(
        `${hourNumber === now.hour ? `${hourNumber}時` : `本日${hourNumber}時（直近の時間帯）`}・`,
      ),
    );
    // 天気は他の表示と同じくアイコン+文字で示す
    timeLine.appendChild(weatherWithLabel(target.weather.weatherCode, target.weatherLabel));
    timeLine.appendChild(
      document.createTextNode(`・${target.weather.temperature.toFixed(1)}℃`),
    );

    const headline = document.createElement('div');
    headline.className = 'now-headline';
    headline.appendChild(createBadge(target.outdoor, true));
    const minutes = document.createElement('span');
    minutes.className = 'now-minutes';
    minutes.textContent =
      target.outdoor.activityMinutes > 0
        ? `連続${target.outdoor.activityMinutes}分まで`
        : '着用中止';
    headline.appendChild(minutes);

    const advice = document.createElement('p');
    advice.className = 'now-advice';
    advice.textContent = target.outdoor.advice;

    // 屋内の冷房要否は時間別テーブルと同じバッジ（雪の結晶+記号）で示す
    const indoor = document.createElement('p');
    indoor.className = 'now-time now-indoor';
    indoor.appendChild(faIcon('house', 'th-icon'));
    indoor.appendChild(document.createTextNode('屋内（空調なしの場合）:'));
    indoor.appendChild(coolingBadge(target.indoor.cooling, target.indoor.coolingLabel));

    const children = [timeLine, headline, advice, indoor];
    // 今日の予報に雷を含む天気があるときは、下部の注意欄より先に判定カードで知らせる
    // （中止級の情報を上部だけ見て見落とさないため）
    const thunderToday = currentForecast.hours.some(
      (h) => h.time.slice(0, 10) === now.date && h.weather.weatherCode >= THUNDER_WEATHER_CODE_MIN,
    );
    if (thunderToday) {
      const thunder = document.createElement('p');
      thunder.className = 'now-emergency';
      thunder.appendChild(faIcon('cloud-bolt', 'btn-icon'));
      thunder.appendChild(
        document.createTextNode('今日は雷が予想されています。雷鳴が聞こえたらすぐ中止を。'),
      );
      children.push(thunder);
    }
    // 厳重警戒（grade 3）以上の時間帯は、応急対応ページへの導線を判定カード内に出す
    // （体調不良が起きやすい状況で、手順を探させない）。
    // 低温側の危険（coldDanger）はgradeが同値でも熱中症手順ではないため出さない
    if (target.outdoor.grade >= 3 && !target.outdoor.level.startsWith('cold')) {
      const emergency = document.createElement('p');
      emergency.className = 'now-emergency';
      emergency.appendChild(faIcon('triangle-exclamation', 'btn-icon'));
      const link = document.createElement('a');
      link.href = '/emergency';
      link.textContent = 'もしものとき（熱中症の応急対応）';
      emergency.appendChild(link);
      children.push(emergency);
    }
    nowCard.replaceChildren(...children);
  }

  /** 時間別テーブルを描画する */
  function renderHours() {
    const now = nowInJst();
    // 当日は過ぎた時間帯を表示しない（例: 15:25なら15時以降のみ表示する）
    const hours = hoursOnDate(selectedDate).filter(
      (h) => selectedDate !== now.date || hourNumberOf(h.time) >= now.hour,
    );
    hoursTitle.textContent = `時間別予報（${formatDate(selectedDate)}）`;
    hoursBody.replaceChildren();

    // 日の入りの区切りマーク用（その日のデータが無ければ出さない）
    const selectedDay = currentForecast.days.find((d) => d.date === selectedDate);
    const sunset = selectedDay ? selectedDay.sunset : null;

    for (const hour of hours) {
      const row = document.createElement('tr');
      const hourNumber = hourNumberOf(hour.time);
      if (hourNumber < 6 || hourNumber >= 19) {
        row.classList.add('night');
      }

      const addCell = (content) => {
        const cell = document.createElement('td');
        appendContent(cell, content);
        row.appendChild(cell);
      };

      // 時刻セルは行見出し（th scope=row）にして、スクリーンリーダーが
      // 各セルを読むときに対応する時刻を伝えられるようにする
      const timeHeader = document.createElement('th');
      timeHeader.scope = 'row';
      timeHeader.textContent = `${String(hourNumber).padStart(2, '0')}:00`;
      // 日の入りを含む時間帯の行に目印を付ける（照明・撤収準備の目安）
      if (sunset && hourNumber === Number(sunset.slice(0, 2))) {
        const sunsetNote = document.createElement('span');
        sunsetNote.className = 'sunset-note';
        sunsetNote.textContent = `日の入り ${sunset}`;
        timeHeader.appendChild(document.createElement('br'));
        timeHeader.appendChild(sunsetNote);
      }
      row.appendChild(timeHeader);
      addCell(weatherWithLabel(hour.weather.weatherCode, hour.weatherLabel));
      addCell(`${hour.weather.temperature.toFixed(1)}℃`);
      addCell(`${Math.round(hour.weather.humidity)}%`);
      // 降水確率は上流モデルが提供しない場合がある（そのときは「-」表示）
      addCell(
        typeof hour.weather.precipitationProbability === 'number'
          ? `${Math.round(hour.weather.precipitationProbability)}%`
          : '-',
      );
      // 風速（1時間平均）。しきい値以上は色に頼らずアイコン併記で強調する
      const windText = `${hour.weather.windSpeed.toFixed(1)}m/s`;
      if (hour.weather.windSpeed >= WIND_CAUTION_SPEED) {
        const windCell = document.createElement('span');
        windCell.className = 'wind-caution';
        windCell.appendChild(faIcon('wind'));
        windCell.appendChild(srOnlySpan('強風注意: '));
        windCell.appendChild(document.createTextNode(windText));
        addCell(windCell);
      } else {
        addCell(windText);
      }
      addCell(`${hour.outdoor.suitWbgt.toFixed(1)}℃`);
      addCell(createBadge(hour.outdoor));
      // 連続活動目安も判定と同じ記号+色のバッジで表示する（色弱対応の記号併記）
      addCell(
        createBadge({
          level: hour.outdoor.level,
          grade: hour.outdoor.grade,
          label: hour.outdoor.activityMinutes > 0 ? `${hour.outdoor.activityMinutes}分` : '中止',
        }),
      );

      // 屋内判定はレベルバッジ+冷房要否バッジ（雪の結晶アイコン付き）で表示する。
      // 冷房ラベルの文言はAPIのcoolingLabelをそのまま使う（フロントで再定義しない）
      const indoorCell = document.createElement('span');
      indoorCell.className = 'badge-line';
      indoorCell.appendChild(createBadge(hour.indoor));
      indoorCell.appendChild(coolingBadge(hour.indoor.cooling, hour.indoor.coolingLabel));
      addCell(indoorCell);

      hoursBody.appendChild(row);
    }
  }

  /** 注意事項を描画する */
  function renderNotices() {
    noticesList.replaceChildren();
    // 素のWBGT（着衣補正前）が熱中症警戒アラートの発表基準（33以上）に達する日は、
    // 公式の発表状況への導線つきで最上部に注意を出す（判定はサーバーのmaxWbgtを使う）
    const alertDays = currentForecast.days
      .filter((d) => typeof d.maxWbgt === 'number' && d.maxWbgt >= 33)
      .map((d) => formatDate(d.date));
    if (alertDays.length > 0) {
      const item = document.createElement('li');
      item.className = 'alert-notice';
      const icon = faIcon('triangle-exclamation', 'btn-icon');
      const text = document.createTextNode(
        `${alertDays.join('、')}は暑さ指数（WBGT）33以上が予測されています。` +
          '環境省の熱中症警戒アラートの発表基準に相当する暑さです。公式の発表状況は',
      );
      const link = document.createElement('a');
      link.href = 'https://www.wbgt.env.go.jp/alert.php';
      link.rel = 'noopener';
      link.textContent = '環境省 熱中症予防情報サイト';
      item.append(icon, text, link, document.createTextNode('をご確認ください。'));
      noticesList.appendChild(item);
    }

    /** アイコン付きの注意liを追加する（classNameで赤=alert-notice/黄=caution-noticeを使い分ける） */
    const addNoticeItem = (className, iconName, text) => {
      const item = document.createElement('li');
      item.className = className;
      item.append(faIcon(iconName, 'btn-icon'), document.createTextNode(text));
      noticesList.appendChild(item);
    };

    // 雷: 予報に雷を含む天気コードがある日は活動中止を求める（赤枠）。
    // 逆（雷表示なし=雷なし）は保証しないため、平常時に「雷なし」とは表示しない
    const thunderDays = [
      ...new Set(
        currentForecast.hours
          .filter((h) => h.weather.weatherCode >= THUNDER_WEATHER_CODE_MIN)
          .map((h) => h.time.slice(0, 10)),
      ),
    ].map(formatDate);
    if (thunderDays.length > 0) {
      addNoticeItem(
        'alert-notice',
        'cloud-bolt',
        `${thunderDays.join('、')}は雷を伴う天気が予想されています。` +
          '雷鳴が聞こえたら屋外の着ぐるみ活動をすぐ中止し、建物か車の中へ避難してください' +
          '（テント・木の下は危険です）。',
      );
    }

    // 急な暑さ（暑熱順化前）: サーバーの判定（suddenHeat）があるときだけ表示する（黄枠）。
    // 「ここ数日」= 直近7日のうち十分なデータがある日の平均（欠測日は除外されるため
    // 「1週間の平均」と言い切らない）。数値はconstants.tsのSUDDEN_HEATと同期
    const suddenHeat = currentForecast.suddenHeat;
    if (suddenHeat && typeof suddenHeat.recentAverageMax === 'number') {
      addNoticeItem(
        'caution-notice',
        'temperature-high',
        `${formatDate(suddenHeat.date)}は最高${suddenHeat.targetMax}℃と、` +
          `ここ数日の平均（${suddenHeat.recentAverageMax}℃）より5℃以上高い見込みです。` +
          '暑さに体が慣れていない時期は、着用時間を短くし休憩と水分補給を増やしてください。',
      );
    }

    // 強風: 最大風速がしきい値以上の日は設営物と視界への注意を出す（黄枠）
    const windyDays = currentForecast.days
      .filter((d) => typeof d.maxWindSpeed === 'number' && d.maxWindSpeed >= WIND_CAUTION_SPEED)
      .map((d) => formatDate(d.date));
    if (windyDays.length > 0) {
      addNoticeItem(
        'caution-notice',
        'wind',
        `${windyDays.join('、')}は風速${WIND_CAUTION_SPEED}m/s以上（「やや強い風」以上）の時間帯があります。` +
          '瞬間的にはさらに強く吹くため、看板・テントの固定と視界にご注意ください。',
      );
    }

    for (const notice of currentForecast.notices) {
      const item = document.createElement('li');
      item.textContent = notice;
      noticesList.appendChild(item);
    }
  }

  // ---- 前回見た予報との差分 ----
  // 予報を表示するたびに日別判定をこの端末へ保存し、時間をあけた再訪で
  // 判定が変わっていたら差分バナーで知らせる（サーバーへは何も送らない）

  const diffBanner = document.getElementById('diff-banner');
  const SNAPSHOT_STORAGE_KEY = 'fursuitweatherForecastSnapshots';
  const DIFF_DISMISSED_KEY = 'fursuitweatherDiffDismissed';
  /** 差分を比較する最小の経過時間。直前のリロードとの比較は意味が薄い */
  const SNAPSHOT_MIN_AGE_MS = 3 * 60 * 60 * 1000;
  /** 保存する地点数の上限（古い地点から削除して肥大化を防ぐ） */
  const SNAPSHOT_LIMIT = 10;

  /** 保存済みスナップショット一式を読む（壊れた保存値・保存不可の環境は空） */
  function readForecastSnapshots() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY) ?? '');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  /** スナップショットを残してよい地点か（記憶中の地点とお気に入りに限定する）。
   * 検索などで一時的に見ただけの地点まで保存すると、画面で約束している保存内容
   * （記憶した地点・お気に入り）を超えた閲覧履歴が端末に残るため */
  function isSnapshotAllowed(query) {
    const stored = readStoredLocation();
    if (stored && stored.query === query) {
      return true;
    }
    return readFavorites().some((fav) => fav.query === query);
  }

  /** 表示した予報の日別判定を地点クエリごとに保存する */
  function writeForecastSnapshot(query, body) {
    try {
      const snapshots = readForecastSnapshots();
      // 対象外になった地点（過去に保存した分を含む）は残さない
      for (const key of Object.keys(snapshots)) {
        if (!isSnapshotAllowed(key)) {
          delete snapshots[key];
        }
      }
      snapshots[query] = {
        at: Date.now(),
        days: body.days.map((day) => ({
          date: day.date,
          grade: day.outdoorWorst.grade,
          label: day.outdoorWorst.label,
        })),
      };
      const keys = Object.keys(snapshots);
      if (keys.length > SNAPSHOT_LIMIT) {
        keys.sort((a, b) => (snapshots[a].at ?? 0) - (snapshots[b].at ?? 0));
        for (const key of keys.slice(0, keys.length - SNAPSHOT_LIMIT)) {
          delete snapshots[key];
        }
      }
      localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshots));
    } catch {
      // 保存できない環境（プライベートモード等）では差分表示を諦める
    }
  }

  /** 前回の閲覧から日別判定が変わっていれば差分バナーを表示する */
  function renderForecastDiff(query, body) {
    diffBanner.hidden = true;
    const previous = readForecastSnapshots()[query];
    if (
      !previous ||
      !Array.isArray(previous.days) ||
      typeof previous.at !== 'number' ||
      Date.now() - previous.at < SNAPSHOT_MIN_AGE_MS
    ) {
      return;
    }
    const changes = [];
    for (const day of body.days) {
      const before = previous.days.find((d) => d && d.date === day.date);
      if (
        before &&
        typeof before.grade === 'number' &&
        typeof before.label === 'string' &&
        before.grade !== day.outdoorWorst.grade
      ) {
        changes.push({ date: day.date, before, after: day.outdoorWorst });
      }
    }
    if (changes.length === 0) {
      return;
    }
    // 「閉じる」で同じ差分を再表示しないための署名（内容が変われば再び表示する）
    const signature = JSON.stringify(
      changes.map((c) => [query, c.date, c.before.grade, c.after.grade]),
    );
    try {
      if (localStorage.getItem(DIFF_DISMISSED_KEY) === signature) {
        return;
      }
    } catch {
      // 読めない環境では常に表示する（安全側）
    }

    const worsened = changes.some((c) => c.after.grade > c.before.grade);
    diffBanner.className = `diff-banner ${worsened ? 'diff-worse' : 'diff-better'}`;
    const at = new Date(previous.at);
    const text = document.createElement('span');
    const changeText = changes
      .map(
        (c) =>
          `${formatDate(c.date)} ${c.before.label}→${c.after.label}` +
          `（${c.after.grade > c.before.grade ? '悪化' : '改善'}）`,
      )
      .join('、');
    text.textContent =
      `前回の閲覧（${at.getMonth() + 1}月${at.getDate()}日${at.getHours()}時ごろ）から` +
      `判定が変わりました: ${changeText}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'diff-close';
    close.textContent = '閉じる';
    close.addEventListener('click', () => {
      diffBanner.hidden = true;
      try {
        localStorage.setItem(DIFF_DISMISSED_KEY, signature);
      } catch {
        // 保存できなくても閉じる操作自体は成立させる
      }
    });
    // 悪化のときだけ警告アイコンを付ける（改善の知らせに△!を付けると文意と食い違う。
    // 悪化/改善の別は本文と配色クラスが担う）
    diffBanner.replaceChildren(
      ...(worsened ? [faIcon('triangle-exclamation', 'btn-icon')] : []),
      text,
      close,
    );
    diffBanner.hidden = false;
  }

  /** 予報を取得して描画する
   * @param {string} query APIへのクエリ文字列
   * @param {string} locationName 表示する地点名（成功時にラベルへ反映）
   * @param {object} [options]
   * @param {number | null} [options.cityIndex] 地点セレクト由来の場合のCITIESインデックス（記憶用）
   * @param {boolean} [options.persist] falseなら記憶もURL反映もしない（現在地用）
   * @param {string | null} [options.storedName] 記憶に使う名前（URL由来の名前を信頼しない場合に指定）
   * @param {string | null} [options.urlName] URL・共有リンクに載せる名前。
   *   省略時はlocationNameを使う。locationNameに画面だけの注記（「（共有・…）」など）を
   *   付ける場合は、注記なしの名前をここで渡すこと。注記付きのままURLへ書き戻すと、
   *   その共有リンクを開くたびに注記が積み重なって名前が伸び、80文字で切られて壊れる */
  async function loadForecast(query, locationName, options = {}) {
    const { cityIndex = null, persist = true, storedName = null, urlName = null } = options;
    // URL・共有リンクに載せる名前（注記なし）。空文字ならURLに名前を載せない
    const shareName = urlName ?? locationName;
    // 確定ロードは保留中のセレクトデバウンスと検索応答を無効化し、後から
    // 古い地点選択・検索候補が発火して最後の明示操作を上書きするのを防ぐ
    cancelPendingCitySelect();
    searchSeq += 1;
    // 「予報を更新」が常に「最後に要求した条件の再試行」になるよう、
    // クエリと地点名は成功を待たずペアで記録する（表示ラベルの更新は成功時のみ）
    lastQuery = query;
    lastLocationName = locationName;
    lastOptions = options;
    const seq = ++requestSeq;
    setStatus('予報を取得しています…', false);
    try {
      // 第2引数は通信断時に表示する日本語の定型文（差し替えの仕組みはfetchJsonBodyを参照）
      const { response, body } = await fetchJsonBody(
        `/api/forecast?${query}&days=${FORECAST_DAYS}`,
        '通信に失敗しました。ネットワーク接続を確認して「予報を更新」をお試しください。',
      );
      if (seq !== requestSeq) {
        // より新しいリクエストが始まっているので、この応答は破棄する
        return;
      }
      throwIfHttpError(response, body, '予報の取得');
      // JSONとして妥当でも予報の形をしていないボディ（中間プロキシの200応答など）は、
      // 後続の描画でTypeErrorの生メッセージが出る前にここで弾く
      // （days・hours・noticesは描画経路が無条件に反復する配列のためすべて検証する）
      if (
        !body ||
        !Array.isArray(body.days) ||
        !Array.isArray(body.hours) ||
        !Array.isArray(body.notices)
      ) {
        throw new Error('予報データを正しく受け取れませんでした。しばらくたってから「予報を更新」をお試しください。');
      }

      currentForecast = body;
      // 再取得時は選択中の日が新しいデータにも存在すれば維持する
      // （「予報を更新」のたびに初日へ戻ると、読んでいる表と利用者の認識がずれるため）
      const dates = body.days.map((d) => d.date);
      selectedDate = dates.includes(selectedDate) ? selectedDate : (dates[0] ?? null);

      // 取得後に空白へ戻さず、完了が分かるメッセージを表示したままにする
      // （詳細な読み上げは#sr-announceのサマリーが担うため、ここは短い文言でよい）
      displayedFromCache = response.headers.get('X-Served-From-Cache') === '1';
      displayedCachedAtText = displayedFromCache ? cachedAtTimeText(response) : null;
      setStatus(displayedFromCache ? cachedStatusText(response) : '予報を取得しました。', false);
      setLocationLabel(locationName);
      // 共有ボタンは「表示に成功した地点」を対象にする（失敗し得るlastQueryとは分ける）。
      // 名前は画面用ラベルではなく注記なしのshareNameを使う（共有のたびに注記が
      // 積み重なるのを防ぐ）
      displayedQuery = query;
      displayedName = shareName;
      // お気に入り登録には記憶と同じ名前を使う（共有URL由来の名前を鵜呑みにしないため）。
      // 現在地（persist: false）とデモはプライバシー約束のため登録不可にする
      displayedStorable = persist && query !== DEMO_QUERY;
      displayedStoredName = storedName ?? locationName;
      displayedCityIndex = cityIndex;
      updateFavoriteToggle();
      updateDisplayLink();
      if (query !== DEMO_QUERY) {
        if (persist) {
          // 次回アクセス時に同じ地点を表示できるよう記憶し、表示中の地点をURLにも
          // 反映してそのまま共有・ブックマークできるようにする。
          // 記憶する名前はstoredName優先（共有URL由来の名前を鵜呑みにしないため）
          writeStoredLocation(query, storedName ?? locationName, cityIndex);
          window.history.replaceState(null, '', `?${shareQueryString(query, shareName)}`);
        } else {
          // 現在地は「位置情報は保存しません」の約束どおり記憶もURL反映もしない。
          // 以前の地点パラメータが残っているとアドレスバーと表示が食い違うため消す
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
      renderForecast();
      // 印刷用ワンシートの発行情報（いつ・どの地点の予報を印刷したかを紙に残す）。
      // オフライン表示の保存済み予報は、発行時刻だけだと最新と誤認されるため
      // 取得時刻を明記する
      const printedAt = new Date();
      document.getElementById('print-meta').textContent =
        `発行: ${printedAt.getFullYear()}年${printedAt.getMonth() + 1}月${printedAt.getDate()}日` +
        `${printedAt.getHours()}時${String(printedAt.getMinutes()).padStart(2, '0')}分・` +
        `${locationName}・` +
        (displayedFromCache
          ? `※${displayedCachedAtText ?? '以前'}に取得したオフライン表示の予報（最新ではない可能性があります）・`
          : '') +
        '最新の予報は https://fursuit-weather.223n.tech/';
      // 前回見た予報との差分（記憶中の地点・お気に入りのみ。現在地・デモ・
      // 一時的に見ただけの地点はスナップショットも残さない）
      if (displayedStorable && isSnapshotAllowed(query)) {
        renderForecastDiff(query, body);
        writeForecastSnapshot(query, body);
      } else {
        diffBanner.hidden = true;
      }

      // スクリーンリーダーへ読み込み完了とその日の要点を通知する
      srAnnounce.textContent = buildSpokenSummary(body, locationName);
      // 呼び出し元が表示成功後の追加処理（イベント開催日のタブ切り替えなど）を
      // 行えるよう、成功をtrueで返す（破棄・失敗時はundefined）
      return true;
    } catch (error) {
      if (seq !== requestSeq) {
        return;
      }
      setStatus(`エラー: ${error.message}`, true);
      // 予報を表示できないときは読み込み中のプレースホルダーを消す
      if (!currentForecast) {
        nowCard.replaceChildren();
        dayCardsElement.replaceChildren();
        hoursBody.replaceChildren();
      }
    }
  }

  /** オフライン表示の予報の取得時刻の表示文を作る（X-*ヘッダーはsw.jsが付ける） */
  function cachedAtTimeText(response) {
    const cachedAt = new Date(response.headers.get('X-Cached-At') ?? NaN);
    return Number.isNaN(cachedAt.getTime())
      ? '以前'
      : `${cachedAt.getMonth() + 1}月${cachedAt.getDate()}日${cachedAt.getHours()}時${String(cachedAt.getMinutes()).padStart(2, '0')}分`;
  }

  /**
   * オフライン表示（Service Workerの保存済み予報）の案内文を作る
   * その旨と取得時刻を利用者へ明示する
   */
  function cachedStatusText(response) {
    return `オフライン表示: ${cachedAtTimeText(response)}に取得した予報を表示しています。最新ではない可能性があります。`;
  }

  /** 取得済みの予報（currentForecast・selectedDate）から画面全体を描画し直す */
  function renderForecast() {
    renderNowCard();
    renderDayCards();
    renderNotices();
    // 取得できた日数に合わせて日付タブとプランナーの日付候補を更新し、
    // 地点や取得結果が変わったら古い前提の計画を残さない
    updateDayTabs();
    populatePlanDates();
    clearPlan();
    // 着用タイマーの開始ボタンの表示と、表示中のタイマーの判定バッジを合わせる
    updateTimerButton();
    // 当日ボードの自動の上限は「いまの判定」に連動するため、予報の描画と同時に更新する
    // （boardStateは初期化前のみnull。初期化後は常に最新の判定を反映する）
    if (boardState) {
      renderBoard();
    }

    if (selectedDate) {
      renderHours();
    }
  }

  /** 選択中の都市で予報を読み込む（完了を待てるようloadForecastの結果を返す） */
  function loadSelectedCity() {
    const cityIndex = Number(citySelect.value);
    const city = CITIES[cityIndex];
    if (!city) {
      return undefined;
    }
    return loadForecast(coordQuery(city.lat, city.lon), city.name, { cityIndex });
  }

  // 地点セレクトの選択肢はレイアウトシフト防止のためindex.htmlに静的に記載している
  // （valueはCITIES配列のインデックスに対応）
  // changeは矢印キーでの選択肢探索でも発火するため、デバウンスして
  // 連続操作中の取得と読み上げ通知の洪水を防ぐ（確定は600ms静止後）
  citySelect.addEventListener('change', () => {
    cancelPendingCitySelect();
    cityChangeTimer = setTimeout(() => {
      cityChangeTimer = null;
      loadSelectedCity();
    }, 600);
  });

  // 「この地点を使う」: 現在地やデモの表示中でも、セレクトで選んだ地点にいつでも戻れる
  // （セレクトの値が変わらないとchangeイベントが発火しないため、明示的なボタンを用意）
  document.getElementById('city-button').addEventListener('click', loadSelectedCity);

  // 「予報を更新」は直前に要求した条件（現在地・デモを含む）で再取得する
  // （記憶可否などのオプションも引き継ぎ、現在地の再取得で座標が保存されないようにする）
  document.getElementById('reload-button').addEventListener('click', () => {
    if (lastQuery) {
      loadForecast(lastQuery, lastLocationName, lastOptions ?? {});
    } else {
      loadSelectedCity();
    }
  });

  // 見守りモード: 表示中の地点を10分ごとに自動再取得し、「いまの判定」の変化を
  // 画面内ハイライトと短いチャイムで知らせる。検知は判定帯の変化のみで、
  // 独自のしきい値は持ち込まない。トグルは意図しない自動取得ループを避けるため
  // 記憶しない（開くたびに明示的にONにする）
  const watchToggle = document.getElementById('watch-toggle');
  const watchStatus = document.getElementById('watch-status');
  /** 再取得間隔（ブラウザキャッシュの10分と一致させ、上流コールを増やさない） */
  const WATCH_INTERVAL_MS = 10 * 60 * 1000;
  let watchTimer = null;
  /** 前回の「いまの判定」のレベルID（変化検知用。データなしはnull） */
  let watchLastLevel = null;
  /** 最後に再取得へ成功した時刻（ミリ秒。バックグラウンド復帰時の即時更新の判断に使う） */
  let watchLastUpdatedMs = 0;
  let watchHighlightTimer = null;

  /** 見守りの状態表示を更新する */
  function updateWatchStatus(text) {
    watchStatus.textContent = text;
    watchStatus.hidden = false;
  }

  /** 「HH:MM」表記（見守りの最終更新表示用） */
  function watchClockText(date) {
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  /** 判定変化の通知（画面内ハイライト+短いチャイム+読み上げ）。
   * 前面で開いているときだけ呼ばれる（バックグラウンドでは再取得自体を止める） */
  function notifyWatchChange(label) {
    nowCard.classList.remove('watch-changed');
    // 再フローを挟んでクラスを付け直し、CSSアニメーションを再発火させる
    // （連続変化でも毎回光る。getBoundingClientRectは同期レイアウトの強制目的）
    nowCard.getBoundingClientRect();
    nowCard.classList.add('watch-changed');
    clearTimeout(watchHighlightTimer);
    watchHighlightTimer = setTimeout(() => nowCard.classList.remove('watch-changed'), 6000);
    timerAlert(2);
    srAnnounce.textContent = `見守り: いまの判定が「${label}」に変わりました。`;
  }

  /**
   * 見守りの自動再取得
   * 明示操作（loadForecast）とは独立に動き、開始後に明示操作・地点変更・OFFが
   * あれば結果を黙って破棄する（requestSeqを増やさず「最後の明示操作が勝つ」を
   * 崩さない）。URL・記憶・共有状態も更新しない（表示中の地点の再取得のため）
   */
  async function watchRefresh() {
    if (document.visibilityState !== 'visible' || !displayedQuery) {
      return;
    }
    const seq = requestSeq;
    const query = displayedQuery;
    try {
      const { response, body } = await fetchJsonBody(
        `/api/forecast?${query}&days=${FORECAST_DAYS}`,
        '通信に失敗しました。',
      );
      if (watchTimer === null || seq !== requestSeq || query !== displayedQuery) {
        return;
      }
      throwIfHttpError(response, body, '予報の取得');
      if (!body || !Array.isArray(body.days) || !Array.isArray(body.hours) || !Array.isArray(body.notices)) {
        throw new Error('形式異常');
      }
      currentForecast = body;
      // 選択中の日を維持する（「予報を更新」と同じ配慮）
      const dates = body.days.map((d) => d.date);
      selectedDate = dates.includes(selectedDate) ? selectedDate : (dates[0] ?? null);
      renderForecast();
      const entry = currentHourEntry();
      const level = entry ? entry.outdoor.level : null;
      const changed = watchLastLevel !== null && level !== null && level !== watchLastLevel;
      watchLastLevel = level;
      watchLastUpdatedMs = Date.now();
      updateWatchStatus(`見守り中・最終更新 ${watchClockText(new Date())}`);
      if (changed) {
        notifyWatchChange(entry.outdoor.label);
      }
    } catch {
      if (watchTimer === null) {
        return;
      }
      // ベストエフォート: 画面は前回の予報のまま残し、次の周期で再試行する
      updateWatchStatus('見守り中・更新できませんでした（次の更新で再試行します）');
    }
  }

  watchToggle.addEventListener('change', () => {
    // チャイムの自動再生制限はユーザー操作の中で解いておく
    prepareTimerAudio();
    if (watchToggle.checked) {
      const entry = currentForecast ? currentHourEntry() : null;
      watchLastLevel = entry ? entry.outdoor.level : null;
      watchLastUpdatedMs = Date.now();
      watchTimer = setInterval(watchRefresh, WATCH_INTERVAL_MS);
      updateWatchStatus(`見守り中・最終更新 ${watchClockText(new Date())}`);
    } else {
      clearInterval(watchTimer);
      watchTimer = null;
      watchStatus.hidden = true;
      nowCard.classList.remove('watch-changed');
    }
  });

  // バックグラウンド中は再取得を止めているため、復帰時に前回から10分以上
  // 経っていればすぐ取り直す（次の周期まで最大10分古いまま待たせない）
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      watchTimer !== null &&
      Date.now() - watchLastUpdatedMs >= WATCH_INTERVAL_MS
    ) {
      watchRefresh();
    }
  });

  document.getElementById('geolocation-button').addEventListener('click', () => {
    // GPS取得待ちの間に保留中のセレクトデバウンスが発火しないよう先に解除する
    cancelPendingCitySelect();
    if (!navigator.geolocation) {
      setStatus('このブラウザは位置情報に対応していません。', true);
      return;
    }
    setStatus('現在地を取得しています…', false);
    // GPS取得中に別の地点操作でロードが始まっていたら、遅れて届いた結果は破棄する
    // （requestSeqのfetch応答ガードはコールバック起点の新規ロードには効かないため）
    const startedAt = requestSeq;
    // 取得中に新しいロードが始まった、または新しいセレクト操作が保留されて
    // いたら、遅れて届いたGPS結果はそちらに譲る（最後の明示操作が勝つ）。
    // コールバック到着時に評価するため関数にしておく
    const superseded = () => requestSeq !== startedAt || cityChangeTimer !== null;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (superseded()) {
          return;
        }
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        loadForecast(
          // プライバシー保護: GPS座標はcoordQueryが小数2桁（約1km）へ丸める
          coordQuery(lat, lon),
          describeCurrentLocation(lat, lon),
          // 現在地の座標はlocalStorageにもURLにも残さない（「保存しません」の約束）。
          // 共有リンクの名前は座標由来の説明だけにする（受け取った人にとっては
          // 「現在地」ではないうえ、画面用の語がURLへ流れると共有のたびに積み重なる）
          { persist: false, urlName: nearestCityText(lat, lon) },
        );
      },
      (geoError) => {
        if (superseded()) {
          return;
        }
        // 最頻原因の許可拒否（code=1）だけは、次に何をすればよいかが分かる文面にする
        setStatus(
          geoError.code === 1
            ? '現在地の利用が許可されていません。ブラウザの設定で位置情報を許可するか、都市の選択や地点検索をご利用ください。'
            : '現在地を取得できませんでした。地点を選択してください。',
          true,
        );
      },
      // 位置情報源が応答しない環境でコールバックが来ず「取得しています…」のまま
      // 固まらないよう、待ち時間を有界にする（TIMEOUTは上のエラー表示に合流する）。
      // maximumAgeは直近1分のキャッシュ位置を許容し、再クリック時の応答を速くする
      { timeout: 15000, maximumAge: 60000 },
    );
  });

  // 「予報を共有」: 表示に成功している地点の共有URLをOSの共有機能または
  // クリップボードで渡す（要求中・失敗中のlastQueryではなくdisplayedQueryを使い、
  // 画面の予報と共有URLが常に一致するようにする）
  const shareIncludePlan = document.getElementById('share-include-plan');
  document.getElementById('share-button').addEventListener('click', async () => {
    let shareUrl = `${window.location.origin}/`;
    if (displayedQuery === DEMO_QUERY) {
      shareUrl = `${window.location.origin}/?${DEMO_QUERY}`;
    } else if (displayedQuery) {
      const params = new URLSearchParams(shareQueryString(displayedQuery, displayedName));
      // 任意設定: 見ている日付とプランナーの時間帯（date/from/to）を含める。
      // 開いた側は最新の予報で再計算されるため、古い画面写真を信じる事故を防げる
      if (shareIncludePlan.checked && currentForecast && selectedDate) {
        params.set('date', selectedDate);
        params.set('from', planStart.value);
        params.set('to', planEnd.value);
      }
      shareUrl = `${window.location.origin}/?${params.toString()}`;
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'FursuitWeather - 着ぐるみ天気予報',
          text: `${displayedName || '選択した地点'}の着ぐるみ天気予報`,
          url: shareUrl,
        });
      } catch {
        // 共有シートのキャンセルは正常な操作のため何もしない
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus('共有用URLをコピーしました。', false);
    } catch {
      setStatus('URLをコピーできませんでした。アドレスバーのURLをご利用ください。', true);
    }
  });

  // 印刷用ワンシート: 印刷レイアウトは@media print（style.css）が担う。
  // ブラウザの印刷ダイアログを開くだけで、A4縦1枚の要約が出る
  document.getElementById('print-button').addEventListener('click', () => {
    if (!currentForecast) {
      setStatus('先に予報を読み込んでください。', true);
      return;
    }
    window.print();
  });

  // 会場表示モード（display.html）への導線: 表示に成功している地点を引き継いだ
  // URLをリンクに設定する。共有と同じく注記なしの名前（displayedName）を使う
  const displayLink = document.getElementById('display-link');

  /** 会場表示モードのリンク先を表示中の地点に合わせて更新する */
  function updateDisplayLink() {
    if (!displayedQuery) {
      displayLink.hidden = true;
      return;
    }
    displayLink.setAttribute(
      'href',
      displayedQuery === DEMO_QUERY
        ? '/display?demo=1'
        : `/display?${shareQueryString(displayedQuery, displayedName)}`,
    );
    displayLink.hidden = false;
  }

  // お気に入り地点: チップで即切り替え、トグルボタンで表示中の地点を追加/解除する
  const favoritesList = document.getElementById('favorites-list');
  const favoriteToggleButton = document.getElementById('favorite-toggle-button');

  /** お気に入りチップ一覧を描画し直す */
  function renderFavorites() {
    const favorites = readFavorites();
    if (favorites.length === 0) {
      // 未登録のときは空欄にせず、登録方法への導線を示す
      const hint = document.createElement('li');
      hint.className = 'favorites-empty';
      hint.textContent = '（下の「お気に入りに追加」で登録できます）';
      favoritesList.replaceChildren(hint);
      return;
    }
    const items = favorites.map((fav) =>
      createLocationItem(fav.name, () => {
        loadForecast(fav.query, fav.name, {
          cityIndex: fav.cityIndex,
          storedName: fav.name,
        });
      }),
    );
    favoritesList.replaceChildren(...items);
  }

  /** トグルボタンの文言と有効/無効を表示中の地点に合わせる */
  function updateFavoriteToggle() {
    const registered =
      displayedStorable && readFavorites().some((fav) => fav.query === displayedQuery);
    favoriteToggleButton.disabled = !displayedStorable;
    favoriteToggleButton.replaceChildren(
      faIcon('star', 'btn-icon'),
      document.createTextNode(registered ? 'お気に入り解除' : 'お気に入りに追加'),
    );
    // 現在地・デモで無効化する理由を補足する（プライバシー約束との整合）
    favoriteToggleButton.title = displayedStorable
      ? ''
      : '現在地とデモ表示はお気に入りに追加できません（位置情報は保存しません）';
  }

  favoriteToggleButton.addEventListener('click', () => {
    if (!displayedStorable) {
      return;
    }
    const favorites = readFavorites();
    const index = favorites.findIndex((fav) => fav.query === displayedQuery);
    if (index >= 0) {
      const removed = favorites.splice(index, 1)[0];
      writeFavorites(favorites);
      setStatus(`「${removed.name}」をお気に入りから外しました。`, false);
    } else {
      if (favorites.length >= MAX_FAVORITES) {
        setStatus(
          `お気に入りは${MAX_FAVORITES}件までです。どれかを解除してから追加してください。`,
          true,
        );
        return;
      }
      favorites.push({
        query: displayedQuery,
        name: displayedStoredName,
        cityIndex: displayedCityIndex,
      });
      writeFavorites(favorites);
      setStatus(`「${displayedStoredName}」をお気に入りに追加しました。`, false);
    }
    renderFavorites();
    updateFavoriteToggle();
  });

  // 初期化時にチップを描画する（記憶済みのお気に入りを最初の描画から見せる）
  renderFavorites();

  // 地点検索: 都市名・郵便番号を/api/geocode（Worker経由のジオコーディング）で検索し、
  // 候補をボタンとして表示する。選択で予報を読み込む
  const searchInput = document.getElementById('place-search');
  const searchResults = document.getElementById('search-results');
  const searchResultsBox = document.getElementById('search-results-box');

  /** 検索結果の候補表示を消す */
  function clearSearchResults() {
    searchResultsBox.hidden = true;
    searchResults.replaceChildren();
  }

  async function fetchGeocode(query) {
    return fetchJsonBody(
      `/api/geocode?q=${encodeURIComponent(query)}`,
      '通信に失敗しました。ネットワーク接続を確認してください。',
    );
  }

  async function searchPlace() {
    const query = searchInput.value.trim();
    if (query === '') {
      setStatus('都市名または郵便番号を入力してください。', true);
      return;
    }
    // 連続検索・検索後の確定操作（候補選択・地点セレクトなど）より後に届いた
    // 古い応答が候補やステータスを上書きしないよう、世代番号で守る
    const seq = ++searchSeq;
    clearSearchResults();
    setStatus('地点を検索しています…', false);
    try {
      const { response, body } = await fetchGeocode(query);
      if (seq !== searchSeq) {
        return;
      }
      throwIfHttpError(response, body, '地点検索');
      if (!body || !Array.isArray(body.results)) {
        throw new Error('検索結果を正しく受け取れませんでした。しばらくたってからもう一度お試しください。');
      }
      const places = body.results
        .filter(
          (place) =>
            typeof place.name === 'string' &&
            typeof place.latitude === 'number' &&
            typeof place.longitude === 'number',
        )
        .map((place) => ({
          label: placeLabel(place.name, place.admin1),
          latitude: place.latitude,
          longitude: place.longitude,
        }));
      if (places.length === 0) {
        setStatus('該当する地点が見つかりませんでした。市区町村名や別の表記でお試しください。', true);
        return;
      }
      const selectPlace = (choice) => {
        clearSearchResults();
        searchInput.value = '';
        loadForecast(coordQuery(choice.latitude, choice.longitude), choice.label);
      };
      // 候補が1件だけなら選ばせる必要がないため、そのまま予報を表示する
      // （郵便番号検索は市区町村1件に決まることが多く、この経路になる）
      if (places.length === 1) {
        selectPlace(places[0]);
        return;
      }
      const items = places.map((choice) =>
        createLocationItem(choice.label, () => selectPlace(choice)),
      );
      // 追記ではなく全置換にして、万一の競合でも新旧候補が混在しないようにする
      searchResults.replaceChildren(...items);
      searchResultsBox.hidden = false;
      setStatus(
        `地点の候補が${places.length}件見つかりました。検索欄の下の一覧から選択してください。`,
        false,
      );
    } catch (error) {
      if (seq !== searchSeq) {
        return;
      }
      setStatus(`エラー: ${error.message}`, true);
    }
  }

  document.getElementById('search-button').addEventListener('click', searchPlace);
  searchInput.addEventListener('keydown', (event) => {
    // 検索欄でのEnterはフォーム送信ではなく検索を実行する
    if (event.key === 'Enter') {
      event.preventDefault();
      searchPlace();
    }
  });

  // イベント予報: あらかじめ定義したイベント（/events.json）を読み込み、
  // 選択したイベントの開催地の予報を表示する。定義の書き方はdocs/events.md
  const eventSelect = document.getElementById('event-select');
  const eventButton = document.getElementById('event-button');
  /** 表示可能なイベント一覧（セレクトのvalueはこの配列のインデックス） */
  let eventList = [];

  /** 日付文字列がYYYY-MM-DD形式かつ実在する日付かを判定する
   * （2026-02-30のような書き間違いをここで弾く。test/events.test.tsと同じ基準） */
  function isValidDateText(text) {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return false;
    }
    const { year, month, day, utc } = parseDateText(text);
    const date = new Date(utc);
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  /** 時刻文字列がHH:MM形式（00:00〜23:59）かを判定する */
  function isValidTimeText(text) {
    return typeof text === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  }

  /** 郵便番号がハイフン区切り（123-4567）または7桁の数字かを判定する
   * （どちらの形式でも/api/geocodeが受け付ける） */
  function isValidZipText(text) {
    return typeof text === 'string' && /^\d{3}-?\d{4}$/.test(text);
  }

  /** YYYY-MM-DD同士の日数差（toDate − fromDate、日数） */
  function daysBetween(fromDate, toDate) {
    return Math.round((parseDateText(toDate).utc - parseDateText(fromDate).utc) / 86400000);
  }

  /** イベントの日付の表示文を作る。翌年以降の開催は年を添えて取り違えを防ぐ */
  function formatEventDate(dateText) {
    const { year } = parseDateText(dateText);
    const prefix = year === parseDateText(nowInJst().date).year ? '' : `${year}年`;
    return `${prefix}${formatDate(dateText)}`;
  }

  /** イベントの開催期間の表示文を作る（単日は日付のみ）
   * 「〜」の読み上げは環境依存だが、option要素は装飾を持てないためそのまま使う
   * （開始・終了の日付自体は読み上げられるため意味は伝わる） */
  function formatEventPeriod(event) {
    return event.startDate === event.endDate
      ? formatEventDate(event.startDate)
      : `${formatEventDate(event.startDate)}〜${formatEventDate(event.endDate)}`;
  }

  /** /events.jsonを読み込んでセレクトの選択肢を作る。
   * 定義がない・読み込めない場合はその旨の表示にして無効化する（表示は壊さない） */
  async function initEvents() {
    let emptyMessage = '予定されているイベントはありません';
    try {
      const response = await fetch('/events.json');
      if (!response.ok) {
        // メッセージはcatch側で固定文言に置き換わるため持たない
        throw new Error();
      }
      const body = await response.json();
      if (body && Array.isArray(body.events)) {
        const today = nowInJst().date;
        eventList = body.events
          // 形式が不正な項目は表示しない（定義ミスで画面全体を壊さないための防御。
          // 形式はtest/events.test.tsがCIでも検証する）
          .filter(
            (event) =>
              event &&
              typeof event.name === 'string' &&
              event.name !== '' &&
              typeof event.place === 'string' &&
              event.place !== '' &&
              isValidZipText(event.zip) &&
              isValidDateText(event.startDate) &&
              (event.endDate === undefined || isValidDateText(event.endDate)) &&
              (event.startTime === undefined || isValidTimeText(event.startTime)) &&
              (event.endTime === undefined || isValidTimeText(event.endTime)),
          )
          .map((event) => ({ ...event, endDate: event.endDate ?? event.startDate }))
          // 終了日が開始日より前の不正な定義と、終了済みのイベントは表示しない
          // （前者はtest/events.test.tsと同じ基準の防御）。残りは開催が近い順に並べる
          // （日付はJST基準で比較。YYYY-MM-DD形式のため文字列比較で前後を正しく判定できる。
          //   開始日が同じイベントは定義順を保つ）
          .filter((event) => event.endDate >= event.startDate && event.endDate >= today)
          .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
      }
    } catch {
      emptyMessage = 'イベント情報を読み込めませんでした';
    }
    eventSelect.replaceChildren();
    if (eventList.length === 0) {
      // 再実行（開催終了の検知時）で空になった場合に、押しても何も起きない
      // ボタンが残らないよう初期状態へ戻す
      disablePicker(eventSelect, eventButton, emptyMessage);
      return;
    }
    eventList.forEach((event, index) => {
      eventSelect.appendChild(
        new Option(`${event.name}（${formatEventPeriod(event)}・${event.place}）`, String(index)),
      );
    });
    eventSelect.disabled = false;
    eventButton.disabled = false;
  }

  /** 郵便番号から開催地の座標を1件解決する（候補が無ければnull）。
   * 郵便番号→市区町村名→座標の変換はWorker側（/api/geocode）が担う */
  async function geocodeZip(zip) {
    const { response, body } = await fetchGeocode(zip);
    throwIfHttpError(response, body, '地点検索');
    const first = body && Array.isArray(body.results) ? body.results[0] : null;
    if (!first || typeof first.latitude !== 'number' || typeof first.longitude !== 'number') {
      return null;
    }
    // 解決先の地名も返す。郵便番号は市区町村の代表点へ解決されるため、
    // どこの予報を見ているのかを画面に示して取り違えに気付けるようにする
    const name = typeof first.name === 'string' ? first.name : '';
    const admin1 = typeof first.admin1 === 'string' ? first.admin1 : '';
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      // 空名のときだけ空文字（呼び出し側が郵便番号表記で代替する）
      label: name === '' ? '' : placeLabel(name, admin1),
    };
  }

  /** 対象日のイベント開催時間を活動プランナーへ設定する。
   *
   * startTime・endTime は開催期間全体の開始・終了時刻のため、複数日開催では
   * 「その日の開催時間」が定義から決まらない（初日の終了時刻も最終日の開始
   * 時刻も分からない）。0時・24時で補うと、開催していない夜間の時間まで
   * 着用可能時間の合計に積み上がり、熱中症対策の目安が安全側から外れる。
   * そのため時刻を設定するのは単日開催のときだけにする。
   * 設定できたときは利用者へ示す説明文を返す（設定しない場合はnull） */
  function applyEventPlanTimes(event, targetDate) {
    // 日付だけは対象日に合わせておく（時間帯は利用者が選ぶ）
    planDate.value = targetDate;
    // 前の条件で作った計画は前提が変わるため消す（プランナーは操作起点で作り直す）
    clearPlan();
    if (
      event.startDate !== event.endDate ||
      event.startTime === undefined ||
      event.endTime === undefined
    ) {
      return null;
    }
    const startHour = Number.parseInt(event.startTime.slice(0, 2), 10);
    // 終了時刻は時間単位へ切り上げる（19:30終了なら20時までを計画に含める）
    const endHourBase = Number.parseInt(event.endTime.slice(0, 2), 10);
    const endHour = event.endTime.endsWith(':00') ? endHourBase : endHourBase + 1;
    if (startHour >= endHour) {
      return null;
    }
    planStart.value = String(startHour);
    planEnd.value = String(endHour);
    return `開催時間（${startHour}時〜${endHour}時）`;
  }

  /** 選択中のイベントの開催地の予報を表示する。
   * 開催日が取得済みの予報に含まれていればその日のタブへ切り替える */
  async function showEventForecast() {
    const event = eventList[Number(eventSelect.value)];
    if (!event) {
      return;
    }
    // ページを開いたまま日付が変わると、初期化時に作った一覧に終了済みが残る。
    // 過去日の予報を探して的外れな案内をしないよう、ここで一覧を作り直す
    if (event.endDate < nowInJst().date) {
      setStatus(`「${event.name}」は開催が終了しました。イベント一覧を更新しました。`, true);
      await initEvents();
      return;
    }
    // 表示待ちの間の明示的なタブ操作を、完了後の自動切り替えで上書きしないためのガード
    const tabSeqAtStart = manualTabSeq;
    // 保留中のセレクト操作が郵便番号の検索中に発火して、この明示操作を
    // 追い越さないよう先に解除する（loadForecast・現在地ボタンと同じ扱い）
    cancelPendingCitySelect();
    // 直前の地点検索の候補が残っていると、どれが表示中か紛らわしいため消す
    clearSearchResults();
    // 開催地は郵便番号から検索する（地点検索と同じ/api/geocode経由。
    // 古い応答が新しい操作を上書きしないよう、地点検索と同じ世代番号で守る）
    const seq = ++searchSeq;
    setStatus(`「${event.name}」の開催地（〒${event.zip}）を検索しています…`, false);
    let place;
    try {
      place = await geocodeZip(event.zip);
    } catch (error) {
      if (seq === searchSeq) {
        setStatus(`エラー: ${error.message}`, true);
      }
      return;
    }
    if (seq !== searchSeq) {
      // より新しい操作が始まっているため、この結果は破棄する
      return;
    }
    if (!place) {
      setStatus(
        `「${event.name}」の開催地（〒${event.zip}）が見つかりませんでした。地点検索からお探しください。`,
        true,
      );
      return;
    }
    // 表示は会場名＋実際に解決された地名（郵便番号は市区町村の代表点へ
    // 解決されるため、どこの予報かを示して取り違えに気付けるようにする）
    const label =
      place.label === ''
        ? `${event.name}（${event.place}）`
        : `${event.name}（${event.place}・${place.label}付近）`;
    const loaded = await loadForecast(
      coordQuery(place.latitude, place.longitude),
      label,
      // 記憶・お気に入りにはイベント名を残さず地名を使う。イベントは日付を
      // 過ぎれば意味を失うが、記憶した地点は次回以降も表示され続けるため
      { storedName: place.label === '' ? `〒${event.zip}付近` : place.label },
    );
    if (!loaded) {
      return;
    }
    // 開催中（今日が期間内）なら今日、これからなら初日の予報を見せる
    const today = nowInJst().date;
    const targetDate = event.startDate <= today && today <= event.endDate ? today : event.startDate;
    const dayTab = dayTabForDate(targetDate);
    // オフライン表示中も案内は出すが、保存済み予報である注記（安全に関わる）は前置きして残す
    const prefix = displayedFromCache ? 'オフライン表示（保存済みの予報）: ' : '';
    if (dayTab) {
      const planText = applyEventPlanTimes(event, targetDate);
      // 利用者が待っている間に別のタブを選んでいたら、その操作を尊重して切り替えない
      if (manualTabSeq === tabSeqAtStart) {
        forecastTabs.activate(dayTab.tabId, false);
      }
      const message =
        `${prefix}「${event.name}」開催日（${formatDate(targetDate)}）の予報です。` +
        (planText ? `活動プランナーに${planText}を設定しました。` : '');
      setStatus(message, false);
      // 読み上げサマリーは常に当日の予報を述べるため、対象日が今日でない
      // ときに食い違う。開催日を明示した文で上書きする
      srAnnounce.textContent = message;
      // 固定リンク（?event=）の呼び出し元が失敗時のフォールバックを判断できるよう、
      // 予報の表示まで成功したことをtrueで返す（失敗・破棄時はundefined）
      return true;
    }
    // 開催日が予報範囲外。表示中がいつの予報かを明示し、開催日の予報では
    // ないことを言い切る（「直近の予報」だけでは開催日の予報と誤読されうる）
    const dates = currentForecast.days.map((d) => d.date);
    const range =
      dates.length > 1
        ? `${formatDate(dates[0])}〜${formatDate(dates[dates.length - 1])}`
        : formatDate(dates[0]);
    const message =
      `${prefix}「${event.name}」の開催日（${formatEventPeriod(event)}）は予報の範囲外です` +
      `（あと${daysBetween(today, event.startDate)}日）。` +
      `表示しているのは開催地の${range}の予報で、開催日の予報ではありません。`;
    setStatus(message, false, true);
    srAnnounce.textContent = message;
    return true;
  }

  eventButton.addEventListener('click', showEventForecast);
  initEvents().then(async () => {
    // イベント固定リンク（?event=イベント名）: 一覧が揃ってから該当イベントを
    // 自動選択して開催地の予報表示まで進める。見つからなければ通常の初期表示へ
    if (pendingEventName === null) {
      return;
    }
    const name = pendingEventName;
    pendingEventName = null;
    // 一覧の読み込みを待つ間に利用者が地点を明示的に操作していたら（読み込みや
    // 検索はrequestSeq・searchSeqを必ず進める）、自動選択でその表示を上書きしない
    // （「最後の明示操作が勝つ」不変条件。?event=分岐は初期ロードを行わないため、
    //   どちらかが0でなければ利用者の操作があったと判断できる）
    if (requestSeq !== 0 || searchSeq !== 0) {
      return;
    }
    const index = eventList.findIndex((event) => event.name === name);
    if (index >= 0) {
      eventSelect.value = String(index);
      const shown = await showEventForecast();
      // 開催地の解決や予報の取得に失敗して何も表示されていないときは、
      // スケルトンのまま放置せず通常の予報へフォールバックする
      if (!shown && !currentForecast) {
        await loadInitialStoredOrDefault();
        setStatus(
          `URLで指定されたイベント「${name}」の開催地の予報を表示できませんでした。かわりに通常の予報を表示しています。`,
          false,
          true,
        );
      }
      return;
    }
    // 通常表示の完了メッセージで消えないよう、読み込み後に案内を出す
    // （通信エラーではないため、赤のエラーではなく黄の注意で示す）。
    // 読み込み自体が失敗したときはエラー表示を残し、虚偽の案内で上書きしない
    const loaded = await loadInitialStoredOrDefault();
    if (loaded) {
      setStatus(
        `URLで指定されたイベント「${name}」は一覧にありません（開催終了・名称変更の可能性があります）。かわりに通常の予報を表示しています。`,
        false,
        true,
      );
    }
  });

  // 活動プランナー: 選んだ日付の指定時間帯から、休憩を挟んだ着用計画の目安を作る
  const planDate = document.getElementById('plan-date');
  const planButton = document.getElementById('plan-button');
  const planStart = document.getElementById('plan-start');
  const planEnd = document.getElementById('plan-end');
  const planResult = document.getElementById('plan-result');

  // 時刻の選択肢を生成する（開始0〜23時、終了1〜24時。既定は10〜16時）
  for (let hour = 0; hour < 24; hour += 1) {
    planStart.appendChild(new Option(`${hour}時`, String(hour)));
    planEnd.appendChild(new Option(`${hour + 1}時`, String(hour + 1)));
  }
  planStart.value = '10';
  planEnd.value = '16';

  /** 取得済みの予報からプランナーの日付候補を作り直す（選択は可能なら維持する） */
  function populatePlanDates() {
    const previous = planDate.value;
    planDate.replaceChildren();
    if (!currentForecast) {
      disablePicker(planDate, planButton, '予報を読み込むと選べます');
      return;
    }
    planDate.disabled = false;
    planButton.disabled = false;
    const names = ['今日', '明日', '明後日'];
    currentForecast.days.forEach((day, index) => {
      const prefix = names[index] ? `${names[index]} ` : '';
      planDate.appendChild(new Option(`${prefix}${formatDate(day.date)}`, day.date));
    });
    if ([...planDate.options].some((option) => option.value === previous)) {
      planDate.value = previous;
    }
  }

  /** プランナーの結果を消す（地点・日付が変わったとき、古い前提の計画を残さない） */
  function clearPlan() {
    planResult.replaceChildren();
    // 持ち物リストも前提（対象日・地点）が変わるため隠す（計画の作成で再表示される）
    packingSection.hidden = true;
    lastPacking = null;
  }

  /** 選んだ日付の指定時間帯の計画を描画する */
  function renderPlan() {
    const planDateValue = planDate.value;
    if (!currentForecast || !planDateValue) {
      setStatus('先に予報を読み込んでください。', true);
      return;
    }
    const start = Number(planStart.value);
    const end = Number(planEnd.value);
    if (start >= end) {
      setStatus('終了時刻は開始時刻より後にしてください。', true);
      return;
    }
    const hours = hoursOnDate(planDateValue).filter((h) => {
      const hour = hourNumberOf(h.time);
      return hour >= start && hour < end;
    });
    if (hours.length === 0) {
      planResult.replaceChildren(
        hintParagraph('選択した時間帯の予報データがありません。別の時間帯か日付をお試しください。'),
      );
      setStatus('選択した時間帯の予報データがありませんでした。', true);
      return;
    }

    const heading = document.createElement('h3');
    heading.textContent = `${formatDate(planDateValue)} ${start}時〜${end}時の計画`;

    const list = document.createElement('ul');
    list.className = 'plan-hours';
    let totalMinutes = 0;
    const rainHours = [];
    for (const h of hours) {
      const hour = hourNumberOf(h.time);
      const item = document.createElement('li');
      item.appendChild(createBadge(h.outdoor));
      const text = document.createElement('span');
      if (h.outdoor.activityMinutes > 0) {
        text.textContent = `${hour}時台: 連続${h.outdoor.activityMinutes}分まで（残りは休憩・冷却）`;
        totalMinutes += h.outdoor.activityMinutes;
      } else {
        text.textContent = `${hour}時台: 着用中止`;
      }
      item.appendChild(text);
      list.appendChild(item);
      if (h.weather.precipitation > 0) {
        rainHours.push(`${hour}時`);
      }
    }

    const total = document.createElement('p');
    total.className = 'plan-total';
    total.textContent =
      totalMinutes > 0
        ? `この時間帯で着用できる合計の目安: 約${totalMinutes}分（1時間ごとに休憩を挟んだ場合）`
        : 'この時間帯の屋外での着用は推奨できません。屋内の冷房環境での活動をご検討ください。';

    const notes = document.createElement('ul');
    notes.className = 'plan-notes hint';
    if (rainHours.length > 0) {
      const rainNote = document.createElement('li');
      rainNote.appendChild(faIcon('cloud-rain', 'btn-icon weather-cloud-rain'));
      rainNote.appendChild(
        document.createTextNode(
          `降水の予報がある時間帯: ${rainHours.join('、')}。濡れたファーは乾きにくく冷えの原因になります。`,
        ),
      );
      notes.appendChild(rainNote);
    }
    // 終了時刻が日の入りの後なら、暗さ・冷え込みへの備えを促す
    const planDay = currentForecast.days.find((d) => d.date === planDateValue);
    if (planDay && planDay.sunset) {
      const sunsetMinutes =
        Number(planDay.sunset.slice(0, 2)) * 60 + Number(planDay.sunset.slice(3, 5));
      if (end * 60 > sunsetMinutes) {
        const sunsetNote = document.createElement('li');
        sunsetNote.appendChild(faIcon('sun', 'btn-icon'));
        sunsetNote.appendChild(
          document.createTextNode(
            `終了に選んだ${end}時は日の入り（${planDay.sunset}）の後です。` +
              '照明の準備と、日没後の冷え込み・視界の悪化にご注意ください。',
          ),
        );
        notes.appendChild(sunsetNote);
      }
    }
    // 暑熱リスクのある計画では、間が空いたときの慣らし（暑熱順化）を促す
    // （詳細は同じタブ内の啓発パネル。冬の計画には出さない）
    if (worstGradeOf(hours, false) >= 1) {
      const acclimatizationNote = document.createElement('li');
      acclimatizationNote.textContent =
        'しばらく（2週間以上）着ていないときは、初日は目安のおよそ半分から段階的に。' +
        '詳しくは下の「暑熱順化について」をご覧ください。';
      notes.appendChild(acclimatizationNote);
    }
    // 前回の着用実績（活動ふりかえり記録）を参考として示す。
    // 「前回できたから今日もいける」の危険側アンカリングを避ける文言を必ず併記する
    const lastWear = readWearLog().slice(-1)[0];
    if (lastWear) {
      const lastDate = new Date(lastWear.at + 9 * 60 * 60 * 1000);
      const wearNote = document.createElement('li');
      wearNote.textContent =
        `参考: 前回の着用（${lastDate.getUTCMonth() + 1}月${lastDate.getUTCDate()}日）は` +
        `${lastWear.minutes}分でした。間が空いたときは前回より短めから始めてください` +
        '（前回できた長さを今日の目安を緩める根拠にしないでください）。';
      notes.appendChild(wearNote);
    }
    const generalNote = document.createElement('li');
    generalNote.textContent =
      'あくまで目安です。体調を最優先し、予定より早めの休憩・中止をためらわないでください。';
    notes.appendChild(generalNote);

    // 休憩ガイド・持ち物は暑熱と低温で内容が逆になるため、gradeを側別に分けて渡す
    // （低温警戒=grade 2・低温危険=grade 4を暑熱の厳しさとして扱うと、氷点下の日に
    //   冷却手順や保冷剤を案内してしまう）
    const heatWorstGrade = worstGradeOf(hours, false);
    const coldWorstGrade = worstGradeOf(hours, true);
    planResult.replaceChildren(
      heading,
      list,
      total,
      notes,
      buildRestGuide(heatWorstGrade, coldWorstGrade),
    );
    renderPacking(planDateValue, hours);
    setStatus('活動計画を作成しました。', false);
  }

  /** 時間帯の中の最も厳しいgradeを、暑熱側/低温側に分けて求める（該当なしは0） */
  function worstGradeOf(hours, cold) {
    return Math.max(
      0,
      ...hours
        .filter((h) => String(h.outdoor.level).startsWith('cold') === cold)
        .map((h) => h.outdoor.grade),
    );
  }

  /** 休憩の質ガイドを作る。暑熱の厳しさに応じて冷却手順を、低温の厳しさに応じて
   * 保温手順を足す（判定が厳しいほど手順を増やす） */
  function buildRestGuide(heatGrade, coldGrade) {
    const guide = document.createElement('div');
    guide.className = 'rest-guide';
    const heading = document.createElement('h4');
    heading.appendChild(faIcon('snowflake', 'btn-icon'));
    heading.appendChild(document.createTextNode('休憩の質ガイド'));
    const list = document.createElement('ul');
    // 低温が主リスクの日は「風を当てる」を勧めない（体温を奪う方向のため）
    const items = [
      coldGrade >= 2 && heatGrade < 2
        ? 'ヘッドとハンドを外し、呼吸を整えて体調を確認する'
        : 'ヘッドとハンドを外し、顔と手に風を当てる',
      '水分と塩分を一緒にとる（汗をかいたら水だけにしない）',
    ];
    if (heatGrade >= 2) {
      items.push(
        '前腕から手を冷たい水につける（手のひら・前腕の冷却は体温を下げやすい）',
        '冷房の効いた室内か、日陰で風通しのよい場所に座って休む',
      );
    }
    if (heatGrade >= 3) {
      items.push(
        '首・脇の下・足の付け根を保冷剤で冷やす',
        '「30分着たら30分休む」を守り、次の着用前に体調を互いに確認する',
      );
    }
    if (coldGrade >= 2) {
      items.push(
        '風を避けた暖かい室内で休み、汗で湿ったインナーは早めに着替える',
        '温かい飲み物で体の内側から温める',
      );
    }
    if (coldGrade >= 3) {
      items.push('手足の感覚のにぶり・ふるえがあれば着用を中止し、保温を最優先する');
    }
    for (const text of items) {
      const item = document.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    }
    guide.append(heading, list);
    return guide;
  }

  // ---- この日の持ち物（予報連動チェックリスト） ----
  // 判定・降水・低温・乾燥指数から自動生成し、チェック状態と自由入力の持ち物は
  // この端末のlocalStorageにのみ保存する（サーバーへは何も送らない）

  const packingSection = document.getElementById('packing-section');
  const packingList = document.getElementById('packing-list');
  const packingCustomInput = document.getElementById('packing-custom-input');
  const PACKING_CHECKED_KEY = 'fursuitweatherPackingChecked';
  const PACKING_CUSTOM_KEY = 'fursuitweatherPackingCustom';
  const PACKING_CUSTOM_LIMIT = 10;
  /** 直近に生成した持ち物リストの条件（自由入力の追加後に同じ条件で作り直す用） */
  let lastPacking = null;

  /** 対象日のチェック状態を読む（日付が変わったら白紙から始める。
   * 前回イベントのチェック済み状態が別の日の準備に持ち越されると、
   * 「持った」と誤認して忘れ物につながるため） */
  function readPackingChecked(dateText) {
    const state = readPackingState(PACKING_CHECKED_KEY, null);
    return state && state.date === dateText && state.items && typeof state.items === 'object'
      ? state.items
      : {};
  }

  /** localStorageのJSON値を読む（壊れた保存・保存不可の環境はfallback） */
  function readPackingState(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? '');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** localStorageへJSON値を書く（保存できない環境では黙って諦める） */
  function writePackingState(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 保存できなくても表示中のリスト自体は使える
    }
  }

  /** 対象日の予報から持ち物を自動生成する */
  function buildPackingItems(day, hours) {
    const items = ['飲み物（いつもより多めに）', 'タオル・着替えのインナー'];
    // 保冷グッズは暑熱側の判定だけで決める（低温警戒のgrade 2で保冷剤を出さない）
    if (worstGradeOf(hours, false) >= 2) {
      items.push(
        '保冷剤・凍らせたペットボトル',
        '経口補水液または塩分タブレット',
        '冷却ベスト・首用の冷却グッズ',
      );
    }
    if (hours.some((h) => String(h.outdoor.level).startsWith('cold'))) {
      items.push(
        '速乾インナーの替え（汗冷え対策）',
        'カイロ（肌に直接当てない。低温やけどに注意）',
      );
    }
    const rainy = hours.some(
      (h) =>
        h.weather.precipitation > 0 ||
        (typeof h.weather.precipitationProbability === 'number' &&
          h.weather.precipitationProbability >= 50),
    );
    if (rainy) {
      items.push('レインカバー・防水バッグ', '替えタオル（ファーの水気取り）');
    }
    if (day && day.laundry && day.laundry.moldWarning) {
      items.push('乾燥剤・除湿グッズ（この日は乾きにくい予報）');
    }
    return items;
  }

  /** 持ち物リスト1項目を作って追加する */
  function appendPackingItem(text, isCustom) {
    const item = document.createElement('li');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = readPackingChecked(lastPacking.dateText)[text] === true;
    box.addEventListener('change', () => {
      const dateText = lastPacking ? lastPacking.dateText : '';
      const items = readPackingChecked(dateText);
      if (box.checked) {
        items[text] = true;
      } else {
        delete items[text];
      }
      writePackingState(PACKING_CHECKED_KEY, { date: dateText, items });
    });
    label.append(box, document.createTextNode(` ${text}`));
    item.appendChild(label);
    if (isCustom) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'packing-remove';
      remove.textContent = '削除';
      remove.setAttribute('aria-label', `「${text}」を持ち物から削除`);
      remove.addEventListener('click', () => {
        writePackingState(
          PACKING_CUSTOM_KEY,
          readPackingState(PACKING_CUSTOM_KEY, []).filter((entry) => entry !== text),
        );
        item.remove();
      });
      item.appendChild(remove);
    }
    packingList.appendChild(item);
  }

  /** 対象日の持ち物リストを描画する（プランナーの計画作成時に更新される） */
  function renderPacking(dateText, hours) {
    lastPacking = { dateText, hours };
    const day = currentForecast.days.find((d) => d.date === dateText);
    packingList.replaceChildren();
    for (const text of buildPackingItems(day, hours)) {
      appendPackingItem(text, false);
    }
    for (const text of readPackingState(PACKING_CUSTOM_KEY, [])) {
      if (typeof text === 'string' && text !== '') {
        appendPackingItem(text, true);
      }
    }
    packingSection.hidden = false;
  }

  /** 自由入力の持ち物を追加する */
  function addCustomPackingItem() {
    const text = packingCustomInput.value.trim().slice(0, 40);
    if (text === '') {
      return;
    }
    const custom = readPackingState(PACKING_CUSTOM_KEY, []).filter(
      (entry) => typeof entry === 'string',
    );
    if (custom.includes(text)) {
      setStatus('同じ持ち物がすでにあります。', false, true);
      return;
    }
    if (custom.length >= PACKING_CUSTOM_LIMIT) {
      setStatus(`自由入力の持ち物は${PACKING_CUSTOM_LIMIT}件までです。`, false, true);
      return;
    }
    custom.push(text);
    writePackingState(PACKING_CUSTOM_KEY, custom);
    packingCustomInput.value = '';
    if (lastPacking) {
      renderPacking(lastPacking.dateText, lastPacking.hours);
    }
  }

  document.getElementById('packing-add-button').addEventListener('click', addCustomPackingItem);
  packingCustomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addCustomPackingItem();
    }
  });
  document.getElementById('packing-copy-button').addEventListener('click', async () => {
    const lines = [...packingList.querySelectorAll('li')].map((item) => {
      const box = item.querySelector('input');
      const text = item.querySelector('label').textContent.trim();
      return `${box.checked ? '☑' : '□'} ${text}`;
    });
    const header = `持ち物リスト（${planDate.value ? formatDate(planDate.value) : ''}・${displayedName || '選択地点'}）`;
    try {
      await navigator.clipboard.writeText([header, ...lines].join('\n'));
      setStatus('持ち物リストをコピーしました。', false);
    } catch {
      setStatus('コピーできませんでした。リストを直接選択してコピーしてください。', true);
    }
  });

  planButton.addEventListener('click', renderPlan);

  // ---- シェア画像カード ----
  // 表示中の予報からOGPサイズ（1200×630）の判定カード画像をCanvasで描き、
  // Web Share（対応環境）またはPNGダウンロードで渡す。SNSの画面写真と違い、
  // 生成時刻と出典・URL入りのため「いつの判定か」が伝わる

  /** 判定レベル別の描画色。style.cssの--level-N-accent/surface/text（ライト側）と
   * 同期する（ずれはhtmlSyncテストが検出する）。画像は閲覧環境のダークモード設定に
   * 左右されない固定の見た目にするため、常にライト配色で描く */
  const SHARE_GRADE_COLORS = [
    { accent: '#009E73', surface: '#E5F5EF', text: '#006147' },
    { accent: '#A66E00', surface: '#FCF0D8', text: '#6B4700' },
    { accent: '#B34700', surface: '#FDE8D7', text: '#7A3100' },
    { accent: '#CC3311', surface: '#FBE3DD', text: '#99260C' },
    { accent: '#8A1500', surface: '#F6D7D0', text: '#6E1100' },
  ];
  /** 低温側レベルの描画色。style.cssの--level-cold-*（ライト側）と同期 */
  const SHARE_COLD_COLORS = { accent: '#0072B2', surface: '#E1EFF8', text: '#005180' };
  /** ヘッダー帯の色。style.cssの--color-header-bg（ライト側）と同期 */
  const SHARE_HEADER_COLOR = '#0072B2';

  /** 時間別判定に対応する描画色を返す（低温レベルは青系） */
  function shareColorsOf(outdoor) {
    return String(outdoor.level).startsWith('cold')
      ? SHARE_COLD_COLORS
      : (SHARE_GRADE_COLORS[outdoor.grade] ?? SHARE_GRADE_COLORS[0]);
  }

  /** 角丸長方形のパスを作る（roundRect未対応環境でも動く書き方にする） */
  function shareRoundRectPath(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  /** 禁止マーク（grade 4の記号。GRADE_SYMBOLSのbanアイコンに対応）を描く */
  function shareDrawBan(ctx, x, y, radius, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, radius * 0.25);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    const offset = radius * Math.SQRT1_2;
    ctx.beginPath();
    ctx.moveTo(x - offset, y - offset);
    ctx.lineTo(x + offset, y + offset);
    ctx.stroke();
  }

  /** 時間帯セル・判定見出しの記号を描く（記号+色で段階を示す。中止級は禁止マーク）
   * 低温危険（cold・grade 4）も着用中止のため同じ禁止マークにする
   * （文字配列の範囲外参照で「?」が描かれるのを防ぐ。低温側は青系の配色が区別を担う） */
  function shareDrawSymbol(ctx, outdoor, x, y, size, color) {
    if (outdoor.grade === 4) {
      shareDrawBan(ctx, x, y, size * 0.55, color);
      return;
    }
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px sans-serif`;
    const align = ctx.textAlign;
    ctx.textAlign = 'center';
    ctx.fillText(['◎', '○', '△', '✕'][outdoor.grade] ?? '?', x, y);
    ctx.textAlign = align;
  }

  /** 表示中の予報からシェア用カード画像を描く（対象日の時間帯がなければnull） */
  function buildShareCanvas() {
    // 対象は選択中の日。時間帯ミニバーは時間別テーブルと同じ6〜18時
    const date = selectedDate ?? currentForecast.days[0].date;
    const dayHours = hoursOnDate(date).filter((h) => {
      const hour = hourNumberOf(h.time);
      return hour >= 6 && hour < 19;
    });
    if (dayHours.length === 0) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'middle';

    // 背景とヘッダー帯
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = SHARE_HEADER_COLOR;
    ctx.fillRect(0, 0, canvas.width, 84);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText('着ぐるみ天気予報 FursuitWeather', 40, 46);

    // 地点と日付（長い地点名は画像内で収まる長さに切る）
    ctx.fillStyle = '#1A1A1A';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText(`${(displayedName || '選択した地点').slice(0, 18)}・${formatDate(date)}`, 40, 148);

    // 判定見出し（その日の6〜18時で最も厳しい時間帯）
    const worstHour = dayHours.reduce((a, b) => (b.outdoor.grade > a.outdoor.grade ? b : a));
    const outdoor = worstHour.outdoor;
    const colors = shareColorsOf(outdoor);
    shareRoundRectPath(ctx, 40, 192, 1120, 158, 16);
    ctx.fillStyle = colors.surface;
    ctx.fill();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 5;
    ctx.stroke();
    shareDrawSymbol(ctx, outdoor, 120, 274, 76, colors.text);
    ctx.fillStyle = colors.text;
    ctx.font = 'bold 60px sans-serif';
    ctx.fillText(outdoor.label, 200, 248);
    ctx.font = '34px sans-serif';
    ctx.fillText(
      outdoor.activityMinutes > 0
        ? `屋外の連続着用は${outdoor.activityMinutes}分まで（最も厳しい時間帯の目安）`
        : '屋外での着用は中止を（最も厳しい時間帯の判定）',
      200,
      308,
    );

    // 時間帯ミニバー（6〜18時。各セルをその時間の判定色で塗り、記号を重ねる）
    const barX = 40;
    const barY = 396;
    const barHeight = 68;
    const cellWidth = 1120 / 13;
    for (let index = 0; index < dayHours.length; index += 1) {
      const cellColors = shareColorsOf(dayHours[index].outdoor);
      const x = barX + index * cellWidth;
      ctx.fillStyle = cellColors.accent;
      ctx.fillRect(x + 2, barY, cellWidth - 4, barHeight);
      shareDrawSymbol(ctx, dayHours[index].outdoor, x + cellWidth / 2, barY + barHeight / 2 + 2, 28, '#FFFFFF');
      ctx.fillStyle = '#555555';
      ctx.font = '22px sans-serif';
      const align = ctx.textAlign;
      ctx.textAlign = 'center';
      ctx.fillText(`${hourNumberOf(dayHours[index].time)}時`, x + cellWidth / 2, barY + barHeight + 24);
      ctx.textAlign = align;
    }

    // 注意文と出典・URL・生成時刻（「いつの判定か」を画像自体に残す）。
    // オフライン表示の保存済み予報は、生成時刻だけだと最新と誤認されるため
    // 取得時刻の警告を赤字で入れる
    ctx.fillStyle = '#1A1A1A';
    ctx.font = '26px sans-serif';
    ctx.fillText('判定は目安です。体調を最優先し、早めの休憩と水分・塩分補給を。', 40, 536);
    if (displayedFromCache) {
      ctx.fillStyle = '#CC3311';
      ctx.fillText(
        `※${displayedCachedAtText ?? '以前'}に取得したオフライン表示の予報です。最新ではない可能性があります。`,
        40,
        566,
      );
    }
    ctx.fillStyle = '#555555';
    ctx.font = '22px sans-serif';
    const generatedAt = new Date();
    ctx.fillText(
      `fursuit-weather.223n.tech・${generatedAt.getMonth() + 1}月${generatedAt.getDate()}日` +
        `${generatedAt.getHours()}時${String(generatedAt.getMinutes()).padStart(2, '0')}分生成・` +
        '天気データ: Open-Meteo（気象庁モデル）',
      40,
      596,
    );
    return canvas;
  }

  document.getElementById('share-image-button').addEventListener('click', async () => {
    if (!currentForecast || !displayedQuery) {
      setStatus('先に予報を読み込んでください。', true);
      return;
    }
    const canvas = buildShareCanvas();
    if (!canvas) {
      setStatus('この日の時間別データがないため、画像を作成できません。', true);
      return;
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      setStatus('画像を作成できませんでした。', true);
      return;
    }
    const file = new File([blob], 'fursuit-weather.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'FursuitWeather - 着ぐるみ天気予報',
          text: `${displayedName || '選択した地点'}の着ぐるみ天気予報`,
        });
      } catch {
        // 共有シートのキャンセルは正常な操作のため何もしない
      }
      return;
    }
    // Web Share非対応環境: PNGを保存する。画像には代替テキストを付けられないため、
    // 貼り付けて使える説明文（読み上げ用サマリーと同文）をクリップボードへ用意する
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fursuit-weather.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    try {
      await navigator.clipboard.writeText(
        srAnnounce.textContent || buildSpokenSummary(currentForecast, displayedName || ''),
      );
      setStatus(
        '画像を保存し、内容の説明文をコピーしました。画像と一緒に貼り付けると文字でも伝わります。',
        false,
      );
    } catch {
      setStatus('画像を保存しました。', false);
    }
  });

  // ---- 着用タイマー（アテンド用の全画面タイマー） ----
  // 「着用開始」で現在の判定の連続活動時間を上限にした全画面タイマーを開く。
  // 開始時刻などの状態はこの端末のlocalStorageにのみ保存し、リロード・
  // スリープ復帰後も継続する。残り5分と超過は音・バイブ・表示で知らせる

  const timerStartButton = document.getElementById('timer-start-button');
  const timerOverlay = document.getElementById('timer-overlay');
  const timerHeading = document.getElementById('timer-heading');
  const timerModeElement = document.getElementById('timer-mode');
  const timerClock = document.getElementById('timer-clock');
  const timerLimitElement = document.getElementById('timer-limit');
  const timerJudgmentElement = document.getElementById('timer-judgment');
  const timerNote = document.getElementById('timer-note');
  const timerRestButton = document.getElementById('timer-rest-button');
  const timerStopButton = document.getElementById('timer-stop-button');
  const TIMER_STATE_KEY = 'fursuitweatherWearTimer';
  /** タイマー表示中に最新の予報で判定を取り直す間隔（ベストエフォート） */
  const TIMER_REFRESH_MS = 10 * 60 * 1000;
  /** 保存済みタイマーの有効期限。これより古い開始時刻は復元しない
   * （前日の消し忘れが翌日に全画面の「上限超過」で開くのを防ぐ） */
  const TIMER_STATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  /** 動作中のタイマー状態（null=停止中）。localStorageと同じ内容を保持する */
  let timerState = null;
  /** 1秒ごとの表示更新タイマー */
  let timerTickId = null;
  /** 画面消灯防止（Wake Lock）。非対応環境ではnullのまま動く */
  let timerWakeLock = null;
  /** 次に判定を取り直す時刻（ミリ秒） */
  let timerNextRefreshAt = 0;
  /** タイマーを開いたときのフォーカス元（終了時にフォーカスを返す） */
  let timerReturnFocus = null;

  /** 現在時刻（JST）の時間別予報を返す（renderNowCardと同じ直近未来への代替規則） */
  function currentOutdoorTarget() {
    if (!currentForecast) {
      return null;
    }
    const now = nowInJst();
    const todayHours = hoursOnDate(now.date);
    return (
      todayHours.find((h) => hourNumberOf(h.time) === now.hour) ??
      todayHours.find((h) => hourNumberOf(h.time) > now.hour) ??
      null
    );
  }

  /** 予報の描画に合わせて開始ボタンの表示と、表示中のタイマーの判定を更新する */
  function updateTimerButton() {
    const target = currentOutdoorTarget();
    // 判定できる時間帯がない日（深夜の欠測など）はボタン自体を出さない。
    // 「着用中止」でもボタンは出し、押したときに理由を案内する
    timerStartButton.hidden = target === null;
    // タイマーが開始時と同じ地点の表示のときだけ追従させる（着用中に別の地点の
    // 予報を眺めても、着用者と無関係な判定でタイマーが更新されないようにする。
    // 別地点表示中の追従は約10分ごとのrefreshTimerJudgmentが開始時の地点で行う）
    if (timerState && (!timerState.query || timerState.query === displayedQuery)) {
      applyTimerOutdoor(target ? target.outdoor : null);
    }
  }

  /** タイマーへ最新の判定を反映する（バッジ更新+悪化時の上限短縮。
   * リロード復帰後の再取得・約10分ごとの取り直しの両経路で共通に使い、
   * どちらの経路でも判定悪化が上限へ確実に反映されるようにする） */
  function applyTimerOutdoor(outdoor) {
    if (!timerState) {
      return;
    }
    renderTimerJudgment(outdoor);
    if (!outdoor || timerState.mode !== 'wear') {
      return;
    }
    // ふりかえり記録用に、この着用中の最高の補正後WBGTを控える
    if (
      Number.isFinite(outdoor.suitWbgt) &&
      (!Number.isFinite(timerState.maxSuitWbgt) || outdoor.suitWbgt > timerState.maxSuitWbgt)
    ) {
      timerState.maxSuitWbgt = outdoor.suitWbgt;
      writeTimerState();
    }
    if (outdoor.activityMinutes < timerState.limitMinutes) {
      // 判定が悪化していたら上限を安全側へ短縮し、警告を新しい上限で出し直す
      timerState.limitMinutes = outdoor.activityMinutes;
      timerState.warned5 = false;
      timerState.warnedOver = false;
      writeTimerState();
      timerNote.textContent =
        outdoor.activityMinutes > 0
          ? `最新の予報で判定が変わりました。上限を${outdoor.activityMinutes}分に短縮します。`
          : '最新の予報で判定が「着用中止」になりました。すぐに休憩してください。';
      updateTimerDisplay();
    }
  }

  /** タイマー内の判定バッジ（現在の時間帯の屋外判定）を描画する */
  function renderTimerJudgment(outdoor) {
    if (!outdoor) {
      timerJudgmentElement.replaceChildren(hintParagraph('現在の判定を読み込んでいます…'));
      return;
    }
    const line = document.createElement('p');
    line.className = 'badge-line';
    line.appendChild(createBadge(outdoor, true));
    line.appendChild(
      document.createTextNode(
        outdoor.activityMinutes > 0 ? ` 連続${outdoor.activityMinutes}分まで` : ' 着用中止',
      ),
    );
    timerJudgmentElement.replaceChildren(line);
  }

  /** 警告音用のAudioContext（最初のユーザー操作で作成し、以後使い回す。
   * 警告の瞬間に新規作成すると自動再生制限で無音になるため、操作の中で準備しておく） */
  let timerAudio = null;

  /** 警告音を出せる状態を整える（ユーザー操作のハンドラー内で呼ぶと再生制限が解ける。
   * リロード復帰後もダイアログ内の最初の操作で解けるよう、操作系リスナーからも呼ぶ） */
  function prepareTimerAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!timerAudio && AudioContextClass) {
        timerAudio = new AudioContextClass();
      }
      if (timerAudio && timerAudio.state === 'suspended') {
        timerAudio.resume().catch(() => {});
      }
    } catch {
      // 音を出せない環境では表示とバイブのみ
    }
  }

  /** 警告音（短いビープ）とバイブレーション。音を出せない環境では表示のみになる */
  function timerAlert(times) {
    try {
      prepareTimerAudio();
      if (timerAudio && timerAudio.state === 'running') {
        for (let i = 0; i < times; i += 1) {
          const oscillator = timerAudio.createOscillator();
          const gain = timerAudio.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = 880;
          gain.gain.value = 0.2;
          oscillator.connect(gain);
          gain.connect(timerAudio.destination);
          const at = timerAudio.currentTime + i * 0.4;
          oscillator.start(at);
          oscillator.stop(at + 0.25);
        }
      }
    } catch {
      // 音を出せない環境（自動再生制限など）では表示とバイブのみ
    }
    try {
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch {
      // バイブ非対応環境では何もしない
    }
  }

  /** 画面消灯防止を取得する（非対応・省電力設定では黙って諦める） */
  async function acquireTimerWakeLock() {
    try {
      if (navigator.wakeLock && timerState) {
        timerWakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      // 取得できなくてもタイマーは動く（経過は開始時刻基準のため消灯中も正確）
    }
  }

  /** 画面消灯防止を解放する */
  function releaseTimerWakeLock() {
    try {
      if (timerWakeLock) {
        timerWakeLock.release();
      }
    } catch {
      // 解放に失敗してもタブを閉じれば解放される
    }
    timerWakeLock = null;
  }

  // スリープ・タブ切り替えからの復帰でWake Lockは自動解放されるため取り直す
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && timerState) {
      acquireTimerWakeLock();
    }
  });

  /** タイマー状態を保存する（保存できない環境ではこのタブの表示中だけ動く） */
  function writeTimerState() {
    try {
      localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(timerState));
    } catch {
      // 保存できなくても表示中のタイマーは動き続ける
    }
  }

  /** 保存済みのタイマー状態を読む（壊れた保存・古い形式・期限切れはnull） */
  function readTimerState() {
    const state = readStorageJson(TIMER_STATE_KEY);
    if (
      state &&
      (state.mode === 'wear' || state.mode === 'rest') &&
      Number.isFinite(state.startedAt) &&
      Date.now() - state.startedAt < TIMER_STATE_MAX_AGE_MS &&
      Number.isFinite(state.limitMinutes) &&
      (state.mode !== 'rest' || Number.isFinite(state.wearMinutes)) &&
      (state.query === undefined || typeof state.query === 'string') &&
      (state.maxSuitWbgt === undefined ||
        state.maxSuitWbgt === null ||
        Number.isFinite(state.maxSuitWbgt))
    ) {
      return state;
    }
    return null;
  }

  /** モード（着用中/休憩中）に応じた表示へ切り替える */
  function updateTimerModeUi() {
    const resting = timerState.mode === 'rest';
    timerModeElement.textContent = resting ? '休憩中' : '着用中';
    timerRestButton.textContent = resting ? '着用を再開' : '休憩開始';
    timerOverlay.classList.toggle('timer-rest', resting);
    timerOverlay.classList.remove('timer-warning', 'timer-over');
    if (resting) {
      timerLimitElement.textContent =
        `着用は約${timerState.wearMinutes}分でした。同じ長さ以上の休憩と、水分・塩分補給を。`;
    }
  }

  /** 経過表示と残り時間の警告を更新する（1秒ごと） */
  function updateTimerDisplay() {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timerState.startedAt) / 1000));
    timerClock.textContent =
      `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
    if (timerState.mode !== 'wear') {
      return;
    }
    const remainingSeconds = timerState.limitMinutes * 60 - elapsedSeconds;
    timerLimitElement.textContent =
      remainingSeconds >= 0
        ? `上限 ${timerState.limitMinutes}分・残り約${Math.ceil(remainingSeconds / 60)}分`
        : `上限 ${timerState.limitMinutes}分を超えています`;
    // 警告は1回ずつ（warned5/warnedOver）。状態ごと保存し、リロードしても鳴り直さない
    if (!timerState.warned5 && remainingSeconds <= 5 * 60 && remainingSeconds > 0) {
      timerState.warned5 = true;
      writeTimerState();
      timerOverlay.classList.add('timer-warning');
      timerNote.textContent = '残り5分です。休憩場所への移動を始めてください。';
      timerAlert(2);
    }
    if (!timerState.warnedOver && remainingSeconds <= 0) {
      timerState.warnedOver = true;
      writeTimerState();
      timerOverlay.classList.remove('timer-warning');
      timerOverlay.classList.add('timer-over');
      timerNote.textContent = '上限を超えました。すぐに休憩してください。';
      timerAlert(3);
    }
  }

  /** タイマー開始時の地点の最新予報で判定を取り直す（失敗しても次の周期で再試行）。
   * 表示中の地点ではなく開始時の地点（timerState.query）を使い、着用中に別の地点の
   * 予報を確認しても着用者の場所の判定でタイマーが更新されるようにする */
  async function refreshTimerJudgment() {
    const query = timerState && timerState.query ? timerState.query : displayedQuery;
    if (!query) {
      return;
    }
    try {
      const response = await fetch(`/api/forecast?${query}&days=${FORECAST_DAYS}`);
      if (!response.ok) {
        return;
      }
      const body = await response.json();
      if (!timerState || !body || !Array.isArray(body.hours)) {
        return;
      }
      const now = nowInJst();
      const todayHours = body.hours.filter(
        (h) => h && typeof h.time === 'string' && h.time.startsWith(now.date),
      );
      const target =
        todayHours.find((h) => hourNumberOf(h.time) === now.hour) ??
        todayHours.find((h) => hourNumberOf(h.time) > now.hour);
      if (!target || !target.outdoor || !Number.isFinite(target.outdoor.activityMinutes)) {
        return;
      }
      applyTimerOutdoor(target.outdoor);
    } catch {
      // 取得できないときは前回の判定表示のまま続行する
    }
  }

  /** 1秒ごとの更新（経過表示と、約10分ごとの判定の取り直し） */
  function timerTick() {
    if (!timerState) {
      return;
    }
    updateTimerDisplay();
    if (Date.now() >= timerNextRefreshAt) {
      timerNextRefreshAt = Date.now() + TIMER_REFRESH_MS;
      refreshTimerJudgment();
    }
  }

  /** タイマーを開いて動かし始める（開始・リロード復帰で共通） */
  function openTimer(state) {
    timerState = state;
    writeTimerState();
    timerNote.textContent = '';
    updateTimerModeUi();
    // リロード復帰時: 警告済み・超過済みの視覚状態と注意文を復元する
    // （音・バイブは鳴らし直さない。復元なしだと超過中でも通常配色に見えてしまう）
    if (state.mode === 'wear' && state.warnedOver) {
      timerOverlay.classList.add('timer-over');
      timerNote.textContent = '上限を超えました。すぐに休憩してください。';
    } else if (state.mode === 'wear' && state.warned5) {
      timerOverlay.classList.add('timer-warning');
      timerNote.textContent = '残り5分です。休憩場所への移動を始めてください。';
    }
    const target = currentOutdoorTarget();
    renderTimerJudgment(target ? target.outdoor : null);
    updateTimerDisplay();
    timerOverlay.hidden = false;
    setBackgroundInert(true);
    clearInterval(timerTickId);
    timerTickId = setInterval(timerTick, 1000);
    timerNextRefreshAt = Date.now() + TIMER_REFRESH_MS;
    acquireTimerWakeLock();
    timerReturnFocus = document.activeElement;
    timerHeading.focus();
  }

  /** タイマーを終了して閉じる（保存した状態も消す） */
  function stopTimer() {
    // 着用中の終了なら、そのセッションをふりかえり記録へ残す
    if (timerState && timerState.mode === 'wear') {
      recordWearSession(timerState);
    }
    clearInterval(timerTickId);
    timerTickId = null;
    timerState = null;
    try {
      localStorage.removeItem(TIMER_STATE_KEY);
    } catch {
      // 消せない環境でも表示は閉じる（次回表示時はreadTimerStateの検証に従う）
    }
    releaseTimerWakeLock();
    timerOverlay.hidden = true;
    setBackgroundInert(false);
    timerOverlay.classList.remove('timer-warning', 'timer-over', 'timer-rest');
    timerNote.textContent = '';
    // フォーカスをタイマーを開いた操作元へ返す（キーボード利用者が迷子にならない）
    if (timerReturnFocus && document.contains(timerReturnFocus)) {
      timerReturnFocus.focus();
    }
    timerReturnFocus = null;
  }

  // ---- 活動ふりかえり記録 ----
  // 着用タイマーの終了・休憩切り替え時に着用セッション（時刻・長さ・その間の
  // 最高の補正後WBGT）をこの端末にのみ自動蓄積し、当日のサマリーを表示する。
  // 「前回できたから今日もいける」という危険側の判断材料にしないよう、
  // 表示には常に「目安を緩める根拠にしない」注意を併記する

  const WEAR_LOG_KEY = 'fursuitweatherWearLog';
  /** 保存する着用セッションの上限（古い記録から削除する） */
  const WEAR_LOG_LIMIT = 20;
  const wearLogSection = document.getElementById('wear-log-section');
  const wearLogSummary = document.getElementById('wear-log-summary');

  /** ミリ秒時刻の日本時間の日付（YYYY-MM-DD） */
  function jstDateOfMs(ms) {
    return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  /** 保存済みの着用セッションを読む（壊れた保存・保存不可の環境は空） */
  function readWearLog() {
    const list = readStorageJson(WEAR_LOG_KEY);
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(
      (entry) => entry && Number.isFinite(entry.at) && Number.isFinite(entry.minutes),
    );
  }

  /** 着用セッションを1件記録する（着用→休憩・タイマー終了の両方から呼ぶ） */
  function recordWearSession(state) {
    const minutes = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
    const entries = readWearLog();
    entries.push({
      at: Date.now(),
      minutes,
      maxSuitWbgt: Number.isFinite(state.maxSuitWbgt) ? state.maxSuitWbgt : null,
    });
    try {
      localStorage.setItem(WEAR_LOG_KEY, JSON.stringify(entries.slice(-WEAR_LOG_LIMIT)));
    } catch {
      // 保存できない環境では表示だけ諦める（タイマー本体には影響しない）
    }
    renderWearLog();
  }

  /** 今日の着用記録のサマリーを描画する（今日の記録がなければ隠す） */
  function renderWearLog() {
    const today = nowInJst().date;
    const todayEntries = readWearLog().filter((entry) => jstDateOfMs(entry.at) === today);
    wearLogSection.hidden = todayEntries.length === 0;
    if (todayEntries.length === 0) {
      return;
    }
    const total = todayEntries.reduce((sum, entry) => sum + entry.minutes, 0);
    const maxWbgt = Math.max(
      ...todayEntries.map((entry) =>
        Number.isFinite(entry.maxSuitWbgt) ? entry.maxSuitWbgt : Number.NEGATIVE_INFINITY,
      ),
    );
    wearLogSummary.textContent =
      `今日の記録: 着用${todayEntries.length}回・計${total}分` +
      (Number.isFinite(maxWbgt) ? `・最高 補正後WBGT ${maxWbgt}℃` : '');
  }

  document.getElementById('wear-log-copy-button').addEventListener('click', async () => {
    const lines = readWearLog().map((entry) => {
      const date = new Date(entry.at + 9 * 60 * 60 * 1000);
      return (
        `${date.getUTCMonth() + 1}/${date.getUTCDate()} 着用${entry.minutes}分` +
        (Number.isFinite(entry.maxSuitWbgt) ? `（最高 補正後WBGT ${entry.maxSuitWbgt}℃）` : '')
      );
    });
    try {
      await navigator.clipboard.writeText(['着用記録（FursuitWeather）', ...lines].join('\n'));
      setStatus('着用記録をコピーしました。', false);
    } catch {
      setStatus('コピーできませんでした。', true);
    }
  });

  renderWearLog();

  timerStartButton.addEventListener('click', () => {
    // クリック（ユーザー操作）の中で音声の再生制限を解いておく
    prepareTimerAudio();
    const target = currentOutdoorTarget();
    if (!target) {
      setStatus('先に予報を読み込んでください。', true);
      return;
    }
    if (target.outdoor.activityMinutes === 0) {
      // 中止の理由が暑熱か低温かで、優先すべき行動（冷却/保温）を出し分ける
      setStatus(
        String(target.outdoor.level).startsWith('cold')
          ? '現在の判定は「着用中止」のため、タイマーは開始できません。保温と休憩を優先してください。'
          : '現在の判定は「着用中止」のため、タイマーは開始できません。休憩・冷却を優先してください。',
        true,
      );
      return;
    }
    openTimer({
      mode: 'wear',
      startedAt: Date.now(),
      limitMinutes: target.outdoor.activityMinutes,
      warned5: false,
      warnedOver: false,
      // 判定の取り直しは開始時の地点で行う（表示地点の切り替えに追従させない）
      query: displayedQuery,
      // ふりかえり記録用（この着用中の最高の補正後WBGT）
      maxSuitWbgt: Number.isFinite(target.outdoor.suitWbgt) ? target.outdoor.suitWbgt : null,
    });
  });

  timerRestButton.addEventListener('click', () => {
    if (!timerState) {
      return;
    }
    // クリック（ユーザー操作）の中で音声の再生制限を解いておく（リロード復帰後の保険）
    prepareTimerAudio();
    if (timerState.mode === 'wear') {
      // 着用セッションをふりかえり記録へ残してから休憩に切り替える
      recordWearSession(timerState);
      // 休憩へ: 着用した長さを控えて「同じ長さ以上の休憩」の目安に使う
      const wearMinutes = Math.max(1, Math.round((Date.now() - timerState.startedAt) / 60000));
      timerState = {
        mode: 'rest',
        startedAt: Date.now(),
        limitMinutes: timerState.limitMinutes,
        wearMinutes,
        warned5: false,
        warnedOver: false,
        query: timerState.query,
      };
      writeTimerState();
      updateTimerModeUi();
      timerNote.textContent = '休憩を開始しました。';
    } else {
      // 着用の再開: 上限はその時点の判定から取り直す（休憩中に状況が変わり得る）
      const target = currentOutdoorTarget();
      if (!target || target.outdoor.activityMinutes === 0) {
        timerNote.textContent = '現在の判定は「着用中止」のため再開できません。休憩を続けてください。';
        return;
      }
      timerState = {
        mode: 'wear',
        startedAt: Date.now(),
        limitMinutes: target.outdoor.activityMinutes,
        warned5: false,
        warnedOver: false,
        query: timerState.query,
        maxSuitWbgt: Number.isFinite(target.outdoor.suitWbgt) ? target.outdoor.suitWbgt : null,
      };
      writeTimerState();
      updateTimerModeUi();
      timerNote.textContent = '着用を再開しました。';
    }
    const latest = currentOutdoorTarget();
    renderTimerJudgment(latest ? latest.outdoor : null);
    updateTimerDisplay();
  });

  timerStopButton.addEventListener('click', stopTimer);

  // リロード復帰はユーザー操作を経ないため音声の再生制限が残る。
  // ダイアログ内の最初の操作（タップ）で解いておく（キー入力は下のトラップが担う）
  timerOverlay.addEventListener('pointerdown', prepareTimerAudio);

  // 全画面ダイアログ内にフォーカスを留める。overlay上のリスナーだと、フォーカスが
  // 背面（body等）にあるときのTabを捕まえられず背面ページへ抜けられるため、
  // documentで監視して表示中だけ働かせる（背面はopenTimerがinert化するが、
  // inert未対応の環境の保険としてトラップも残す）
  document.addEventListener('keydown', (event) => {
    if (timerOverlay.hidden) {
      return;
    }
    prepareTimerAudio();
    if (event.key !== 'Tab') {
      return;
    }
    const focusables = [timerRestButton, timerStopButton];
    const index = focusables.indexOf(document.activeElement);
    if (index === -1 && !timerOverlay.contains(document.activeElement)) {
      // フォーカスが背面へ出ていたらダイアログへ戻す
      event.preventDefault();
      focusables[0].focus();
    } else if (event.shiftKey && index <= 0) {
      event.preventDefault();
      focusables[focusables.length - 1].focus();
    } else if (!event.shiftKey && index === focusables.length - 1) {
      event.preventDefault();
      focusables[0].focus();
    }
  });

  /** タイマー表示中は背面ページを操作・読み上げの対象から外す（対応ブラウザのみ） */
  function setBackgroundInert(inert) {
    for (const element of document.querySelectorAll('body > :not(#timer-overlay)')) {
      element.inert = inert;
    }
  }

  // リロード・再訪時: 保存済みのタイマーがあれば表示を復元する
  // （予報の読み込み前でも経過は正しく出る。判定は読み込み完了後に埋まる）
  const storedTimerState = readTimerState();
  if (storedTimerState) {
    openTimer(storedTimerState);
  }

  // ---- 当日コンディションチェック ----
  // 環境側の予報に対して、着用者側の体調リスクを自覚するための任意チェック。
  // 回答はどこにも保存しない（localStorage・URLへ書かないことが実装上の不変条件）。
  // 発熱・下痢（厚労省要綱では作業から外す判断の対象）は「活動見送りの検討」、
  // それ以外は「1段階慎重に」の2段階に分け、判定のしきい値・記号・色は変えない

  const conditionItems = [...document.querySelectorAll('.condition-item')];
  const conditionNote = document.getElementById('condition-note');

  /** チェック状態から注意の帯を更新する（未チェックなら空にする） */
  function updateConditionNote() {
    const severe = conditionItems.some((box) => box.checked && box.dataset.severe === 'true');
    const anyChecked = conditionItems.some((box) => box.checked);
    conditionNote.classList.toggle('condition-note-severe', severe);
    conditionNote.classList.toggle('condition-note-warning', !severe && anyChecked);
    if (!anyChecked) {
      conditionNote.replaceChildren();
      return;
    }
    conditionNote.replaceChildren(
      faIcon('triangle-exclamation'),
      srOnlySpan('注意: '),
      document.createTextNode(
        severe
          ? '発熱・下痢など体調不良があるときは、今日の活動の見送りを検討してください。脱水が進みやすく、熱中症の危険が大きく高まります。回復を最優先に。'
          : '該当がある日は、表示の判定より1段階慎重に。連続着用は目安より短めにし、休憩と水分・塩分補給を増やしてください。',
      ),
    );
  }

  for (const box of conditionItems) {
    box.addEventListener('change', updateConditionNote);
  }

  // ---- 当日ボード（複数着用者の見守り） ----
  // 1台の画面点灯した端末で「誰がいつから出ていて、誰がそろそろ休憩か」を
  // 一覧する掲示ボード。データはこの端末のlocalStorageのみで、当日限り
  // （日付が変わると自動リセット）。ニックネームは共有URL・会場表示モードへ
  // 一切載せない。休憩の下限時間という新しいしきい値は発明せず、休憩中は
  // 経過の上向きカウントのみ表示する

  const BOARD_STORAGE_KEY = 'fursuitweatherDayBoard';
  const BOARD_WEARER_LIMIT = 20;
  /** 交代が近い表示に切り替える残り分数（着用タイマーの5分前警告と同じ間隔） */
  const BOARD_SOON_MINUTES = 5;
  const boardNameInput = document.getElementById('board-name-input');
  const boardManualLimitInput = document.getElementById('board-manual-limit');
  const boardLimitNote = document.getElementById('board-limit-note');
  const boardLists = {
    wearing: document.getElementById('board-wearing'),
    resting: document.getElementById('board-resting'),
    waiting: document.getElementById('board-waiting'),
  };

  /** 当日ボードの状態（読み込みはinitBoardで行う） */
  let boardState = null;

  /** 空のボード状態を作る */
  function emptyBoardState() {
    return {
      date: nowInJst().date,
      limitMode: 'auto',
      manualLimitMinutes: 30,
      wearers: [],
    };
  }

  /** 保存済みのボード状態を読む（壊れた保存・別の日の保存は空へリセット） */
  function readBoardState() {
    const state = readStorageJson(BOARD_STORAGE_KEY);
    if (
      !state ||
      state.date !== nowInJst().date ||
      !Array.isArray(state.wearers) ||
      (state.limitMode !== 'auto' && state.limitMode !== 'manual') ||
      !Number.isFinite(state.manualLimitMinutes)
    ) {
      return emptyBoardState();
    }
    const validStates = ['wearing', 'resting', 'waiting'];
    state.wearers = state.wearers.filter(
      (wearer) =>
        wearer &&
        typeof wearer.name === 'string' &&
        wearer.name !== '' &&
        validStates.includes(wearer.state) &&
        Number.isFinite(wearer.since),
    );
    return state;
  }

  /** ボード状態を保存する（保存できない環境ではこのタブの表示中だけ動く） */
  function writeBoardState() {
    writeStorageJson(BOARD_STORAGE_KEY, boardState);
  }

  /** 現在の上限の目安（分）。自動は予報のいまの判定から。判定できないときはnull */
  function boardLimitMinutes() {
    if (boardState.limitMode === 'manual') {
      return boardState.manualLimitMinutes;
    }
    if (!currentForecast) {
      return null;
    }
    const entry = currentHourEntry();
    return entry ? entry.outdoor.activityMinutes : null;
  }

  /** 経過分（切り捨て） */
  function boardElapsedMinutes(wearer) {
    return Math.max(0, Math.floor((Date.now() - wearer.since) / 60000));
  }

  /** 出演中カードの状況テキストと強調区分（'over'・'soon'・null）を作る */
  function boardWearingStatus(wearer, limit) {
    const elapsed = boardElapsedMinutes(wearer);
    if (limit === null) {
      return { text: `経過${elapsed}分（上限の目安なし）`, emphasis: null };
    }
    if (limit <= 0) {
      return { text: `経過${elapsed}分・着用中止の判定です。直ちに交代を`, emphasis: 'over' };
    }
    const remaining = limit - elapsed;
    if (remaining <= 0) {
      return { text: `上限${limit}分を超過（経過${elapsed}分）・交代してください`, emphasis: 'over' };
    }
    if (remaining <= BOARD_SOON_MINUTES) {
      return { text: `経過${elapsed}分／上限${limit}分・残り約${remaining}分`, emphasis: 'soon' };
    }
    return { text: `経過${elapsed}分／上限${limit}分`, emphasis: null };
  }

  /** 状態変更ボタンを作る */
  function boardActionButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  /** 着用者の状態を変える（経過は移動時点から数え直し、超過チャイムも再武装する） */
  function moveBoardWearer(wearer, nextState) {
    wearer.state = nextState;
    wearer.since = Date.now();
    wearer.warnedOver = false;
    writeBoardState();
    renderBoard();
  }

  /** 1人分のカードを作る */
  function boardCard(wearer, limit) {
    const item = document.createElement('li');
    item.className = 'board-card';
    const name = document.createElement('span');
    name.className = 'board-card-name';
    name.textContent = wearer.name;
    item.appendChild(name);

    const status = document.createElement('span');
    status.className = 'board-card-status';
    if (wearer.state === 'wearing') {
      const { text, emphasis } = boardWearingStatus(wearer, limit);
      status.textContent = text;
      if (emphasis) {
        item.classList.add(`board-card-${emphasis}`);
      }
    } else if (wearer.state === 'resting') {
      status.textContent = `休憩${boardElapsedMinutes(wearer)}分`;
    } else {
      status.textContent = '待機中';
    }
    item.appendChild(status);

    const actions = document.createElement('span');
    actions.className = 'board-card-actions';
    if (wearer.state !== 'wearing') {
      actions.appendChild(boardActionButton('出演開始', () => moveBoardWearer(wearer, 'wearing')));
    }
    if (wearer.state === 'wearing') {
      actions.appendChild(boardActionButton('休憩へ', () => moveBoardWearer(wearer, 'resting')));
    }
    if (wearer.state !== 'waiting') {
      actions.appendChild(boardActionButton('待機へ', () => moveBoardWearer(wearer, 'waiting')));
    }
    actions.appendChild(
      boardActionButton('削除', () => {
        boardState.wearers = boardState.wearers.filter((entry) => entry !== wearer);
        writeBoardState();
        renderBoard();
      }),
    );
    item.appendChild(actions);
    return item;
  }

  /** 上限の目安の表示を更新する */
  function renderBoardLimitNote(limit) {
    if (boardState.limitMode === 'manual') {
      boardLimitNote.textContent = `目安: ${boardState.manualLimitMinutes}分（手動）`;
    } else if (limit === null) {
      boardLimitNote.textContent = '目安: 予報の取得後に表示されます';
    } else if (limit <= 0) {
      boardLimitNote.textContent = '目安: 着用中止の判定です';
    } else {
      boardLimitNote.textContent = `目安: ${limit}分（いまの判定から自動）`;
    }
  }

  /** ボード全体を描画し、上限超過のチャイムを鳴らす（画面表示中のみ）。
   * 出演中は残り時間の少ない順に並べ、次に交代させる人が先頭に来るようにする */
  function renderBoard() {
    // 日付が変わったら当日ボードの約束どおりリセットする（深夜運用のまたぎ対策）
    if (boardState.date !== nowInJst().date) {
      boardState = emptyBoardState();
      writeBoardState();
    }
    const limit = boardLimitMinutes();
    renderBoardLimitNote(limit);

    const groups = { wearing: [], resting: [], waiting: [] };
    for (const wearer of boardState.wearers) {
      groups[wearer.state].push(wearer);
    }
    groups.wearing.sort((a, b) => a.since - b.since);
    for (const state of ['wearing', 'resting', 'waiting']) {
      boardLists[state].replaceChildren(
        ...groups[state].map((wearer) => boardCard(wearer, limit)),
      );
      if (groups[state].length === 0) {
        const empty = document.createElement('li');
        empty.className = 'board-empty hint';
        empty.textContent = 'なし';
        boardLists[state].appendChild(empty);
      }
    }

    // 上限超過のチャイム（1回だけ。休憩・待機へ動かすと再武装される）。
    // 画面点灯前提のボードのため、前面表示中以外では鳴らさない
    if (document.visibilityState === 'visible') {
      for (const wearer of groups.wearing) {
        const { emphasis } = boardWearingStatus(wearer, limit);
        if (emphasis === 'over' && !wearer.warnedOver) {
          wearer.warnedOver = true;
          writeBoardState();
          timerAlert(3);
          srAnnounce.textContent = `当日ボード: ${wearer.name}が連続活動の上限を超えています。交代してください。`;
        }
      }
    }
  }

  document.getElementById('board-add-button').addEventListener('click', () => {
    prepareTimerAudio();
    const name = boardNameInput.value.trim();
    if (name === '') {
      setStatus('ニックネームを入力してから追加してください。', true);
      return;
    }
    if (boardState.wearers.length >= BOARD_WEARER_LIMIT) {
      setStatus(`登録は${BOARD_WEARER_LIMIT}人までです。使い終わったカードを削除してください。`, true);
      return;
    }
    boardState.wearers.push({
      // idは使い捨て（並び・削除はオブジェクト参照で行う）。名前の重複は許す
      name,
      state: 'waiting',
      since: Date.now(),
      warnedOver: false,
    });
    boardNameInput.value = '';
    writeBoardState();
    renderBoard();
  });

  for (const radio of document.querySelectorAll('input[name="board-limit-mode"]')) {
    radio.addEventListener('change', () => {
      boardState.limitMode = radio.value === 'manual' ? 'manual' : 'auto';
      writeBoardState();
      renderBoard();
    });
  }

  boardManualLimitInput.addEventListener('change', () => {
    const value = Number(boardManualLimitInput.value);
    if (Number.isFinite(value) && value >= 5 && value <= 120) {
      boardState.manualLimitMinutes = Math.round(value);
    }
    boardManualLimitInput.value = String(boardState.manualLimitMinutes);
    writeBoardState();
    renderBoard();
  });

  /** 保存済みの状態をUIへ反映してボードを開始する */
  function initBoard() {
    boardState = readBoardState();
    const manualRadio = document.querySelector('input[name="board-limit-mode"][value="manual"]');
    const autoRadio = document.querySelector('input[name="board-limit-mode"][value="auto"]');
    (boardState.limitMode === 'manual' ? manualRadio : autoRadio).checked = true;
    boardManualLimitInput.value = String(boardState.manualLimitMinutes);
    renderBoard();
    // 経過表示は分単位のため30秒ごとの再描画で十分（1分ずれの半分以下に収まる）
    setInterval(renderBoard, 30 * 1000);
  }

  initBoard();

  // ---- 見やすさ設定（文字サイズ） ----
  // 押すたびに標準→大→特大と切り替え、この端末へ保存する。適用は全ページ共通の
  // prefs.jsが担う（サイズの対応表はprefs.jsのSIZESと同期。htmlSyncテストが検証する）

  const FONT_SIZE_KEY = 'fursuitweatherFontSize';
  const FONT_SIZES = [
    { id: 'standard', label: '標準', size: '100%' },
    { id: 'large', label: '大', size: '115%' },
    { id: 'xlarge', label: '特大', size: '130%' },
  ];
  const fontSizeButton = document.getElementById('font-size-button');

  /** 保存済みの文字サイズの添字（読めない・未設定は標準） */
  function currentFontSizeIndex() {
    try {
      const stored = localStorage.getItem(FONT_SIZE_KEY);
      const index = FONT_SIZES.findIndex((entry) => entry.id === stored);
      return index >= 0 ? index : 0;
    } catch {
      return 0;
    }
  }

  /** 適用中の文字サイズの添字。保存値とは別にメモリで持ち、localStorageが使えない
   * 環境（保存の読み書きが常に失敗する設定）でも巡回が成立するようにする */
  let fontSizeIndex = currentFontSizeIndex();

  /** ボタンの表記と読み上げ用ラベルを現在のサイズに合わせる */
  function updateFontSizeButton(entry) {
    fontSizeButton.textContent = `Aa ${entry.label}`;
    fontSizeButton.setAttribute('aria-label', `文字の大きさを切り替え（現在: ${entry.label}）`);
  }

  /** 文字サイズを適用・保存し、ボタンの表記を合わせる */
  function applyFontSize(index) {
    fontSizeIndex = index;
    const entry = FONT_SIZES[index];
    document.documentElement.style.fontSize = entry.id === 'standard' ? '' : entry.size;
    updateFontSizeButton(entry);
    try {
      localStorage.setItem(FONT_SIZE_KEY, entry.id);
    } catch {
      // 保存できない環境では、このページ表示中だけ適用される
    }
  }

  updateFontSizeButton(FONT_SIZES[fontSizeIndex]);
  fontSizeButton.addEventListener('click', () => {
    const next = (fontSizeIndex + 1) % FONT_SIZES.length;
    applyFontSize(next);
    setStatus(`文字の大きさを「${FONT_SIZES[next].label}」にしました。`, false);
  });

  // ---- 音声で聞く今日の要点 ----
  // #sr-announce用に生成している要点文を、端末内蔵の音声合成で読み上げる。
  // 通信・上流コストはゼロ。非対応環境ではボタンを出さない

  const speakButton = document.getElementById('speak-button');
  let speaking = false;

  /** 再生状態に応じてボタンの表記を切り替える（2状態ボタン） */
  function updateSpeakButton() {
    speakButton.textContent = speaking ? '読み上げを停止' : '今日の要点を聞く';
  }

  if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function') {
    speakButton.hidden = false;
    updateSpeakButton();
    speakButton.addEventListener('click', () => {
      if (speaking) {
        window.speechSynthesis.cancel();
        speaking = false;
        updateSpeakButton();
        return;
      }
      if (!currentForecast) {
        setStatus('先に予報を読み込んでください。', true);
        return;
      }
      // 読み上げ文はスクリーンリーダー向けサマリーと同一（時刻の読みも変換済み）
      const utterance = new SpeechSynthesisUtterance(
        srAnnounce.textContent || buildSpokenSummary(currentForecast, displayedName || ''),
      );
      utterance.lang = 'ja-JP';
      const finish = () => {
        speaking = false;
        updateSpeakButton();
      };
      utterance.addEventListener('end', finish);
      utterance.addEventListener('error', finish);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      speaking = true;
      updateSpeakButton();
    });
  }

  // ---- ホーム画面追加のかんたん案内 ----
  // Android Chrome系はbeforeinstallpromptを捕まえてワンタップの追加ボタンを出し、
  // iOS Safariは操作手順の案内を出す。どちらでもない環境は一般的な文言のまま

  const a2hsAndroid = document.getElementById('a2hs-android');
  const a2hsIos = document.getElementById('a2hs-ios');
  const a2hsGeneric = document.getElementById('a2hs-generic');
  /** 捕捉したインストールプロンプト（対応ブラウザのみ。1回使うと無効になる） */
  let installPrompt = null;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    a2hsAndroid.hidden = false;
    a2hsGeneric.hidden = true;
  });
  document.getElementById('a2hs-install-button').addEventListener('click', async () => {
    if (!installPrompt) {
      return;
    }
    const prompt = installPrompt;
    installPrompt = null;
    a2hsAndroid.hidden = true;
    a2hsGeneric.hidden = false;
    await prompt.prompt();
  });
  // iOS Safari（スタンドアロン起動中は案内不要）
  if (
    /iPhone|iPad|iPod/.test(navigator.userAgent) &&
    !window.matchMedia('(display-mode: standalone)').matches
  ) {
    a2hsIos.hidden = false;
    a2hsGeneric.hidden = true;
  }

  // 初期表示の優先順位: (1)デモ指定 (2)共有URLの座標 (3)イベント固定リンク
  // (4)記憶した地点 (5)既定の都市
  const pageParams = new URLSearchParams(window.location.search);
  const sharedLat = Number.parseFloat(pageParams.get('lat') ?? '');
  const sharedLon = Number.parseFloat(pageParams.get('lon') ?? '');

  /** 共有URLの日付・時間帯（date/from/to）を表示とプランナーへ反映する。
   * 開いた時点の最新予報で再計算するため、共有元の画面写真より安全側になる */
  function applySharedPlan(tabSeqAtStart) {
    const date = (pageParams.get('date') ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return;
    }
    if (!currentForecast.days.some((d) => d.date === date)) {
      // 予報3日を過ぎた・過去の日付は固定文で案内し、地点のみの表示に留める
      // （通信エラーではないため、赤のエラーではなく黄の注意で示す）
      setStatus(
        `共有された日付（${date}）は予報の範囲外です。この地点の直近の予報を表示しています。`,
        false,
        true,
      );
      return;
    }
    planDate.value = date;
    clearPlan();
    const from = Number.parseInt(pageParams.get('from') ?? '', 10);
    const to = Number.parseInt(pageParams.get('to') ?? '', 10);
    const hasRange =
      Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from <= 23 && to >= 1 && to <= 24 && from < to;
    if (hasRange) {
      planStart.value = String(from);
      planEnd.value = String(to);
    }
    // 利用者が先にタブを触っていたら、その操作を尊重して切り替えない
    const dayTab = dayTabForDate(date);
    if (dayTab && manualTabSeq === tabSeqAtStart) {
      forecastTabs.activate(dayTab.tabId, false);
    }
    setStatus(
      `共有された日付（${formatDate(date)}）${hasRange ? `と時間帯（${from}時〜${to}時）` : ''}を反映しました。` +
        '予報は開いた時点の最新の内容です。',
      false,
    );
  }

  /** 記憶した地点または既定都市を読み込む（イベント固定リンクの失敗時にも使う。
   * 完了後に案内を出せるようloadForecastの結果を返す） */
  function loadInitialStoredOrDefault() {
    const stored = readStoredLocation();
    if (stored) {
      // 記憶した地点が地点セレクト由来なら、セレクトの表示も合わせる
      if (stored.cityIndex !== null && CITIES[stored.cityIndex]) {
        citySelect.value = String(stored.cityIndex);
      }
      return loadForecast(stored.query, stored.locationName, { cityIndex: stored.cityIndex });
    }
    return loadSelectedCity();
  }

  if (pageParams.get('demo') === '1') {
    loadForecast(DEMO_QUERY, 'デモデータ（架空の気象データ）');
  } else if (
    Number.isFinite(sharedLat) &&
    Number.isFinite(sharedLon) &&
    sharedLat >= -90 &&
    sharedLat <= 90 &&
    sharedLon >= -180 &&
    sharedLon <= 180
  ) {
    // 共有URL: URL由来の地点名は信頼しない。表示には座標由来の位置関係を併記して
    // 名前と座標の食い違い（偽装リンク）に気付けるようにし、記憶には座標由来の
    // 名前だけを使って偽装名が次回以降の表示に固定されないようにする。
    // 表示自体はtextContent経由のため、タグや装飾は無効化される
    const sharedName = (pageParams.get('name') ?? '').trim().slice(0, 80);
    const coordName = describeSharedLocation(sharedLat, sharedLon);
    const displayLabel = sharedName
      ? `${sharedName}（共有・${nearestCityText(sharedLat, sharedLon)}）`
      : coordName;
    const tabSeqAtStart = manualTabSeq;
    // 旧形式（小数4桁）の共有URLで開かれても、以後のURL・記憶は小数2桁に正規化する
    loadForecast(coordQuery(sharedLat, sharedLon), displayLabel, {
      storedName: coordName,
      // URL・共有リンクへは注記なしの名前だけを書き戻す。displayLabelをそのまま
      // 載せると、共有が1往復するたびに「（共有・…）」が積み重なって名前が伸び、
      // 80文字で切られて壊れる（名前が無ければURLにも載せない）
      urlName: sharedName,
    }).then((loaded) => {
      if (loaded) {
        applySharedPlan(tabSeqAtStart);
      }
    });
  } else if ((pageParams.get('event') ?? '').trim() !== '') {
    // イベント固定リンク（?event=イベント名）: 一覧の読み込み完了後に
    // initEventsの続き（下のinitEvents().then）が該当イベントを自動選択する
    pendingEventName = (pageParams.get('event') ?? '').trim().slice(0, 80);
  } else {
    loadInitialStoredOrDefault();
  }

  // Service Worker登録（PWA）: オフライン時にシェルと最後に取得した予報を表示できる。
  // オンライン時は常にネットワーク優先のため、通常表示への影響はない（詳細はsw.js）
  if ('serviceWorker' in navigator) {
    // CSPで`require-trusted-types-for 'script'`を有効にしているため、
    // register()へ文字列をそのまま渡すとTypeErrorになる（DOM型XSS対策）。
    // 自分のsw.js以外を返さないポリシーを通してURLを作る。
    // ポリシー名は_headersのtrusted-typesディレクティブと一致させること
    let swUrl = '/sw.js';
    try {
      if (window.trustedTypes && window.trustedTypes.createPolicy) {
        swUrl = window.trustedTypes
          .createPolicy('fursuitweather-sw', { createScriptURL: () => '/sw.js' })
          .createScriptURL('/sw.js');
      }
    } catch {
      // ポリシーを作れない場合は登録を諦める（通常表示には影響しない）
      swUrl = null;
    }
    if (swUrl !== null) {
      navigator.serviceWorker.register(swUrl).catch(() => {
        // 登録できない環境（古いブラウザなど）でも通常表示には影響しない
      });
    }
  }
})();
