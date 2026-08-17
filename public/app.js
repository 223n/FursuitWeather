// FursuitWeather フロントエンド
// /api/forecast から予報を取得して描画する

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
    if (code >= 51 && code <= 67) return 'cloud-rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowflake';
    if (code >= 80 && code <= 82) return 'cloud-rain';
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

  // 可変状態はこのブロックの変数のみ（描画関数はここを参照する）
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
  /** 進行中リクエストの識別番号（古い応答で表示が上書きされるのを防ぐ） */
  let requestSeq = 0;
  /** 進行中の地点検索の識別番号（古い検索応答で候補が汚染されるのを防ぐ） */
  let searchSeq = 0;
  /** 地点セレクトのデバウンス用タイマー */
  let cityChangeTimer = null;

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

  /** 記憶済みの地点を読み出す。形式が不正・破損している場合はnullを返す */
  function readStoredLocation() {
    try {
      const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const stored = JSON.parse(raw);
      if (
        !stored ||
        typeof stored.query !== 'string' ||
        !/^lat=-?[\d.]+&lon=-?[\d.]+$/.test(stored.query) ||
        typeof stored.locationName !== 'string'
      ) {
        return null;
      }
      return {
        query: stored.query,
        locationName: stored.locationName,
        cityIndex: Number.isInteger(stored.cityIndex) ? stored.cityIndex : null,
      };
    } catch {
      return null;
    }
  }

  /** 表示に成功した地点を記憶する */
  function writeStoredLocation(query, locationName, cityIndex) {
    try {
      window.localStorage.setItem(
        LOCATION_STORAGE_KEY,
        JSON.stringify({ query, locationName, cityIndex }),
      );
    } catch {
      // 保存できなくても予報表示自体には影響しないため無視する
    }
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
      '詳しくは日別サマリーと時間別予報の表をご確認ください。',
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
  function setStatus(message, isError) {
    // エラーはrole=alert領域に書き、スクリーンリーダーへ即時に通知する
    // （politeの#statusだと他の読み上げ待ちで遅延・埋没するため）
    statusElement.textContent = isError ? '' : message;
    statusErrorElement.textContent = isError ? message : '';
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
    const srPrefix = document.createElement('span');
    srPrefix.className = 'sr-only';
    srPrefix.textContent = '注意: ';
    note.appendChild(srPrefix);
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

  /** 冷房要否ごとのバッジ設定（色+記号）。ラベルはAPIのcoolingLabelを使う */
  const COOLING_BADGES = {
    required: { grade: 3, symbol: [{ icon: 'snowflake' }, '✕'] },
    recommended: { grade: 1, symbol: [{ icon: 'snowflake' }, '○'] },
    none: { grade: 0 },
  };

  /** 着ぐるみ乾燥目安のバッジ設定を組み立てる */
  function fursuitDryingBadge(laundry) {
    const hours = laundry.fursuitDryingHours;
    if (laundry.moldWarning) {
      return { grade: 3, label: `約${hours}時間・カビ注意` };
    }
    if (hours <= 30) {
      return { grade: 0, label: `約${hours}時間` };
    }
    if (hours <= 40) {
      return { grade: 1, label: `約${hours}時間` };
    }
    return { grade: 2, label: `約${hours}時間` };
  }

  /** 日付文字列（YYYY-MM-DD）を「8月15日（土）」形式にする
   * 予報の日付はJST基準のため、閲覧環境のタイムゾーンに依存しないようUTC基準で曜日を求める */
  function formatDate(dateText) {
    const [year, month, day] = dateText.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${month}月${day}日（${weekdays[date.getUTCDay()]}）`;
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
    const tildeReading = document.createElement('span');
    tildeReading.className = 'sr-only';
    tildeReading.textContent = 'から';
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
    const srPurpose = document.createElement('span');
    srPurpose.className = 'sr-only';
    srPurpose.textContent = 'の時間別予報を表示';
    titleButton.appendChild(srPurpose);
    title.appendChild(titleButton);
    card.appendChild(title);

    const weatherLine = document.createElement('p');
    weatherLine.className = 'weather-line';
    const weatherContent = weatherWithLabel(day.weatherCode, day.weatherLabel);
    weatherContent.appendChild(createTemperatureRange(day.temperatureMin, day.temperatureMax));
    weatherLine.appendChild(weatherContent);
    card.appendChild(weatherLine);

    const list = document.createElement('dl');

    const addRow = (label, valueNode) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      if (typeof valueNode === 'string') {
        dd.textContent = valueNode;
      } else {
        dd.appendChild(valueNode);
      }
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
      createBadge(
        day.coolingRequired
          ? { ...COOLING_BADGES.required, label: '冷房必須' }
          : { ...COOLING_BADGES.none, label: '冷房なしでも可の時間帯あり' },
      ),
    );
    const laundryValue = badgeWithText(
      { ...(LAUNDRY_BADGES[day.laundry.level] ?? { grade: 2 }), label: day.laundry.label },
      null,
    );
    laundryValue.appendChild(createInfoChip(`指数${day.laundry.score}`));
    addRow('洗濯・乾燥', laundryValue);
    addRow('着ぐるみ乾燥目安', createBadge(fursuitDryingBadge(day.laundry)));

    card.appendChild(list);

    const selectDay = () => {
      selectedDate = day.date;
      updateSelectedCard();
      renderHours();
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

  /** 時間別テーブルを描画する */
  /** 日本時間の現在日付（YYYY-MM-DD）と時（0〜23）を返す
   * 予報データの時刻はAsia/Tokyoのため、端末のタイムゾーンに依存せずJSTで比較する */
  function nowInJst() {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return { date: jst.toISOString().slice(0, 10), hour: jst.getUTCHours() };
  }

  function renderHours() {
    const now = nowInJst();
    const hours = currentForecast.hours.filter((h) => {
      if (!h.time.startsWith(selectedDate)) {
        return false;
      }
      // 当日は過ぎた時間帯を表示しない（例: 15:25なら15時以降のみ表示する）
      if (selectedDate === now.date) {
        return Number.parseInt(h.time.slice(11, 13), 10) >= now.hour;
      }
      return true;
    });
    hoursTitle.textContent = `時間別予報（${formatDate(selectedDate)}）`;
    hoursBody.replaceChildren();

    for (const hour of hours) {
      const row = document.createElement('tr');
      const hourNumber = Number.parseInt(hour.time.slice(11, 13), 10);
      if (hourNumber < 6 || hourNumber >= 19) {
        row.classList.add('night');
      }

      const addCell = (content) => {
        const cell = document.createElement('td');
        if (typeof content === 'string') {
          cell.textContent = content;
        } else {
          cell.appendChild(content);
        }
        row.appendChild(cell);
      };

      // 時刻セルは行見出し（th scope=row）にして、スクリーンリーダーが
      // 各セルを読むときに対応する時刻を伝えられるようにする
      const timeHeader = document.createElement('th');
      timeHeader.scope = 'row';
      timeHeader.textContent = `${String(hourNumber).padStart(2, '0')}:00`;
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
      indoorCell.appendChild(
        createBadge({
          ...(COOLING_BADGES[hour.indoor.cooling] ?? COOLING_BADGES.none),
          label: hour.indoor.coolingLabel,
        }),
      );
      addCell(indoorCell);

      hoursBody.appendChild(row);
    }
  }

  /** 注意事項を描画する */
  function renderNotices() {
    noticesList.replaceChildren();
    for (const notice of currentForecast.notices) {
      const item = document.createElement('li');
      item.textContent = notice;
      noticesList.appendChild(item);
    }
  }

  /** 予報を取得して描画する
   * @param {string} query APIへのクエリ文字列
   * @param {string} locationName 表示する地点名（成功時にラベルへ反映）
   * @param {object} [options]
   * @param {number | null} [options.cityIndex] 地点セレクト由来の場合のCITIESインデックス（記憶用）
   * @param {boolean} [options.persist] falseなら記憶もURL反映もしない（現在地用）
   * @param {string | null} [options.storedName] 記憶に使う名前（URL由来の名前を信頼しない場合に指定） */
  async function loadForecast(query, locationName, options = {}) {
    const { cityIndex = null, persist = true, storedName = null } = options;
    // 確定ロードは保留中のセレクトデバウンスと検索応答を無効化し、後から
    // 古い地点選択・検索候補が発火して最後の明示操作を上書きするのを防ぐ
    clearTimeout(cityChangeTimer);
    cityChangeTimer = null;
    searchSeq += 1;
    // 「予報を更新」が常に「最後に要求した条件の再試行」になるよう、
    // クエリと地点名は成功を待たずペアで記録する（表示ラベルの更新は成功時のみ）
    lastQuery = query;
    lastLocationName = locationName;
    lastOptions = options;
    const seq = ++requestSeq;
    setStatus('予報を取得しています…', false);
    try {
      // ネットワーク断ではブラウザ固有の英語メッセージ（Failed to fetch等）になるため、
      // 生メッセージを出さず日本語の定型文に差し替える
      const response = await fetch(`/api/forecast?${query}`).catch(() => {
        throw new Error(
          '通信に失敗しました。ネットワーク接続を確認して「予報を更新」をお試しください。',
        );
      });
      // 非JSON応答（エッジのエラーページなど）でパースエラーの生メッセージを出さないよう、
      // パース失敗はnullに落としてからステータスを判定する
      const body = await response.json().catch(() => null);
      if (seq !== requestSeq) {
        // より新しいリクエストが始まっているので、この応答は破棄する
        return;
      }
      if (!response.ok) {
        throw new Error(
          (body && body.error) || `予報の取得に失敗しました（HTTP ${response.status}）`,
        );
      }
      // JSONとして妥当でも予報の形をしていないボディ（中間プロキシの200応答など）は、
      // 後続の描画でTypeErrorの生メッセージが出る前にここで弾く
      // （days・hours・noticesは描画経路が無条件に反復する配列のためすべて検証する）
      if (
        !body ||
        !Array.isArray(body.days) ||
        !Array.isArray(body.hours) ||
        !Array.isArray(body.notices)
      ) {
        throw new Error('予報データの形式が不正です');
      }

      currentForecast = body;
      // 再取得時は選択中の日が新しいデータにも存在すれば維持する
      // （「予報を更新」のたびに初日へ戻ると、読んでいる表と利用者の認識がずれるため）
      const dates = body.days.map((d) => d.date);
      selectedDate = dates.includes(selectedDate) ? selectedDate : (dates[0] ?? null);

      // 取得後に空白へ戻さず、完了が分かるメッセージを表示したままにする
      // （詳細な読み上げは#sr-announceのサマリーが担うため、ここは短い文言でよい）
      setStatus('予報を取得しました', false);
      setLocationLabel(locationName);
      // 共有ボタンは「表示に成功した地点」を対象にする（失敗し得るlastQueryとは分ける）
      displayedQuery = query;
      displayedName = locationName;
      if (query !== 'demo=1') {
        if (persist) {
          // 次回アクセス時に同じ地点を表示できるよう記憶し、表示中の地点をURLにも
          // 反映してそのまま共有・ブックマークできるようにする。
          // 記憶する名前はstoredName優先（共有URL由来の名前を鵜呑みにしないため）
          writeStoredLocation(query, storedName ?? locationName, cityIndex);
          const urlParams = new URLSearchParams(query);
          urlParams.set('name', locationName);
          window.history.replaceState(null, '', `?${urlParams.toString()}`);
        } else {
          // 現在地は「位置情報は保存しません」の約束どおり記憶もURL反映もしない。
          // 以前の地点パラメータが残っているとアドレスバーと表示が食い違うため消す
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
      renderDayCards();
      renderNotices();

      if (selectedDate) {
        renderHours();
      }

      // スクリーンリーダーへ読み込み完了とその日の要点を通知する
      srAnnounce.textContent = buildSpokenSummary(body, locationName);
    } catch (error) {
      if (seq !== requestSeq) {
        return;
      }
      setStatus(`エラー: ${error.message}`, true);
      // 予報を表示できないときは読み込み中のプレースホルダーを消す
      if (!currentForecast) {
        dayCardsElement.replaceChildren();
        hoursBody.replaceChildren();
      }
    }
  }

  /** 選択中の都市で予報を読み込む */
  function loadSelectedCity() {
    const cityIndex = Number(citySelect.value);
    const city = CITIES[cityIndex];
    if (!city) {
      return;
    }
    // 座標はURLに現れるためすべて小数2桁（約1km）に統一する
    loadForecast(`lat=${city.lat.toFixed(2)}&lon=${city.lon.toFixed(2)}`, city.name, { cityIndex });
  }

  // 地点セレクトの選択肢はレイアウトシフト防止のためindex.htmlに静的に記載している
  // （valueはCITIES配列のインデックスに対応）
  // changeは矢印キーでの選択肢探索でも発火するため、デバウンスして
  // 連続操作中の取得と読み上げ通知の洪水を防ぐ（確定は600ms静止後）
  citySelect.addEventListener('change', () => {
    clearTimeout(cityChangeTimer);
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

  document.getElementById('geolocation-button').addEventListener('click', () => {
    // GPS取得待ちの間に保留中のセレクトデバウンスが発火しないよう先に解除する
    clearTimeout(cityChangeTimer);
    cityChangeTimer = null;
    if (!navigator.geolocation) {
      setStatus('このブラウザは位置情報に対応していません。', true);
      return;
    }
    setStatus('現在地を取得しています…', false);
    // GPS取得中に別の地点操作でロードが始まっていたら、遅れて届いた結果は破棄する
    // （requestSeqのfetch応答ガードはコールバック起点の新規ロードには効かないため）
    const startedAt = requestSeq;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // 取得中に新しいロードが始まった、または新しいセレクト操作が保留されて
        // いたら、遅れて届いたGPS結果はそちらに譲る（最後の明示操作が勝つ）
        if (requestSeq !== startedAt || cityChangeTimer !== null) {
          return;
        }
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        loadForecast(
          // プライバシー保護: GPS座標は小数2桁（約1km）へ丸めてから使う。
          // 予報は約5kmメッシュのため結果は変わらず、APIリクエストや
          // 「共有」のURLに自宅を特定できる精度の位置が流れない
          `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`,
          describeCurrentLocation(lat, lon),
          // 現在地の座標はlocalStorageにもURLにも残さない（「保存しません」の約束）
          { persist: false },
        );
      },
      () => {
        if (requestSeq !== startedAt || cityChangeTimer !== null) {
          return;
        }
        setStatus('現在地を取得できませんでした。地点を選択してください。', true);
      },
      // 位置情報源が応答しない環境でコールバックが来ず「取得しています…」のまま
      // 固まらないよう、待ち時間を有界にする（TIMEOUTは上のエラー表示に合流する）。
      // maximumAgeは直近1分のキャッシュ位置を許容し、再クリック時の応答を速くする
      { timeout: 15000, maximumAge: 60000 },
    );
  });

  // 「表示地点の予報を共有」: 表示に成功している地点の共有URLをOSの共有機能または
  // クリップボードで渡す（要求中・失敗中のlastQueryではなくdisplayedQueryを使い、
  // 画面の予報と共有URLが常に一致するようにする）
  document.getElementById('share-button').addEventListener('click', async () => {
    let shareUrl = `${window.location.origin}/`;
    if (displayedQuery === 'demo=1') {
      shareUrl = `${window.location.origin}/?demo=1`;
    } else if (displayedQuery) {
      const params = new URLSearchParams(displayedQuery);
      if (displayedName) {
        params.set('name', displayedName);
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
      setStatus('共有用URLをコピーしました', false);
    } catch {
      setStatus('URLをコピーできませんでした。アドレスバーのURLをご利用ください。', true);
    }
  });

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
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`).catch(() => {
        throw new Error('通信に失敗しました。ネットワーク接続を確認してください。');
      });
      const body = await response.json().catch(() => null);
      if (seq !== searchSeq) {
        return;
      }
      if (!response.ok) {
        throw new Error(
          (body && body.error) || `地点検索に失敗しました（HTTP ${response.status}）`,
        );
      }
      if (!body || !Array.isArray(body.results)) {
        throw new Error('地点検索の結果の形式が不正です');
      }
      const places = [];
      for (const place of body.results) {
        if (
          typeof place.name !== 'string' ||
          typeof place.latitude !== 'number' ||
          typeof place.longitude !== 'number'
        ) {
          continue;
        }
        const label =
          typeof place.admin1 === 'string' && place.admin1 !== ''
            ? `${place.name}（${place.admin1}）`
            : place.name;
        places.push({ label, latitude: place.latitude, longitude: place.longitude });
      }
      if (places.length === 0) {
        setStatus('該当する地点が見つかりませんでした。市区町村名や別の表記でお試しください。', true);
        return;
      }
      const selectPlace = (choice) => {
        clearSearchResults();
        searchInput.value = '';
        loadForecast(
          // 座標はURLに現れるためすべて小数2桁（約1km）に統一する。予報は約5km
          // メッシュのため結果への影響はない
          `lat=${choice.latitude.toFixed(2)}&lon=${choice.longitude.toFixed(2)}`,
          choice.label,
        );
      };
      // 候補が1件だけなら選ばせる必要がないため、そのまま予報を表示する
      // （郵便番号検索は市区町村1件に決まることが多く、この経路になる）
      if (places.length === 1) {
        selectPlace(places[0]);
        return;
      }
      const items = places.map((choice) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.appendChild(faIcon('location-dot', 'btn-icon'));
        button.appendChild(document.createTextNode(choice.label));
        button.addEventListener('click', () => selectPlace(choice));
        item.appendChild(button);
        return item;
      });
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

  // 初期表示の優先順位: (1)デモ指定 (2)共有URLの座標 (3)記憶した地点 (4)既定の都市
  const pageParams = new URLSearchParams(window.location.search);
  const sharedLat = Number.parseFloat(pageParams.get('lat') ?? '');
  const sharedLon = Number.parseFloat(pageParams.get('lon') ?? '');
  if (pageParams.get('demo') === '1') {
    loadForecast('demo=1', 'デモデータ（架空の気象データ）');
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
    // 旧形式（小数4桁）の共有URLで開かれても、以後のURL・記憶は小数2桁に正規化する
    loadForecast(`lat=${sharedLat.toFixed(2)}&lon=${sharedLon.toFixed(2)}`, displayLabel, {
      storedName: coordName,
    });
  } else {
    const stored = readStoredLocation();
    if (stored) {
      // 記憶した地点が地点セレクト由来なら、セレクトの表示も合わせる
      if (stored.cityIndex !== null && CITIES[stored.cityIndex]) {
        citySelect.value = String(stored.cityIndex);
      }
      loadForecast(stored.query, stored.locationName, { cityIndex: stored.cityIndex });
    } else {
      loadSelectedCity();
    }
  }
})();
