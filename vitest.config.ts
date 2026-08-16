// vitest設定
// 予報ロジックは純粋関数として分離しているため、Node環境の高速なユニットテストで検証する
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/**'],
      // docs/development.mdで宣言している「100%を維持」をCIで強制する。
      // branchesは番兵値により到達しない防御フォールバックが含まれるため対象外
      thresholds: {
        statements: 100,
        lines: 100,
        functions: 100,
      },
    },
  },
});
