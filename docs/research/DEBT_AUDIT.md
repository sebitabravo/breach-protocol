# Auditoría de deuda pendiente: código muerto, `server/`/`api/`, Daily/Overflow

Auditoría solicitada en `odd/tasks/product-reset.md` (D7, S6, S11) para cerrar los tres ítems
marcados UNKNOWN por el diagnóstico, añadiendo el inventario de duplicación pendiente y la
cobertura de tests de los caminos críticos. El owner prohibió eliminar nada antes de verificar
sus dependencias; este documento no elimina nada y no recomienda nada por gusto.

Cada afirmación lleva la etiqueta del sistema del repositorio: `CONFIRMADO` (observado
directamente por tooling o lectura), `INFERIDO` (deducido de evidencia observada) o
`NO VERIFICADO` (no pudo observarse). Este documento no promueve un `INFERIDO` a `CONFIRMADO`.

## Cómo se investigó

Herramienta primaria: **knip** ejecutado vía `bunx` (sin instalarlo en el proyecto), con dos
pasadas: una completa (grafo con tests como entradas) y una `--production`. knip 5.x reportó
cero issues en la pasada `--production` pero 26 exportaciones sin importación externa en la
completa — se verificó manualmente cada símbolo con conteo de referencias antes de clasificarlo,
porque "sin importación externa" no significa "sin usos" (uso interno del propio módulo).
El número de versión exacto de knip quedó como **NO VERIFICADO** (la salida de `bunx`
no lo imprime; se resolvió desde el store de bun).

Complementos documentados: `bunx tsc --noEmit` (el `tsconfig.json` ya fija `noUnusedLocals` y
`noUnusedParameters`, así que su veredicto vale doble), conteo manual de referencias por símbolo
con `grep` acotado a `src/ tests/ scripts/ core/src/`, y un escaneo de bloques de código
comentado (≥4 líneas consecutivas con forma de código) por script de una sola pasada.

## 1. Código muerto

### Archivos nunca importados desde una entrada

**CONFIRMADO** (knip, pasada completa *y* pasada `--production`, con `tests/` como entradas):
ningún archivo bajo `src/` queda fuera del grafo de entradas (`index.html` → `src/main.ts` →
`src/core/game.ts` + `vite.config.ts` + las suites de test). Los únicos archivos del proyecto
no alcanzados por ninguna entrada:

| Archivo | Clasificación | Justificación con locator |
| --- | --- | --- |
| `scripts/build-textures.mjs` | SIN REFERENCIAR PERO INTENCIONAL | Se declara a sí mismo "NOT part of `bun run build`", on-demand (`scripts/build-textures.mjs:1,9`); se explica en `THIRD_PARTY_NOTICES.md:140` y el pipeline KTX2 es opcional por diseño |
| `scripts/measure-boot.mjs` | SIN REFERENCIAR PERO INTENCIONAL | Herramienta de medición manual (`scripts/measure-boot.mjs:1`), referenciada en `docs/performance-budget.md:38` |
| `tests/lab/lab.ts` | SIN REFERENCIAR PERO INTENCIONAL | Laboratorio de render solo-desarrollo; su cabecera documenta que no se importa ni desde `index.html` ni desde `src/` (`tests/lab/lab.ts:1-6`) |
| `.agents/skills/**` (boilerplates y plantillas threejs) | FUERA DEL PRODUCTO | Material de referencia de skills, no código del juego; excluido del análisis |

### Exportaciones sin referencias externas

knip reporta 26 exportaciones y 10 tipos "unused". El conteo manual de referencias los separa en
dos clases **CONFIRMADO**:

1. **MUERTO PROBADO — solo un símbolo**: `WEAPON_LABEL` (`src/wasm/protocol.ts:148`). Cero
   referencias en `src/`, `tests/`, `scripts/` y `core/src/`; ni siquiera lo usa el propio
   módulo. Es una tabla de etiquetas (`'PB-01 SIDEARM'`, etc.) que el HUD no consume.
2. **SOBRE-EXPORTADO, NO MUERTO — 25 símbolos + 10 tipos**: exportados pero usados solo dentro
   de su propio módulo. Ejemplos verificados uno a uno: `BOOT_MINIMUM_BROWSERS` y
   `probeBootRuntime` (`src/core/game.ts:451,349`), `PROGRESS_VERSION` (`src/core/progress.ts:127,235`),
   `probeGfxSignature` (`src/core/resolution-policy.ts:169,277`), `clamp`
   (`src/input/input.ts:189,190,360,361`), `THEMES` (`src/world/map.ts:78`), `robotLookInto`
   (`src/render/enemies.ts:87,284`), `BAY_X` (10 usos internos). Los tipos (`FeedLine`,
   `SectorRecord`, `OverflowRecord`, `DailyRecord`, `Screen`, `Handedness`, `GfxTierRecord`,
   `DressRole`, `MapSuffix`) operan igual: `OverflowRecord`/`DailyRecord` son la forma de
   `ProgressState` (`src/core/progress.ts:41-42,67-68`), y las dos únicas apariciones "externas"
   de `Screen` y `GfxTierRecord` son comentarios y el nombre de un describe
   (`tests/unit/terminal-scale.test.ts:29`, `tests/unit/gfx-tier.test.ts:102`). Sobrar `export`
   es cosmético, no deuda demostrada (S7).

### Alias duplicado de exportación

**CONFIRMADO** (knip): `HEADER_LEN` y `ENEMY_BASE` duplican el mismo valor
(`src/wasm/protocol.ts:63,66`; `ENEMY_BASE = HEADER_LEN`). Ambos se consumen ampliamente
(`src/wasm/bridge.ts:227`, `src/render/renderer.ts:290`, `src/render/enemies.ts:238`,
`tests/unit/protocol.test.ts:38`), así que es un alias documentado, no duplicación de verdad:
el valor vive en una sola línea.

### Ramas inalcanzables y bloques comentados

- **RAMAS INALCANZABLES: NO VERIFICADO por análisis estático dedicado** (no se corrió
  `unreachable`/control-flow aparte), pero con dos compuertas de CI que lo limitan en la
  práctica: `bunx tsc --noEmit` pasa con exit 0 con `noUnusedLocals`/`noUnusedParameters`
  strict, y `cargo clippy --all-targets -- -D warnings` es bloqueante en `.github/workflows/ci.yml:30`
  y `.github/workflows/api.yml` (el lint `dead_code` de rustc falla el build si existiera).
- **CÓDIGO COMENTADO: CERO bloques** **CONFIRMADO** por escaneo (≥4 líneas consecutivas con
  forma de código en `src/**/*.ts` y `core/**/*.rs`): 0 coincidencias.

## 2. `server/` y `api/`

**Qué son** — **CONFIRMADO**: tal como el diagnóstico sospechaba, son la mitad servidor del
tablero verificado, no un release/servidor del juego.

- `server/` es el crate `bp-server`: lógica del tablero como librería (`server/Cargo.toml:6`,
  `[lib] path = src/lib.rs`; 1.973 líneas en `server/src/` + `api/`): verificación
  re-simulada del registro (`server/src/submit.rs`), puntaje y orden del tablero
  (`server/src/board.rs`), firma/anonimización (`server/src/client.rs`), límite de ratio y
  almacén Upstash (`server/src/upstash.rs`), validación de nombres (`server/src/name.rs`).
- `api/` son las dos funciones de Vercel que envuelven esa librería: `api/runs.rs` (`POST
  /api/runs`, `api/runs.rs:1`) y `api/leaderboard.rs` (`GET /api/leaderboard`,
  `api/leaderboard.rs:1`). Vercel las descubre por `[[bin]]` del crate raíz (`Cargo.toml:13-19`)
  y las declara en `vercel.json:6-13` con `maxDuration`.

**Cómo se despliega** — **CONFIRMADO**: `vercel.json:4-13` (comando de instalación con
toolchain Rust 1.100.0 fijado y `bun install --frozen-lockfile`; `functions` apuntando a
`api/runs.rs` y `api/leaderboard.rs`). El build del juego (`bun run build`) es independiente:
`vite build` no toca `server/` ni `api/`. En CI, `.github/workflows/api.yml` valida la API en
cada push a `main` (fmt, clippy `-D warnings`, `cargo test --workspace --locked`, y verificación
del layout de binarios Linux vía `scripts/check-api-bins.py`).

**Alcance desde el cliente** — **CONFIRMADO**: el único consumidor es
`src/net/leaderboard.ts:11-12` (`/api/runs` POST, `/api/leaderboard` GET), llamado desde
`src/core/game.ts:761,792-808` (submit al terminar la partida y tablas en la pantalla de
tableros). No hay nada más del juego que toque esos rutas — grep por `/api/` en `src/` da solo
esas dos constantes.

**Qué se rompe para un jugador si desaparecen** — **CONFIRMADO por tests, no por suerte**: el
juego sigue jugando completo. El cliente nunca lanza hacia el bucle (`src/net/leaderboard.ts:3-4`);
`submitRun` devuelve un resultado tipado con todos los estados offline (`network`, `timeout`,
`server`, `invalid-response`, `src/net/leaderboard.ts:50`). En producción sin funciones, una
petición a `/api/*` cae al fallback de SPA y el caso ya está cubierto por un test: "trata un
200 no-JSON (por ejemplo una página de fallback de SPA) como offline"
(`tests/unit/leaderboard.test.ts:194`).
El panel de tablero muestra su estado offline (`src/ui/board-view.ts:12,69,109`). Lo que se pierde: el puntaje verificado en servidor desaparece; la app queda degradada, no rota.

**¿Es load-bearing para el tablero que el owner decidió mantener?** — **SÍ, CONFIRMADO**: las
dos funciones `api/` + el crate `bp-server` + el almacén Upstash *son* el tablero verificado.
No existe una alternativa serverless del tablero ni un modo local del mismo: sin
`server/`+`api/` solo queda el récord local de `ProgressState`. Además el crate depende de `bp-core` para la
re-simulación del registro (`server/Cargo.toml:10`, `server/src/submit.rs`), así que la
eliminación del crate rompería también `cargo test --workspace` de CI mientras el workflow
siga disparando (paths incluyen `server/**` y `api/**`, `.github/workflows/api.yml:9-11`).

## 3. Daily y Overflow (con el contexto de Practice)

**Inventario, CONFIRMADO por lectura**:

- **Archivos que existen solo por los modos**: `src/core/daily.ts` (18 líneas: `utcDateKey` +
  `dailySeed`), `core/src/daily.rs` (218 líneas: fecha→seed de mapa y mutadores, 4 mutadores
  con reglas), `tests/unit/daily.test.ts` (6 `it`), `tests/unit/map-mutator.test.ts` (35 líneas),
  `server/tests/overflow_bench.rs`.
- **Ramas en archivos compartidos** (conteo y locators):
  - `src/core/game.ts`: 21 puntos de modo (seed diario `:545`, tutorial en practice `:572`,
    registro de progreso `:703-706`, copy de elegibilidad `:108`, despacho del evento de nav
    `:1143-1150`, copia de sector `:602-604`).
  - `core/src/sim.rs`: modo como constantes en el contrato (`:29-32`), validación `:227`,
    seed→mutator `:231-237`, escala por mutador/vida por oleada `:337,373-378,408`,
    score de overflow `:455,480-481`, ausencia de reloj `:397,898`.
  - `core/src/replay.rs`: validación de modo `:259,381,454`.
  - `core/src/waves.rs`: `endless_composition` solo lo consume Overflow
    (`core/src/sim.rs:374`); la misión usa `mission_composition` + `surge_composition`.
  - Un solo lugar de riesgo compartido: `daily::rules()` se aplica **a todas las partidas**
    (`core/src/sim.rs:373-378`) — es una multiplicación con mutator 0, no una rama del hot path.
  - `src/core/match.ts:21-24` (mapa de modos), `src/core/screens.ts:18,54-56`, `src/core/progress.ts:28-33,41-42,67-68,100-113,161-184`
    (récords y racha), `src/net/leaderboard.ts:20-22,69-71,111`, `src/ui/board-view.ts:21-22`,
    `src/ui/hud.ts:59-63,166,197,223`, `src/ui/campaign-view.ts:36-38`, `index.html:87-94,132,323-324`.
  - Servidor: `server/src/board.rs:14,68-70,87-92` (claves `overflow` y `daily:aaaa-mm-dd` en
    el contrato del tablero ya desplegado).
- **Tests que arrastran**: cliente — `tests/unit/daily.test.ts` (6), ~22 menciones daily +
  10 overflow en `tests/unit/progress.test.ts` (29 `it` en total), casos daily/overflow en
  `tests/unit/leaderboard.test.ts` (7+12 menciones sobre 33 `it`), `tests/unit/match.test.ts:17-31`
  (mapeo de modos), `tests/unit/screens.test.ts`, `tests/unit/protocol.test.ts` (ids de modo),
  `tests/unit/determinism.test.ts` (daily+overflow en el hash dorado); Rust — ~10 tests de
  mutador/overflow en `core/src/sim.rs:1673-1868` y en `core/src/replay.rs`, tests de daily y
  overflow en `server/tests/submit.rs` (`:47-165`, con la restricción anti-farming de terminales)
  y `server/tests/overflow_bench.rs`; e2e — entrada a overflow (`tests/e2e/gameplay.spec.ts:332`)
  y menciones en `screens.spec.ts`/`hygiene.spec.ts`.
- **Copy/cadenas**: `src/core/screens.ts:54-56` (descripciones de menú), `src/core/game.ts:602-604`
  (códigos de sector), `src/ui/hud.ts:60-63` (etiquetas HUD), `src/ui/board-view.ts:21-22`
  (etiquetas de tablero), `index.html:87-94,132,323-324` (botones de menú, récord, pestañas de
  tablero). Son cadenas de una línea cada una, no niveles de traducción dobles.
- **Caso aparte — Practice**: NO está en la decisión del owner (el pedido fue Daily y Overflow),
  y tampoco lo es su deuda: Practice aloja el tutorial (`src/core/game.ts:572`,
  `index.html:93-94,629`, modo en `src/core/game.ts:108`) y el tutorial es un requisito S8.

**Veredicto** — **CONFIRMADO con criterio de S7 (deuda demostrada, no volumen)**: mantener los
modos Daily y Overflow es **más barato** que removerlos, y encaja con la decisión ya tomada
(P4 reduce los puntos de entrada visibles, no borra código):

- El costo en ejecución es efectivamente cero: los modos comparten el mismo núcleo, la misma wave
  pipeline y el mismo servidor; las únicas ramas extra son constantes de modo y la composición
  de oleadas de overflow, un cálculo frío por oleada (no por tick).
- Eliminarlos tocaría unas 15+ rutas en **tres lenguajes** (TS, Rust del juego, Rust del
  servidor) más el **contrato del tablero ya desplegado** (`server/src/board.rs:68-70`: las
  claves `daily:*` y `overflow` son parte del GET /api/leaderboard consumido por pestañas
  activas hoy) y el **esquema persistido** del progreso (`src/core/progress.ts:107-113`: los
  récords y la racha viven en el snapshot versionado `bp.progress`; borrar campos necesita
  migración de `sanitize` para no romper jugadores existentes).
- El costo de mantener, en cambio, es superficial: copy de una línea por modo + P4 ya reduce el
  menú. Eso es superficie de producto en pausa, no deuda arquitectónica.

## 4. Duplicación pendiente tras la etapa de fuente única

**Delimitación temporal**: las constataciones de este documento se hicieron contra `HEAD`
(`3c1270b`) y contra el árbol de trabajo observado en el momento de la auditoría. Durante la
propia auditoría el árbol contenía trabajo P2 en curso, sin commit, que cierra parte de lo que
sigue: `src/core/constants.ts` y `src/render/palette.ts` nuevos, `tests/unit/single-source.test.ts`
nuevo, y modificaciones en `src/core/settings.ts`, `src/core/sectors.ts`, `src/render/camera.ts`,
`src/render/presets.ts`, `src/render/terminal-model.ts`, `src/render/themes.ts`, `src/ui/engineering.ts`,
`src/ui/hud.ts` (`git status --short`, observado al cerrar la auditoría). La columna Estado distingue
los dos estados; ninguno reemplaza la lectura del revisor.

Contexto previo (ya aterrizado en commits): P2 cerró la familia de la escala de props (los
terminales derivan su escala del jugador, `src/render/terminal-model.ts:14-27`, commit
`ad9a0d7`) y P3 dio un responsable único a la resolución de render
(`src/core/resolution-policy.ts`, commit `3c1270b`).

Lo que sigue pendiente, familia por familia **CONFIRMADO con locators**:

| Familia | Estado | Locators |
| --- | --- | --- |
| Altura de ojos / dimensiones del jugador | **CERRADA en el árbol en curso, pendiente de commit**; en `HEAD` sigue el espejo por comentario | Owner nuevo (sin commit): `src/core/constants.ts` (`PLAYER`, con test de drift); derivan de ahí `src/render/camera.ts`, `src/render/terminal-model.ts`; base del espejo: `core/src/player.rs:9` |
| Color de estado «mint» `#5ce08b` | **CERRADA en el árbol en curso para los canvas de UI (`hud.ts`, `engineering.ts`) y resto aún SIN VERIFICAR**; en `HEAD` son tokens CSS + literales | En `HEAD`: `src/styles/tokens.css:77`, `src/ui/hud.ts:406,433`, `src/ui/engineering.ts:212`, `src/render/feedback-fx.ts:16`, `src/render/themes.ts:22,29`, `src/render/fx.ts:30`, `src/render/authored-weapon.ts:13`, `src/render/weapon-hardware.ts:6`. En curso: `src/render/palette.ts` (`STATE_COLORS`, espejo del CSS con test) y derivación en `src/ui/hud.ts`, `src/ui/engineering.ts` |
| Lista de efectos gráficos | **CERRADA en el árbol en curso, pendiente de commit**; en `HEAD` siguen tres listas | En `HEAD`: `src/core/settings.ts:19` (`GFX_KEYS`), `src/ui/settings-form.ts:71` (`GFX_EFFECTS`), `src/render/presets.ts:85-91` (`GfxPlan` + firma enumerada). En curso: `GFX_EFFECTS` se deriva de `GFX_KEYS` (`src/core/settings.ts:23-25`) y `presets.ts` deriva `GfxPlan` de acá |
| Duración de partida | **CERRADA en el árbol en curso, pendiente de commit**; en `HEAD` el dueño es único pero el copy repite | En `HEAD`: `core/src/sim.rs:18` + `src/core/sectors.ts:26,35,44` + `index.html:373`. En curso: `MATCH_SECONDS` y `formatMatchClock` en `src/core/constants.ts`, y `sectors.ts` deriva el plazo (`Completá antes de …`) |
| Copy de interfaz con fuente doble | **SIGUE**: el trabajo en curso no lo toca | `src/core/game.ts:213` (`BOOT_COPY`, dos locales), `src/ui/settings-form.ts:46` (`GFX_LABELS`), `index.html` (etiquetas estáticas en español) |

Falta un detalle menor nuevo: el alias `ENEMY_BASE = HEADER_LEN` (`src/wasm/protocol.ts:63,66`),
que es derivación documentada, no duplicación.

## 5. Cobertura de tests de caminos críticos

**Tablero (envío verificado)** — **CUBIERTO, CONFIRMADO**: cliente con 33 `it` en
`tests/unit/leaderboard.test.ts` (saneo de nombres, `boardFor` por modo y desbloqueo, base64 en
chunks, timeout/red/4xx/parseo corrupto, 429, fallback SPA); servidor con tests de submit que
construyen registros **reales** con `bp_core::run` y calculan el esperado con el mismo núcleo
(`server/tests/common/mod.rs:1-92`), más rechazo de truncados/pad (`server/tests/submit.rs:99-137`)
y la política de frescura del tablero diario (`api/leaderboard.rs:69-72`).

**Paridad de re-simulación** — **INFERIDO, no probado de extremo a extremo**: la paridad entre
lo que graba el cliente y lo que verifica el servidor se apoya en un hecho de diseño — ambos
usan el mismo `bp-core` (WASM en el cliente, crate nativo en el servidor, mismo snapshot
determinista). Hay hash dorado en vitest (`tests/unit/determinism.test.ts`) y fixtures Rust
grabadas con el núcleo real (`server/tests/common/mod.rs`). **No existe ningún test cruzado**
que tome un log grabado por la ruta cliente (Vitest + WASM) y lo verifique con el `submit()`
puro Rust: las dos mitades se testean por separado y el puente real (mismo binario compilado
distinto, mismo endianness/f32 path) queda sin pin futuro.

**Multitouch** — **HUECO, CONFIRMADO**: el normalizador de entrada gestiona múltiples punteros
con `pointerId` + pointer capture y lo documenta como lo que habilita "mover + apuntar +
disparar" con tres toques (`src/input/input.ts:2-6,70,332-347`). Los tests unitarios del input
solo cubren el umbral de sprint y el ciclo de armas (`tests/unit/input-weapons.test.ts:24-31`),
no el DOM multi-puntero. Los e2e móviles tapan un botón por vez: taps individuales
(`tests/e2e/gameplay.spec.ts:184-194`), un hold de interacción con CDP de **un** punto
(`:218-236`), y `tests/e2e/wave-acceleration.spec.ts:66-81` igual. **Ningún test toca dos
punteros a la vez** (stick + botón de fuego simultáneos), que es exactamente el requisito del
comentario del propio `input.ts`.

## Comandos y resultados de verificación

- `bunx knip --no-exit-code` (config por defecto del proyecto): 30 archivos sin usar (27 son
  plantillas de `.agents/`, más los 3 ítems de la tabla de arriba), 26 exportaciones sin importación
  externa, 10 tipos sin uso, 1 serie duplicada — se clasificaron a mano uno a uno arriba.
- `bunx knip -c /tmp/knip-audit.json --no-exit-code` (entradas = `index.html`, `src/main.ts`,
  configs, `scripts/*.mjs`, suites de test; `ignore = [".agents/**"]`): mismas exportaciones,
  **ningún archivo de `src/` sin usar**.
- `bunx knip -c /tmp/knip-audit.json --production --reporter json`: `{"issues":[]}` — cero
  issues de producción. Esta pasada contradice a la completa en exportaciones y es menos
  informativa aquí (knip `--production` restringe además las entradas); por eso la
  clasificación es el conteo manual por símbolo, no el número de knip.
- `bunx tsc --noEmit`: exit 0 (con `noUnusedLocals`/`noUnusedParameters` ya fijados en
  `tsconfig.json`).
- Escaneo de bloques comentados (script de una pasada, ≥4 líneas consecutivas con forma de
  código, `src/**/*.ts` + `core/**/*.rs`): 0 bloques.
- `git status --short` tras el análisis: limpio (knip vía `bunx` no escribió nada en el repo;
  su "Saved lockfile" fue en su store temporal de bun).

## Recomendación

- Eliminar solo `WEAPON_LABEL` (`src/wasm/protocol.ts:148`): único símbolo con cero referencias
  en todo el repo; el resto de los 25 "unused exports" son sobre-exportación cosmética, no deuda (S7).
- Dejar sin tocar `scripts/build-textures.mjs`, `scripts/measure-boot.mjs` y `tests/lab/lab.ts`:
  sin enlistar por diseño, referenciados por docs (`docs/performance-budget.md:38`,
  `THIRD_PARTY_NOTICES.md:140`) y con el pipeline KTX2 dependiendo del primero.
- Dejar `server/` + `api/` intactos: son el tablero verificado que el owner decidió mantener
  (`vercel.json:6-13`), el cliente degrada tipado y con tests, y nada del build del juego los
  alcanza.
- Ocultar Daily/Overflow del menú en P4 conservando el código: mantener es más barato que
  eliminar (cero ramas calientes, frente a ~15 rutas en TS/Rust/contrato del board desplegado y
  el esquema versionado de progreso).
- Consolidar la familia de duplicación demostrada que sigue abierta en ambos estados: la fase
doble del copy de interfaz (`src/core/game.ts:213` `BOOT_COPY` + `src/ui/settings-form.ts:46`
`GFX_LABELS` + español estático en `index.html` → una sola fuente). El resto de las familias
(D5/D4: dimensiones del jugador, color de estado, lista de efectos, duración) está cerrada en
el trabajo P2 en curso del árbol; el revisor solo debe verificar que esos commits aterrizan
con su test de drift (`tests/unit/single-source.test.ts`).
- Cerrar los dos huecos de cobertura antes del próximo cambio en esas rutas: un e2e de multitouch
  real (stick + fuego simultáneos, dos `pointerId`) y un fixture de paridad log-cliente →
  verificación Rust del servidor, hoy solo la protege el diseño compartido de `bp-core`.
