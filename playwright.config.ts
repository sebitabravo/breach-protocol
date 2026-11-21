import { defineConfig } from '@playwright/test';

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
  ],
  webServer: {
    // Regenera dist/ antes de servirlo, incluso si ya existe.
    command: `bun run build:wasm && bunx vite build && bunx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
