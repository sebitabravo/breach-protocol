# Avisos de terceros

## Dependencias de código

| Componente | Uso | Licencia |
| --- | --- | --- |
| [three.js](https://threejs.org) | rendering 3D | MIT |
| [Vite](https://vite.dev) | bundler y dev server | MIT |
| [TypeScript](https://www.typescriptlang.org) | lenguaje / compilador | Apache-2.0 |
| [Vitest](https://vitest.dev) | tests unitarios | MIT |
| [Playwright](https://playwright.dev) / `@playwright/test` | tests e2e | Apache-2.0 |
| [@types/three](https://www.npmjs.com/package/@types/three) | tipos de three.js | MIT |

Correcciones sobre las licencias: TypeScript y Playwright se distribuyen bajo
Apache-2.0; el resto de las herramientas web listadas, bajo MIT. Los textos
completos de cada licencia acompañan a cada paquete en `node_modules/<paquete>/LICENSE`.

## Crates de Rust

El núcleo de simulación (`core/`, crate `bp-core`) **no usa ningún crate de
terceros**: solo la librería estándar de Rust. Por lo tanto no hay licences de
crates que reportar y la superficie de proveniencia del wasm es completa.

## Assets del juego

**No se usa ningún asset de terceros.** Toda la geometría (arena, cobertura,
enemigos, armas, retícula), las texturas (generadas por canvas/procedural) y
el audio (SFX sintetizados en runtime con Web Audio) son procedurales y
originales de este repositorio. No hay descargas, no hay fonts comerciales
embebidas (la tipografía se resuelve con una pila de fallback documentada,
pendiente de revisión de licencia), y no hay dependencia en runtime de
sebita.dev.

## Tokens de diseño

Los tokens visuales (paleta azul-negra, acento menta, acento de peligro) fueron
derivados de los mockups entregados por el humano dueño del proyecto. **No**
fueron copiados de sebita.dev ni de ningún otro sitio. Ver
`docs/adr/0002-visual-direction.md`.
