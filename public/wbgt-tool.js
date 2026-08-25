// 実測WBGTから着ぐるみ判定を行う簡易ツール（トップページの「実測WBGT」タブ専用）
// イベント会場などでWBGT計（暑さ指数計）で測った値に着衣補正を加えて判定する。
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

  /** 深刻度に対応する記号（grade 4はテキストではなく禁止マークSVGで表示）。
   * app.jsのGRADE_SYMBOLSと完全一致（test/htmlSync.test.tsが検証する） */
  const GRADE_SYMBOLS = [['◎'], ['○'], ['△'], ['✕'], [{ icon: 'ban' }]];

  /**
   * 冷房要否の表示設定（Indexページの時間別テーブルと同じ配色・記号）
   * app.jsのCOOLING_BADGESと配色（grade）・記号（symbol）を揃える。
   * app.js側のラベルはAPIのcoolingLabel由来のため本ツールでは固定文言を持ち、
   * htmlSyncテストの機械検証対象はapp.js側のみ
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
  function faIcon(name) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'fa-icon');
    svg.setAttribute('aria-hidden', 'true');
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
        symbol.appendChild(faIcon(part.icon));
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
    // 空欄（type=numberでは不正文字もvalueが空になる）はまず入力を促す文にする。
    // 範囲の話から始めると「まず値を入れる」ことが伝わりにくいため分ける
    if (input.value.trim() === '') {
      resultArea.textContent = '実測したWBGTの値を入力してください。';
      // 前回の判定を誤って記録しないよう、記録の対象も無効にする
      lastJudged = null;
      logButton.disabled = true;
      return;
    }
    const measured = Number.parseFloat(input.value);
    if (!Number.isFinite(measured) || measured < -20 || measured > 50) {
      resultArea.textContent = '実測WBGTは−20℃から50℃までの数値で入力してください。';
      lastJudged = null;
      logButton.disabled = true;
      return;
    }

    const suitWbgt = Math.round((measured + SUIT_WBGT_ADJUSTMENT) * 10) / 10;
    // upperBoundにInfinityの帯があるため必ず見つかる
    const band = HEAT_BANDS.find((b) => suitWbgt < b.upperBound);
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
          GRADE_SYMBOLS[band.grade],
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
    // 低温側の注記: 低温判定（汗冷え・凍結）は体感温度ベースのため、WBGTの
    // 実測値からは判定できない。低い実測値で暑熱側の「ほぼ安全（45分）」だけを
    // 見て危険側に楽観しないよう、予報画面の低温判定への導線を添える
    // （しきい値15はsrc/constants.tsのCOLD_SWITCH_TEMPERATUREと同じ目安）
    if (suitWbgt < 15) {
      const coldNote = document.createElement('p');
      coldNote.className = 'hint';
      coldNote.textContent =
        '低温側の判定（汗冷え・凍結のリスク）はこのツールでは行いません。寒い環境では予報画面の低温判定も併せて確認してください。';
      resultArea.appendChild(coldNote);
    }
    // 厳重警戒（grade 3）以上は応急対応ページへの導線を結果の直下に出す
    // （判定カード（now-card）と同じ方針。実測で危険と分かった瞬間に手順を探させない）
    if (band.grade >= 3) {
      const emergency = document.createElement('p');
      emergency.className = 'now-emergency';
      emergency.appendChild(faIcon('triangle-exclamation'));
      const link = document.createElement('a');
      link.href = '/emergency';
      link.textContent = 'もしものとき（熱中症の応急対応）';
      emergency.appendChild(link);
      resultArea.appendChild(emergency);
    }
    // 会場ログ用に直近の判定を保持し、記録ボタンを押せるようにする
    lastJudged = { measured, suitWbgt, grade: band.grade, label: band.label };
    logButton.disabled = false;
  }

  // ---- 会場ログ（実測WBGTの記録） ----
  // 判定した値を場所ラベル・時刻付きでこの端末（localStorage）に記録し、
  // 時系列の表とCSV書き出しでイベント後の振り返りに使えるようにする

  const placeInput = document.getElementById('wbgt-place');
  const logButton = document.getElementById('wbgt-log-button');
  const logSection = document.getElementById('wbgt-log-section');
  const logBody = document.getElementById('wbgt-log-body');
  /** 記録・削除の完了通知欄（role=status。判定結果の表示を上書きしないよう分ける） */
  const logStatus = document.getElementById('wbgt-log-status');
  const WBGT_LOG_KEY = 'fursuitweatherWbgtLog';
  /** 保存件数の上限（超えたら古い記録から削除する） */
  const WBGT_LOG_LIMIT = 200;
  /** 直近の判定結果（記録ボタンの対象。未判定ならnull） */
  let lastJudged = null;

  /** 保存済みの記録を読む（壊れた保存・保存不可の環境は空） */
  function readLog() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WBGT_LOG_KEY) ?? '');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** 記録を保存する（保存できない環境では黙って諦める） */
  function writeLog(entries) {
    try {
      localStorage.setItem(WBGT_LOG_KEY, JSON.stringify(entries));
    } catch {
      // 保存できなくても表示中の表は使える
    }
  }

  /** 記録1件の形式が正しいか（保存値の破損・古い形式への防御） */
  function isValidEntry(entry) {
    return (
      entry &&
      typeof entry.at === 'string' &&
      typeof entry.place === 'string' &&
      Number.isFinite(entry.measured) &&
      Number.isFinite(entry.suitWbgt) &&
      Number.isInteger(entry.grade) &&
      typeof entry.label === 'string'
    );
  }

  /** 記録時刻の表示文（月/日 時:分） */
  function formatLogTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  /** 会場ログの表を描き直す（新しい記録が上に来るよう逆順で表示する） */
  function renderLog() {
    const entries = readLog().filter(isValidEntry);
    logSection.hidden = entries.length === 0;
    logBody.replaceChildren();
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      const row = document.createElement('tr');
      const addCell = (content) => {
        const cell = document.createElement('td');
        if (typeof content === 'string') {
          cell.textContent = content;
        } else {
          cell.appendChild(content);
        }
        row.appendChild(cell);
      };
      addCell(formatLogTime(entry.at));
      addCell(entry.place === '' ? '-' : entry.place);
      addCell(`${entry.measured}℃`);
      addCell(`${entry.suitWbgt}℃`);
      addCell(
        createBadge(entry.grade, GRADE_SYMBOLS[entry.grade] ?? ['?'], entry.label),
      );
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '削除';
      remove.setAttribute('aria-label', `${formatLogTime(entry.at)}の記録を削除`);
      remove.addEventListener('click', () => {
        // 記録の同定は描画時のインデックスではなく内容（記録時刻at）で行う。
        // 別タブでの追加・削除により保存内容が描画後に変わっていても、
        // 位置ずれで意図しない記録を消さない（同時刻の重複は先頭の1件を消す）
        const latest = readLog().filter(isValidEntry);
        const target = latest.findIndex((candidate) => candidate.at === entry.at);
        if (target >= 0) {
          latest.splice(target, 1);
        }
        writeLog(latest);
        renderLog();
        // 押した削除ボタンは表の再描画で消えるため、フォーカスを迷子にしない
        // （記録が残っていればログの見出しへ、空になったら入力欄へ返す）
        logStatus.textContent = '記録を削除しました。';
        if (latest.length === 0) {
          input.focus();
        } else {
          document.getElementById('wbgt-log-heading').focus();
        }
      });
      addCell(remove);
      logBody.appendChild(row);
    }
  }

  logButton.addEventListener('click', () => {
    if (!lastJudged) {
      return;
    }
    const entries = readLog().filter(isValidEntry);
    entries.push({
      at: new Date().toISOString(),
      // 制御文字を除いた表示用テキストにする（app.jsのnameパラメータと同じ対策）
      place: placeInput.value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 30),
      measured: lastJudged.measured,
      suitWbgt: lastJudged.suitWbgt,
      grade: lastJudged.grade,
      label: lastJudged.label,
    });
    // 上限を超えたら古い記録から削除する
    writeLog(entries.slice(-WBGT_LOG_LIMIT));
    renderLog();
    // 連打（手袋越しの二重タップなど）で同じ判定が重複記録されないよう、
    // 1回の判定につき1回だけ記録できるようにする（次の判定で再び有効になる）
    logButton.disabled = true;
    logStatus.textContent = '記録しました。';
  });

  document.getElementById('wbgt-log-csv-button').addEventListener('click', () => {
    const entries = readLog().filter(isValidEntry);
    const escapeCsv = (text) => `"${String(text).replace(/"/g, '""')}"`;
    // 記録時刻は画面の表と同じこの端末のローカル時刻で出す
    // （保存値のISO文字列（UTC）のままだと表計算ソフトで9時間ずれて見える）
    const csvTime = (iso) => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) {
        return iso;
      }
      const two = (value) => String(value).padStart(2, '0');
      return (
        `${date.getFullYear()}/${two(date.getMonth() + 1)}/${two(date.getDate())} ` +
        `${two(date.getHours())}:${two(date.getMinutes())}`
      );
    };
    const lines = [
      ['記録時刻', '場所', '実測WBGT（℃）', '補正後WBGT（℃）', '判定'].map(escapeCsv).join(','),
      ...entries.map((entry) =>
        [csvTime(entry.at), entry.place, entry.measured, entry.suitWbgt, entry.label]
          .map(escapeCsv)
          .join(','),
      ),
    ];
    // BOM付きUTF-8にして表計算ソフトでの文字化けを防ぐ
    const blob = new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wbgt-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  renderLog();

  judgeButton.addEventListener('click', judge);
  input.addEventListener('keydown', (event) => {
    // 入力欄でのEnterでも判定を実行する
    if (event.key === 'Enter') {
      event.preventDefault();
      judge();
    }
  });
})();
