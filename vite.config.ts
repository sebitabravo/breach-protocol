import { defineConfig, type Plugin } from 'vite';

const base = '/';
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

/** Hint only the dynamic game entry; its renderer and Three.js stay off the shell path. */
function preloadGame(): Plugin {
  return {
    name: 'preload-game-entry',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        const chunks = Object.values(bundle ?? {}).filter((chunk) => chunk.type === 'chunk');
        const game = chunks.find((chunk) => chunk.moduleIds.some((id) => id.endsWith('/src/core/game.ts')));
        if (!game) throw new Error(`No se encontró la entrada del juego en: ${chunks.map((chunk) => chunk.fileName).join(', ')}`);
        return [{ tag: 'link', attrs: { rel: 'modulepreload', href: `${base}${game.fileName}`, crossorigin: true } }];
      },
    },
  };
}

export default defineConfig({
  base,
  plugins: [preloadGame()],
  build: {
    target: 'es2022',
    sourcemap: env?.BP_SOURCEMAPS === '1',
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
