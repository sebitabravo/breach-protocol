import { defineConfig } from '@playwright/test';

// Puerto configurable para poder correr varias suites en paralelo (worktrees).
const port = Number(process.env.PW_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  // Keep artifacts cheap: screenshots only when something breaks.
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure',
  reporter: [['list']],
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        baseURL: `http://localhost:${port}`,
        // Pointer lock is unavailable headless; touch is a first-class path.
        hasTouch: true,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `npm run build:wasm && npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
