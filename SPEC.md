# SEBITA: BREACH PROTOCOL

> **Game Design Document (GDD) + Technical Design Document (TDD) + plan de implementación**  
> **Proyecto:** `https://game.sebita.dev`  
> **Autor / marca:** Sebastián Bravo · sebita.dev  
> **Edición:** 1.0 · 20 de noviembre de 2026  
> **Estado:** propuesta técnica y de producto; **no** describe un juego ya implementado.  
> **Plataformas obligatorias:** navegadores de escritorio y móviles Android/iOS.  
> **Propósito central:** demostrar ingeniería de software mediante un FPS web completo, medible y defendible en entrevistas de trabajo.

---

## 0. Cómo leer este documento y decisiones inamovibles

Este documento es el **contrato inicial del producto**. Las cifras de tamaño, duración y rendimiento son **objetivos de diseño que deben comprobarse**, no benchmarks obtenidos ni garantías universales. Las dependencias se fijarán en versiones exactas al iniciar el repositorio; no copiar versiones antiguas de ejemplos.

**Requisitos no negociables:**

1. **Jugable en PC y móvil desde el navegador**, sin instalación ni registro obligatorios. Teclado + mouse y multitouch deben ser experiencias reales, no una adaptación superficial.
2. **Mismo lenguaje visual de `sebita.dev`**: sistema *Resolución*, paleta y tipografías verificadas en su código; cambios en el portafolio se deben sincronizar de manera consciente.
3. **Rendimiento primero**: carga pequeña, calidad adaptable, telemetría local, pruebas en teléfonos físicos y degradación explícita para dispositivos débiles.
4. **Calidad de ingeniería observable**: módulos pequeños, código TypeScript estricto, pruebas, mediciones reproducibles, CI/CD y documentación de decisiones.
5. **Un juego divertido antes que muchos sistemas**: una arena, una partida corta y un ciclo de combate satisfactorio. No comenzar con multijugador, microservicios, cuentas ni mundos abiertos.
6. **Assets con origen y licencia registrada**. Usar material propio o CC0 preferentemente. Nunca extraer modelos, audio, mapas o marcas de juegos comerciales.
7. **Accesibilidad y control**: remapeos, sensibilidad, reducción de movimiento, audio opcional, pausa y ajuste de calidad desde el juego.

**Definición de éxito:** una persona llega desde el portafolio, entiende qué hacer en menos de un minuto, juega una ronda en el móvil o PC, ve su resultado y puede entrar al *Engineering Mode* para entender las decisiones técnicas. Un reclutador puede evaluar una demo y abrir un repositorio de código serio.

---

## 1. Investigación: qué podemos afirmar y qué no

### 1.1. `sebita.dev`: la fuente de verdad de la identidad

Repositorio: https://github.com/sebitabravo/portfolio  
README: https://github.com/sebitabravo/portfolio#readme  
Tokens visuales: https://github.com/sebitabravo/portfolio/blob/main/src/styles/tokens.css  
Entrada de estilos: https://github.com/sebitabravo/portfolio/blob/main/src/styles/resolucion.css

**Hechos verificados:**

- Sitio construido con **Astro 7**, **TypeScript estricto**, HTML/CSS/JS nativos, contenido MDX y generación estática; despliegue en Vercel detrás de Cloudflare según el README consultado.
- Sistema visual propio llamado **Resolución**: tipografía pixel para destacados, **Geist Mono** para lectura, grilla de 8 px, monocromía, animaciones con `steps()` y modo oscuro predeterminado.
- Utiliza **GeistPixel-Square.woff2**, variantes pixel especiales y **GeistMono-Regular/Medium.woff2**, alojadas en `public/fonts`.
- Tiene tests con **Vitest** y **Playwright** y controles de tamaño/CSP en su build. El sitio principal preserva fallback y rendimiento mediante CSS y JS nativo.

**Consecuencia:** el juego **no debe importar todo Astro para renderizar el FPS**. Debe tener una aplicación independiente, pero compartir visualmente tokens CSS, fuentes **respetando su licencia** y componentes de diseño equivalentes. Mantener una referencia de commit/fecha de los tokens sincronizados.

### 1.2. `halloween.dev`: inspiración de experiencia, no plantilla de código

Sitio: https://halloween.dev/  
Repositorio proporcionado: https://github.com/midudev/halloween-issues

- La web consultada se presenta como **The Last Deploy**, una experiencia de terror para desarrolladores que comienza con una premisa narrativa y un aviso de soporte de navegador, audio y efectos intensos.
- El repositorio `halloween-issues` dice expresamente que **no aloja el código del juego**, solo incidencias. Por ello **no se puede certificar su motor, arquitectura, tamaño de bundle ni FPS** a partir de ese repositorio.
- Sus buenas ideas transferibles son **identidad fuerte, entrada inmediata, narrativa compacta, pantalla de compatibilidad, sonido opcional y presentación cuidada**.
- **No es una referencia equivalente de diseño de FPS**: tomamos su tratamiento de experiencia web y lo complementamos con proyectos de shooters abiertos.

**No prometer:** «usaremos el mismo motor que halloween.dev» ni «tendremos sus mismos FPS». Esas afirmaciones necesitan acceso al código real o un benchmark propio con metodología comparable.

### 1.3. Otros juegos FPS web investigados

| Referencia | Qué muestra la fuente | Qué aprender / qué no copiar |
|---|---|---|
| [Tembaku](https://github.com/wafley/tembaku) | FPS sci-fi en Three.js + TypeScript + Vite; controles desktop/mobile, máquinas de estado, paso fijo, object pooling, oleadas y HUD. | Buen ejemplo de organización e inputs multiplataforma. No copiar código/assets sin revisar su licencia concreta. |
| [ECHELON Mobile FPS](https://github.com/Cyberpunk0070/echelon-mobile-fps) | Describe controles multitouch con `pointerId` y captura por dedo, HUD editable, render con instancias y resolución adaptable. | Muy útil para evitar botones que no funcionan al mover y disparar simultáneamente. Las cifras de FPS de su README son **autodeclaradas**; no son nuestro benchmark. |
| [Voxel Ops FPS](https://github.com/SiddharthaVarshney/voxel-ops-fps) | FPS de oleadas en Three.js, marcador local y joystick/cámara/botones táctiles. | Referencia para alcance pequeño y jugabilidad móvil. |
| [Neon Doom Pit](https://github.com/PaulAtkins88/neon-doom-pit) | Prototipo compacto con Vite + TS + Three.js, una arena y un game loop acotado. | Un *vertical slice* pequeño permite iterar mejor que un proyecto inflado. |
| [Poki: elección de motor web](https://developers.poki.com/guide/web-engine) | Explica opciones web como Three.js, Babylon.js y PlayCanvas y consideraciones táctiles y de distribución. | La elección de motor debe responder a capacidades del equipo, no a popularidad. |

### 1.4. Conclusión de la investigación

Elegimos **Three.js + TypeScript + Vite**, entrada y UI nativas, física de personaje simple y API separada solo al necesitarla. Es un buen equilibrio entre control de la carga, transparencia del código y valor laboral. **No afirmamos que Three.js sea universalmente el motor con más FPS**; el rendimiento final depende de escena, assets, sombras, resolución, JS, GPU y dispositivo.

---

## 2. Visión del producto y posicionamiento profesional

**Nombre:** SEBITA: BREACH PROTOCOL  
**Tagline:** *La red cayó. Queda una última conexión.*  
**Género:** FPS arcade 3D, supervivencia por oleadas con microobjetivos de recuperación de sistemas.  
**Modelo:** juego web gratuito, un jugador, partidas de **3 minutos** por defecto, con modos de accesibilidad y sin anuncios.  
**Audiencia:** personas que disfrutan shooters y desarrolladores/reclutadores curiosos por una demo técnica.

### 2.1. Historia mínima

Eres un operador dentro de una instalación de simulación de redes. Un sistema de defensa automatizado identificó a todos los procesos como intrusos. Debes mantenerte con vida, recuperar tres nodos de red y extraer un registro final antes de que termine la ronda.

La ficción aporta significado a los objetivos, sin obligar a crear cinemáticas ni diálogos largos. *Breach Protocol* **no es un simulador real de ciberseguridad**: el vocabulario técnico ambienta una experiencia arcade, y no debe confundirse con un tutorial de intrusión.

### 2.2. Pilares de diseño

1. **Sensación de disparo:** respuesta inmediata, impactos claros y audio legible.
2. **Movimiento accesible:** dominarlo ayuda, pero el juego no castiga a quien usa pantalla táctil.
3. **Partidas cortas:** se puede jugar desde el teléfono en una pausa.
4. **Identidad editorial:** interfaz *Resolución*, sobria, no un «HUD gamer neón» genérico.
5. **Ingeniería demostrable:** un modo técnico muestra métricas reales y arquitectura comprensible.

### 2.3. Objetivos profesionales y evidencias

| Capacidad demostrada | Evidencia verificable |
|---|---|
| TypeScript y diseño modular | Dominios desacoplados, interfaces, tests de reglas, documentación ADR. |
| Algoritmos y matemáticas | Trayectorias/collisions, raycasts, interpolación, FSM y determinismo parcial. |
| Frontend y UX | UI adaptable, menús accesibles, teclado, Pointer Events multitouch. |
| Optimización | Perfilado de CPU/GPU, presupuestos, mediciones por dispositivo, comparativas antes/después. |
| Ingeniería de calidad | CI, pruebas unitarias, E2E, compatibilidad y pruebas manuales móviles. |
| Backend (fase posterior) | API Fastify, validación, persistencia y seguridad sin exagerar antitrampas. |
| Producto | Demo navegable, onboarding, documentación y experiencia coherente. |

---

## 3. Diseño del juego: funcionamiento completo

### 3.1. Bucle principal de usuario

`Abrir game.sebita.dev → comprobar soporte → menú → calibrar si es primera visita → jugar → disparar/evadir → recuperar nodos → sobrevivir → resumen → reintentar / compartir / ver ingeniería`.

**Entrada sin fricción:** «Jugar» permite empezar como invitado. No correo, login ni consentimiento de analíticas como requisito. Configuración sensible a teclado/mouse o táctil, sin asumir el dispositivo solo por el user-agent.

### 3.2. Modos

- **Protocol Run — MVP:** ronda de 3:00 min, oleadas finitas, objetivo de activar nodos mientras sobrevives. Un mapa.
- **Practice Range — MVP:** espacio simple, blancos estáticos y móviles, sin daño ni límite; usado para enseñar controles y calibración táctil.
- **Endless Survival — P2:** oleadas infinitas y récord local.
- **Daily Protocol — P3:** desafío diario con semilla de escenario, reglas iguales; no anunciar rankings verificables sin anti-cheat serio.

### 3.3. Mecánica principal y condición de victoria

En `Protocol Run`, aparecen tres terminales en distintas zonas. Para ganar:

1. Activar **3 nodos**: acercarse a distancia corta (p. ej., 1,8 m) y mantener `E` / botón táctil durante **1,2 s**, interrumpido si se aleja o recibe un impacto fuerte (valores ajustables tras playtests).
2. Sobrevivir hasta extracción o llegar al momento final con vida.
3. Completar antes de **180 s**, o perder por quedarse sin salud o agotar el tiempo.

Cada activación informa progreso mediante UI, sonido y una señal de mundo. Los terminales **no abren pantallas de texto durante el combate**: la interacción dura poco. Se desactivan disparos durante el canalizado solo si pruebas de juego muestran que mejora la decisión táctica.

**Dificultad:** principiante por defecto. Escalar principalmente con número/velocidad de enemigos y tiempos de reacción, sin trucos injustos como disparos imposibles de esquivar.

### 3.4. Arena MVP: `SECTOR_01 / CORE ROOM`

- Mapa compacto de referencia: ~**36 × 36 m** en unidades de juego (hipótesis inicial, a iterar).
- Planta cuadrada con columna central, 4 coberturas grandes, rutas laterales y 3 terminales visibles o señalizadas.
- Alturas sencillas y máximo dos niveles si no perjudica la navegación táctil.
- Arquitectura modular industrial minimalista, sin texturas realistas caras.
- Colisión optimizada con geometría simplificada **distinta del renderizado**.
- Iluminación legible: evitar que enemigos oscuros se pierdan sobre fondo oscuro; destacar siluetas por material/valor, no solo color.
- Spawn de enemigos fuera del campo inmediato del jugador, distancia mínima segura, telegráfico y sin teletransportes delante de la cámara.

### 3.5. Enemigos MVP

| Enemigo | Comportamiento / estados | Riesgo | Señal previa |
|---|---|---|---|
| **Scout** | Patrol → Detect → Chase → Attack → Recover → Dead | Persigue a corta distancia, poca salud. | Luz/sonido antes de atacar. |
| **Sentinel** | Idle → Scan → Aim → Burst → Cooldown → Dead | Dispara ráfagas con línea de visión, se queda más lejos. | Marcador de fijación y retardo de reacción. |
| **Interceptor** | Flank → Position → Charge → Attack → Retreat | Se desplaza lateralmente y presiona al jugador. | Sonido de carga y cambio visible de postura. |

**MVP realista:** empezar **solo con Scout**, agregar Sentinel al segundo hito e Interceptor al tercero. Nada de aprendizaje automático o LLM: **máquinas de estados y reglas deterministas** son más estables, baratas y explicables.

**AI tick:** comportamiento complejo a frecuencia inferior al render (p. ej., 10–15 Hz), movimiento suavizado en el paso fijo. Visibilidad y búsqueda espacial con límites por frame; los enemigos fuera de rango/del plano se actualizan menos si los tests confirman que no rompe la jugabilidad.

### 3.6. Armas

| Arma | Rol | Mecánica |
|---|---|---|
| **PB-01 Sidearm** | MVP, arma de inicio | Semiautomática, precisa, cargador corto, hitscan. |
| **AR-04 Carbine** | P1 | Automática, retroceso recuperable, ráfagas sostenidas, hitscan. |
| **SG-08 Scatter** | P2 | Escopeta de corto alcance con varios raycasts por disparo. |

**Reglas:** cadencia/daño/munición en archivos de datos; caída de daño opcional en P1. Retroceso visual y jugable limitado. No usar armas o logotipos reales. El disparo debe mantener percepción inmediata incluso con ping inexistente (simulación local).

### 3.7. Movimiento y combate

- **Cámara primera persona** con FOV configurable y límites de pitch.
- Caminar, correr, saltar; **sin agacharse, deslizarse, doble salto ni parkour en MVP**.
- Gravedad y suelo estables, colisiones sin atravesar paredes ni saltos dependientes de FPS.
- Disparo `hitscan` mediante raycast para pistola y rifle; efectos visuales son cosméticos y pueden omitirse en modo bajo.
- Hitboxes de enemigos ajustadas visualmente; disparo de prueba para validar coincidencia de impacto.
- Indicadores de daño discretos, barra de salud, contador de munición, nodos y temporizador.
- Recarga manual y automática opcional; sin una animación larga que impida la interacción en móviles.

### 3.8. Puntuación, derrota y progresión

Puntuación **orientativa**, configurable y versionada:

`score = 100 × enemigos_eliminados + 500 × nodos_activados + bonus_tiempo + bonus_precision − penalizacion_dano`.

- No usar la precisión como única señal de habilidad: en móvil hay ayudas opcionales.
- Guardar **récord local** y mejores partidas en almacenamiento del navegador; sin dependencia de red.
- Mostrar resumen: victoria/derrota, enemigos, precisión, daño recibido, nodos, tiempo, puntuación, tipo de control y preset de dificultad.
- **Separar categorías de resultados** por modalidad/input/ayudas para que una comparación futura sea honesta.
- El leaderboard global se incorpora después del juego estable y etiqueta claramente entradas no verificadas si es necesario.

### 3.9. Tutorial y onboarding

En la primera visita: intro opcional de 10–20 segundos, pantalla de controles detectados y **tutorial interactivo de 3 acciones**: moverse, apuntar/disparar, activar terminal. Botón visible «Omitir tutorial»; permitir volver al campo de práctica desde menú.

No usar bloques de texto largos. En móvil, practicar **dos dedos simultáneos** en el tutorial es obligatorio. Preferir ejemplos de acción a explicaciones.

---

## 4. Controles multiplataforma: requisito crítico

### 4.1. Desktop

| Acción | Por defecto | Personalizable |
|---|---|---|
| Mover | WASD / flechas | Sí |
| Apuntar | Mouse, Pointer Lock | Sensibilidad / invertir eje Y |
| Disparar | Click izquierdo | Sí |
| Recargar | R | Sí |
| Saltar | Espacio | Sí |
| Correr | Shift | Sí |
| Interactuar | E | Sí |
| Pausar | Esc | Mantener Esc |
| Engineering Mode | F3 o botón de menú | Sí |

**Pointer Lock**: solicitarlo **solo tras gesto explícito** de usuario, liberar al pausar/perder foco y mostrar «Haz clic para continuar» cuando el navegador lo rechace. No iniciar en bucle peticiones sin interacción.

### 4.2. Móvil táctil: dos pulgares y multitouch real

**Orientación preferida: horizontal (landscape).** El juego también debe disponer de un **modo vertical compacto jugable** o alternativa funcional comprobada, sin asumir que el navegador permite bloquear la orientación. Si la experiencia vertical no cumple el mínimo de control, mostrar sugerencia de rotación **sin bloquear el inicio**, y rediseñar controles antes de lanzar.

- **Zona izquierda**: joystick flotante/fijo para movimiento. Radio y sensibilidad calibrables. Empujar hacia borde para correr de forma opcional.
- **Zona derecha**: arrastrar dedo libre para girar cámara y apuntar.
- **Botón FIRE** grande: mantener para disparo automático o tocar para semiautomática; permitir **apuntar con otro dedo al mismo tiempo**.
- **JUMP, RELOAD, INTERACT**: botones próximos al pulgar derecho sin ocultar enemigos ni terminales.
- **PAUSA** arriba y fuera de la zona de disparo; accesible con safe-area.
- **Opción móvil** de auto-recarga y ayuda de puntería leve, documentada y desactivable; nunca corregir la cámara de forma brusca ni disparar solo.
- **HUD editable P2**: tamaño/posición y modo zurdo. **MVP**: dos layouts fijos, diestro/zurdo, y escala 80–140%.

**Implementación obligatoria:** `Pointer Events` con registro `pointerId` independiente por control, `setPointerCapture()` por elemento, manejo de `pointerup`, `pointercancel`, `lostpointercapture`, cambio de visibilidad y rotación de pantalla. **No implementar multitouch usando solo eventos `click`**. `touch-action: none` **únicamente** sobre superficie de juego/zonas de control para no romper navegación y menús del sitio.

**Objetivos ergonómicos (verificar en dispositivos físicos):** botones principales ≥48 CSS px, espaciado suficiente, sin contacto involuntario con bordes del sistema, áreas ampliadas según dedos, opacidad adaptable; respetar `env(safe-area-inset-*)` y cambios del viewport por barras del navegador.

### 4.3. Pantalla completa y rotación

Intentar Fullscreen y `screen.orientation.lock('landscape')` **solo si las APIs están disponibles y desde una acción permitida**. Safari/iOS u otros navegadores pueden limitarlo. Nunca hacer que el juego dependa de que ambas llamadas tengan éxito; proporcionar UI adaptable. Mantener `playsinline` si hubiera video introductorio.

### 4.4. Pausa y recuperación de foco

- `visibilitychange`, `blur`, `pagehide`: detener simulación, silenciar/atenuar audio, limpiar controles y pausar la partida.
- Al volver: menú de reanudación; **no avanzar 20 segundos de simulación acumulada**.
- Recuperar contextos WebGL si es posible; si no, mostrar error recuperable y reinicio sin perder preferencias.
- Al rotar móvil: recalcular viewport y zonas táctiles, liberar dedos previos y permitir continuar sin movimiento «pegado».

### 4.5. Accesibilidad

- Sensibilidad y eje Y, escala HUD, subtítulos de señales importantes, contraste legible y menú con teclado.
- Preferencia `prefers-reduced-motion` reduce sacudidas de cámara, flashes decorativos y transiciones; **no altera señales jugables esenciales**.
- Alternativa a avisos exclusivamente sonoros mediante texto/icono.
- En móvil, el juego se puede controlar sin precisión milimétrica; la interacción de nodos tiene área generosa.
- Mostrar advertencia de destellos antes de iniciar si efectivamente existen y ofrecer desactivarlos; evitar flashes intensos de entrada.
- El menú debe mantener foco visible, navegación comprensible y tamaño de texto accesible.

---

## 5. Diseño visual: copiar fielmente la identidad de `sebita.dev`

### 5.1. Fuente de verdad y política de sincronización

**Archivo original:** `portfolio/src/styles/tokens.css` del repositorio público. Los valores siguientes se extrajeron de ese archivo el 20/11/2026. La documentación de game debe guardar el commit original al integrar. **Si cambian los tokens del portafolio, revisar el contrato visual y sincronizar con pruebas.**

| Token Resolución | Oscuro (por defecto) | Claro |
|---|---|---|
| `--bg` | `#000000` | `#ffffff` |
| `--fg` | `#ffffff` | `#000000` |
| `--fg-muted` | `#a1a1a1` | `#5c5c5c` |
| `--fg-faint` | `#8a8a8a` | `#6b6b6b` |
| `--line` | `#262626` | `#e5e5e5` |
| `--fill` | `#141414` | `#f2f2f2` |

**Tokens adicionales reales:** `--gutter: 16px`, `--page: 90rem`, `--header: 64px`, `--dist: 8px`, `--fs-body: 15px`, `--fs-small: 13px`, `--t-feedback: 80ms steps(4,end)`, `--t-enter: 480ms steps(8,end)`; el gutter puede cambiar en desktop según media queries del portafolio. **No inventar otros valores como si fueran originales.**

**Fuentes existentes:**

- Encabezados/wordmark: `Geist Pixel` → `/fonts/GeistPixel-Square.woff2`.
- Texto, controles y datos: `Geist Mono` → `/fonts/GeistMono-Regular.woff2` y `/fonts/GeistMono-Medium.woff2`.
- Variantes decorativas (`GP Line`, `GP Triangle`, `GP Grid`, `GP Circle`) **solo bajo demanda**, no cargarlas en el boot si no se necesitan.
- Usar `font-display: swap`/fallback compatible para texto; no dejar texto crítico invisible esperando tipografía decorativa.

**Licencias de fuentes:** tomar **únicamente archivos y usos cuya licencia se haya verificado en su distribución original**. Este documento **no redistribuye fuentes**; copiar desde repositorio propio solo después de verificar permisos y atribuciones aplicables. Se puede registrar en `THIRD_PARTY_NOTICES.md`.

### 5.2. Guía visual

- **Monocromía predominante**: negro, blanco y grises exactos arriba. No sustituir por azules/teal/neón tipo cyberpunk.
- **Color de peligro**: permitir un acento semántico limitado y documentado **solo para aviso de daño, amenaza y accesibilidad**, sin cambiar identidad principal. Validar contraste, idealmente con formas/textos redundantes.
- Marcos finos (`--line`), superficies `--fill`, grid de 8 px, numeración/etiquetas técnicas, tipografía pixel para títulos cortos y mono para lectura.
- Motion con `steps()` y transiciones discretas, apagadas en preferencias de reducción de movimiento.
- El **mundo 3D**: instalación industrial low-poly de tonos carbón, gris, blanco roto; superficies visibles sin depender de sombras caras. Los enemigos deben distinguirse claramente del escenario.
- No importar capturas de `halloween.dev` ni reutilizar su branding, monstruos o elementos creativos.

### 5.3. Pantallas exactas a diseñar

1. **Boot / compatibilidad:** logo, verificación WebGL2 y audio, indicador accesible de carga, fallback si no es compatible.
2. **Home:** wordmark `SEBITA / BREACH PROTOCOL`, texto corto, `JUGAR`, `ENTRENAMIENTO`, `AJUSTES`, `ACERCA DEL PROYECTO`, enlace a `sebita.dev` y repositorio.
3. **Calibración móvil:** «Mueve / mira / dispara», muestra dos dedos, selector mano dominante, sensibilidad.
4. **HUD jugando:** superior: tiempo/objetivo; inferior izquierdo: HP; inferior derecho: munición y recarga; centro: crosshair; botones táctiles si corresponde.
5. **Pausa:** continuar, controles, sonido, gráficos, volver al menú, inspección técnica.
6. **Victoria/Derrota:** puntuación y desglose, reintentar, compartir resultado sin datos sensibles, consultar implementación técnica.
7. **Engineering Mode:** FPS, frametime, draw calls, triángulos, instancias activas, tick de simulación, calidad actual y memoria estimada cuando sea medible.
8. **Fallback:** dispositivo sin WebGL2, pérdida de contexto, fallo de assets, orientación o memoria; sin pantalla en blanco.

### 5.4. Contrato de tema sugerido para el nuevo repo

```css
/* Copia versionada de tokens Resolución: comprobar contra el repo fuente. */
:root {
  --bg: #000000;
  --fg: #ffffff;
  --fg-muted: #a1a1a1;
  --fg-faint: #8a8a8a;
  --line: #262626;
  --fill: #141414;
  --dist: 8px;
  --mono: "Geist Mono", ui-monospace, monospace;
  --pixel: "Geist Pixel", ui-monospace, monospace;
}
:root[data-theme="light"] {
  --bg: #ffffff;
  --fg: #000000;
  --fg-muted: #5c5c5c;
  --fg-faint: #6b6b6b;
  --line: #e5e5e5;
  --fill: #f2f2f2;
}
.game-canvas, .touch-zone { touch-action: none; }
```

**Regla:** en partida la UI y menús aceptan tema claro/oscuro; el nivel 3D mantiene iluminación diseñada para jugabilidad salvo que exista un esquema alternativo testeado. Reutilizar fuentes por URL propia, cacheables, respetando permisos; no depender de recursos cargados desde `sebita.dev` por cross-origin.

### 5.5. Navegación y copy

Menú: `JUGAR / ENTRENAR / CÓMO FUNCIONA / AJUSTES`. Microcopy preferido en minúsculas o mayúsculas técnicas según página, de 2–6 palabras. No llenar el HUD con párrafos. Idioma inicial **español**, inglés como P1; traducir menú y ayudas, no duplicar toda la lógica.

---

## 6. Inventario de assets: obligatorio y con procedencia

**Política:** nunca descargar y usar un asset automáticamente solo porque aparece en una búsqueda. Verificar **licencia de la página y licencia incluida en el zip**, origen, autor, permiso comercial y modificaciones. Cada archivo incorporado queda en `assets/manifest.json` y `THIRD_PARTY_NOTICES.md`. Preferir **CC0** o creación propia. Crear una estética coherente: mezclar packs sin normalizar escalas, colores y materiales destruye el acabado.

### 6.1. Packs candidatos con licencias publicadas como CC0

| Necesidad | Fuente investigada | Uso recomendado | Etapa |
|---|---|---|---|
| Pasillos, suelos, puertas, muros | [Kenney — Modular Space Kit](https://kenney.nl/assets/modular-space-kit) | Base de una arena modular; elegir pocas piezas y recolorear. | P0 |
| Interiores de estación | [Kenney — Space Station Kit](https://kenney.nl/assets/space-station-kit) | Consolas y detalles extra si faltan; no cargar el pack completo. | P1 |
| Armas low-poly | [Kenney — Blaster Kit](https://kenney.nl/assets/blaster-kit) | Referencia o base para PB-01 / AR-04, con modificaciones propias. | P0/P1 |
| Elementos industriales alternativos | [Quaternius — Modular Sci-Fi Megakit](https://quaternius.com/packs/modularscifimegakit) | Piezas `.gltf`; usar como **alternativa**, no fusionar 270 piezas al runtime. | P1 |
| Accesorios sci-fi | [Quaternius — Sci-Fi Essentials Kit](https://quaternius.com/packs/scifiessentialskit) | Consolas/props para terminales y ambientación. | P1 |
| Elementos de UI | [Kenney — UI Pack Sci-Fi](https://kenney.nl/assets/ui-pack-sci-fi) | Solo iconos útiles; **reestilizarlos al sistema Resolución**. | P0 |
| Crosshair | [Kenney — Crosshair Pack](https://kenney.nl/assets/crosshair-pack) | Elegir un retículo legible; se puede dibujar con CSS/SVG propio. | P0 |
| Efectos UI | [Kenney — UI Audio](https://kenney.nl/assets/ui-audio) | Hover, confirmar, error, terminal activado. | P0 |
| Sonidos de armas/sci-fi | [Kenney — Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | Disparos y activaciones; procesar niveles de audio. | P0 |
| Impactos | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | Superficie/armadura: conjunto pequeño de variantes. | P1 |
| Partículas | [Kenney — Particle Pack](https://kenney.nl/assets/particle-pack) | Solo si texturas compactas ganan a geometría procedural. | P1 |

Las páginas citadas publican **CC0**; **verificar de nuevo cada paquete al descargar**. Kenney explica que sus packs de assets se distribuyen como CC0 en https://kenney.nl/support. En Quaternius se declara CC0 en las fichas indicadas. **Atribución puede ser voluntaria en CC0, pero mantener créditos es buena práctica profesional.**

### 6.2. Assets **propios** que deben crearse

| ID | Asset final lógico | Fuente | Requisitos |
|---|---|---|---|
| `arena-sector-01.glb` | Arena render | Selección + modificación propia | Bajo número de materiales; geometría combinada donde corresponda. |
| `arena-collision.json` | Colisiones simples | Autoría propia | AABB/cápsula/octree estáticos; no usar malla visual compleja para física. |
| `terminal-node.glb` | Terminal interactivo | Prop modificado | Estados visuales idle/activando/activo. |
| `enemy-scout.glb` | Robot básico | Modelado low-poly propio/derivado CC0 | Silueta legible, geometría simple, pivotes definidos. |
| `enemy-sentinel.glb` | Segundo enemigo | Propio/CC0 editado | Silueta diferente + animaciones mínimas. |
| `weapon-sidearm.glb` | Arma primera persona | Kenney Blaster Kit adaptado | Viewmodel low-poly; mano/brazo opcionales, evitar rigs caros. |
| `weapon-carbine.glb` | Arma secundaria | Kenney adaptado | P1; silenciador/skin no obligatorios. |
| `logo.svg` | Identidad del juego | Original | Variación de la identidad tipográfica, sin copiar marcas ajenas. |
| `reticle.svg` | Crosshair | Original/Kenney | Parametrizable, visible en ambos temas. |
| `icon-play.svg`, `icon-pause.svg` etc. | Iconografía HUD | Original/Kenney | Trazo y tamaños consistentes, sin cargar librería entera. |
| `sfx-fire.*`, `sfx-hit.*`, `sfx-ui.*` | Sonidos seleccionados | Kenney/propios | Mono para SFX puntuales, volumen homogéneo, ≤2–3 variantes por evento MVP. |
| `ambient-loop.*` | Ambientación | Composición propia o CC0 | Opcional y desactivada por preferencia; no bloquear carga. |
| `share-card.webp`, `og.png` | Preview social | Original | Portada legible y optimizada; no cargarla dentro del juego. |

### 6.3. Manifiesto obligatorio

```json
{
  "id": "weapon-sidearm",
  "file": "/assets/models/weapon-sidearm.glb",
  "origin": "Kenney Blaster Kit + modificaciones propias",
  "sourceUrl": "https://kenney.nl/assets/blaster-kit",
  "author": "Kenney / Sebastián Bravo (modificaciones)",
  "license": "CC0 1.0 (confirmar archivo del pack)",
  "licenseEvidence": "assets/licenses/kenney-blaster-kit.txt",
  "role": "weapon-viewmodel",
  "lod": "mobile-low",
  "optimized": true
}
```

Guardar además versión original (en `art-source/` o almacenamiento de desarrollo, **no enviada al navegador**), parámetros de exportación, procedencia y hash de artefacto optimizado. No versionar ZIP enormes si no aportan al build.

### 6.4. Pipeline de assets y formatos

1. **Seleccionar** 15–25 piezas coherentes del entorno, no descargar/cargar packs completos.
2. Editar en Blender con **escala consistente** (1 unidad = 1 m aprox.), ejes correctos, pivotes razonables, sin caras invisibles, materiales compartidos.
3. Exportar **glTF/GLB**; evitar FBX/OBJ en runtime. Preferir **un GLB por conjunto lógico**, no un GLB por tornillo.
4. Procesar con [glTF Transform](https://gltf-transform.dev/) (prune, dedup, quantize, meshopt **si es compatible con loader y decoder incluidos**). Medir costo de decodificación: menor descarga no siempre equivale a menor tiempo de carga.
5. Texturas: 256/512 px donde baste; 1024 solo si la inspección lo justifica. Usar WebP para UI/OG y **KTX2/Basis** para texturas de GPU si la compatibilidad/beneficio se comprueba. Probar fallbacks reales.
6. Materiales: compartir geometrías y materiales; evitar metal/transmisión/SSR/PBR de alto costo si no aportan al estilo.
7. Audio: recortar silencios, normalizar sin clipping, usar muestras comprimidas y **no reproducir antes de interacción del usuario**. Un sintetizador Web Audio propio para UI puede ser aún más ligero, sin imponerlo a todos los efectos.
8. Empaquetar por demanda: el menú no debe cargar anticipadamente modelos del segundo mapa ni un arma P2.
9. Auditar con herramientas de red y métricas en teléfono, no solo con `dist/` en disco.

**Presupuestos iniciales propuestos (revisables por medición):**

| Grupo | Objetivo de transferencia comprimida |
|---|---:|
| HTML/CSS + JS esencial del menú | ≤250 KiB |
| JS del motor/juego, restante para primera ronda | ≤600 KiB |
| Assets 3D/geom/animaciones de arena y enemigos MVP | ≤3 MiB |
| Texturas esenciales | ≤1,5 MiB |
| Audio esencial | ≤0,8 MiB |
| Fonts usadas al inicio | usar subsets existentes; medir y no duplicar familias |
| **Descarga total objetivo hasta primera partida** | **≤6 MiB**, con margen para fuentes/variaciones |

**Son presupuestos de ingeniería, no cifras obtenidas**; la carga diferida y compresión deben documentarse con HAR/Network de cada build. Medir también tiempo de *decode*, GPU upload y tiempo de primera interacción.

---

## 7. Arquitectura técnica recomendada

### 7.1. Stack y decisiones

| Capa | Elección | Justificación / condición |
|---|---|---|
| Lenguaje | **TypeScript strict** | Contratos, legibilidad, tipado de configuración y eventos. |
| Build | **Vite** | Aplicación web estática, chunks y buen ciclo de desarrollo. |
| Render | **Three.js / WebGL2** | 3D en navegador con control explícito de la escena y profiling. **No WebGPU obligatorio** en MVP. |
| Simulación | TS puro + `requestAnimationFrame` + **paso fijo** | Reglas testeables desacopladas de la GPU y Hz del monitor. |
| Física personaje | **Capsule + Octree/AABB** con primitivas compatibles de Three.js, colisión simple | El MVP no justifica introducir WASM/solver complejo si no hay físicas dinámicas. |
| Física avanzada | **Rapier (P2, condicional)** | Incorporarlo solo para cuerpos rígidos/proyectiles dinámicos que lo necesiten. |
| Inputs | **Pointer Events**, Pointer Lock, KeyboardEvent, Gamepad opcional P2 | Multitouch con `pointerId` y normalización independiente. |
| HUD / menús | **DOM + CSS puro + SVG** | Accesibilidad, coherencia Resolución y menor dependencia. |
| Audio | **Web Audio API** | SFX con control de volumen; activar con gesto de usuario. |
| Datos MVP | `localStorage` con esquema versionado | Configuración, tutorial y récord local sin servidor. |
| Backend P1 | **Fastify + TypeScript + Zod** | API pequeña, validación por esquema y mismas competencias full-stack. |
| BD P1 | **PostgreSQL** + consultas parametrizadas/Drizzle opcional | Persistencia de partidas/estadísticas y migraciones. |
| Pruebas | **Vitest**, **Playwright**, axe en UI y pruebas físicas manuales | Motor lógico + rutas + dispositivos. |
| CI/CD | **GitHub Actions** + deploy estático independiente | Calidad verificable y rollback. |
| Alojamiento | Estático en **Vercel** o CDN equivalente con `game.sebita.dev`; API separada opcional | Escala para una demo sin servidor de juego permanente. |
| Analytics | Ninguno por defecto; métricas locales | Preservar privacidad y tamaño. Analítica opt-in opcional P2. |

**Por qué NO al comienzo:** React/React Three Fiber (no se necesita reconciliación para un pequeño juego en bucle), Godot/Unity Web export (mayor superficie de runtime y desafíos de compatibilidad web/móvil para este alcance), un backend siempre encendido, multiplayer WebSocket, un CMS o microservicios. No significa que sean malas tecnologías; **no son la opción de menor complejidad bajo estos requisitos**.

### 7.2. Separación de repositorios

- `https://github.com/sebitabravo/portfolio`: no incorporar el motor ni miles de assets. Añadir **solo una tarjeta/enlace y caso de estudio**.
- Nuevo repositorio sugerido: `https://github.com/sebitabravo/breach-protocol` (nombre **propuesto, no creado**).
- `game.sebita.dev`: despliegue separado, estilo compartido mediante **tokens versionados** y sin dependencia runtime entre dominios.
- **No usar monorepo entre portafolio y juego** solo para compartir 40 líneas de CSS; añade fricción de CI y despliegue. Dentro del juego, mantener estructura modular simple.

### 7.3. Estructura sugerida del repositorio

```text
breach-protocol/
├── README.md
├── SPEC.md                         # Esta especificación
├── LICENSE
├── THIRD_PARTY_NOTICES.md
├── CHANGELOG.md
├── package.json / bun.lock
├── tsconfig.json / vite.config.ts
├── index.html
├── public/
│   ├── fonts/                      # Solo archivos con licencia revisada
│   ├── icons/
│   ├── assets/
│   │   ├── models/                 # .glb optimizados
│   │   ├── textures/               # .ktx2 / .webp cuando aplique
│   │   ├── audio/                  # .ogg/.mp3/aac según soporte
│   │   ├── manifest.json
│   │   └── licenses/
│   └── og/
├── art-source/                     # Fuente editable local o Git LFS SI aplica
├── src/
│   ├── main.ts                     # Boot mínimo y DI manual
│   ├── config/                     # presets, reglas de balance
│   ├── core/
│   │   ├── Game.ts                 # composición, NO lógica monolítica
│   │   ├── GameLoop.ts
│   │   ├── GameStateMachine.ts
│   │   ├── EventBus.ts
│   │   ├── Clock.ts
│   │   └── QualityController.ts
│   ├── input/
│   │   ├── InputManager.ts
│   │   ├── KeyboardMouseInput.ts
│   │   ├── TouchInput.ts
│   │   └── InputSnapshot.ts
│   ├── simulation/
│   │   ├── WorldState.ts
│   │   ├── PlayerController.ts
│   │   ├── CollisionWorld.ts
│   │   ├── WeaponSystem.ts
│   │   ├── DamageSystem.ts
│   │   ├── ObjectiveSystem.ts
│   │   ├── WaveDirector.ts
│   │   └── enemies/
│   │       ├── EnemyFSM.ts
│   │       └── archetypes.ts
│   ├── rendering/
│   │   ├── Renderer.ts
│   │   ├── SceneFactory.ts
│   │   ├── AssetLoader.ts
│   │   ├── FXPool.ts
│   │   ├── CameraRig.ts
│   │   └── DebugOverlay.ts
│   ├── audio/
│   │   └── AudioManager.ts
│   ├── ui/
│   │   ├── MenuView.ts
│   │   ├── HUDView.ts
│   │   ├── SettingsView.ts
│   │   ├── TouchControlsView.ts
│   │   └── ResultView.ts
│   ├── persistence/
│   │   ├── SettingsRepository.ts
│   │   └── LocalScoresRepository.ts
│   ├── styles/
│   │   ├── resolucion-tokens.css
│   │   ├── base.css
│   │   ├── hud.css
│   │   ├── menus.css
│   │   └── touch.css
│   └── lib/
│       └── accessibility.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── performance/
│   └── fixtures/
├── docs/
│   ├── architecture.md
│   ├── adr/
│   ├── controls.md
│   ├── performance-budget.md
│   ├── benchmark-results.md
│   ├── devices-tested.md
│   └── asset-provenance.md
└── .github/workflows/
    └── ci.yml

# P1 opcional (solo si API real):
server/
├── src/routes/
├── src/domain/
├── src/db/migrations/
└── tests/
```

**Nota:** esta estructura es objetivo, no un requisito de crear archivos vacíos desde el día uno. Crear cada módulo cuando exista funcionalidad y pruebas concretas. Preferir composición e interfaces frente a jerarquías OOP profundas.

### 7.4. Contratos de responsabilidades

- `InputManager`: convierte teclado, mouse y toques en un **InputSnapshot neutral** por tick (`moveX`, `moveY`, `lookDeltaX/Y`, `fire`, `jump`, `interact`, `reload`, etc.). No modifica jugador directamente.
- `GameLoop`: administra reloj, `fixedUpdate`, render e interpolación. **Único dueño del ciclo**.
- `WorldState`: fuente de verdad de jugador, enemigos, nodos y temporizador; sin dependencias DOM/WebGL.
- `WeaponSystem`: cadencia y cálculo de rayos/damage, no reproduce audio por sí mismo.
- `Renderer`: representa snapshot de la simulación, actualiza la cámara/escena y expone `renderer.info`.
- `AudioManager`: observa eventos y evita duplicados; puede estar desactivado.
- `HUDView`: lee proyección del estado y actualiza DOM **cuando cambian valores**, no reescribe todo el HUD cada frame.
- `QualityController`: controla resolución/preset con histéresis y cooldown, nunca cambia escala cada fotograma.
- `SettingsRepository`: versiones, migración de preferencias y valores seguros.

### 7.5. Estados del juego

```text
BOOT → COMPATIBILITY_CHECK → MENU → LOADING → TUTORIAL? → PLAYING
                                         ↑             |
                                         |          PAUSED
                                         |             |
                                         └── RESTART ← WIN / LOSE

Cualquier estado jugable → CONTEXT_LOST → RECOVERY / SAFE_ERROR
```

Todas las transiciones tienen acciones explícitas: cancelar listeners, pausar audio, limpiar punteros, disponer recursos si corresponde. Cada estado debe permitir retornar al menú sin recargar toda la página en condiciones normales.

---

## 8. Game loop, física y exactitud temporal

### 8.1. Paso fijo obligatorio

Objetivo: **simular a 60 Hz** (`fixedDt = 1/60`) y **renderizar con `requestAnimationFrame`** a la frecuencia disponible. Esto evita que caminar/disparar sea más rápido en monitor de 144 Hz.

```ts
const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1;
const MAX_STEPS = 5;
let previous = performance.now();
let accumulator = 0;

function frame(now: number) {
  const frameDt = Math.min((now - previous) / 1000, MAX_FRAME_DT);
  previous = now;
  if (!game.isPlaying()) {
    renderer.renderMenuOrPaused();
    requestAnimationFrame(frame);
    return;
  }
  accumulator += frameDt;
  const input = inputManager.getSnapshot();
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
    game.fixedUpdate(FIXED_DT, input);
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS && accumulator >= FIXED_DT) {
    // Política explícita para evitar espiral de muerte;
    // medir ticks descartados y documentar la limitación.
    accumulator = 0;
  }
  renderer.render(game.getInterpolatedView(accumulator / FIXED_DT));
  requestAnimationFrame(frame);
}
```

**Este código es pseudocódigo orientativo**, no módulo listo para copiar: debe gestionar *one-shot actions* (salto/recarga) sin repetirlos por cada subpaso, resample de look del mouse, primer frame al reanudar, time scale, acumulador estable y métricas de ticks descartados. **No alimentar el mismo `lookDelta` a todos los subpasos**: distribuir/consumir eventos de entrada correctamente o usar ticks/eventos con timestamps.

### 8.2. Decisiones de simulación

- Calcular movimiento con velocidades en `m/s` y `dt`, aceleración y fricción definidas; sin lógica dependiente de frame.
- Resolver colisión personaje-mundo con cápsula/simple AABB + resolución de penetración, tolerancia de suelo y pendientes. Evitar física de `Mesh` visual complejo.
- Enemigos usar colisión simplificada y navegación por *waypoints* definidos a mano inicialmente; **no introducir navmesh completo en MVP**.
- Disparo por raycast; daño solo tras hit confirmado contra collider apropiado.
- Efectos en `ObjectPool` con capacidad fija; liberar GPU resources (`dispose`) cuando salga de escenario.
- Límite máximo de enemigos simultáneos por perfil de calidad; no eliminar adversarios ya visibles de golpe para «optimizar».
- RNG con semilla configurable en tests del director de oleadas; simulación totalmente determinista es un objetivo P2, no una afirmación MVP.

---

## 9. Rendimiento: contrato medible

### 9.1. Metas por tipo de dispositivo

| Perfil | Objetivo razonable de partida | Estrategia |
|---|---|---|
| Escritorio medio moderno | **60 FPS** o frecuencia de pantalla si hay margen | Quality `high`; no suponer que todos los PC son iguales. |
| Notebook de gráficos integrados | **60 FPS** aspiracional; degradar si no se sostiene | `medium` y resolución dinámica. |
| Android gama media de últimos años | **45–60 FPS** si el hardware lo permite | `medium`/`low`, menos partículas y menor DPR. |
| iPhone compatible / Safari | **45–60 FPS** objetivo sujeto a medición real | No asumir fullscreen/orientation-lock ni WebGPU. |
| Móvil de gama baja aún compatible | **≥30 FPS estables** como mínimo de aceptación | `low`, sombras desactivadas, densidad reducida. |

**Importante:** no declarar compatibilidad universal con cualquier dispositivo. Publicar una **matriz de hardware probado** y un mensaje de incompatibilidad si falta WebGL2. En caso de 30 FPS, las simulaciones siguen en paso fijo y la UI debe seguir respondiendo.

### 9.2. Presupuestos runtime iniciales

Valores **meta para empezar y revisar con benchmarks**, no métricas existentes:

- **Draw calls en primera arena:** objetivo móvil ≤80 y desktop ≤150 en un frame representativo de combate (depende del perfil y escena final).
- **Triángulos visibles:** objetivo móvil ≤100 000; desktop ≤250 000; medir, no obsesionarse si la GPU bottleneck es *fill-rate*.
- **Luces dinámicas costosas:** 0–1 principal con sombras si el perfil lo soporta; perfiles bajos sin sombras dinámicas. Bake/iluminación ambiental simple como base.
- **Partículas activas:** limitadas por pool y presets, sin crear/destruir objetos por disparo.
- **Frame budget:** 60 FPS ≈16,7 ms por frame; 45 FPS ≈22,2 ms; 30 FPS ≈33,3 ms. Incluye navegador y trabajo de CPU/GPU, por lo que se necesita margen.
- **Persistencia de sesión:** 5–10 minutos de juego sin crecimiento sostenido injustificado de memoria, tirones de GC ni *context lost* en dispositivos de prueba.

### 9.3. Calidad adaptable: preset y resolución dinámica

**Presets:** `low`, `medium`, `high`, `auto`. Selección manual siempre tiene prioridad sobre Auto. Detectar capacidades reales, **no decidir solo por marca de teléfono ni `deviceMemory`**.

- Inicial: DPR efectivo acotado, p. ej. **0,75–1,5** según preset/viewport; permitir 1.0 en móviles modestos.
- Muestrear frametime robusto (mediana/P90 de una ventana móvil de 3–5 s). Evitar decisiones durante compilación inicial de shaders.
- Si P90 supera presupuesto por varias ventanas, bajar **un escalón** de resolución; esperar 10–20 s antes de subir. Histéresis distinta para subir/bajar, evitando oscilación.
- Si bajar resolución no mejora FPS, el cuello puede ser CPU: reducir frecuencia IA, animación, partículas/instancias activas dentro de límites jugables, no seguir bajando píxeles sin evidencia.
- Mostrar preset y DPR real en Engineering Mode. Registrar eventos de cambio y comparar antes/después.

### 9.4. Optimización por orden, NO por intuición

1. **Medir:** FPS promedio/P90 frame time, CPU scripting, render time aproximado, draw calls, triángulos, memoria y red en teléfono real.
2. **Detectar cuello:** GPU/fill-rate, CPU/JS, recolección de basura, assets, decode, red o compilación de shaders.
3. **Elegir cambio mínimo:** instancing, geometría compartida, frustum culling, materiales comunes, sombras off, pooling, texturas comprimidas, reducción de DPR.
4. **Repetir escenario controlado**: misma arena, semilla, oleada, duración, dispositivo, navegador, energía y perfil. Medir en frío y caliente.
5. **Documentar evidencia:** tabla de resultados y conclusión; revertir optimizaciones que empeoren calidad/rendimiento.

Consultar [MDN WebGL Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) y [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer). `renderer.info.render.calls` y datos similares ayudan a diagnosticar pero **no constituyen FPS ni memoria total real**.

### 9.5. Carga, energía y móvil

- Menú visible primero; cargar motor/assets de juego **después de «Jugar»** o en idle según ahorro de datos.
- Evitar HDR grande, postprocesados Bloom/SSR, motion blur, sombras múltiples y resolución física sin límites.
- Suspender render intensivo y audio en pestaña oculta; reducir trabajo en pausa. `requestAnimationFrame` normalmente se detiene en background, pero la lógica también debe pausar explícitamente.
- No activar vibración continuamente; haptics solo opcionales y según disponibilidad.
- Tratar throttling térmico: repetir sesión de 5–10 minutos, no validar solo el primer minuto.
- Evitar descargar assets grandes por conexión móvil sin consentimiento; mostrar progreso y tamaño aproximado si supera presupuesto.

### 9.6. Engineering Mode: **datos reales**, no maqueta

Mostrar bajo demanda: FPS suavizado, P50/P95 de frametime, draw calls, triángulos, instancias, cantidad de enemigos, ticks de simulación y acumulados descartados, preset, DPR, duración de carga, bytes transferidos medibles, errores WebGL y versión/build SHA. La memoria JS (`performance.memory`) no es universal: **mostrar «no disponible»** donde no exista; no inventar lecturas. Un overlay puede alterar el rendimiento: actualizar 2–4 veces por segundo y medir también con él desactivado.

---

## 10. Modelo de datos, persistencia y backend opcional

### 10.1. MVP local y offline-ready

Usar `localStorage` exclusivamente para configuraciones pequeñas y récords; capturar excepciones/quota. Esquema versionado:

```ts
type SettingsV1 = {
  version: 1;
  locale: 'es' | 'en';
  theme: 'dark' | 'light';
  quality: 'auto' | 'low' | 'medium' | 'high';
  sensitivityMouse: number;
  sensitivityTouch: number;
  touchHandedness: 'right' | 'left';
  autoReload: boolean;
  aimAssistTouch: boolean;
  reduceMotion: boolean;
  audioEnabled: boolean;
};
```

Validar cargas JSON externas/almacenadas, defaults conservadores, migración y `reset settings`. Guardar resultados locales de forma compacta y versionada; **no confiar en localStorage para premios ni rankings oficiales**.

### 10.2. P1: API que aporte valor al portafolio

**Fastify + Zod + PostgreSQL** para estadísticas anónimas y ranking casual. Evitar requerir crear cuenta.

Endpoints propuestos:

| Método | Ruta | Acción |
|---|---|---|
| `GET` | `/v1/health` | Estado mínimo. |
| `POST` | `/v1/runs` | Registrar resultado con validación de formato/tamaño/rate limit. |
| `GET` | `/v1/leaderboard?mode=...&input=...` | Listado paginado y filtrado; respuestas cacheables. |
| `GET` | `/v1/build` | Identificador/versiones compatibles. |

Tablas candidatas `runs` (id UUID, created_at, build_version, mode, difficulty, input_type, duration_ms, score, kills, nodes, assist_enabled, verification_level), `leaderboard_entries` solo si hace falta vista materializada o clasificación diferente. Sin IP persistida innecesariamente; no recopilar fingerprint. Esquemas Zod estrictos, tamaños máximos, límites de peticiones, CORS allowlist de `https://game.sebita.dev`, migraciones, consultas parametrizadas y política de retención.

**Anti-cheat:** un resultado enviado por el cliente **puede falsificarse**. Validaciones de rango, duración, nonce y rate limit solo reducen abuso; **NO prueban juego legítimo**. Para leaderboard competitivo haría falta autoridad de simulación o un sistema de repeticiones verificables diseñado y probado, que queda fuera del MVP. Etiquetar ranking como casual/no verificado.

### 10.3. PWA y offline P2

Primero lograr buena web. Después añadir manifest y service worker con cache versionada de **shell + assets de la arena ya descargados**, pantalla offline clara y estrategia de actualización. No precachear indiscriminadamente packs futuros; probar cuotas y actualizaciones. Los records online nunca se deben subir silenciosamente si no hay consentimiento/acuerdo de privacidad.

---

## 11. Seguridad, privacidad, permisos y despliegue

- **Hosting**: `game.sebita.dev` como sitio estático con HTTPS; API bajo `api.game.sebita.dev` o dominio equivalente **solo al implementarla**.
- **CSP propia** para el juego: derivarla del build real, no copiar ciegamente los hashes de Astro. Evaluar `wasm-unsafe-eval` **solo si se introduce WASM**; restringir `connect-src`, fuentes, imágenes y medios a orígenes necesarios. Evitar `unsafe-eval`.
- **Headers**: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` adecuada, HSTS servido por infraestructura HTTPS; verificar compatibilidad de COOP/COEP antes de activarlos, especialmente si se usan workers o terceros.
- **Asset loading**: URLs estáticas versionadas, controles de error/reintento y fallback; no ejecutar contenido arbitrario cargado desde usuario.
- **Backend**: límites de tamaño y tasa, validación, logs sin credenciales, migraciones, backups DB si se considera crítica, alertas simples y secreto fuera del frontend.
- **Enlace a portafolio**: abrir `sebita.dev` desde menú; no compartir cookies entre subdominios si no hace falta; no exponer sesión ni datos del sitio principal.
- **Privacidad**: sin Google Analytics/ads por defecto, sin reconocimiento biométrico, sin pedir permisos de micrófono/cámara/ubicación. Explicar qué guarda localStorage y cuándo el juego envía datos.
- **Licencias**: código bajo licencia que el autor elija (p. ej., MIT para code) **no equivale** a relicenciar los assets. Documentar por separado.

---

## 12. Pruebas: criterios observables y matriz de dispositivos

### 12.1. Pruebas unitarias con Vitest

- Estados: transición válida/inválida, pausa, victoria/derrota y recovery.
- Input: `pointerId` simultáneos, liberación al cancelar, mano dominante, remapeos, pérdida de foco.
- Movimiento: tiempo fijo y velocidades equivalentes a distintos FPS de render.
- Armas: cadencia por segundo, munición no negativa, recarga sin duplicados, hitscan y daño.
- Enemigos: FSM no entra en estados imposibles, tiempos de reacción y transiciones.
- Director de oleadas: límites por preset, semilla de prueba, spawn seguro.
- Objetivos: canalizado completo/cancelación, progresión 0→3, victoria.
- Configuración: migración, defaults, inputs corruptos, localStorage bloqueado.
- QualityController: evita cambiar DPR continuamente y respeta preset manual.

### 12.2. E2E con Playwright (navegador)

- Carga menú sin errores y muestra fallback WebGL si se simula ausencia de soporte.
- `Jugar` lleva a partida, pausa/reanuda, reinicia y devuelve al menú.
- `localStorage` persiste preferencias y récord.
- Layout de menús sin overflow en 320/375/390/768/1280/1920 CSS px.
- Alternancia de temas e idioma sin text truncation crítico.
- Usabilidad teclado, accesibilidad de botones/menús; `aria` donde corresponda.
- Simulación de Pointer Events para lógica básica; **esto no sustituye test físico de multitouch**.
- No errores JS severos en Chrome/Firefox/WebKit ni requests 404 para assets obligatorios.
- Test de camino desde landing a primera ronda con red emulada, sin garantizar resultados a partir del emulador.

### 12.3. Pruebas manuales obligatorias en equipos físicos

| Plataforma | Requisito mínimo de QA | Riesgos a buscar |
|---|---|---|
| Chrome Windows/Linux | Teclado, mouse, menú, Pointer Lock | Foco, cursor escapando, teclas pegadas. |
| Safari macOS | Mouse/trackpad y audio | Políticas de audio, render/driver, Fullscreen. |
| Chrome Android gama media | 2–3 toques simultáneos, landscape/portrait | Joystick+mirar+disparar, pausa, cambios de barras del navegador. |
| Safari iPhone | Multitouch y recuperación de orientación | Fullscreen limitado, safe-area, gestos del sistema, audio. |
| Android gama baja | 5–10 min en bajo | Throttling, caídas sostenidas, cierre de pestaña. |
| Tablet (si accesible) | Layout y control | Botones demasiado separados. |

Registrar modelo, SO, versión del navegador, resolución CSS, DPR, nivel gráfico, FPS P50 y P95 frame time, problemas y commits de solución. Un navegador en emulación **no prueba realmente el touch ni la GPU móvil**.

### 12.4. Criterios de aceptación P0

- [ ] Un jugador puede **terminar una ronda completa** desde escritorio y móvil real.
- [ ] Joystick, cámara y FIRE funcionan **simultáneamente** con varios dedos, sin `stuck movement`.
- [ ] Sin pantalla blanca en pérdida de contexto, assets no disponibles o WebGL2 ausente.
- [ ] No se requiere cuenta, login, API ni pago para jugar.
- [ ] Pausa al perder foco; reanudación no salta tiempo.
- [ ] SFX son opcionales, nunca se disparan contra políticas de autoplay.
- [ ] Cada pantalla es usable a 320 CSS px y con safe-area; en móvil horizontal control completo.
- [ ] El juego tiene al menos: un arma, un enemigo, una arena, tres terminales y victoria/derrota.
- [ ] Typecheck, tests de dominio y Playwright smoke en CI; sin errores críticos.
- [ ] Assets registrados y licencia verificada; fuentes autorizadas.
- [ ] Build de producción y tamaño documentados; fps documentados **con dispositivos concretos**.
- [ ] Engineering Mode muestra valores **medidos** o `N/D`, nunca valores falsos.
- [ ] README permite ejecutar y desplegar el proyecto desde cero.

### 12.5. Métricas no funcionales para publicación

Definir en `docs/benchmark-results.md` antes de release:

- Tiempo entre pulsar **Jugar** y control disponible (cold/warm, red simulada y real).
- Bytes descargados hasta primera partida, bundles por ruta/chunk, caching.
- P50/P95 frame time durante ronda de 3 min, 3 repeticiones en cada perfil físico.
- Draw calls, triángulos y máximo de enemigos en escena, según presets.
- Porcentaje de sesiones de QA sin errores, crash o WebGL context loss.
- Rendimiento de 10 min en teléfono sin degradación severa.
- Compatibilidad/limitaciones publicadas, incluyendo Safari iOS.

**Regla de release:** si 30 FPS estables no se alcanzan en el equipo de gama baja seleccionado, priorizar una versión `low` jugable antes de añadir efectos. Si un equipo específico nunca cumple, declarar su no compatibilidad, no ocultarlo.

---

## 13. Roadmap realista y entregables

Las fases son **secuenciales por resultado**, no estimaciones de días; avanzan cuando pasan sus criterios de salida.

### Hito 0 — Investigación y prototipo técnico

- Inicializar Vite + TS strict, CSS Resolución y menú simple.
- Probar WebGL2, carga de `three`, escena con primitivas y FPS en PC/Android/iOS disponibles.
- Crear dos layouts táctiles y PoC de multitouch real: movimiento + giro + FIRE simultáneos.
- Elegir motor con benchmark real de una escena representativa. Si Three.js falla objetivamente, documentar ADR y revaluar PlayCanvas/Babylon.js **antes** de construir todo.

**Entrega:** página de prueba pública o local con menú y una sala vacía jugable. Registro de decisiones de compatibilidad.

### Hito 1 — Vertical Slice jugable **(MVP mínimo)**

- Arena pequeña con colisión, PB-01, Scout, 3 terminales, oleadas, victoria/derrota.
- HUD, pause/settings, audio opcional, récord local, práctica básica.
- Quality presets, asset loading y pruebas unitarias/E2E.
- Primeros benchmarks físicos y corrección de bugs de touch.

**Entrega:** juego que una persona externa pueda terminar sin instrucciones del desarrollador.

### Hito 2 — Calidad, optimización y marca

- Integrar assets definitivos y diseño Resolución completo.
- Animaciones/recoil y SFX pulidos; agregar Sentinel si FPS lo permite.
- Engineering Mode real; benchmarking reproducible, optimización basada en perfiles.
- Modo vertical mejorado, ajustes de sensibilidad y remapeos; idiomas ES/EN.
- Accesibilidad, estados de recuperación, revisión de licencias.

**Entrega:** release pública v1.0 con evidencia y documentación.

### Hito 3 — Demostración full stack

- API sencilla para estadísticas/leaderboard casual, migraciones Postgres, validación y rate limits.
- Pruebas API, monitoreo básico, despliegue separado, privacidad.
- Caso de estudio detallado y artículo técnico en `sebita.dev`.

**Entrega:** muestra de frontend + backend con riesgos de integridad reconocidos.

### Hito 4 — Opcionales condicionados por jugadores reales

- Arma AR-04 / SG-08, Interceptor, Endless, desafío diario.
- HUD editable, gamepad, instalación PWA/offline.
- Repeticiones o clasificación con mayor integridad; investigar coste antes de implementar.
- **Multiplayer solo si existe motivación, presupuesto y diseño de red específico**; no se promete.

---

## 14. Integración con tu búsqueda laboral

### 14.1. Presentación en `sebita.dev`

Añadir proyecto destacado al portafolio: **SEBITA: BREACH PROTOCOL — FPS 3D multiplataforma en navegador**.

Enlace principal `Jugar demo` → `game.sebita.dev`. Enlace secundario `Arquitectura y resultados` → caso de estudio y `Ver código` → repositorio. Mantener el mismo lenguaje de tarjetas, microcopy y datos verificables que el portafolio ya utiliza.

### 14.2. El caso de estudio debe responder

1. **Problema:** conseguir que un FPS web 3D sea jugable en PC y móvil sin instalación.
2. **Restricciones:** ancho de banda, GPU y térmicas móviles, multitouch iOS, estética compartida, mantenibilidad.
3. **Alternativas evaluadas:** Three/Babylon/PlayCanvas; física simple vs Rapier; CSS nativo vs UI framework.
4. **Decisiones y trade-offs:** por qué se eligió cada cosa, qué se pospuso y por qué.
5. **Resultados medidos:** FPS/tiempos/bytes/dispositivos con baseline y mejora, sin inflar cifras.
6. **Calidad:** pruebas, bugs detectados/corregidos, CI, cobertura relevante.
7. **Lecciones:** problemas de pointer capture, políticas de audio, pérdida de contexto, rendimiento.
8. **Links:** demo, repo, arquitectura, benchmark y assets/atribuciones.

### 14.3. Ejemplos de contenido para blog y entrevista

- «Cómo construí un FPS web compatible con mouse y multitouch sin duplicar la lógica».
- «Por qué elegí un loop de simulación a paso fijo en TypeScript».
- «Optimizando un juego Three.js para móvil: de un baseline medido a una mejora reproducible».
- «Qué muestra realmente `renderer.info` y qué no dice sobre rendimiento».
- «Assets GLB y licencias: cómo reducir tamaño sin destruir calidad».

**No escribir títulos con números de FPS o porcentajes de mejora hasta tener las mediciones.** Un caso de estudio honesto impresiona más que afirmaciones imposibles de reproducir.

---

## 15. Decisiones de arquitectura (ADR) iniciales

| ADR | Decisión | Justificación | Revaluar cuando… |
|---|---|---|---|
| ADR-001 | Repo y deploy separados del portafolio | Independencia de bundles y ciclo de release. | Mantenimiento de tokens requiere automatización real. |
| ADR-002 | Three.js + TS + Vite | Control fino y buena señal laboral, con mínimo framework. | Benchmark real no logra requisitos tras optimización razonable. |
| ADR-003 | WebGL2 baseline | Compatibilidad móvil prioritaria; WebGPU no requisito. | Soporte/beneficio WebGPU probado y fallback correcto. |
| ADR-004 | UI HTML/CSS nativa | Accesibilidad, tamaño y similitud Resolución. | UI 3D compleja y necesidades reales de render único. |
| ADR-005 | Colisión cápsula + mundo simple | Sin WASM ni físicas dinámicas innecesarias. | Mecánicas exigen rigid bodies complejos. |
| ADR-006 | Input normalizado por plataforma | Simulación común, menos bugs entre PC/móvil. | Incorporación de mando o accesibilidad especial. |
| ADR-007 | Sin autenticación en MVP | Reduce fricción y exposición de datos. | Usuarios necesitan cuentas con valor claro. |
| ADR-008 | Benchmarks físicos como quality gate | Emulación no mide GPU ni táctil real. | Nunca: es condición de publicación. |
| ADR-009 | Mono/pixel Resolución | Extiende la marca personal del autor. | Cambie oficialmente el sistema del sitio principal. |
| ADR-010 | Ranking no verificado hasta autoridad real | El cliente no es confiable. | Se implementa validación fuerte y verificable. |

Cada ADR real tiene contexto, decisión, alternativas, consecuencias, prueba de reversión, fecha y enlaces a issues/commits.

---

## 16. Riesgos y mitigaciones

| Riesgo | Probabilidad / impacto | Prevención y respuesta |
|---|---|---|
| FPS bajo en móvil | Alta / alta | Vertical slice en móvil desde H0, DPR dinámico, bajos draws/materiales. |
| Controles táctiles frustrantes | Alta / alta | Probar 2–3 dedos en iPhone/Android real antes de diseñar el resto. |
| Safari limita fullscreen/orientación | Alta / media | No depender de API, modo horizontal recomendado y fallback funcional. |
| UI muy oscura reduce visibilidad | Media / alta | Iluminación/siluetas de enemigos y contrastes específicos de combate. |
| Crece el alcance indefinidamente | Alta / alta | Scope P0 congelado, H2/P3 pospuestos hasta release. |
| Assets heterogéneos y pesados | Media / alta | Curación, remapeo de materiales, pipeline GLB y presupuesto por grupo. |
| Overengineering para «verse senior» | Alta / alta | Modularidad por necesidad, sin microservicios ni ECS prematuro. |
| Métricas de ingeniería falsas | Media / alta | Mostrar N/D y metodología, usar profiler real, no números decorativos. |
| Seguridad débil del leaderboard | Alta / media | Ranking casual, validación/rate limit, jamás «anticheat seguro» sin autoridad. |
| Licencias dudosas de assets o fonts | Media / alta | Registro por archivo, verificación de paquetes y THIRD_PARTY_NOTICES. |
| Primer load lento | Media / alta | Carga diferida, red auditada, presupuesto 6 MiB orientativo. |
| Context loss/background | Media / media | Gestores recovery, pausa automática, QA de rotación y multitarea. |

---

## 17. Checklist de entrega a un agente de programación

> **Instrucción de ejecución:** tratar este documento como especificación, no como permiso para generar decenas de archivos vacíos. El agente debe implementar **vertical slices verificables**, justificar cada dependencia, y reportar en cada iteración: qué cambió, cómo se probó, qué no pudo verificar, FPS/bytes medidos donde corresponda y próximos riesgos. No declarar «terminado» sin pruebas reales.

1. Leer repositorio del portafolio y **validar tokens/fuentes** actuales antes de copiar el estilo.
2. Crear `breach-protocol` independiente con Vite + TS strict; fijar dependencias y scripts.
3. Implementar `Menu → Playing → Paused → Result` con keyboard/mouse y prueba básica WebGL2.
4. Implementar **TouchInput** antes de enemigos complejos; probar triple contacto y cancelaciones.
5. Construir arena con primitivas + colisión simple y movimiento paso fijo.
6. Crear un Scout, PB-01 y tres terminales; balancear ronda.
7. Unificar HUD y ajustes con Resolución; cuidar accesibilidad, safe-area y orientación.
8. Incorporar assets documentados del manifiesto, optimizados antes de distribución.
9. Medir cold load y gameplay en PC y **móvil físico**; optimizar con hipótesis y pruebas.
10. Añadir vitest/e2e/CI, documentación ADR, benchmarks y licencias.
11. Desplegar `game.sebita.dev` y enlazarlo desde `sebita.dev` con caso de estudio.
12. **Solo después** evaluar API, ranking, nuevas armas, PWA y modos adicionales.

### Definition of Done de cada PR

- [ ] Cumple funcionalidad y no rompe juego móvil.
- [ ] TypeScript sin errores y tests relevantes verdes.
- [ ] Estados de pausa/reinicio/errores probados.
- [ ] No añade librería sin justificar carga/beneficio.
- [ ] Si toca render/assets/inputs: nueva medición o validación física documentada.
- [ ] No filtra secretos, no introduce assets de licencia desconocida.
- [ ] Documentación y cambios de UX actualizados.

---

## 18. Fuentes y lecturas técnicas (consultadas 20/11/2026)

### Proyecto y referencias directas

1. [sebita.dev — sitio público](https://sebita.dev/).
2. [sebitabravo/portfolio — README](https://github.com/sebitabravo/portfolio) (stack y quality gates).
3. [Resolución: tokens CSS](https://github.com/sebitabravo/portfolio/blob/main/src/styles/tokens.css) (hex, fuentes, tipografía, escala y motion).
4. [Resolución: CSS entry](https://github.com/sebitabravo/portfolio/blob/main/src/styles/resolucion.css).
5. [The Last Deploy](https://halloween.dev/) (presentación y aviso de compatibilidad).
6. [midudev/halloween-issues](https://github.com/midudev/halloween-issues) (repositorio de **issues, sin código del juego**).
7. [Tembaku](https://github.com/wafley/tembaku) (FPS TypeScript/Three, input y arquitectura declarados en README).
8. [ECHELON Mobile FPS](https://github.com/Cyberpunk0070/echelon-mobile-fps) (Pointer Events multitouch, optimizaciones autodescritas; FPS no validado aquí).
9. [Voxel Ops FPS](https://github.com/SiddharthaVarshney/voxel-ops-fps) (shooter web pequeño y controles táctiles).
10. [Neon Doom Pit](https://github.com/PaulAtkins88/neon-doom-pit) (vertical slice Three.js + Vite).
11. [Poki — Choosing your web game engine](https://developers.poki.com/guide/web-engine).

### APIs y performance de referencia

12. [MDN — WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).
13. [Three.js — WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer).
14. [Three.js — GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html).
15. [Three.js — KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html).
16. [glTF Transform](https://gltf-transform.dev/).
17. [MDN — Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events).
18. [MDN — setPointerCapture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture).
19. [MDN — touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action).
20. [MDN — Pointer Lock](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API).
21. [MDN — Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API).
22. [MDN — ScreenOrientation.lock](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock).
23. [MDN — requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
24. [MDN — Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
25. [MDN — WebGL context loss](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_lose_context).
26. [MDN — PWA caching](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching).
27. [Godot — export web](https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html) (limitaciones específicas de entorno web).

### Assets CC0, consultar licencia incluida en el pack

28. [Kenney — soporte/licencias](https://kenney.nl/support).
29. [Kenney — Modular Space Kit](https://kenney.nl/assets/modular-space-kit).
30. [Kenney — Space Station Kit](https://kenney.nl/assets/space-station-kit).
31. [Kenney — Blaster Kit](https://kenney.nl/assets/blaster-kit).
32. [Kenney — Sci-Fi UI](https://kenney.nl/assets/ui-pack-sci-fi).
33. [Kenney — Crosshair Pack](https://kenney.nl/assets/crosshair-pack).
34. [Kenney — Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds).
35. [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds).
36. [Kenney — UI Audio](https://kenney.nl/assets/ui-audio).
37. [Kenney — Particle Pack](https://kenney.nl/assets/particle-pack).
38. [Quaternius — Modular Sci-Fi Megakit](https://quaternius.com/packs/modularscifimegakit).
39. [Quaternius — Sci-Fi Essentials Kit](https://quaternius.com/packs/scifiessentialskit).

**Limitaciones de la revisión:** no se ejecutó ni perfiló `halloween.dev`, `sebita.dev` ni los shooters de referencia en un navegador gráfico o equipo físico desde esta investigación. Se consultó documentación pública/repo y se distinguieron datos verificados, descripción de terceros y propuestas. Las metas de rendimiento se deben confirmar en el proyecto real. Algunas URLs, licencias o APIs pueden cambiar; revísalas al integrar.

---

## 19. Resumen ejecutivo y criterio final

**Construir primero:** un FPS con una arena modular, una pistola, Scout, tres nodos, tres minutos, tutorial, menú Resolución, controles desktop/móvil genuinos, calidad adaptable, resultados locales y Engineering Mode real.

**Medir antes de expandir:** carga, FPS y UX táctil en Android e iOS reales. Corregir bugs y documentación antes de sumar armas/bosses.

**Presentar al buscar trabajo:** demo en `game.sebita.dev` + código público + caso de estudio de decisiones, pruebas y optimizaciones en `sebita.dev`.

La fortaleza de este proyecto **no será la cantidad de efectos o tecnologías**. Será demostrar que Sebastián Bravo es capaz de diseñar, construir, probar, optimizar, desplegar y explicar un producto multiplataforma completo, con criterio técnico y evidencia verificable.
