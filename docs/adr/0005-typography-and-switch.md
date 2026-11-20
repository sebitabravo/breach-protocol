# ADR 0005 — Tipografía de sistema y switch sobre checkbox nativo

- Estado: aceptado
- Fecha: 2026-11 (flujo de campaña)
- Decide: el equipo de UI, siguiendo los mockups aprobados (ADR 0002)

## Contexto

Los mockups usan títulos sans geométricos y números en mono, y controles de
ajustes con switch en lugar de checkboxes del sistema. La versión anterior usaba
un stack mono para todo y `input[type=checkbox]` con el estilo azul del
navegador, lo que rompía la paleta y dejaba el foco visual inconsistente.

## Decisión

### Tipografía

- `--sans` (stack del sistema: `system-ui`, `-apple-system`, `Segoe UI`, `Roboto`,
  `Helvetica Neue`, `Arial`) para títulos, cuerpo y nombres de elementos.
- `--mono` para números, etiquetas en mayúsculas, datos del tablero y telemetría.
- Sin descargas de fuentes: cero requests de fuentes y cero bytes extra en el arranque.
  El costo es que el aspecto varía entre sistemas operativos; se acepta porque el
  presupuesto de carga (`docs/performance-budget.md`) pesa más que la fidelidad
  tipográfica exacta del mockup.
- `--pixel` deja de existir. Los números del HUD y del resultado usan `--mono`.

### Switch

- Cada switch es un `<input type="checkbox" role="switch" class="switch">` real.
  Así el estado, el foco por teclado y la lectura de pantalla salen del navegador.
- `appearance: none` quita el estilo nativo. El knob se dibuja con `background`
  (gradiente) y no con `::before`/`::after`, porque los pseudo-elementos de
  checkbox no se renderizan de forma uniforme entre motores.
- El foco visible usa `:focus-visible` con un anillo de 2 px del color primario.
- `disabled` atenúa el control y quita el cursor de acción.

### Movimiento

- `prefers-reduced-motion: reduce` anula animaciones y transiciones decorativas.
- El ajuste del jugador `reduceMotion` agrega `data-motion="reduce"` en `#app` y
  aplica la misma regla, para que el jugador no dependa del sistema operativo.

## Alternativas descartadas

- **Fuentes web (Inter, Geist, Space Grotesk):** agregan requests y bloquean el
  primer render si no llegan. Se descartan para el presupuesto de arranque.
- **Seguir con checkbox nativo y solo cambiar el color con `accent-color`:**
  `accent-color` no cambia la forma del control ni el foco, y el mockup pide un switch.
- **Switch con `<button role="switch">`:** funcionaría, pero el formulario de
  ajustes ya lee `input.checked`; cambiar el tipo de control obligaba a reescribir
  el enlace con el estado sin ganancia de accesibilidad.

## Consecuencias

- Los tests de UI no fijan colores ni fuentes; el contraste se revisa en las
  capturas del e2e (`tests/e2e/screens.spec.ts`).
- Cualquier fuente nueva debe justificar su costo de carga en esta ADR antes de
  agregarse.
