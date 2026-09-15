import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/web',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  use: { browserName: 'chromium' },
});
