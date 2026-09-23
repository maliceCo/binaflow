import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  grep: /(?:creates, edits, persists, exports and imports a wireframe|creates a contained block, reparents it and grows the persisted canvas)/,
  fullyParallel: false,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
});
