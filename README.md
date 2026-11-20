# SEBITA: BREACH PROTOCOL

> La red cayó. Queda una última conexión.

FPS arcade de un jugador que corre directo en el navegador: núcleo de simulación
escrito en Rust y compilado a WebAssembly, render en Three.js y HUD en DOM/CSS.
Sin instalación, sin registro, sin assets de terceros: toda la geometría y el
audio son procedurales. Proyecto de ingeniería de [sebita.dev](https://sebita.dev).

## Qué es

Un `Protocol Run`: sobreviví 180 s como máximo, 5 oleadas de enemigos
deterministas (Scout y Sentinel) y reactivá los 3 terminales de red manteniendo
`E` a menos de 1.8 m durante 1.2 s. Con los tres activos arranca una ventana de
extracción de 12 s; sobrevivirla es ganar. Perder toda la salud o quedarte sin
tiempo es perder. La simulación corre a 60 Hz con paso fijo y RNG con semilla:
la misma semilla y la misma secuencia de input producen el mismo mundo.

## Cómo correrlo

Requisitos: Node ≥ 20.19, Rust con el target `wasm32-unknown-unknown`
(`rustup target add wasm32-unknown-unknown`).

```sh
npm install
npm run build:wasm   # compila bp-core y copia public/bp_core.wasm
npm run dev          # servidor de desarrollo de Vite
```

Build de producción: `npm run build` (wasm + `tsc --noEmit` + `vite build`).

## Tests

```sh
npm run test:rust    # 66 tests del núcleo de simulación (cargo)
npm run test:unit    # tests de los módulos TypeScript puros (vitest)
npm run test:e2e     # smoke test que arranca el juego de verdad (playwright)
npm run test:all     # typecheck + rust + unit + e2e
```

CI en `.github/workflows/ci.yml`: un job de Rust (cargo test + build wasm) y un
job web (typecheck → unit → build → e2e) sobre Node 22.

## Arquitectura en diez líneas

1. `core/` — Rust puro (solo `std`): matemática, arena, jugador, armas, FSMs de enemigos, fases y puntaje.
2. `scripts/build-wasm.mjs` — compila a `wasm32-unknown-unknown` y copia el binario a `public/`.
3. `src/wasm/bridge.ts` — instancia el módulo y expone `tick` / snapshot.
4. `src/wasm/protocol.ts` — contrato binario espejo de `core/src/protocol.rs`: un único buffer `f32` de 620 floats.
5. Rust escribe el snapshot en su memoria lineal; TypeScript lo lee con un `Float32Array` **sin copiar**.
6. `src/core/loop.ts` — acumulador de paso fijo: la simulación siempre avanza en pasos de 1/60 s, con clamping y conteo honesto de ticks descartados.
7. `src/render/` — Three.js: arena, cobertura instanciada, enemigos, viewmodel y pool de efectos.
8. `src/core/quality.ts` — controlador adaptativo con histéresis sobre percentiles reales de frame time.
9. `src/ui/` — HUD y Engineering Mode (métricas reales: FPS, p50/p95, draw calls, ticks, calidad, DPR).
10. `src/ui/hud.ts` + DOM — accesibilidad y persistencia en `src/core/settings.ts` / `src/core/scores.ts`.

Detalle completo en [`docs/architecture.md`](docs/architecture.md).

## Controles

| Acción | Escritorio | Táctil |
| --- | --- | --- |
| Moverse | `W A S D` / flechas | stick virtual (izquierda) |
| Apuntar | mouse (pointer lock) | arrastrar en la pantalla |
| Disparar | clic izquierdo | botón de fuego |
| Apuntado fino (ADS) | — | botón ⊕ |
| Saltar | `Espacio` | botón ⤒ |
| Correr | `Shift` | — |
| Terminal | mantener `E` | mantener botón E |
| Recargar | `R` | botón ⟳ |
| Cambiar arma | `1` / `2` | botón ⇄ |
| Pausa | `Esc` | botón ❙❙ |
| Engineering Mode | `F3` | botón en pausa/ajustes |

La sensibilidad de mouse y táctil, invertir Y, escala del HUD, lateralidad,
autorecarga, asistencia de apuntado táctil y movimiento reducido se ajustan en
la pantalla de calibración o en Ajustes, y persisten en `localStorage`.

## Presupuestos de performance

Los objetivos y los números medidos están en
[`docs/performance-budget.md`](docs/performance-budget.md). Resumen: el núcleo
wasm pesa 69.7 KiB y todo el payload descomprimido queda por debajo de ~1 MiB;
el render mantenido apunta a < 20 draw calls vía instancing.

## Estado (honesto)

Implementado en esta vertical slice: un modo (`Protocol Run`), una arena
(`SECTOR_01`), dos armas, dos enemigos, puntaje local con récord por modo,
ajustes persistentes, Engineering Mode con métricas reales y tests en las tres
capas (cargo, vitest, playwright).

**No implementado (a propósito, todavía):**

- Backend o servidor: todo corre local, no hay cuentas ni sincronización.
- Leaderboard en línea: el puntaje es un récord personal en `localStorage`.
- Modo endless y desafío diario: solo el run de 180 s / 5 oleadas.
- Mapas extra: una sola arena.
- Archivos de audio: el sonido es sintetizado con Web Audio en runtime; no hay samples.

## Especificación

El brief humano y la especificación original del proyecto viven en
[`SPEC.md`](SPEC.md). Las decisiones de arquitectura están registradas como
ADRs: [`docs/adr/0001-rust-wasm-core.md`](docs/adr/0001-rust-wasm-core.md)
(núcleo en Rust/WASM) y [`docs/adr/0002-visual-direction.md`](docs/adr/0002-visual-direction.md)
(dirección visual según los mockups del humano).

## Licencia

MIT — ver [`LICENSE`](LICENSE). Sin assets de terceros: proveniencia
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
