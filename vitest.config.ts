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
      // branchesはしきい値の対象外（既定引数などツール上の部分分岐が含まれるため。
      // statements・lines・functionsの100%で検証水準を担保する）
      thresholds: {
        statements: 100,
        lines: 100,
        functions: 100,
      },
    },
  },
});
