# Changelog

## 0.1.0 — 2026-11-20

Vertical slice jugable de SEBITA: BREACH PROTOCOL.

### Agregado

- Núcleo de simulación en Rust (`core/`, crate `bp-core`, solo std, sin
  dependencias) compilado a WebAssembly: jugador, arena SECTOR_01, hitscan
  (PB-01 y AR-04), FSMs deterministas Scout/Sentinel, oleadas, terminales,
  fases y puntaje. Simulación determinista a 60 Hz con RNG con semilla.
- Shell TypeScript + Three.js: render con instancing, HUD en DOM, Engineering
  Mode con métricas reales (FPS, p50/p95, draw calls, triángulos, ticks,
  calidad, DPR), pantallas de boot/calibración/menú/pausa/resultados y
  fallback recuperable si falta WebGL2.
- Contrato binario Rust↔TS sin wasm-bindgen: snapshot de 620 floats leído sin
  copiar sobre la memoria de wasm, pineado por tests en ambos lados.
- Input de escritorio (pointer lock, teclado) y multitouch real con
  `pointerId` por control.
- Audio sintetizado con Web Audio (sin archivos) y ajustes persistentes
  versionados con migración (sensibilidad, invertir Y, escala del HUD,
  lateralidad, calidad, audio, movimiento reducido).
- Récord local por modo e input con grados (S/A/B/C/D).
- Tests: 66 de cargo para las reglas de simulación, suite Vitest para los
  módulos TS puros (ajustes, puntajes, controlador de calidad, loop, layout,
  protocolo) y smoke test de Playwright que arranca el juego en Chromium y
  prueba que la simulación avanza sin errores de consola.
- CI en GitHub Actions: job de Rust (cargo test + build wasm) y job web
  (typecheck, unit, build, e2e) sobre Node 22.
- Documentación: README, arquitectura, presupuesto de performance medido, dos
  ADRs (núcleo Rust/WASM; dirección visual según mockups), avisos de terceros
  y licencia MIT.
