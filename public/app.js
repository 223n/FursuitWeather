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

  /** 深刻度（grade）に対応する記号。色覚に依存しないよう必ずラベルと併記する */
  const GRADE_SYMBOLS = ['◎', '○', '△', '✕', '🚫'];

  /** WMO天気コードに対応する絵文字 */
  function weatherEmoji(code) {
    if (code === 0 || code === 1) return '☀️';
    if (code === 2) return '⛅';
    if (code === 3) return '☁️';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 67) return '🌧️';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄️';
    if (code >= 80 && code <= 82) return '🌧️';
    if (code >= 95) return '⛈️';
    return '❓';
  }

  const statusElement = document.getElementById('status');
  const citySelect = document.getElementById('city-select');
  const dayCardsElement = document.getElementById('day-cards');
  const hoursBody = document.getElementById('hours-body');
  const hoursTitle = document.getElementById('hours-title');
  const noticesList = document.getElementById('notices-list');

  let currentForecast = null;
  let selectedDate = null;

  /** ステータスメッセージを表示する */
  function setStatus(message, isError) {
    statusElement.textContent = message;
    statusElement.classList.toggle('error', Boolean(isError));
  }

  /** バッジ要素を作る */
  function createBadge(summary) {
    const badge = document.createElement('span');
    const isCold = String(summary.level).startsWith('cold');
    badge.className = `badge grade-${summary.grade}${isCold ? ' cold' : ''}`;
    const symbol = GRADE_SYMBOLS[summary.grade] ?? '?';
    badge.textContent = `${symbol} ${summary.label}`;
    return badge;
  }

  /** 日付文字列（YYYY-MM-DD）を「8月15日（土）」形式にする
   * 予報の日付はJST基準のため、閲覧環境のタイムゾーンに依存しないようUTC基準で曜日を求める */
  function formatDate(dateText) {
    const [year, month, day] = dateText.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${month}月${day}日（${weekdays[date.getUTCDay()]}）`;
  }

  /** 日別カードを描画する */
  function renderDayCards(forecast) {
    dayCardsElement.replaceChildren();
    for (const day of forecast.days) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'day-card';
      card.dataset.date = day.date;
      if (day.date === selectedDate) {
        card.classList.add('selected');
      }

      const title = document.createElement('h3');
      title.textContent = formatDate(day.date);
      card.appendChild(title);

      const weatherLine = document.createElement('p');
      weatherLine.className = 'weather-line';
      weatherLine.textContent =
        `${weatherEmoji(day.weatherCode)} ${day.weatherLabel} ` +
        `${Math.round(day.temperatureMin)}〜${Math.round(day.temperatureMax)}℃`;
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

      addRow('屋外（日中の最も厳しい時間帯）', createBadge(day.outdoorWorst));
      addRow(
        '活動しやすい時間帯',
        day.recommendedHours.length > 0 ? day.recommendedHours.join('、') : 'なし（休憩と冷却を最優先に）',
      );
      addRow('屋内（空調なしの場合）', day.coolingRequired ? '冷房必須' : '冷房なしでも活動可の時間帯あり');
      addRow('洗濯・乾燥', `${day.laundry.label}（指数${day.laundry.score}）`);
      addRow('ファースーツ乾燥目安', `約${day.laundry.fursuitDryingHours}時間${day.laundry.moldWarning ? '（カビ注意）' : ''}`);

      card.appendChild(list);
      card.addEventListener('click', () => {
        selectedDate = day.date;
        renderDayCards(currentForecast);
        renderHours(currentForecast);
      });
      dayCardsElement.appendChild(card);
    }
  }

  /** 時間別テーブルを描画する */
  function renderHours(forecast) {
    const hours = forecast.hours.filter((h) => h.time.startsWith(selectedDate));
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

      addCell(`${String(hourNumber).padStart(2, '0')}:00`);
      addCell(`${weatherEmoji(hour.weather.weatherCode)} ${hour.weatherLabel}`);
      addCell(`${hour.weather.temperature.toFixed(1)}℃`);
      addCell(`${Math.round(hour.weather.humidity)}%`);
      addCell(`${hour.outdoor.suitWbgt.toFixed(1)}℃`);
      addCell(createBadge(hour.outdoor));
      addCell(hour.outdoor.activityMinutes > 0 ? `${hour.outdoor.activityMinutes}分` : '中止');

      const indoorCell = document.createElement('span');
      indoorCell.appendChild(createBadge(hour.indoor));
      indoorCell.appendChild(document.createTextNode(` ${hour.indoor.coolingLabel}`));
      addCell(indoorCell);

      hoursBody.appendChild(row);
    }
  }

  /** 注意事項を描画する */
  function renderNotices(forecast) {
    noticesList.replaceChildren();
    for (const notice of forecast.notices) {
      const item = document.createElement('li');
      item.textContent = notice;
      noticesList.appendChild(item);
    }
  }

  /** 予報を取得して描画する */
  async function loadForecast(query) {
    setStatus('予報を取得しています…', false);
    try {
      const response = await fetch(`/api/forecast?${query}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || `予報の取得に失敗しました（HTTP ${response.status}）`);
      }

      currentForecast = body;
      selectedDate = body.days.length > 0 ? body.days[0].date : null;

      setStatus('', false);
      document.getElementById('days-section').classList.remove('hidden');
      document.getElementById('notices-section').classList.remove('hidden');
      renderDayCards(body);
      renderNotices(body);

      if (selectedDate) {
        document.getElementById('hours-section').classList.remove('hidden');
        renderHours(body);
      }
    } catch (error) {
      setStatus(`エラー: ${error.message}`, true);
    }
  }

  /** 選択中の都市で予報を読み込む */
  function loadSelectedCity() {
    const city = CITIES[Number(citySelect.value)];
    if (!city) {
      return;
    }
    loadForecast(`lat=${city.lat}&lon=${city.lon}`);
  }

  // 地点セレクトの初期化
  CITIES.forEach((city, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = city.name;
    if (city.name === '東京') {
      option.selected = true;
    }
    citySelect.appendChild(option);
  });

  citySelect.addEventListener('change', loadSelectedCity);
  document.getElementById('reload-button').addEventListener('click', loadSelectedCity);

  document.getElementById('geolocation-button').addEventListener('click', () => {
    if (!navigator.geolocation) {
      setStatus('このブラウザは位置情報に対応していません。', true);
      return;
    }
    setStatus('現在地を取得しています…', false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        loadForecast(
          `lat=${position.coords.latitude.toFixed(4)}&lon=${position.coords.longitude.toFixed(4)}`,
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
    loadForecast('demo=1');
  } else {
    loadSelectedCity();
  }
})();
