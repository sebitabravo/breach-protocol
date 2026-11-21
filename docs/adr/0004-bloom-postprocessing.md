# ADR 0004 — Bloom con postprocesado en medium y high

- Estado: aceptado
- Fecha: 2026-11 (pase de arte procedural)
- Decide: agente de arte, pendiente de revisión humana

## Contexto

- El renderer no tenía postprocesado. Las tiras emisivas del techo se leían
  como cajas planas: el look de los mockups (ADR 0002) pide glow.
- Presupuesto: ≤ 30 draw calls en `medium`, cero assets externos, 60 fps
  objetivo (`docs/performance-budget.md`).
- MSAA: el contexto WebGL se crea en `init()`, que corre antes del primer
  `setQuality`. El `antialias` que dependía del preset nunca llegaba a aplicarse.
  El canvas se crea con `antialias: false` y el suavizado vive en el target del
  composer.

## Decisión

- Cadena en `src/render/postfx.ts`: `RenderPass` → `UnrealBloomPass` →
  `OutputPass`. `OutputPass` va último para que la conversión a sRGB ocurra una
  sola vez. Los imports salen de `three/addons/postprocessing/*`.
- Bloom solo en `medium` y `high`. `low` renderiza directo al canvas, sin
  composer.
- MSAA 4× en el `WebGLRenderTarget` del composer (`samples: 4`, `HalfFloatType`).
  El canvas nunca tiene antialias. `low` no tiene suavizado.
- El composer se configura en cada `resize` y `setQuality`, con
  `setPixelRatio` explícito (el composer captura el pixel ratio al crearse).
  Al restaurar el contexto se reconstruye (`PostFx.rebuild`).
- Cadena de bloom de **3 niveles** en vez de los 5 por defecto (ver tabla).
  Los pesos de los niveles 4 y 5 se ponen en cero en `bloomFactors`; el shader
  no cambia.
- Contador de draw calls: `info.autoReset = false` y `info.reset()` una vez por
  frame. Con el reset automático, cada pase del composer borra el conteo del
  anterior y el número reportado era de un solo pase.

## Lo probado

| Variante | Pases de pantalla completa del bloom | Draw calls, medium, 1 robot | Veredicto |
| --- | ---: | ---: | --- |
| Sin composer (`low`) | 0 | 11–15 con 2–4 robots | sin glow; presupuesto mínimo |
| Bloom de 5 niveles (default) | 12 + output | 24 | 4 robots + halo + mira = 32: rompe el presupuesto |
| Bloom de 3 niveles (elegido) | 8 + output | 20 | 4 robots + halo + mira = 28: entra |

Los pases del bloom son fijos por frame; el costo de la escena escala con los
robots visibles, a dos draws cada uno (cuerpo y ojos).

Parámetros: `BLOOM = { strength: 0.35, radius: 0.35, threshold: 1.0 }`. Las tiras
del techo van a `stripIntensity` 2.0 (control) o 2.2 (cryo y archive), en HDR,
para pasar el umbral; las paredes y el piso quedan debajo.

## Costo

- Medium: `calls = 18 + 2 × robots visibles`, más 1 si hay halo de telegrafía y
  1 si hay línea de mira. Medido: 20 / 22 / 24 con 1 / 2 / 3 robots visibles, y
  26 con 4. El término del halo y el de la mira salen del código; no aparecieron
  en las muestras, porque ningún robot estaba en estado de telegrafía. Con
  4 robots más halo y mira daría 28.
- El tiempo de frame no se mide acá: SwiftShader no sirve para fps. El costo de
  fill rate del bloom a 1600×900 no está medido en hardware real. Pendiente.
- Memoria: el composer usa dos targets `HalfFloat` con 4× MSAA, al tamaño del
  canvas por DPR, más la cadena de bloom a mitad de resolución.

## Actualización (auditoría `fix/game-audit-pass`)

Medido en un Apple M3 con Chromium con ventana (`bun run bench:frames`,
1600×900 a DPR 2). Detalle en `docs/PERFORMANCE_REPORT.md`.

- La cadena de bloom no es de 3 niveles en todos los presets: `medium` usa **1**
  nivel (`trimBloomMips`) y `high` usa 3. `low` no tiene composer.
- El DPR efectivo ya no es solo el del preset: `playPixelRatio` lo acota por un
  presupuesto de píxeles del drawing buffer. Antes `high` no tenía tope: a
  1600×900 y DPR 2 el buffer era de 3200×1800 (5.76 MP; ~264 MB estimados para el
  composer) y bajaba a 44.7 fps con p95 de 34.5 ms. Con 3.5 MP (2494×1403, DPR
  1.56; ~160 MB) sostiene 60 fps con p95 de 18.2 ms, sin diferencia visible en
  una comparación de capturas a esa escala.
- La memoria de arriba es una **estimación** (`ancho × alto × 12 B × muestras`),
  no una lectura de la GPU.
- En headless con DPR 1 el costo de fill sigue sin decir nada de una GPU real;
  esas cifras se midieron con ventana.

## Por qué `low` no tiene bloom

- Sin composer no hay target HDR. El bloom necesita valores > 1 para
  distinguir una tira emisiva de una pared.
- `low` existe para dispositivos sin margen de fill rate. Un pase de bloom ahí
  es el costo que el preset está pensado para evitar.
- Queda como limitación documentada: en `low` las tiras se ven, pero sin halo.

## Tradeoff

- Los halos aditivos de las luminarias se eliminaron al pasar el arena a
  batches: el bloom los reemplaza en `medium` y `high`. En `low` las luminarias
  son más chicas.
- El fondo del menú (órbita) se ve más oscuro: los halos se veían desde arriba y
  eran parte del fondo. Aceptado; el overlay del menú lo tapa en gran parte.
- El bloom de 3 niveles tiene un radio de glow más corto que el de 5. Se
  compensa con `radius` y `strength`, no con más pases.
- Con `devicePixelRatio` 1 (headless) el preset `medium` renderiza a DPR 1, no a
  1.5. Las cifras de draw calls no dependen del DPR; el costo de fill sí.

## Consecuencias

- `tests/e2e/resilience.spec.ts` pasa con el composer. Además, tras
  `loseContext` + `restoreContext`, el conteo se sostiene (18 calls por frame)
  y no hay errores de consola.
- Un cambio de preset a `low` deshace el composer (`dispose`); volver a
  `medium` lo crea de nuevo.
- Medir en hardware real queda pendiente antes de subir el bloom a 5 niveles o
  de subir MSAA a 8×.
