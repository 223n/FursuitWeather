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

  /** 深刻度に対応する記号（grade 4はテキストではなく禁止マークSVGで表示） */
  const GRADE_SYMBOLS = ['◎', '○', '△', '✕', null];

  /** Font Awesome Freeのbanアイコンのパス（本ページの対応表と同じもの） */
  const BAN_ICON_PATH =
    'M367.2 412.5L99.5 144.8c-22.4 31.4-35.5 69.8-35.5 111.2 0 106 86 192 192 192 41.5 0 79.9-13.1 111.2-35.5zm45.3-45.3c22.4-31.4 35.5-69.8 35.5-111.2 0-106-86-192-192-192-41.5 0-79.9 13.1-111.2 35.5L412.5 367.2zM0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0z';

  const input = document.getElementById('wbgt-input');
  const judgeButton = document.getElementById('wbgt-judge-button');
  const resultArea = document.getElementById('wbgt-result');

  /** 判定バッジ要素を作る（本文の対応表と同じ配色・記号） */
  function createBadge(band, text) {
    const badge = document.createElement('span');
    badge.className = `badge grade-${band.grade}`;

    const symbol = document.createElement('span');
    symbol.className = 'symbol';
    symbol.setAttribute('aria-hidden', 'true');
    const symbolChar = GRADE_SYMBOLS[band.grade];
    if (symbolChar !== null && symbolChar !== undefined) {
      symbol.textContent = symbolChar;
    } else {
      const svgNs = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNs, 'svg');
      svg.setAttribute('class', 'fa-icon');
      svg.setAttribute('viewBox', '0 0 512 512');
      const path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', BAN_ICON_PATH);
      svg.appendChild(path);
      symbol.appendChild(svg);
    }
    badge.appendChild(symbol);
    badge.appendChild(document.createTextNode(text));
    return badge;
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

    resultArea.replaceChildren();

    const summary = document.createElement('span');
    summary.textContent = `着ぐるみ補正後のWBGTは${suitWbgt}℃（実測${measured}℃ + ${SUIT_WBGT_ADJUSTMENT}℃）。判定: `;
    resultArea.appendChild(summary);
    resultArea.appendChild(
      createBadge(
        band,
        band.activityMinutes > 0 ? `${band.label}（連続${band.activityMinutes}分まで）` : `${band.label}（着用中止）`,
      ),
    );

    // 屋内会場で実測した場合の冷房要否も参考として添える
    const cooling = document.createElement('span');
    const coolingLabel =
      suitWbgt >= COOLING_REQUIRED_WBGT
        ? '冷房必須'
        : suitWbgt >= COOLING_RECOMMENDED_WBGT
          ? '冷房推奨'
          : '冷房なしでも可';
    cooling.textContent = ` 屋内で実測した場合の冷房要否: ${coolingLabel}`;
    resultArea.appendChild(cooling);
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
