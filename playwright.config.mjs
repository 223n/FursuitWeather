// E2Eテスト設定（フロントエンドpublic/の実ブラウザ検証）
// APIはテスト側でモックするため、上流ネットワークには接続しない。
// ローカルで既にwrangler devが起動している場合はそれを再利用する
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // CIでは失敗の切り分けを容易にするためリトライしない
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:8787',
    // Service Workerが介在するとpage.routeのAPIモックが素通しされるためブロックする
    // （オフライン挙動などSW自体の検証はここでは扱わない）
    serviceWorkers: 'block',
    // サンドボックスなど、事前展開済みのChromiumを使う環境向けの上書き
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npx wrangler dev --port 8787',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
