# Checklist de accesibilidad

Las pautas de abajo son **referencias**, no una declaración de conformidad. Se usaron como lista
de verificación: Game Accessibility Guidelines (GAG), Xbox Accessibility Guidelines (XAG) y WCAG 2.2.
**Este proyecto no declara cumplir ninguna de ellas**; una auditoría formal con personas usuarias de
tecnologías asistivas sigue pendiente.

Estados: **cumple** (implementado y con una prueba o medición citada), **parcial**, **pendiente**,
**no aplica**.

## Visión

| Pauta | Estado | Evidencia o nota |
| --- | --- | --- |
| Contraste de texto 4.5:1 (WCAG 1.4.3) | cumple | `--text`, `--muted`, `--subtle`, `--primary` y `--danger` sobre `--bg`, `--surface-1` y `--surface-2`: `tests/unit/contrast.test.ts` calcula la razón sobre los tokens. `--subtle` estaba en 3.93:1 sobre `surface-2` y pasó a 4.86:1 |
| Contraste sobre `surface-3` | parcial | `--subtle` da 4.05:1 y `--danger` 4.36:1 sobre `surface-3`. No hay texto en esos pares hoy; la prueba no los cubre |
| No depender solo del color (WCAG 1.4.1) | parcial | Vida baja agrega el texto «! crítico» y munición baja un «!»; el minimapa distingue scout (círculo), sentinel (cuadrado) e interceptor (triángulo) y los terminales pendientes son cuadrados huecos. Las barras de terminales distinguen estados por relleno y el texto «(n/3)» acompaña. Los colores del HUD de vida y munición siguen siendo la señal primaria |
| Tamaño mínimo de texto del HUD | cumple | Piso de 11 px en `hud.css` (antes había 9 y 10 px) |
| Tamaño de texto configurable | pendiente | Existe la escala de HUD (80–140 %), no un ajuste de texto |
| Modos de daltonismo | pendiente | Solo las señales no cromáticas de arriba |
| Foco visible | pendiente de verificar | No se revisó en esta auditoría ni hay prueba automática del anillo de foco |

## Movimiento y destellos

| Pauta | Estado | Evidencia o nota |
| --- | --- | --- |
| Reducir movimiento (`prefers-reduced-motion`) | cumple | `reduceMotion` y la preferencia del sistema; apagan el destello de avance del tutorial y el pulso de terminales |
| Reducir destellos (WCAG 2.3.1 y 2.3.3) | cumple | Ajuste `reduceFlashes` (versión 3 de los ajustes): el pico del destello de daño baja de 0.9 a 0.25. `reduceMotion` y la preferencia del sistema lo implican. `tests/unit/hud-flash.test.ts`, `tests/unit/settings.test.ts` |
| Advertencia de destellos antes de empezar (`SPEC.md` §4.5) | pendiente | El juego no tiene destellos de más de tres por segundo, pero no hay aviso previo |

## Audio

| Pauta | Estado | Evidencia o nota |
| --- | --- | --- |
| Subtítulos | no aplica | No hay voz |
| Señales sonoras con equivalente visual | parcial | Daño: marcador direccional y destello. Recarga: barra y rótulo. Fin de recarga: solo sonido (`reloadEnd`). Avance de tutorial: sonido más destello |
| Control de volumen | cumple | Maestro, efectos e interfaz (`tests/unit/settings.test.ts`). No hay música, así que no hay canal de música |

## Control

| Pauta | Estado | Evidencia o nota |
| --- | --- | --- |
| Reasignar controles | pendiente | Diferido a propósito (función nueva) |
| Sensibilidad por dispositivo e inversión del eje Y | cumple | El deslizador de accesibilidad escribe solo la sensibilidad del dispositivo activo: `tests/unit/settings.test.ts` |
| Alternativas a mantener pulsado | parcial | La auto-recarga y la ayuda de puntería táctil existen; apuntar y activar terminales siguen siendo de mantener |
| Objetivos táctiles ≥44 px | cumple | `touch.css` bajo `#app.is-touch`; `tests/e2e/mobile-layout.spec.ts` mide botones de juego y de pausa en dos proyectos móviles |
| Mano dominante | cumple | Ajuste zurdo que espeja el cluster |
| Controles sin precisión milimétrica | parcial | Radio de terminal de 1.9 m; sin pruebas con usuarios |
| Uso con teclado en menús | parcial | Esc retrocede un nivel en lista de sectores, briefing, acerca de, tablero y calibración; la pausa abre con foco en Continuar. Las pestañas no usan roving tabindex |

## Cognición y guía

| Pauta | Estado | Evidencia o nota |
| --- | --- | --- |
| Tutorial omitible y repetible | cumple | Botón visible, repetible desde el menú |
| Texto del tutorial acorde al dispositivo | cumple | `tests/unit/tutorial.test.ts`, `tests/e2e/mobile-tutorial.spec.ts` |
| Confirmar acciones destructivas | cumple | Omitir el tutorial con Retroceso, Reiniciar y Salir al menú durante una partida piden una segunda pulsación |
| Indicar el objetivo | cumple | Marcador de rombo con distancia |
| Sin límites de tiempo en menús | cumple | |
| Tiempo para leer los avisos | parcial | El toast dura 2.2 s y es una región `aria-live="polite"`; no es configurable |

## Lectores de pantalla y estructura

| Pauta | Estado | Evidencia o nota |
| --- | --- | --- |
| La pausa es un diálogo modal | cumple | `role="dialog" aria-modal="true"`, foco en Continuar: `tests/e2e/a11y.spec.ts` |
| Mensajes dinámicos anunciados | parcial | `#toast` y el texto del panel del tablero son `role="status"`; el toast queda en el DOM aunque no tenga texto, para que el cambio se anuncie. Las pruebas comprueban atributos y estructura: **no se verificó con un lector de pantalla real** |
| Foco no se pierde al ocultar un control | cumple | Al ocultarse el formulario del tablero, el foco pasa al primer botón del pie |
| Trampa de foco dentro de la pausa | pendiente | El diálogo declara `aria-modal` pero no atrapa el Tab |
| Partida jugable con lector de pantalla | no aplica | Es un FPS en tiempo real; el HUD no se diseñó para lectura continua |

## Qué requiere una persona

- Prueba con usuarios de tecnologías asistivas y de baja visión.
- Revisión del anillo de foco en todas las pantallas.
- Prueba de fotosensibilidad con una herramienta como PEAT sobre una captura de video del destello de daño.
