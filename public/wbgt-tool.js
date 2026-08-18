// 実測WBGTから着ぐるみ判定を行う簡易ツール（トップページの「実測WBGT」タブ専用）
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

  /** SVGスプライト（index.html内で定義）からアイコン要素を作る（app.jsのfaIconと同形式）
   * 本ツールはindex.htmlのタブでのみ動くため、同一文書内のスプライトに依存してよい。
   * スプライトを持たないページへ移設する場合はパス埋め込みへ戻すこと */
  function createIcon(name) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'fa-icon');
    const use = document.createElementNS(svgNs, 'use');
    use.setAttribute('href', `#fa-${name}`);
    svg.appendChild(use);
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
