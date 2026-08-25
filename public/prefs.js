// 見やすさ設定の適用（全ページ共通の小さなスクリプト）
// 文字サイズの選択（標準/大/特大）をlocalStorageから読み、ページ全体へ適用する。
// レイアウトはrem基準のため、root font-sizeの変更で表も含めて破綻なく拡大する。
// 設定の切り替えUIはトップページ（app.jsのAaボタン）が持ち、本スクリプトは
// 適用だけを担う（サイズの対応表はapp.jsのFONT_SIZESと同期。htmlSyncテストが検証する）
(() => {
  'use strict';

  const SIZES = { standard: '100%', large: '115%', xlarge: '130%' };
  let size = 'standard';
  try {
    const stored = localStorage.getItem('fursuitweatherFontSize');
    if (stored && SIZES[stored]) {
      size = stored;
    }
  } catch {
    // 読めない環境（プライベートモード等）では標準のまま表示する
  }
  if (size !== 'standard') {
    document.documentElement.style.fontSize = SIZES[size];
  }
})();
