// vitest設定
// 予報ロジックは純粋関数として分離しているため、Node環境の高速なユニットテストで検証する
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
