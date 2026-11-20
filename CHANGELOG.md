# Changelog

## 0.2.0 — 2026-11-20

### Agregado

- Tres sectores en Rust (`core/src/maps.rs`) con tests de invariantes y alcanzabilidad:
  Control de Acceso, Refrigeración y Archivo (pasarela elevada con terminal).
- Enemigo Interceptor (flanqueo, telegrafía visible en el snapshot, embestida) y arma
  SG-08 Scatter (8 perdigones, caída por distancia).
- Modos Overflow (infinito), Protocolo diario (semilla = fecha UTC, mutadores) y
  Simulador con tutorial de 3 acciones.
- Registro de inputs cuantizados y re-simulación (`core/src/replay.rs`); ABI de paso
  fijo (`bp_start`, `bp_tick_fixed`). Tests de determinismo nativo vs wasm con hashes
  fijados.
- API de clasificación en Rust para Vercel (`api/`, `server/`) con Upstash y
  verificación por replay; cliente en `src/net/`. Ver ADR 0003 y `docs/api-contract.md`.
- Pasada de arte procedural: texturas, temas por sector, bloom (media/alta), robots y
  viewmodels reconocibles, decoración de mundo.
- Menú, selección de sector, briefing, resultados con tablero, clasificación, progreso
  versionado en `localStorage`, HUD según mockups, marcadores de impacto y dirección
  de daño, tipografía `--sans` y componente switch.
- Recuperación de pérdida de contexto WebGL y `pointerlockerror` sin pausar.
- CI: runners fijados a ubuntu-24.04, caché de Rust, `fmt`, `clippy -D warnings`,
  workflow de la API, artefactos del e2e al fallar.

### Corregido

- Esc en Ajustes abiertos desde el menú ya no entra a una partida inexistente.
- `startMatch` guardaba mal el modo: reiniciar el Simulador arrancaba un run con tiempo.
- Teclas mantenidas durante una pausa quedaban muertas al reanudar (auto-repeat).
- Interpolación de cámara: avanzaba a 60 Hz en vez de interpolar entre ticks.
- Chispas y trazadores se congelaban (buffers sin `needsUpdate`).
- Fuga de geometría y material del visor de los robots al cambiar de tipo.
- Una partida reiniciada divergía de una nueva: quedaba estado viejo del ring de
  eventos (hallado al comparar la partida en vivo con su replay).
- `hits` contaba por perdigón y la precisión podía superar 1.
- Una composición de oleada mayor que la cola hacía girar `Waves::begin` para siempre.
- Disparos por eventos de mouse de compatibilidad en táctil; modo táctil de una sola vía.
- La fórmula trascendente pasa por `libm`: `f32::sin` difiere 1 ulp entre nativo y wasm.

### Conocido

- El tutorial en portrait 320×640 se superpone con el HUD.
- Pointer lock: ruta feliz sin verificación automática.
- El servidor no se probó contra Vercel/Upstash reales.

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
