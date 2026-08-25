// 埋め込みバッジ（/api/badge.svg）のSVG組み立て（純粋ロジック）
//
// shields.io風の2セグメント構成（「着ぐるみ判定 | ✕ 危険・着用中止」）。
// 日本語テキストの可変幅計算は環境依存のため、幅は最長ラベル基準の固定値にし、
// 文字はセグメント中央へ揃える。判定は色だけに依存させず記号+文字を併記する
// （配色・記号の出どころはsrc/constants.tsのBADGEを参照）

import { BADGE } from '../constants';
import type { LevelSummary } from '../types';

/** バッジ全体の幅・高さと左セグメント幅（px。最長「✕ 危険・着用中止」基準の固定値） */
const BADGE_WIDTH = 216;
const BADGE_HEIGHT = 24;
const LEFT_WIDTH = 94;

/** 雪結晶マーク（6本腕のアスタリスク）の中心x座標（右セグメントの左端寄り。
 * 低温側の最長ラベル「✕ 低温警戒」の中央揃え文字列と重ならない位置） */
const SNOWFLAKE_CX = LEFT_WIDTH + 12;

/** 低温側判定に添える雪結晶マーク（形の区別）
 * 文字（❄等）はフォント・絵文字化が環境依存のため、SVGパスで直接描く */
function snowflakeMark(stroke: string): string {
  return (
    `<path d="M${SNOWFLAKE_CX - 5} 12h10M${SNOWFLAKE_CX - 2.5} 7.7l5 8.6M${SNOWFLAKE_CX - 2.5} 16.3l5 -8.6" ` +
    `stroke="${stroke}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
  );
}

/** XML属性・テキストのエスケープ */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 右セグメントの表示文（記号+ラベル。暑熱の「危険」は着用中止を明示する）
 * gradeはGrade型（0〜4の閉じた値域）のため、描画定数（要素5のタプル）の
 * 範囲外参照はコンパイル時に排除される */
export function badgeStatusText(worst: LevelSummary): string {
  const suffix = worst.level === 'danger' ? BADGE.dangerSuffix : '';
  return `${BADGE.gradeSymbols[worst.grade]} ${worst.label}${suffix}`;
}

/** 当日の最も厳しい屋外判定からバッジSVGを組み立てる */
export function buildBadgeSvg(worst: LevelSummary): string {
  // 低温側（levelのcold接頭辞。app.js・style.cssと同じ判定基準）は青系配色+
  // 雪結晶マークで暑熱側と区別する（「色+形」の二重符号を埋め込み先でも維持する）
  const cold = worst.level.startsWith('cold');
  const surface = cold ? BADGE.cold.surface : BADGE.gradeSurfaces[worst.grade];
  const textColor = cold ? BADGE.cold.text : BADGE.gradeTexts[worst.grade];
  const accent = cold ? BADGE.cold.accent : BADGE.gradeAccents[worst.grade];
  const status = escapeXml(badgeStatusText(worst));
  const leftLabel = escapeXml(BADGE.leftLabel);
  const description = `${leftLabel}: ${status}`;
  const rightCenter = LEFT_WIDTH + (BADGE_WIDTH - LEFT_WIDTH) / 2;
  const fontFamily =
    'Verdana,Geneva,&quot;Hiragino Kaku Gothic ProN&quot;,&quot;Hiragino Sans&quot;,Meiryo,sans-serif';

  // 角丸はclipPathでまとめて切り抜く（2セグメントの継ぎ目に角丸を作らないため）。
  // <img>で埋め込まれたSVGはドキュメントごとに独立しており、id「r」は衝突しない
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" role="img" aria-label="${description}">` +
    `<title>${description}</title>` +
    `<clipPath id="r"><rect width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" rx="4"/></clipPath>` +
    '<g clip-path="url(#r)">' +
    `<rect width="${LEFT_WIDTH}" height="${BADGE_HEIGHT}" fill="#555555"/>` +
    `<rect x="${LEFT_WIDTH}" width="${BADGE_WIDTH - LEFT_WIDTH}" height="${BADGE_HEIGHT}" fill="${surface}"/>` +
    '</g>' +
    `<rect x="0.5" y="0.5" width="${BADGE_WIDTH - 1}" height="${BADGE_HEIGHT - 1}" rx="4" fill="none" stroke="${accent}"/>` +
    (cold ? snowflakeMark(accent) : '') +
    `<g font-family="${fontFamily}" font-size="12" text-anchor="middle">` +
    `<text x="${LEFT_WIDTH / 2}" y="16.5" fill="#FFFFFF">${leftLabel}</text>` +
    `<text x="${rightCenter}" y="16.5" fill="${textColor}" font-weight="bold">${status}</text>` +
    '</g>' +
    '</svg>'
  );
}
