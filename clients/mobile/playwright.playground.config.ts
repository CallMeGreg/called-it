import { defineConfig } from '@playwright/test';

import apiConfig from './playwright.config';

export default defineConfig({
  ...apiConfig,
  testDir: './tests/playground',
  outputDir: 'playground-test-results',
  use: { ...apiConfig.use, baseURL: 'http://127.0.0.1:43819' },
  webServer: {
    command: 'npm run playground',
    url: 'http://127.0.0.1:43819',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
