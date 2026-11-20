# ADR 0001 — Núcleo de simulación en Rust compilado a WebAssembly

- Estado: aceptado
- Fecha: 2026-11 (vertical slice)
- Decide: el humano, dirección del proyecto

## Contexto

La especificación original (`SPEC.md` §7.1) recomendaba un núcleo de simulación
en TypeScript puro, en el mismo proceso que el shell. El humano pidió
explícitamente lo contrario:

> "yo estoy muy visiado con la tecnologia de rust entonces si el compilador
> puede estar en ese lenguaje para que sea rapido y todo funcione en un buen
> performance seria perfecto"

La instrucción del humano tiene precedencia sobre el documento. Este ADR
registra la decisión y sus tradeoffs para que quede claro qué se cambió y por
qué.

## Decisión

La simulación completa (matemática, arena, jugador, armas, FSMs de enemigos,
oleadas, fases y puntaje) vive en el crate `core/` (`bp-core`, Rust puro, solo
`std`, cero dependencias) y se compila a `wasm32-unknown-unknown` con
`scripts/build-wasm.mjs`. El shell TypeScript no implementa reglas de juego:
solo escribe el buffer de input, ejecuta `bp_tick` y lee el snapshot.

Rendering y UI quedan en la plataforma web (Three.js + DOM) porque los shaders,
la accesibilidad y el teclado/touch viven ahí; el límite es la frontera
Rust↔JS, no "todo en wasm".

## Tradeoff

### Qué costó

- **~69 KiB de binario** (`public/bp_core.wasm` mide 69.7 KiB sin comprimir,
  29.1 KiB con gzip -9, medido en el build actual). El mismo código en
  TypeScript sería tree-shaken junto con el bundle existente.
- **Duplicación del contrato binario.** Los offsets del snapshot y del input
  existen en `core/src/protocol.rs` y en `src/wasm/protocol.ts`; cualquier
  cambio requiere editar ambos, versionar `PROTOCOL_VERSION` y actualizar los
  tests de estabilidad en los dos lados.
- **Toolchain extra.** Compilar exige Rust con el target wasm
  (`rustup target add wasm32-unknown-unknown`), tanto para desarrolladores
  como en CI.

### Qué compró

- **Determinismo estructural.** Paso fijo de 1/60 s y RNG con semilla en el
  núcleo: la misma semilla y la misma secuencia de input producen el mismo
  mundo. En TypeScript ese invariante depende de disciplina; en Rust, del
  diseño del crate.
- **Testabilidad del núcleo.** 66 tests de cargo cubren las reglas de
  simulación sin navegador ni wasm: corren en milisegundos y en CI de Rust
  puro.
- **Sin GC en el loop caliente.** Movimiento, colisiones, hitscan y FSMs no
  tocan el garbage collector de JS; la frontera es un buffer `f32` plano que
  se lee sin copiar (`Float32Array` sobre la memoria lineal de wasm).
- **Velocidad nativa para los hot loops.** Raycasts y colisiones contra la
  arena se ejecutan a velocidad compilada, que es exactamente lo que el
  humano pidió.

## Consecuencias

- Todo cambio de reglas de juego empieza en `core/` y se propaga al protocolo;
  ver `docs/architecture.md` para los puntos de extensión.
- `assertProtocol` corta el boot con una pantalla de fallback si el binario y
  el shell no coinciden: el mismatch nunca es silencioso.
- CI tiene un job de Rust separado (cargo test + build wasm) y uno web
  (typecheck, unit, build, e2e).
