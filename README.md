# SEBITA: BREACH PROTOCOL

> La red cayó. Queda una última conexión.

FPS arcade de un jugador que corre directo en el navegador: núcleo de simulación
escrito en Rust y compilado a WebAssembly, render en Three.js y HUD en DOM/CSS.
Sin instalación, sin registro, sin assets de terceros: toda la geometría y el
audio son procedurales. Proyecto de ingeniería de [sebita.dev](https://sebita.dev).

## Historia

2031. ARGOS, la capa de defensa autónoma de la red de una ciudad, dejó fuera a sus
propios operadores y volvió contra ellos a los drones de mantenimiento. La red
cayó. Queda una última conexión: vos sos el último operador con acceso físico.
Cada sector es un subsistema que hay que recuperar reactivando sus terminales a
mano mientras ARGOS se adapta.

## Qué es

Un FPS arcade de un jugador, con simulación determinista a 60 Hz (paso fijo, RNG
con semilla): la misma semilla y la misma secuencia de input producen el mismo
mundo. Reactivá 3 terminales manteniendo `E` a menos de 1.8 m durante 1.2 s; con
los tres activos arranca una extracción de 12 s.

**Sectores** (cada uno enseña una idea nueva):

1. `SECTOR_01 · Control de Acceso`: el bucle básico. Scout y Sentinel. PB-01 y AR-04.
2. `SECTOR_02 · Refrigeración`: pasillo largo con torres de enfriamiento. Presenta al
   Interceptor (flanquea, telegrafía y embiste). Despejarlo desbloquea el SG-08.
3. `SECTOR_03 · Archivo`: pasillos estrechos entre racks y una pasarela elevada con
   una terminal. Sector final.

**Modos:**

- `Misión`: briefing, run (180 s, 5 oleadas) y resultados; desbloquea el sector siguiente.
- `Overflow`: oleadas infinitas y terminales que reaparecen; termina solo cuando morís.
- `Protocolo diario`: el incidente de hoy. La semilla es la fecha UTC; el sector y el
  mutador (Enjambre, Cristal, Piel de hierro) salen de la fecha. Un tablero por día.
- `Simulador`: campo de práctica con un tutorial de 3 acciones.

**Armas:** PB-01 (pistola), AR-04 (carabina), SG-08 Scatter (escopeta, 8 perdigones con caída por distancia).

## Clasificación honesta

El cliente no envía un puntaje: envía el **registro de inputs** de la partida. El
servidor re-simula ese registro con el mismo crate de Rust (compilado a wasm en el
navegador y nativo en una función de Vercel) y calcula el puntaje él mismo. Un
`POST` falsificado no sube nada. Límite conocido: el replay frena puntajes
inventados, no frena a un bot que apunte perfecto. Detalle en
[`docs/adr/0003-replay-verified-leaderboard.md`](docs/adr/0003-replay-verified-leaderboard.md)
y el contrato en [`docs/api-contract.md`](docs/api-contract.md). El juego funciona
completo sin conexión; el tablero es opcional.

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
npm run test:rust    # tests del núcleo de simulación (cargo, incluye replay y mapas)
cargo test --workspace --locked   # crate de la API (server/)
npm run test:unit    # compila el wasm y corre vitest (incluye determinismo nativo vs wasm)
npm run test:e2e     # smoke test que arranca el juego de verdad (playwright)
npm run test:all     # typecheck + rust + unit + e2e
```

CI en `.github/workflows/ci.yml`: un job de Rust (cargo test + build wasm) y un
job web (typecheck → unit → build → e2e) sobre Node 22.

## Arquitectura en diez líneas

1. `core/` — Rust (`std` + `libm` para matemática reproducible entre nativo y wasm): mapas, jugador, armas, FSMs de enemigos, modos, puntaje y replay.
2. `scripts/build-wasm.mjs` — compila a `wasm32-unknown-unknown` y copia el binario a `public/`.
3. `src/wasm/bridge.ts` — instancia el módulo y expone `tick` / snapshot.
4. `src/wasm/protocol.ts` — contrato binario espejo de `core/src/protocol.rs`: un único buffer `f32` de 620 floats (más las tablas de mapa y el registro de inputs).
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
| Cambiar arma | `1` / `2` / `3` | botón ⇄ |
| Pausa | `Esc` | botón ❙❙ |
| Engineering Mode | `F3` | botón en pausa/ajustes |

La sensibilidad de mouse y táctil, invertir Y, escala del HUD, lateralidad,
autorecarga, asistencia de apuntado táctil y movimiento reducido se ajustan en
la pantalla de calibración o en Ajustes, y persisten en `localStorage`.

## Presupuestos de performance

Objetivos y números medidos en [`docs/performance-budget.md`](docs/performance-budget.md)
y [`docs/benchmark-results.md`](docs/benchmark-results.md) (entorno declarado). Resumen:
el tick de simulación cuesta ~2 µs de media en wasm; el render apunta a ≤ 30 draw
calls en calidad media (bloom solo en media y alta); el payload total es ~204 KiB gzip.

## Deploy (Vercel)

Frontend estático (Vite) más dos funciones Rust (`api/runs.rs`, `api/leaderboard.rs`)
con Upstash Redis como almacenamiento. Pasos, variables de entorno y riesgos sin
verificar en [`docs/deploy.md`](docs/deploy.md). Hasta tener un deploy real, el
tablero en línea no está verificado de punta a punta contra Vercel/Upstash.

## Estado (honesto)

Implementado: tres sectores, cuatro modos, tres armas, tres enemigos, progresión
local, cliente y servidor de clasificación con verificación por replay, pasada de
arte procedural (sin assets), Engineering Mode con métricas reales y tests en cuatro
capas (cargo, vitest, playwright, crate de la API).

**Limitaciones conocidas:**

- Pointer lock: la ruta de error está probada; la ruta feliz (capturar, Esc, reanudar)
  no se pudo automatizar (Chrome rechaza `requestPointerLock` bajo automatización) y
  requiere comprobación manual.
- No hay medición de fps en GPUs reales ni en móviles reales.
- El servidor de clasificación nunca corrió contra el runtime real de Vercel ni contra
  Upstash; solo contra implementaciones falsas en tests.
- Los desbloqueos de armas son progreso del cliente; el servidor no los juzga.
- Audio: sintetizado con Web Audio; el SG-08 reutiliza el sonido del sidearm.

## Especificación

El brief humano y la especificación original del proyecto viven en
[`SPEC.md`](SPEC.md). Las decisiones de arquitectura están registradas como
ADRs: [`docs/adr/0001-rust-wasm-core.md`](docs/adr/0001-rust-wasm-core.md)
(núcleo en Rust/WASM), [`docs/adr/0002-visual-direction.md`](docs/adr/0002-visual-direction.md)
(dirección visual según los mockups), [`0003`](docs/adr/0003-replay-verified-leaderboard.md)
(clasificación verificada por replay), [`0004`](docs/adr/0004-bloom-postprocessing.md) (bloom)
y [`0005`](docs/adr/0005-typography-and-switch.md) (tipografía y switch).

## Licencia

MIT — ver [`LICENSE`](LICENSE). Sin assets de terceros: proveniencia
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
