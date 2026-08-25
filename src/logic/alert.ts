// 環境省の熱中症警戒アラート発表状況CSVの解析（純粋ロジック）
//
// 様式（2026年度の実ファイルで確認。サンプルはtest/fixtures/alert-sample.csv）:
// - 前半はメタ情報行（`項目名,値,,,...`）。TargetDate1が当日の対象日
// - `府県予報区,`で始まるヘッダー行の後に、府県予報区ごとのデータ行が続く
// - フラグの意味（FlagExplanation行）: 発表無し:0、熱中症警戒情報発表:1、
//   熱中症特別警戒情報判定:2、熱中症特別警戒情報発表:3、発表時間外:9
// - 値にカンマを含む列はWBGT一覧を含めて存在しない（区切りは「/」「:」）ため、
//   単純なカンマ分割で解析できる
//
// 様式は年度で変わり得るため、列位置は決め打ちせずヘッダー行の列名から特定し、
// 想定した列が見つからないときは解析失敗として扱う（呼び出し側が非表示へ落とす）

import { PREFECTURE_POINTS, type PrefecturePoint } from '../constants';
import { nearestPoint } from './geo';

/** 解析済みの1府県予報区分の発表状況 */
export interface AlertRegionRow {
  /** 府県予報区名（例: 東京都・石狩・空知・後志地方） */
  readonly regionName: string;
  /** 都道府県コード（2桁） */
  readonly prefectureCode: string;
  /** 当日（TargetDate1）の発表フラグ（0-3・9） */
  readonly flag: number;
}

/** 解析済みの発表状況全体 */
export interface AlertReport {
  /** 対象日（YYYY-MM-DD）。メタ情報に無い・形式不明はnull */
  readonly targetDate: string | null;
  readonly rows: readonly AlertRegionRow[];
}

/** ヘッダー行から特定する列名（この3列が揃わない様式は解析失敗として扱う） */
const REGION_HEADER = '府県予報区';
const PREF_CODE_HEADER = '都道府県コード';
const FLAG1_HEADER = 'TargetDate1フラグ';

/** メタ情報の日付（YYYY/MM/DD）をYYYY-MM-DDへ変換する。形式が違えばnull */
function normalizeDate(raw: string): string | null {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(raw.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * 発表状況CSVを解析する
 * 想定した様式でない場合はErrorを投げる（呼び出し側でログ+非表示に落とす。
 * 様式変更に黙って誤読するより、明示的に失敗して運用検知できるようにする）
 */
export function parseAlertCsv(text: string): AlertReport {
  const lines = text.split(/\r?\n/);

  let targetDate: string | null = null;
  let headerIndex = -1;
  for (const [index, line] of lines.entries()) {
    const cells = line.split(',');
    if (cells[0] === 'TargetDate1') {
      targetDate = normalizeDate(cells[1] ?? '');
    }
    if (cells[0] === REGION_HEADER && cells.length > 1) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex < 0) {
    throw new Error('発表状況CSVにヘッダー行（府県予報区）が見つかりません');
  }

  const header = lines[headerIndex]!.split(',');
  const prefCodeColumn = header.indexOf(PREF_CODE_HEADER);
  const flagColumn = header.indexOf(FLAG1_HEADER);
  if (prefCodeColumn < 0 || flagColumn < 0) {
    throw new Error('発表状況CSVの列構成が想定と異なります（様式変更の可能性）');
  }

  const rows: AlertRegionRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = line.split(',');
    const regionName = cells[0]?.trim() ?? '';
    const prefectureCode = cells[prefCodeColumn]?.trim() ?? '';
    const flagText = cells[flagColumn]?.trim() ?? '';
    // 末尾の空行などは黙って飛ばし、コード・フラグの形式が崩れた行だけを弾く
    if (regionName === '') {
      continue;
    }
    if (!/^\d{2}$/.test(prefectureCode) || !/^\d$/.test(flagText)) {
      continue;
    }
    rows.push({ regionName, prefectureCode, flag: Number(flagText) });
  }
  if (rows.length === 0) {
    throw new Error('発表状況CSVにデータ行がありません');
  }
  return { targetDate, rows };
}

/** 発表フラグが「発表中」を意味するか（1=警戒、2・3=特別警戒の判定・発表） */
function isIssuedFlag(flag: number): boolean {
  return flag >= 1 && flag <= 3;
}

/** 指定した都道府県の発表状況。発表がなければnull */
export function alertForPrefecture(
  report: AlertReport,
  prefectureCode: string,
): { special: boolean } | null {
  const issued = report.rows.filter(
    (row) => row.prefectureCode === prefectureCode && isIssuedFlag(row.flag),
  );
  if (issued.length === 0) {
    return null;
  }
  // 2=特別警戒の判定・3=特別警戒の発表は、警戒（1）より深刻な段階として扱う
  return { special: issued.some((row) => row.flag >= 2) };
}

/** 表示地点に最も近い代表点の都道府県を返す */
export function nearestPrefecture(latitude: number, longitude: number): PrefecturePoint {
  return nearestPoint(latitude, longitude, PREFECTURE_POINTS).point;
}
