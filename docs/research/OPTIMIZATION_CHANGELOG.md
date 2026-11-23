# Registro de optimizaciones implementadas (estudio halloween.dev)

Documento T7 (S11) de la tarea REA (`odd/tasks/rea-halloween-study.md`): qué se cambió de
verdad en este proyecto durante el ciclo de trabajo, con su evidencia de medición, una
sección por cambio (T5a, T5b, T5c, T6a, T6b). Cada afirmación lleva la etiqueta del
sistema de la tarea (`CONFIRMADO` — observado directamente en este repositorio o al
correr sus pruebas, `INFERIDO` — deducido de evidencia observada, `NO VERIFICADO` — no
pudo observarse aquí).

**Regla de atribución de números:** cuando una cifra pertenece a otra unidad de trabajo y
no hay artefacto ni constante que la muestre en este árbol, se declara *según el reporte
de la unidad*; no se presenta como medición propia. El método de medición de frames es el
del propio repositorio (`scripts/measure-frames.mjs`, Apple M3 / Chromium 157,
1600×900, `deviceScaleFactor` 2), igual que en
[`PERFORMANCE_BENCHMARKS.md`](PERFORMANCE_BENCHMARKS.md) y
[`RENDERING_COMPARISON.md`](RENDERING_COMPARISON.md).

## T5a — Overrides por efecto (`gfxBloom`…)

**Problema observado.** La referencia expone toggles por efecto al jugador
(`tld.settings.v1`: `rain, shadows, lights, ao, bloom, fxaa, dof, grain`; L6) y este
proyecto solo ofrecía los presets low/medium/high: no había control individual de ningún
efecto (`CONFIRMADO`, `HALLOWEEN_ANALYSIS.md` y `SPEC.md` — lista de ajustes existentes).

**Cambio hecho.** Cinco overrides `auto | on | off` — `gfxBloom`, `gfxShadows`,
`gfxEnvironment` (reflejos PMREM), `gfxLights` (luces prácticas) y `gfxMist` (neblina) —
encima de la derivación de cada preset, con `DEFAULT_SETTINGS` en `auto` para los cinco
(defaults sin cambios) y `auto` reproducido byte a byte igual que el plan previo al
cambio. El presupuesto de píxeles, el tope de DPR y las muestras MSAA siguen siendo del
preset: un override nunca los toca (`CONFIRMADO`, fijado por test).

**Archivos tocados.** `src/render/presets.ts`, `src/render/renderer.ts`,
`src/render/postfx.ts`, `src/core/settings.ts`, `index.html` (los cinco selects en
ajustes), `src/ui/settings-form.ts`, `src/styles/menus.css`;
`tests/unit/gfx-overrides.test.ts`, `tests/unit/gfx-wiring.test.ts` (`CONFIRMADO`,
visible en el árbol).

**Evidencia.** — 27 → 17 draw calls en preset high con bloom y sombras desactivadas:
*según el reporte de la unidad* (no hay JSON de frames de ese pase en `test-results/` de
este árbol: **NO VERIFICADO** aquí el número exacto). — Lo que sí se observó aquí:
`bunx vitest run` sobre los dos archivos de prueba → 55 casos de overrides (cada
`auto|on|off` × `low|medium|high` × efecto) + 3 de wiring, todos pasando; los tests fijan
que `auto` == plan previo, que los presupuestos quedan intactos
(`PLAY_PIXEL_BUDGET` low 154 000 / medium 540 000 / high 3 500 000) y que el patch de la
UI llega a `renderer.setGfx` (`CONFIRMADO`, corridos por esta unidad documental).

**Regresión posible a vigilar.** Que un override empiece a filtrar presupuesto de píxeles
o MSAA (rompería la aritmética del presupuesto en `presets.ts`); que `auto` deje de
reproducir el comportamiento previo tras cambios futuros de los presets; y el caso bloom
off con camino HalfFloat/MSAA: verificar que el pase de salida sigue correcto.

## T5b — Nivel gráfico verificado persistido (`bp.gfx.tier`)

**Problema observado.** Cada sesión volvía a escalar presets desde medium, aunque la
misma GPU ya hubiera verificado high la sesión anterior. La referencia resuelve eso con
`localStorage tld.gfx.v1` (`sig`, `tier`, `verified`, `scale`; L6) y este proyecto no
tenía equivalente (`CONFIRMADO`).

**Cambio hecho.** Registro `bp.gfx.tier` v1 bajo su propio namespace (nunca toca
`bp.settings`): firma de GPU como hash corto (16 hex, nunca los strings crudos) de
backend + vendor + renderer + `DPR@viewport`; versionado con byte de versión (registro de
versión futura rechazado, versión legacy 0 migrada). Corrupto, parcial, exageradamente
grande o con timestamp no finito se **rechaza sin reparar ni adivinar**. El arranque
consume el registro una sola vez por carga de página; el nivel persistido es **punto de
partida, no techo**: el controlador sigue midiendo ventanas y puede bajar. Bajada en vivo
actualiza el registro a lo que realmente sostuvo; preset manual no lo escribe; sin datos
de WebGL o con storage roto: comportamiento de hoy, sin throw. Contrato fijado en
`tests/unit/gfx-tier.test.ts` (`CONFIRMADO`).

**Archivos tocados.** `src/core/settings.ts` (registro, firma, carga/guardado),
`src/core/quality.ts` (consumo en el arranque), `tests/unit/gfx-tier.test.ts`.

**Evidencia.** La **demostración de dos boots** (boot 2 arranca en el tier persistido en
vez de re-escalar): *según el reporte de la unidad* en su corrida en vivo. Lo observado
aquí: los 21 casos del archivo pasan, incluidos «primera corrida idéntica a hoy con
registro escrito», «un boot posterior con la misma firma arranca en el tier persistido» y
«firma cambiada degrada a medium con re-escalado» (`CONFIRMADO`, corridos por esta
unidad).

**Regresión posible a vigilar.** Firmware o driver que cambie el string de renderer
invalidaría la firma (degradación esperada, no bug, pero debe quedar visible); que
alguna vía empiece a persistir un nivel no verificado; y el fallback sin información de
WebGL, que debe seguir siendo exactamente el comportamiento previo sin persistir nada.

## T5c — Resiliencia de arranque

**Problema observado.** El repositorio de issues de la referencia (terceros: Safari
estancado al 6 %, canvas en blanco/negro, WebViews embebidas; L6/`HALLOWEEN_ANALYSIS.md`)
documenta modos de fallo de boot, pero este proyecto solo tenía 4 checks de
arranque y la pantalla de context-lost: sin estado «lento» ni «no soportado»
diferenciados (`CONFIRMADO`, código previo en `index.html` / `src/core/game.ts`).

**Cambio hecho.** Gate de capacidades por sondeo, no por user-agent: `wasm`, `webgl2` y
`runtime` (lista de APIs que el bundle construido invoca de verdad en el arranque:
`AbortController`, `AbortSignal.timeout`, `ResizeObserver`, `replaceChildren`), con piso
declarado **Chrome 103 / Firefox 100 / Safari 16**. Dos umbrales de tiempo: a los
**24 s** (`BOOT_SLOW_MS`, `CONFIRMADO` en `src/core/game.ts:126`) solo un aviso — nunca
corta una carga que sigue avanzando — y a los **60 s** (`BOOT_STALLED_MS`,
`game.ts:129`) se ofrece **Reintentar**. La variante de fallback «no soportado» nombra lo
que falta y el piso de versiones, y esconde Reintentar: recargar no puede crear una
capability que no existe.

**Archivos tocados.** `src/core/game.ts`, `index.html` (bloques boot-slow, boot-retry y
fallback con `data-boot`), `src/styles/menus.css`, `tests/unit/boot-states.test.ts`,
`tests/e2e/boot.spec.ts`.

**Evidencia.** Que un **boot normal llega al menú sin ninguno de los dos estados**: la
prueba e2e `tests/e2e/boot.spec.ts` lo fija (`data-screen="menu"` y
`bootScreens === ['shell', 'menu']` en la visita normal) — la corrida en vivo del ciclo de
trabajo: *según el reporte de la unidad*; lo observado aquí: los 11 casos de
`boot-states.test.ts` pasan (`CONFIRMADO`), cubriendo el gate, la lista de APIs y los dos
umbrales.

**Regresión posible a vigilar.** Que los umbrales se encojan hasta cortar cargas lentas
pero válidas (24 s es solo aviso; 60 s triplica el peor network funcional); que el gate
quede más estricto que las APIs realmente invocadas y excluya navegadores capaces; y que
Reintentar reaparezca en la variante no-soportado.

## T6a — Rework de silueta de robots

**Problema observado.** Orden del propietario, verbatim (L9): `"los robots no parecen
robots"`. La verificación propia de la unidad (documentada en
[`RENDERING_COMPARISON.md`](RENDERING_COMPARISON.md)) captó los tres tipos leídos como
personas de traje, sin rasgo de máquina ni de clase a ~10 m (`CONFIRMADO`, capturas RED
en `test-results/t6a/before-*.png`).

**Cambio hecho.** Silueta de superficie dura con semántica general (placas de blindaje
con cortes, visor angular con franja de ojo emisiva a todo lo ancho, núcleo pectoral
emisivo, hombreras sobre la banda del torso, articulaciones expuestas como cilindros,
piernas de máquina) y un rasgo dominante por clase: asimetría (scout), anchura
(sentinel), navaja (interceptor). Arquitectura intacta: un `InstancedMesh` por clase,
pose-texture skinning, un draw por tipo, cero materiales por objeto, paleta sin cambios.
Detalle completo: `RENDERING_COMPARISON.md`, sección T6a.

**Archivos tocados.** `src/render/robot-rig.ts`, `tests/unit/robot-silhouette.test.ts`
(`CONFIRMADO` en el árbol).

**Evidencia medida.** Tris totales en high **47 964 → 47 708** (256 por debajo del antes;
presupuesto T1+10 % cumplido), **26 draw calls sin cambio** (1 por clase preservado),
60 fps con p95 **17,5 ms**. La fila «antes» proviene del reporte citado en
`RENDERING_COMPARISON.md` (`frames-t6a-before.json`); ese JSON ya no está en
`test-results/` de este árbol, así que el número de antes queda *según el reporte de la
unidad y el documento citado*; la fila «después» es `CONFIRMADO` directo:
`test-results/frames-t6a-after.json` (26 calls, 47 708 tris, p95 17,5, fps 60) observado
por esta unidad. Los 10 casos de `robot-silhouette.test.ts` pasan (`CONFIRMADO`, corridos
aquí).

**Regresión posible a vigilar.** Que futuras piezas re-inflen los tris por encima del
presupuesto (los cilindros de articulación son baratos, las placas con chaflán no);
que `SENTINEL_MUZZLE` se desalinee si se mueve el cañón; y que la legibilidad de silueta
dependa de efectos que un jugador puede apagar (`gfxLights`, `gfxMist` off) — la franja
emisiva usa el camino de emisión que alimenta el bloom, apagable por diseño.

## T6b — Escala mundial de las terminales

**Problema observado.** Orden del propietario, verbatim (L9): `"las terminales son mas
grandes yo"` (S16: la escala de props debe derivarse del jugador, nunca de otro prop).
La altura autoría del housing era una constante local de **2,70 m** — más alto que el
jugador de **1,80 m** (`CONFIRMADO`: `CONSOLE_TOP_LOCAL = 2.70` y su comentario en
`src/render/terminal-model.ts`; la medición en escena del antes: *según el reporte de la
unidad*).

**Cambio hecho.** La máquina se dimensiona ahora desde las métricas del jugador:
`TERMINAL_TOP = PLAYER_EYE_HEIGHT + 0.16 = 1,780 m` (derivada de la altura del ojo,
`CONFIRMADO` en el árbol), `TERMINAL_SCALE = 1,780 / 2,70 ≈ 0,6593` escala toda la
geometría, la pantalla queda legible bajo el ojo (`SCREEN_CENTRE_Y < 1,62 m`) y el
muestreo de oclusión escala con la máquina (`SCREEN_SPREAD`, `SCREEN_BOUNDS_RADIUS`
derivadas de la misma escala). El pin anti-re-inflado vive en
`tests/unit/terminal-scale.test.ts`: toda constante asertada es una exportación nombrada
derivada de las métricas del jugador, así que un edit futuro no puede volver a inflar la
prop en silencio.

**Archivos tocados.** `src/render/terminal-model.ts`, `src/render/terminals.ts`,
`tests/unit/terminal-scale.test.ts` (`CONFIRMADO` en el árbol).

**Evidencia.** Línea que el propio test imprime al correrse, observada por esta unidad
(`CONFIRMADO`): `terminal top: 1.780 m vs player 1.800 m (eye 1.620 m); scale 0.6593;
screen 1.272 m ±0.204 m`. Los 4 casos del archivo pasan (`CONFIRMADO`, corridos aquí):
tope bajo la corona y sobre el ojo, escala derivada del plano de tope, pantalla bajo el
ojo y sobre una superficie de trabajo, oclusión escalada.

**Regresión posible a vigilar.** Cualquier edición que introduzca un número mágico en vez
de una derivación de `PLAYER_*` (el test lo bloquea); que el radio de oclusión vuelva a
ponerse independiente de la escala; y que el plano de pantalla se suba por encima del
ojo del operador.

## Qué no se midió en este ciclo

- **FPS móvil**, en ninguna dirección: no hubo dispositivo físico; las filas móviles de
  la línea base siguen vacías (`CONFIRMADO`, `PERFORMANCE_BENCHMARKS.md`).
- El **camino WebGPU por defecto de la referencia** y el nivel que vería un visitante real
  de escritorio (`NO VERIFICADO`, límites documentados en `HALLOWEEN_ANALYSIS.md`).
- El pipeline KTX2/Basis: identificado y justificado, **no implementado** (T5d pendiente
  de decisión de toolchain; el ahorro ETC1S queda como estimación por formato).
- Corrida en vivo de la demostración de dos boots (T5b) y del pase e2e de arranque (T5c)
  dentro de esta unidad documental: descritas *según el reporte de la unidad*.
