// 実測WBGTから着ぐるみ判定を行う簡易ツール（aboutページ専用）
// イベント会場などでWBGT計により実測した値に着衣補正を加えて判定する。
// しきい値・補正値はsrc/constants.tsと手動同期し、test/htmlSync.test.tsが機械検証する

(() => {
  'use strict';

  /** 着ぐるみの着衣補正値（℃）。src/constants.tsのSUIT_WBGT_ADJUSTMENTと同期 */
  const SUIT_WBGT_ADJUSTMENT = 11;

  /** 暑熱5段階（upperBound未満で該当）。src/constants.tsのHEAT_BANDSと同期 */
  const HEAT_BANDS = [
    { upperBound: 21, label: 'ほぼ安全', grade: 0, activityMinutes: 45 },
    { upperBound: 25, label: '注意', grade: 1, activityMinutes: 30 },
    { upperBound: 28, label: '警戒', grade: 2, activityMinutes: 20 },
    { upperBound: 31, label: '厳重警戒', grade: 3, activityMinutes: 10 },
    { upperBound: Infinity, label: '危険', grade: 4, activityMinutes: 0 },
  ];

  /** 冷房要否のしきい値（℃）。src/constants.tsのCOOLING_*_WBGTと同期 */
  const COOLING_REQUIRED_WBGT = 25;
  const COOLING_RECOMMENDED_WBGT = 21;

  /** Font Awesome Freeのアイコンパス（本ページの対応表と同じもの） */
  const ICON_PATHS = {
    ban: 'M367.2 412.5L99.5 144.8c-22.4 31.4-35.5 69.8-35.5 111.2 0 106 86 192 192 192 41.5 0 79.9-13.1 111.2-35.5zm45.3-45.3c22.4-31.4 35.5-69.8 35.5-111.2 0-106-86-192-192-192-41.5 0-79.9 13.1-111.2 35.5L412.5 367.2zM0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0z',
    snowflake:
      'M288.2 0c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 62.1-15-15c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l49 49 0 70.6-61.2-35.3-17.9-66.9c-3.4-12.8-16.6-20.4-29.4-17S95.3 98 98.7 110.8l5.5 20.5-53.7-31C35.2 91.5 15.6 96.7 6.8 112s-3.6 34.9 11.7 43.7l53.7 31-20.5 5.5c-12.8 3.4-20.4 16.6-17 29.4s16.6 20.4 29.4 17l66.9-17.9 61.2 35.3-61.2 35.3-66.9-17.9c-12.8-3.4-26 4.2-29.4 17s4.2 26 17 29.4l20.5 5.5-53.7 31C3.2 365.1-2 384.7 6.8 400s28.4 20.6 43.7 11.7l53.7-31-5.5 20.5c-3.4 12.8 4.2 26 17 29.4s26-4.2 29.4-17l17.9-66.9 61.2-35.3 0 70.6-49 49c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l15-15 0 62.1c0 17.7 14.3 32 32 32s32-14.3 32-32l0-62.1 15 15c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-49-49 0-70.6 61.2 35.3 17.9 66.9c3.4 12.8 16.6 20.4 29.4 17s20.4-16.6 17-29.4l-5.5-20.5 53.7 31c15.3 8.8 34.9 3.6 43.7-11.7s3.6-34.9-11.7-43.7l-53.7-31 20.5-5.5c12.8-3.4 20.4-16.6 17-29.4s-16.6-20.4-29.4-17l-66.9 17.9-61.2-35.3 61.2-35.3 66.9 17.9c12.8 3.4 26-4.2 29.4-17s-4.2-26-17-29.4l-20.5-5.5 53.7-31c15.3-8.8 20.6-28.4 11.7-43.7s-28.4-20.5-43.7-11.7l-53.7 31 5.5-20.5c3.4-12.8-4.2-26-17-29.4s-26 4.2-29.4 17l-17.9 66.9-61.2 35.3 0-70.6 49-49c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-15 15 0-62.1z',
  };

  /** 深刻度に対応する記号（grade 4はテキストではなく禁止マークSVGで表示） */
  const GRADE_SYMBOLS = ['◎', '○', '△', '✕', { icon: 'ban' }];

  /**
   * 冷房要否の表示設定（Indexページの時間別テーブルと同じ配色・記号）
   * app.jsのCOOLING_BADGESと同期
   */
  const COOLING_BADGES = {
    required: { grade: 3, symbol: [{ icon: 'snowflake' }, '✕'], label: '冷房必須' },
    recommended: { grade: 1, symbol: [{ icon: 'snowflake' }, '○'], label: '冷房推奨' },
    none: { grade: 0, symbol: ['◎'], label: '冷房なしでも可' },
  };

  const input = document.getElementById('wbgt-input');
  const judgeButton = document.getElementById('wbgt-judge-button');
  const resultArea = document.getElementById('wbgt-result');

  /** SVGアイコン要素を作る */
  function createIcon(name) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'fa-icon');
    svg.setAttribute('viewBox', '0 0 512 512');
    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.appendChild(path);
    return svg;
  }

  /** 判定バッジ要素を作る（本文の対応表・Indexページと同じ配色・記号） */
  function createBadge(grade, symbolParts, labelText) {
    const badge = document.createElement('span');
    badge.className = `badge grade-${grade}`;

    const symbol = document.createElement('span');
    symbol.className = 'symbol';
    symbol.setAttribute('aria-hidden', 'true');
    for (const part of symbolParts) {
      if (typeof part === 'string') {
        symbol.appendChild(document.createTextNode(part));
      } else {
        symbol.appendChild(createIcon(part.icon));
      }
    }
    badge.appendChild(symbol);
    badge.appendChild(document.createTextNode(labelText));
    return badge;
  }

  /** 「項目名: 値」の箇条書き1項目を作る */
  function createItem(labelText, ...valueNodes) {
    const item = document.createElement('li');
    item.appendChild(document.createTextNode(`${labelText}: `));
    for (const node of valueNodes) {
      item.appendChild(node);
    }
    return item;
  }

  /** 入力値から判定して結果を描画する */
  function judge() {
    const measured = Number.parseFloat(input.value);
    if (!Number.isFinite(measured) || measured < -20 || measured > 50) {
      resultArea.textContent = 'WBGTは-20〜50の範囲の数値で入力してください。';
      return;
    }

    const suitWbgt = Math.round((measured + SUIT_WBGT_ADJUSTMENT) * 10) / 10;
    const band = HEAT_BANDS.find((b) => suitWbgt < b.upperBound) ?? HEAT_BANDS[4];
    const cooling =
      suitWbgt >= COOLING_REQUIRED_WBGT
        ? COOLING_BADGES.required
        : suitWbgt >= COOLING_RECOMMENDED_WBGT
          ? COOLING_BADGES.recommended
          : COOLING_BADGES.none;

    const wbgtValue = document.createElement('strong');
    wbgtValue.textContent = `${suitWbgt}℃`;

    // 結果はシンプルな箇条書き（項目名: 値）で表示する
    const list = document.createElement('ul');
    list.className = 'wbgt-result-list';
    list.appendChild(
      createItem(
        '補正後WBGT',
        wbgtValue,
        document.createTextNode(`（実測${measured}℃ + ${SUIT_WBGT_ADJUSTMENT}℃）`),
      ),
    );
    list.appendChild(
      createItem(
        '判定',
        createBadge(
          band.grade,
          GRADE_SYMBOLS[band.grade] !== undefined ? [GRADE_SYMBOLS[band.grade]] : ['?'],
          band.activityMinutes > 0
            ? `${band.label}（連続${band.activityMinutes}分まで）`
            : `${band.label}（着用中止）`,
        ),
      ),
    );
    list.appendChild(
      createItem(
        '屋内で実測した場合の冷房要否',
        createBadge(cooling.grade, cooling.symbol, cooling.label),
      ),
    );

    resultArea.replaceChildren(list);
  }

  judgeButton.addEventListener('click', judge);
  input.addEventListener('keydown', (event) => {
    // 入力欄でのEnterでも判定を実行する
    if (event.key === 'Enter') {
      event.preventDefault();
      judge();
    }
  });
})();
