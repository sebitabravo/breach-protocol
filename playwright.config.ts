import { defineConfig, devices } from '@playwright/test';

// Puerto configurable para poder correr varias suites en paralelo (worktrees).
const port = Number(process.env.PW_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  // Cada spec levanta un contexto WebGL headless; en paralelo compiten por la GPU
  // emulada y el arranque se vuelve lento e inestable. Un worker lo hace determinista.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  projects: [
    {
      name: 'chromium',
      testIgnore: /mobile-.*\.spec\.ts/,
      use: {
        browserName: 'chromium',
        baseURL: `http://localhost:${port}`,
        // Pointer lock is unavailable headless; touch is a first-class path.
        hasTouch: true,
        viewport: { width: 1280, height: 800 },
        // Artefactos baratos: solo cuando algo falla.
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
    },
    {
      name: 'mobile-landscape',
      testMatch: /mobile-.*\.spec\.ts/,
      use: {
        ...devices['Pixel 7 landscape'],
        baseURL: `http://localhost:${port}`,
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'mobile-portrait',
      testMatch: /mobile-.*\.spec\.ts/,
      use: {
        // WebKit del runner (webkit-2215) no está instalado en este equipo: se emula el iPhone 13
        // sobre Chromium. Safari real queda como pendiente humano (ver docs/QA_TEST_PLAN.md).
        ...devices['iPhone 13'],
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
        baseURL: `http://localhost:${port}`,
        screenshot: 'only-on-failure',
      },
    },
  ],
  webServer: {
    // Regenera dist/ antes de servirlo, incluso si ya existe.
    command: `bun run build:wasm && bunx vite build && bunx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
