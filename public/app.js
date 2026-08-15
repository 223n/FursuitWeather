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

  // 可変状態はこのブロックの6変数のみ（描画関数はここを参照する）
  let currentForecast = null;
  let selectedDate = null;
  /** 最後に予報を取得したクエリ（「予報を更新」で同じ条件を再取得するために保持） */
  let lastQuery = null;
  /** 最後に表示した地点の名前（「予報を更新」でラベルを維持するために保持） */
  let lastLocationName = null;
  /** 進行中リクエストの識別番号（古い応答で表示が上書きされるのを防ぐ） */
  let requestSeq = 0;
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

  /** 座標から「現在地」の説明文を作る（最寄りのプリセット都市からの距離で表現） */
  function describeCurrentLocation(lat, lon) {
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
    return `現在地（緯度${lat.toFixed(2)}・経度${lon.toFixed(2)}、${relative}）`;
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
      `洗濯指数は「${today.laundry.label}」、ファースーツの乾燥目安は約${today.laundry.fursuitDryingHours}時間です。`,
      '詳しくは日別サマリーと時間別予報の表をご確認ください。',
    ];
    return parts.join('');
  }

  /** 表示中の地点ラベルを更新する */
  function setLocationLabel(name) {
    lastLocationName = name;
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

  /** ファースーツ乾燥目安のバッジ設定を組み立てる */
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

    // その日の屋外判定（最も厳しい時間帯）を大きなアイコン+文字で表示する
    const mainCaption = document.createElement('p');
    mainCaption.className = 'main-judgement-caption';
    mainCaption.textContent = '屋外判定（日中の最も厳しい時間帯）';
    card.appendChild(mainCaption);

    const mainJudgement = document.createElement('p');
    mainJudgement.className = 'main-judgement';
    mainJudgement.appendChild(createBadge(day.outdoorWorst, true));
    card.appendChild(mainJudgement);

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

    const hasRecommended = day.recommendedHours.length > 0;
    addRow(
      '活動しやすい時間帯',
      badgeWithText(
        hasRecommended ? { grade: 0, label: 'あり' } : { grade: 3, label: 'なし' },
        hasRecommended ? day.recommendedHours.join('、') : '休憩と冷却を最優先に',
      ),
    );
    // 日別サマリーのAPIレスポンス（coolingRequired）にはラベルが無いため、ここの文言はフロントで持つ
    addRow(
      '屋内（空調なしの場合）',
      createBadge(
        day.coolingRequired
          ? { grade: 3, symbol: [{ icon: 'snowflake' }, '✕'], label: '冷房必須' }
          : { grade: 0, label: '冷房なしでも可の時間帯あり' },
      ),
    );
    addRow(
      '洗濯・乾燥',
      badgeWithText(
        { ...(LAUNDRY_BADGES[day.laundry.level] ?? { grade: 2 }), label: day.laundry.label },
        `指数${day.laundry.score}`,
      ),
    );
    addRow('ファースーツ乾燥目安', createBadge(fursuitDryingBadge(day.laundry)));

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
  function renderHours() {
    const hours = currentForecast.hours.filter((h) => h.time.startsWith(selectedDate));
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
   * @param {string} locationName 表示する地点名（成功時にラベルへ反映） */
  async function loadForecast(query, locationName) {
    lastQuery = query;
    const seq = ++requestSeq;
    setStatus('予報を取得しています…', false);
    try {
      const response = await fetch(`/api/forecast?${query}`);
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
      if (!body) {
        throw new Error('予報データの形式が不正です');
      }

      currentForecast = body;
      // 再取得時は選択中の日が新しいデータにも存在すれば維持する
      // （「予報を更新」のたびに初日へ戻ると、読んでいる表と利用者の認識がずれるため）
      const dates = body.days.map((d) => d.date);
      selectedDate = dates.includes(selectedDate) ? selectedDate : (dates[0] ?? null);

      setStatus('', false);
      setLocationLabel(locationName);
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
    const city = CITIES[Number(citySelect.value)];
    if (!city) {
      return;
    }
    loadForecast(`lat=${city.lat}&lon=${city.lon}`, city.name);
  }

  // 地点セレクトの選択肢はレイアウトシフト防止のためindex.htmlに静的に記載している
  // （valueはCITIES配列のインデックスに対応）
  // changeは矢印キーでの選択肢探索でも発火するため、デバウンスして
  // 連続操作中の取得と読み上げ通知の洪水を防ぐ（確定は600ms静止後）
  citySelect.addEventListener('change', () => {
    clearTimeout(cityChangeTimer);
    cityChangeTimer = setTimeout(loadSelectedCity, 600);
  });

  // 「この地点を使う」: 現在地やデモの表示中でも、セレクトで選んだ地点にいつでも戻れる
  // （セレクトの値が変わらないとchangeイベントが発火しないため、明示的なボタンを用意）
  document.getElementById('city-button').addEventListener('click', loadSelectedCity);

  // 「予報を更新」は表示中の予報（現在地・デモを含む）と同じ条件で再取得する
  document.getElementById('reload-button').addEventListener('click', () => {
    if (lastQuery) {
      loadForecast(lastQuery, lastLocationName);
    } else {
      loadSelectedCity();
    }
  });

  document.getElementById('geolocation-button').addEventListener('click', () => {
    if (!navigator.geolocation) {
      setStatus('このブラウザは位置情報に対応していません。', true);
      return;
    }
    setStatus('現在地を取得しています…', false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        loadForecast(
          `lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
          describeCurrentLocation(lat, lon),
        );
      },
      () => {
        setStatus('現在地を取得できませんでした。地点を選択してください。', true);
      },
    );
  });

  // 初期表示: ?demo=1 のときはデモデータ、それ以外は選択中の都市
  const pageParams = new URLSearchParams(window.location.search);
  if (pageParams.get('demo') === '1') {
    loadForecast('demo=1', 'デモデータ（架空の気象データ）');
  } else {
    loadSelectedCity();
  }
})();
