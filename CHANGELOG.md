# Changelog

## Sin publicar

- El menú aparece antes de cargar Three.js. La arena orbital se incorpora al
  terminar la carga; si se pulsa Jugar antes, se muestra el progreso y se entra
  sin volver a pulsar. El build de producción ya no incluye sourcemaps.

- El tutorial pausa el Simulador al terminar y muestra un resumen con tiempo y
  tres opciones: iniciar una misión, seguir practicando o volver al menú. Omitir
  el tutorial lleva a las mismas opciones, sin el resumen.

- Completar una terminal adelanta una oleada (o llama refuerzos al tope) sin
  borrar enemigos vivos ni pendientes. Hay 1 s de gracia y un aviso en el HUD.
  En Overflow las terminales ya no se rearman. Replay y puntuación pasan a v3.

- La esclusa de presión 07 orienta el carril norte de SECTOR_01: puerta segmentada,
  hidráulica, pasarela, manómetros y balizas ámbar. El acero pintado y expuesto,
  polímero, caucho y vidrio se comparten entre escenografía, consolas y armas.
- Los disparos dejan picaduras y expulsan casquillos; el fuego sostenido produce
  humo y ondulación. Las bajas sueltan chispas y las activaciones un anillo menta.
  Efectos acotados por lotes, sin cambiar la colisión ni la simulación.
- Menú, briefing, juego y resultados tienen transiciones breves; pausa y resultados
  comparten jerarquía de secciones. La vida destella al recibir daño y el marcador
  de impacto reacciona al acertar. El movimiento reducido desactiva las transiciones.

- Las terminales de red tienen teclado, palanca, cableado y baliza. La pantalla y
  el anillo de la mira muestran el progreso; un candado y la barra completa
  confirman la activación. La colisión no cambia.

- Un rombo sobre la terminal objetivo y una flecha de borde indican dónde ir.
  El tutorial señala una terminal concreta y el marcador cambia a mantener E/Ⓔ
  al acercarse. Respeta el movimiento reducido.

- SECTOR_01 usa materiales PBR de Poly Haven, iluminación HDR y un acabado húmedo.
  Piso sin brillo central y HUD del simulador sin etiqueta duplicada, con un
  degradado superior de mayor contraste.
- El arma y su destello se dibujan sobre la arena con profundidad propia: ya no
  desaparecen al pegarse a una pared. El arma se recoge suavemente al acercarse,
  también en ADS. La trazadora, los casquillos y los impactos quedan en la arena.
- PB-01, AR-04 y SG-08 tienen siluetas procedurales propias, metal biselado,
  estarcidos y piezas que responden al disparo. Conservan el encuadre, poses y
  animaciones de cámara, con destello y trazadora anclados al cañón. Los GLB
  Kenney siguen disponibles con `?viewmodel=kenney`.
- La flecha de daño sigue el origen del impacto durante 54 ticks de simulación,
  incluso si se renderizan cuadros sin avanzar la partida.
- F3 actualiza todos los números de Engineering al abrirse, incluso en pausa.

- Cambiar de arma conserva su cargador y reserva. El registro y el puntaje pasan a v2.
- Overflow exige 60 ticks simulados y una baja o la muerte del operador. Los registros
  al tope de ticks se pueden enviar y se puntúan sobre el prefijo verificado.
- Los nombres de clasificación conservan los acentos y se rechazan si no cumplen el
  contrato, en vez de recortar caracteres inválidos o truncar el nombre.
- Tutorial accesible por teclado y separado del HUD en pantallas angostas; al
  reanudar o recuperar el puntero, el foco vuelve a la arena.
- La SG-08 tiene sonido propio. Los registros con SG-08 habilitada no se envían
  al tablero porque el desbloqueo no es verificable en un solo registro.
- Overflow genera toda la composición de cada oleada sin ampliar el tope de
  enemigos simultáneos. Resultados informa si solo cuenta el prefijo de 20 min.

### Conocido

- Las habilidades Q/E/F quedan diferidas; E conserva la interacción con terminales.

## 0.2.0 — 2026-11-20

### Agregado

- Tres sectores en Rust (`core/src/maps.rs`) con tests de invariantes y alcanzabilidad:
  Control de Acceso, Refrigeración y Archivo (pasarela elevada con terminal).
- Enemigo Interceptor (flanqueo, telegrafía visible en el snapshot, embestida) y arma
  SG-08 Scatter (8 perdigones, caída por distancia).
- Modos Overflow (infinito), Protocolo diario (semilla = fecha UTC, mutadores) y
  Simulador con tutorial de 3 acciones.
- Registro de inputs cuantizados y re-simulación (`core/src/replay.rs`); ABI de paso
  fijo (`bp_start`, `bp_tick_fixed`). Tests de determinismo nativo vs wasm con hashes
  fijados.
- API de clasificación en Rust para Vercel (`api/`, `server/`) con Upstash y
  verificación por replay; cliente en `src/net/`. Ver ADR 0003 y `docs/api-contract.md`.
- Pasada de arte procedural: texturas, temas por sector, bloom (media/alta), robots y
  viewmodels reconocibles, decoración de mundo.
- Menú, selección de sector, briefing, resultados con tablero, clasificación, progreso
  versionado en `localStorage`, HUD según mockups, marcadores de impacto y dirección
  de daño, tipografía `--sans` y componente switch.
- Recuperación de pérdida de contexto WebGL y `pointerlockerror` sin pausar.
- CI: runners fijados a ubuntu-24.04, caché de Rust, `fmt`, `clippy -D warnings`,
  workflow de la API, artefactos del e2e al fallar.

### Corregido

- Esc en Ajustes abiertos desde el menú ya no entra a una partida inexistente.
- `startMatch` guardaba mal el modo: reiniciar el Simulador arrancaba un run con tiempo.
- Teclas mantenidas durante una pausa quedaban muertas al reanudar (auto-repeat).
- Interpolación de cámara: avanzaba a 60 Hz en vez de interpolar entre ticks.
- Chispas y trazadores se congelaban (buffers sin `needsUpdate`).
- Fuga de geometría y material del visor de los robots al cambiar de tipo.
- Una partida reiniciada divergía de una nueva: quedaba estado viejo del ring de
  eventos (hallado al comparar la partida en vivo con su replay).
- `hits` contaba por perdigón y la precisión podía superar 1.
- Una composición de oleada mayor que la cola hacía girar `Waves::begin` para siempre.
- Disparos por eventos de mouse de compatibilidad en táctil; modo táctil de una sola vía.
- La fórmula trascendente pasa por `libm`: `f32::sin` difiere 1 ulp entre nativo y wasm.

### Conocido

- Pointer lock: ruta feliz sin verificación automática.
- El servidor no se probó contra Vercel/Upstash reales.

## 0.1.0 — 2026-11-20

Vertical slice jugable de SEBITA: BREACH PROTOCOL.

### Agregado

- Núcleo de simulación en Rust (`core/`, crate `bp-core`, solo std, sin
  dependencias) compilado a WebAssembly: jugador, arena SECTOR_01, hitscan
  (PB-01 y AR-04), FSMs deterministas Scout/Sentinel, oleadas, terminales,
  fases y puntaje. Simulación determinista a 60 Hz con RNG con semilla.
- Shell TypeScript + Three.js: render con instancing, HUD en DOM, Engineering
  Mode con métricas reales (FPS, p50/p95, draw calls, triángulos, ticks,
  calidad, DPR), pantallas de boot/calibración/menú/pausa/resultados y
  fallback recuperable si falta WebGL2.
- Contrato binario Rust↔TS sin wasm-bindgen: snapshot de 620 floats leído sin
  copiar sobre la memoria de wasm, pineado por tests en ambos lados.
- Input de escritorio (pointer lock, teclado) y multitouch real con
  `pointerId` por control.
- Audio sintetizado con Web Audio (sin archivos) y ajustes persistentes
  versionados con migración (sensibilidad, invertir Y, escala del HUD,
  lateralidad, calidad, audio, movimiento reducido).
- Récord local por modo e input con grados (S/A/B/C/D).
- Tests: 66 de cargo para las reglas de simulación, suite Vitest para los
  módulos TS puros (ajustes, puntajes, controlador de calidad, loop, layout,
  protocolo) y smoke test de Playwright que arranca el juego en Chromium y
  prueba que la simulación avanza sin errores de consola.
- CI en GitHub Actions: job de Rust (cargo test + build wasm) y job web
  (typecheck, unit, build, e2e) sobre Node 22.
- Documentación: README, arquitectura, presupuesto de performance medido, dos
  ADRs (núcleo Rust/WASM; dirección visual según mockups), avisos de terceros
  y licencia MIT.
