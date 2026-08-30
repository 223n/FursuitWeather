// 埋め込みバッジ（/api/badge.svg）の記号と配色
// 係数・しきい値には出典を明記する（一覧と方針はindex.tsを参照）

/**
 * 埋め込みバッジ（/api/badge.svg）の描画定数
 *
 * 記号・配色はサイト本体の判定バッジの複製（記号はpublic/app.jsのGRADE_SYMBOLS、
 * 配色はpublic/style.cssのCUD配色トークン--level-N-*。ずれはhtmlSyncテストが検出する）。
 * アクセシビリティ方針（判定を色だけに依存させず記号+文字を併記）も
 * 埋め込み先でそのまま維持する。
 * grade 4の記号だけはサイトでは禁止マークのアイコン（Font Awesome）だが、
 * SVGテキストではフォント依存の絵文字を避けて「✕」を使う（ラベル文字で区別できる）
 */
export const BADGE = {
  /** 左セグメントの固定ラベル */
  leftLabel: '着ぐるみ判定',
  /** 読み上げ用ラベル（aria-label・title側）。スクリーンリーダーが
   * 「着ぐるみ」を「ちゃくぐるみ」と誤読するため、読みだけかなにする */
  leftLabelSpoken: 'きぐるみ判定',
  /**
   * gradeごとの記号と配色（1レベル=1オブジェクト。HEAT_BANDS等と同じ形）
   * symbolは0〜3がapp.jsのGRADE_SYMBOLSと同一、色はstyle.cssの
   * --level-N-surface／--level-N-text／--level-N-accentと同一。
   * textはsurface上でコントラストを確保済み、accentは枠線に使う
   */
  grades: [
    { symbol: '◎', surface: '#E5F5EF', text: '#006147', accent: '#009E73' },
    { symbol: '○', surface: '#FCF0D8', text: '#6B4700', accent: '#A66E00' },
    { symbol: '△', surface: '#FDE8D7', text: '#7A3100', accent: '#B34700' },
    { symbol: '✕', surface: '#FBE3DD', text: '#99260C', accent: '#CC3311' },
    { symbol: '✕', surface: '#F6D7D0', text: '#6E1100', accent: '#8A1500' },
  ],
  /** 低温側判定（levelがcold接頭辞）の配色（style.cssの--level-cold-*と同期。
   * ずれはhtmlSyncテストが検出する）。サイト本体の「低温側は青系+形の区別」を
   * 埋め込みバッジでも維持する（バッジでは温度計アイコンの代わりに雪結晶を描く） */
  cold: { surface: '#E1EFF8', text: '#005180', accent: '#0072B2' },
  /** 暑熱の「危険」だけに付ける明示文（HEAT_BANDSのadviceの要点。埋め込み先でも
   * 「着用中止」が文字で伝わるようにする。低温側はラベル自体が低温危険のため付けない） */
  dangerSuffix: '・着用中止',
} as const;
