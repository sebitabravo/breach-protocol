# RENDERING_COMPARISON — Breach Protocol vs. halloween.dev (evidencia observada)

Documento T7 (S11): solo lo observado, con su medición. Se amplía por unidad implementada;
cada sección lleva su etiqueta de tarea T#/S# y su antes/después medido con el harness del
propio repositorio (`scripts/measure-frames.mjs`, Apple M3 / Chromium 157, 1600x900 dpr 2).

Línea base de referencia (T1/L5, misma máquina y método): low 16 draws / 47.954 tris,
medium 15 / 39.384, high 26 / 47.854 — antes del trabajo de silueta la propia escena ya
costaba 3x menos geometría y 5x menos draws que el estudio de referencia; la diferencia
honesta no es coste bruto sino riqueza por píxel (T3/L8) y legibilidad.

## T6a — Silueta de robots (S14, S15, S9)

Defecto reportado por el propietario (L9, verbatim): `"los robots no parecen robots"`.
Verificación propia antes de cambiar nada (captura determinista, semilla fija, build real,
cámara bloqueada a 3,4 m de un enemigo vivo):

- La captura RED (antes) mostraba los tres tipos leídos como **personas con traje**: cabeza
  redondeada con una rendija tipo visor facial, muslos gruesos y caderas estrechas, brazos
  de tubo, pies pequeños y planos. El sentinel tenía un cuadrado emisivo de núcleo casi tan
  grande como el pecho (mancha, no sensor). Nada en la silueta decía "máquina".
- A ~10 m (captura `before-scout-far`) el scout quedaba reducido a una mancha oscura con
  dos puntos rojos: sin rasgo de clase legible.

### Contrato de silueta impuesto (fijado en tests/unit/robot-silhouette.test.ts)

Semántica de superficie dura, general y no copiada de ningún juego:

1. Placas de blindaje con cortes visibles entre ellas (dos planchas con separación, no una
   masa biselada continua). Coste controlado: solo las placas protagonistas llevan chaflán
   (`RoundedBoxGeometry` seg 1 = 108 tris); las cajas planas cuestan 12.
2. Visor angular con franja de ojo emisiva a todo lo ancho del casco (proporción franja
   `sx >= 11 cm`, `sy <= 7 cm`), nada de puntos de ojo separados ni boca: prohibido por
   test el parecido facial. La franja usa el camino de emisión existente (`aBlink` →
   `totalEmissiveRadiance` × 4.5) que alimenta el bloom ya presente; `reduceFlashes` y
   ajustes no cambian.
3. Núcleo pectoral o dorsal emisivo en cada torso (escala pequeña, punta de lectura).
4. Masa de hombros > masa de caderas en las tres clases (hombreras sobre la banda del
   torso; test: span de hombro − span de cadera > 4 cm).
5. Articulaciones expuestas como cilindros (6 segmentos, 24 tris c/u): eje de cadera,
   rodilla, tobillo, hombro y codo. La lectura "articulada" no depende del sombreado.
6. Piernas de máquina: muslo con pala frontal y actuador trasero, rodilla ancha, pie ancho
   con puntera hacia adelante.
7. Un rasgo dominante por clase (test fijado):
   - **scout**: asimetría — hombrera izquierda masiva + antena con baliza; cazador ligero.
   - **sentinel**: anchura — dos hombreras grandes, faldones en la cadera, cresta dorsal en
     el casco y reactor dorsal visible entre los hombros.
   - **interceptor**: navaja — torso estrecho y profundo, aletas dorsales gemelas y cuchillas
     largas desde la muñeca.

### Qué se conservó (restricciones de arquitectura)

- Un `InstancedMesh` por clase, pose-texture skinning (11 partes, `aPart`, textura de 44×32),
  un draw por tipo. Las piezas nuevas viven dentro del mismo rig: los cilindros se queman en
  la misma geometría y comparten `aPart`; el solver y las poses son byte a byte los mismos.
- Cero materiales por objeto, cero texturas nuevas en runtime, paleta y materiales de
  `surfaces.ts` intactos (`ROBOT_COLORS` sin cambios).
- `SENTINEL_MUZZLE` se recalcula del propio rig (sigue siendo exacto: el cañón no se movió).

### Medición (mismo método T1: build + `measure-frames --presets high --seconds 20 --viewport 1600x900 --dsf 2`)

| fila | fps | p50 | p95 | p99 | calls | tris |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| antes (`test-results/frames-t6a-before.json`) | 60 | 16.7 | 17.3 | 17.6 | 26 | 47.964 |
| después (`test-results/frames-t6a-after.json`) | 60 | 16.7 | 17.5 | 17.7 | 26 | 47.708 |

- Presupuesto T1+10 % (52.760 tris en high): cumplido con margen — el reemplazo de cajas
  biseladas por cilindros de articulación dejan los tris totales 256 **por debajo** del antes.
- Los tres rigs suman 5.448 tris de autoría (antes 6.084): scout 1.800, sentinel 1.956,
  interceptor 1.692.
- Capturas antes/después con cámara y semilla idénticas: `test-results/t6a/before-*.png` /
  `after*-*.png` (lineup de las tres clases de frente a ~4 m y ~10 m, y una toma de contexto
  de juego real). En las capturas después las tres clases se distinguen entre sí por silueta
  sin color: anchura del sentinel, asimetría del scout, cuchillas/aletas del interceptor.

### Validación (S9)

- `bunx vitest run tests/unit` → 456 passed (49 archivos), incluye el nuevo contrato de
  silueta y los pines existentes de rig/kind sin cambios.
- `bun run typecheck` → limpio. `bun run build` → limpio (722 ms).
- Controles y gameplay sin cambios: el pool, los estados de la FSM y la telegrafía son los
  mismos; la única diferencia es la geometría de autoría por clase.

### Recortado por presupuesto

- Chaflán seg-2 (300 tris) para las hombreras del sentinel: descartado por pasar de la
  placa protagonista al adorno (solo seg-1, 108 tris).
- Un cañón visual más largo en el rifle del sentinel: descartado para no desplazar
  `SENTINEL_MUZZLE` (el punto de mira del láser debe seguir siendo exacto).
- Rodillas/tobillos de doble eje: un solo eje de 6 segmentos por articulación (12 tris por
  articulación extra no justificado).
