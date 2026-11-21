# Informe de performance

Resultados de la auditoría `fix/game-audit-pass`. Reemplaza la lectura dispersa de
[`performance-budget.md`](performance-budget.md) (payload, arranque, presupuestos) y de
[`benchmark-results.md`](benchmark-results.md) (simulación nativa y en wasm): esos dos siguen siendo la fuente de
sus mediciones y no se repiten acá. Este documento agrega el **costo de frame medido en GPU real** y el antes y
el después de los cambios de esta rama.

## Cómo se midió

| Dato | Valor |
| --- | --- |
| Equipo | Apple M3, macOS, Chromium de Playwright **con ventana** (no headless) |
| Comando | `bun run build && bun run bench:frames --label <nombre> [--presets low,medium,high] [--seconds 20] [--soak 600]` |
| Escena | Práctica, sector 1, semilla fija (`Math.random` sembrado), movimiento en zigzag con W + A/D y disparo sostenido |
| Ventana | 1600×900 px CSS con `deviceScaleFactor` 2 |
| Muestra | 20 s tras 3 s de calentamiento (≈1200 frames por preset; 2400 en la corrida de `auto`, de 40 s) |
| Qué mide | Intervalo entre `requestAnimationFrame` (p50, p95, p99), tiempo de CPU de `renderGame` (envío del frame a la GPU), draw calls, triángulos, `renderer.info.memory` y programas |
| Qué **no** mide | El tiempo de GPU. El costo de GPU solo se infiere de que el intervalo de frame se mantenga o no |

**La pantalla de prueba refresca a 60 Hz** (p50 de 16.7 ms en todos los presets). Está atada a vsync: «60 fps» en
las tablas significa que el equipo **sostiene el vsync**, no que le sobre margen. Un intervalo de frame no puede
bajar de 16.7 ms en este monitor aunque la GPU esté ociosa. Por eso un p95 de 18 ms es el mejor resultado posible
acá, y un número peor es la señal de alarma.

La estimación de memoria del composer es `ancho × alto × 12 B × muestras` (color HalfFloat de 8 B más
profundidad de 4 B por muestra, 4 muestras en medium y high). **No es una lectura de la GPU.**

## Antes y después en el M3

### Presets (después de la rama, salvo la fila de `high` sin tope)

| Preset | Drawing buffer | DPR efectivo | fps | Intervalo p50 / p95 / p99 (ms) | CPU de `renderGame` p50 / p95 (ms) | Draw calls | Triángulos | Composer estimado |
| --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: |
| low | 523×294 | 0.33 | 60.0 | 16.7 / 18.1 / 18.5 | 0.8 / 1.3 | 16 | 41 090 | sin composer |
| medium | 979×551 | 0.61 | 59.8 | 16.7 / 18.0 / 18.5 | 0.8 / 1.6 | 22 | 40 984 | 25 MB |
| **high, antes (sin tope)** | **3200×1800** | **2.00** | **44.7** | **17.2 / 34.5 / 35.3** | 1.1 / 1.9 | 26 | 41 100 | **264 MB** |
| **high, después (3.5 MP)** | **2494×1403** | **1.56** | **60.0** | **16.7 / 18.2 / 18.6** | 0.9 / 1.6 | 25 | 40 986 | **160 MB** |

Lo que dice:

- `high` sin tope no sostenía 60 Hz en un M3: perdía frames (p95 de 34.5 ms, es decir, algunos frames duraban dos
  vsync). La causa es el relleno de píxeles del composer HalfFloat con 4× MSAA a 5.76 MP.
- Con el presupuesto de 3.5 MP (`PLAY_PIXEL_BUDGET.high` en `src/render/presets.ts`) sostiene el vsync y la
  estimación de memoria baja un 39 %.
- La CPU no cambió de forma apreciable (0.8–1.1 ms p50): el problema era de relleno de GPU, no de CPU. Draw calls y
  triángulos son los mismos entre presets salvo los pases del composer.
- La comparación de capturas de `high` antes y después (recorte de 600×340 px del mismo cuadro) no mostró
  diferencia visible a esa escala. Es una comparación a ojo de un cuadro, no una métrica.
- MSAA 4→2 se consideró como alternativa y **no se probó**: el tope de píxeles solo ya alcanzó el vsync.

**Observación sin cambiar:** `low` y `medium` renderizan a 0.33 y 0.61 de DPR en una ventana de 1600×900
(presupuestos de 154 k y 540 k píxeles). Son valores pensados para móviles; en un monitor de escritorio se ven
blandos. No se tocó porque `auto` ya sube a `high` en equipos con margen y el ajuste es de diseño.

### Calidad automática (`auto`)

| Corrida | Preset aplicado a los 40 s | fps | Intervalo p50 / p95 / p99 (ms) |
| --- | --- | ---: | --- |
| Antes | `medium` (no sube nunca) | 60.0 | 16.7 / 18.2 / 18.5 |
| Después | `high` | 59.8 | 16.7 / 18.2 / 18.5 |

Antes, el controlador subía solo si el p95 del intervalo de frame bajaba de 12 ms. En una pantalla de 60 Hz ese
umbral es inalcanzable, así que `auto` quedaba en `medium` en cualquier equipo de 60 Hz, por potente que fuera.
Ahora también sube cuando los frames sostienen el vsync (p95 ≤ 18.5 ms) y el costo de CPU del render deja margen
(p95 ≤ 4 ms), y tras bajar de un preset no vuelve a él por margen de CPU durante toda la sesión.

**Esa vía de subida no está validada en hardware limitado por GPU.** El tiempo de CPU no ve a la GPU: en un
equipo cuya GPU no sostenga `high`, el controlador puede subir una vez y bajar de nuevo (un tirón), y el techo
de sesión evita que repita el ciclo. Falta probar en un portátil con gráficos integrados y en un móvil.

### Fuga de memoria (10 minutos)

`bun run bench:frames --label soak --presets high --seconds 10 --soak 600`, con el tope de píxeles aplicado,
sobre el mismo guion:

| Muestra | Geometrías | Texturas | Programas | Heap JS (MB) |
| --- | ---: | ---: | ---: | --- |
| 20 muestras, una cada 30 s | 21 (constante) | 26 (constante) | 37 (constante) | 19.3–20.7, sin tendencia |

Intervalo del tramo medido: p50 16.7, p95 18.3, p99 18.6 ms; 0 errores de consola o de página. No hubo crecimiento
de recursos de GPU ni del heap en esa ventana. Es una sesión de práctica de 10 minutos, no una partida de
Overflow larga.

## Otros cambios de costo

| Cambio | Efecto medido |
| --- | --- |
| Vista del buffer de entrada del wasm reutilizada entre ticks (`Engine.tick`) | No se midió por separado: es una reserva menos por tick |
| `Snapshot.node(index, out)` con objeto reutilizado en `terminals.ts` | No se midió por separado: tres objetos menos por frame. `renderGame` ya estaba en 0.9 ms p50 |
| `Renderer.resetFeedback()` al iniciar una partida | Coste constante; vacía decals y casquillos |

## Móvil

Sin medir. Todas las filas son `pending (human)`; no se inventan cifras.

| Dispositivo | Preset aplicado | fps | p95 (ms) | Memoria | Temperatura / batería |
| --- | --- | --- | --- | --- | --- |
| Android gama media, Chrome | pending (human) | pending (human) | pending (human) | pending (human) | pending (human) |
| iPhone, Safari | pending (human) | pending (human) | pending (human) | pending (human) | pending (human) |
| Android de gama baja | pending (human) | pending (human) | pending (human) | pending (human) | pending (human) |

Antes de medir en móvil conviene correr `bench:frames` con `--dsf 3` y un viewport de teléfono, y repetir los
presupuestos de píxeles con el DPR real del dispositivo.

## Pendiente

- Medir a 120 Hz: el criterio de subida de `auto` cambia (los frames de 8.3 ms ya cumplen el umbral viejo de 12 ms).
- Medir `high` con 4× MSAA en una GPU integrada.
- Una partida de Overflow larga en el soak (más enemigos, más partículas).
- Tiempo de GPU real con `EXT_disjoint_timer_query_webgl2` si el navegador lo expone.
