// 配信HTMLに埋め込まれたSVGスプライトを最適化するスクリプト
//
// アイコンはFont Awesomeのパスを自前配信のスプライト（HTML内の<symbol>）として
// 持っている。Font Awesomeの出力は小数1桁まで詰めてあるが、パスのコマンド自体は
// 素のままで、曲線を円弧へ畳む余地が残っている。たとえばfa-triangle-exclamationの
// 頭の `c14.7 0 28.2 8.1 35.2 21` 以下は `a40 40 0 0 1 35.2 21` へまとまる。
//
// floatPrecisionは1にする。2・3では効果がほとんど出ない（実測でBrotli後
// -206・-114バイト）のに対し、1にすると曲線→円弧の変換が働いて -2,681バイトになる。
// svgoの円弧化の許容誤差は 0.1^floatPrecision に連動するため、桁を1つ下げた
// ところで初めてコマンド併合が起きる。
//
// 座標を丸めるため描画は厳密には同一にならない。輪郭のアンチエイリアス1画素分の
// 差が出るが、実寸での見え方が変わらないことをChromiumでの描画比較で確認している
// （判定バッジのfa-ban・低温のfa-temperature-low・注意のfa-triangle-exclamationを
// 含む全シンボル。手順と実測値はdocs/development.mdを参照）。
//
// ソースのpublic/*.htmlは変えず、ビルド後の配信物だけを書き換える
// （npm run buildの他の段と同じ方針。検証後はgit checkout -- public/で戻す）。

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

import { optimize } from 'svgo';

/** HTML内のスプライト本体（class="icon-sprite"のsvg要素） */
const SPRITE = /<svg[^>]*\sclass="icon-sprite"[\s\S]*?<\/svg>/g;

/**
 * svgoの設定
 *
 * cleanupIdsは無効にする。`#fa-…`のidはHTML・JSからuse要素で参照される
 * 「外部から使われるid」で、svgoからは未使用に見えて短縮・削除されるため。
 * removeHiddenElems・removeUselessDefsも同じ理由で無効にする
 * （スプライトはdisplay:noneのコンテナに置くため、中身が丸ごと落ちうる）
 */
const SVGO_CONFIG = {
  multipass: true,
  floatPrecision: 1,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          cleanupIds: false,
          removeHiddenElems: false,
          removeUselessDefs: false,
        },
      },
    },
  ],
};

/** 最適化の前後で保たれていなければならない要素を取り出す */
function spriteShape(sprite) {
  return {
    // シンボルのid（use要素の参照先。1つでも欠けるとアイコンが消える）
    ids: [...sprite.matchAll(/<symbol[^>]*\sid="([\w-]+)"/g)].map((m) => m[1]).sort(),
    // viewBox（欠けると拡大縮小が効かなくなる）
    viewBoxes: [...sprite.matchAll(/viewBox="([^"]+)"/g)].map((m) => m[1]).length,
    // パスの本数（図形そのものの数）
    paths: [...sprite.matchAll(/<path[\s/>]/g)].length,
    // スプライト本体を隠す指定（欠けるとアイコン定義が画面に並んでしまう）
    hidden: /class="icon-sprite"/.test(sprite) && /aria-hidden="true"/.test(sprite),
  };
}

/** 保つべき要素が変わっていないかを確かめる（違えばビルドを止める） */
function assertShapeKept(page, before, after) {
  const b = spriteShape(before);
  const a = spriteShape(after);
  const checks = [
    ['シンボルのid', b.ids.join(','), a.ids.join(',')],
    ['viewBoxの数', b.viewBoxes, a.viewBoxes],
    ['pathの数', b.paths, a.paths],
    ['icon-sprite/aria-hidden', b.hidden, a.hidden],
  ];
  for (const [label, expected, actual] of checks) {
    if (expected !== actual) {
      throw new Error(`${page}: スプライトの${label}が変わりました（${expected} → ${actual}）`);
    }
  }
}

const PAGES = readdirSync('public')
  .filter((file) => file.endsWith('.html'))
  .map((file) => `public/${file}`)
  .sort();

for (const page of PAGES) {
  const html = readFileSync(page, 'utf8');
  const sprites = html.match(SPRITE) ?? [];
  if (sprites.length === 0) {
    // スプライトを持たないページは対象外（CSSリンクと違い、必須ではない）
    console.log(`${page}: スプライトなし（そのまま）`);
    continue;
  }
  if (sprites.length > 1) {
    // 1ページに複数あるのは想定外。どれを最適化すべきか決められないため止める
    throw new Error(`${page}: スプライトが${sprites.length}個あります（想定は1個）`);
  }
  const [before] = sprites;
  const after = optimize(before, SVGO_CONFIG).data;
  assertShapeKept(page, before, after);
  // 置換値は関数で渡す: 文字列で渡すとパス中の $' や $& が
  // String.replaceの置換パターンとして解釈され、HTMLを静かに破壊するため
  writeFileSync(page, html.replace(before, () => after));
  console.log(
    `${page}: SVGスプライトを最適化しました（${Buffer.byteLength(before)}→` +
      `${Buffer.byteLength(after)}バイト。${Buffer.byteLength(before) - Buffer.byteLength(after)}バイト削減）`,
  );
}
