# Dirección de arte — SECTOR 01 / Control de Acceso

El [ADR 0002](adr/0002-visual-direction.md) fija el fondo azul-negro, los marcos de 1 px y la menta reservada para acciones y objetivos. En la arena, los tubos cian son iluminación de trabajo y el naranja identifica servicio y peligro ambiental. Nada de esto cambia las superficies de colisión.

## Valores medidos

Referencia previa: medianas de parches de 15 × 15 px de `/tmp/real-play.png` (1280 × 720, alto, ACES a 1,08). Los centros son coordenadas CSS de esa captura; Y′ es luma de pantalla (Rec. 709 sobre RGB sRGB de 8 bits), no luminancia física.

| Parche | Centro | RGB mediano | Y′ |
|---|---:|---:|---:|
| Piso, sin brillo directo | (590, 652) | 24 / 31 / 35 | 29,8 |
| Hormigón con luz del pilar | (676, 298) | 27 / 43 / 48 | 40,0 |
| Cobertura metálica, luz de servicio | (224, 387) | 96 / 50 / 25 | 58,1 |
| Piso, reflejo central | (640, 480) | 192 / 200 / 201 | 198,4 |
| Perímetro en sombra | (406, 323) | 10 / 21 / 26 | 19,0 |

La escalera de albedo es piso < hormigón < cobertura; la luz y el brillo no conservan ese orden en toda la pantalla. En `/tmp/final-play.png`, el mismo parche central baja de Y′ 198,4 a 31,2 (RGB mediano 24 / 33 / 34) y ya no forma una mancha blanca. Algunas paredes a distancia aún pierden relieve.

## Materiales y luces

| Superficie | Repetición | Color sRGB | Normal lineal | ARM lineal |
|---|---:|---|---|---|
| Piso y guías | 4 m | `floor_diff.webp` | `floor_nor.webp` | `floor_arm.webp` |
| Pilares y perímetro | 3 m | `wall_diff.webp` | `wall_nor.webp` | `wall_arm.webp` |
| Cajas, perfiles y servicios | 1,5 m | `metal_diff.webp` | `metal_nor.webp` | `metal_arm.webp` |

ARM: el piso usa solo la oclusión de R; las paredes y el metal usan G para rugosidad y B para metalicidad. Los materiales se comparten entre sectores. El mapa Industrial Pipe & Valve 02 se carga después del arranque visual y se convierte con PMREM: ilumina, pero nunca se muestra como fondo. El piso usa rugosidad 0,86 e IBL 0,24. Las luminarias conservan sus reflejos aproximados en bandas estrechas; no es un espejo de la geometría.

## Pase premium — esclusa de servicio 07

En SECTOR_01, la esclusa sellada del muro norte se ve a la derecha del núcleo desde el punto de aparición. La secuencia de lectura va de caja y bolardos a ocho hojas de puerta escalonadas, dos cilindros hidráulicos y el pórtico alto; al fondo, el haz de cables, revestimiento y ménsulas conectan el conjunto con el resto de la pared. La pasarela lleva barandas, escalera, piso nervado y desgaste de contacto. Tres manómetros, dos balizas ámbar, un rótulo `07 // PRESSURE LOCK` y franjas en el umbral marcan la función. La escalera y la esclusa son solo escenografía, no rutas jugables. Cadena suspendida al oeste, drenaje en el carril de salida y cajas de empalme alejadas repiten el vocabulario. La geometría entra en los lotes estáticos y proyecta sombras en medio/alto; bajo conserva las manchas de contacto.

| Acabado | Papel y color guía sRGB | Rugosidad / metalicidad base | Mapas |
|---|---|---:|---|
| Polímero | Carcasas, teclas, cachas; `#222932` grafito | 0,83 / 0,06 | Ninguno efectivo |
| Acero pintado | Puerta, cajas, pedestal; `#526977` azul petróleo, óxido `#BE6739` para servicio | 0,79 / 0,24 | `metal_diff/nor/arm`, contribución atenuada |
| Acero expuesto | Rieles, pistones, cantos gastados, armas; `#85969F` | 0,49 / 0,54 | `metal_diff/nor/arm`; menos relieve en piezas mecanizadas |
| Caucho | Sellos, mangueras, topes, empuñaduras; `#182228` | 0,98 / 0 | Ninguno efectivo |
| Vidrio | Manómetros y fondo del monitor `#447782`; lente del AR-04 | 0,21 / 0,08 (inserto opaco); lente sin PBR | Ninguno; lente tintada sin transmisión |
| Emisivo | Ámbar `#FFAE60` para servicio; menta `#5CE08B` para acción/objetivos | — | Sin mapas de acabado; pantalla conserva su atlas existente |

Los acabados del mundo se eligen por cara en el mismo lote metálico, no por material nuevo en cada objeto. No se agregan texturas descargadas: el rótulo reutiliza el atlas de estarcidos, y aceite y huellas estrechas son tarjetas procedurales en el lote de atmósfera. Los cantos de carga y los puntos de agarre muestran acero descubierto; no se aplica una pátina uniforme a toda la escena.

| Evento de snapshot | Lectura visual | Tope |
|---|---|---:|
| `wallHit` + `shot` | Picadura orientada a la cara de la colisión, con separación y sesgo de profundidad; se omiten bordes dudosos | 40, FIFO por sobrescritura |
| `shot` | Casquillo desde el puerto, con giro y un rebote visual; humo y ondulación alfa solo con calor acumulado | 16 casquillos / 4 puffs |
| `enemyDied` | Chispas cálidas breves encima de las capas de muerte existentes | 10 por baja, dentro del lote compartido de 128/512/1024 partículas |
| `nodeActivated` | Anillo de piso menta y pico de luz breve sin sombras; sin estos movimientos con `reduceMotion` | 3 anillos / 1 luz |

Los efectos del mundo comparten una malla instanciada de tarjetas y una de casquillos. Bajo/medio comparten además el destello enemigo y 1 trazadora en ese lote; alto conserva el destello enemigo y 64 trazadoras. El destello del jugador viaja con el arma en su propio pase. Medio usa un nivel de bloom y alto tres. No se agregan estados de simulación; se usa el orden real del ABI (`wallHit`/`enemyHit` antes de `shot`). Las tarjetas visuales no tienen su propia colisión ni emiten eventos.

`PREM_CAPTURE=1 bunx playwright test tests/e2e/premium.spec.ts` sirve `dist/` y escribe `/tmp/prem-{spawn,landmark,impact,menu,results,mobile}.png`. Los contadores reales a 1280×720, con impactos/casquillos y nodo rastreado, fueron:

| Preset | Primer cuadro (incluye refresco de sombra cuando aplica) | Cuadro estable |
|---|---:|---:|
| Alto | 33 draws / 78.692 tris | 29 / 40.986 |
| Medio | 29 draws / 78.688 tris | 25 / 40.982 |
| Bajo | 19 draws / 40.976 tris | 19 / 40.976 |

La revisión de interfaz cubre menú, briefing, juego, las cinco pestañas de pausa y resultados a 1280×720, 1024×768, 390×844 y 320×640, con desplazamiento vertical donde corresponde. Cero errores de consola/página en esas sesiones. La captura de resultados usa un final controlado en el límite de la interfaz, no una partida ganada. El humo ondula sin refracción de pantalla; los casquillos no chocan con cada elemento de escenografía. Desde el spawn en retrato, la esclusa queda mayormente fuera del campo frontal.

## Revisión visual

- **Pilares:** dobles pilastras, luz rasante y estarcido `SECTOR 01`; el contraste del grano baja a distancia.
- **Cobertura:** biseles, paneles hundidos, nervios y banda de peligro; el acero diamantado se repite demasiado en el techo.
- **Servicios:** tubos rígidos, bucles de cable y ventilas de lamas; las ventilas se leen mejor al acercarse al perímetro.
- **Plantas:** dos jardineras de hojas plegadas; visibles, aunque estilizadas y facetadas.
- **Piso:** húmedo, con brillo rugoso y bandas, no reflejo de pantalla.
- **Color y atmósfera:** naranja bajo y cian arriba, niebla de distancia y halos locales. Bloom en medio/alto; no se usa en bajo.
- **Armas:** tres siluetas procedurales, con marcas y piezas móviles; ver el desglose y la variante de respaldo a continuación.
- **HUD:** el degradado superior protege la puntuación y los objetivos sin cambiar las luminarias; el simulador no repite su etiqueta.

## Consolas de red (Rewards/interactables: 1 → 2)

La silueta de 2,70 m separa pedestal, teclado inclinado, monitor hundido y baliza. Desde el carril a 20 m se reconoce como consola sin tarjeta de objetivo; no se lee aún el estado fino. El teclado de 18 teclas, la palanca, el mazo de tres cables con placa de piso, el estarcido y los tornillos dan escala y función. No cambia ningún AABB.

| Estado | Lectura sin color | Luz y respuesta |
|---|---|---|
| Espera | ◇, pantalla estática, barra vacía | Un segmento ámbar tenue |
| Canalizando | ◈, anillo, registro en movimiento y porcentaje en ascenso | Columna menta que se llena, pulso suave; el anillo de la mira refleja el mismo progreso que el HUD |
| Activa | ◆ con candado, `LINK LOCKED`, 100 % y confirmación del HUD | Destello con barrido, aceleración de la baliza y columna fija; se conserva el sonido original |

Con movimiento reducido no hay giro, pulso, destello ni desplazamiento del registro. El metal/hormigón se incorporan a los lotes PBR existentes; un solo draw instanciado comparte los tres estados y un atlas canvas. El atlas repinta a un máximo de 10 Hz si cambia un monitor visible o rastreado. No se suma otro borde emisivo al objetivo.

`TERM_CAPTURE=1 bunx playwright test tests/e2e/terminal-console.spec.ts` captura desde `dist/` en Chromium táctil (`/tmp/term-{20m,8m,close,channel,flash,active,mobile}.png`, más las tres tomas en gris). En alto, los cuadros estables del sector registraron **22–24 draws, 31.250–31.666 triángulos**. La comparación con el lote dinámico oculto midió **+1 draw total**; la vista de 8 m previa al cambio registró 21 draws y 23.198 triángulos. No basta para un 3: el monitor se pierde de perfil y no se verificó lectura durante un giro rápido o bajo combate.

## Viewmodels (Hero/player: 1,5 → 2)

| Arma | Silueta y detalles | Triángulos / draws activos (bajo, medio y alto) |
|---|---|---:|
| PB-01 | Corredera facetada con estrías, cañón expuesto, punto de mira y alza abierta, base de cargador saliente y una tira de estado. | 1.232 / 6 |
| AR-04 | Riel mecanizado, guardamanos calado, cargador inclinado con orificios, culata abierta en corredera, empuñadura independiente, puerto de expulsión con manija, freno de boca, miras abatibles, visor con lente y punto menta, anilla y dos cables con anclajes. | 3.922 / 8 |
| SG-08 | Cuerpo corto y ancho, guardamanos de bombeo estriado, cañón y tubo en paralelo, choque escalonado, culata maciza y marcas ámbar de servicio. | 1.894 / 6 |

Los biseles captan el borde de luz; el polímero mate `#222932`, el caucho y el metal fresado son lotes distintos. Se reutilizan los mapas `metal_*` de la arena con el relieve y el patrón de placa atenuados. Los códigos, números de serie y triángulos son estarcidos geométricos. El punto del AR-04 se intensifica en ADS. Los eventos `shot` mueven la corredera/cerrojo y calientan brevemente la boca; ni esa animación ni las envolventes locales de contacto de empuñadura/guardamanos cambian la colisión simulada. El destello y la trazadora parten del ánima abierta. El encuadre de cadera se verificó en 1280×720, 1280×590 y 390×844. Los guantes se descartaron: los dedos parecían piezas sueltas y no justificaban tapar la silueta.

El juego no solicita GLB por defecto. Para comparar con Kenney, abrir `/?viewmodel=kenney` (`Renderer.Hooks.authoredViewmodel: false` para un consumidor del renderizador). Si falla la carga, queda el modelo procedural. El respaldo no cambia los archivos CC0.

La arena se dibuja a 75° verticales (ACES y bloom en medio/alto). Después se limpia solo profundidad y se dibuja el arma a 70°, con plano cercano a 0,025 m: la lente más estrecha conserva las proporciones del primer plano. El arma tiene luces propias de hemisferio, clave, relleno y cámara, y usa el mismo PMREM. Su pase directo mantiene ACES pero no recibe bloom ni MSAA del compositor; el destello lleva un halo suave en su propia textura. Trazadoras, humo, picaduras, chispas y casquillos siguen usando profundidad de la arena.

Una consulta visual del rayo de mira contra los AABB del sector empieza a recoger el arma a 1,35 m y llega al máximo a 0,42 m. Acorta el alcance visual hasta un 24 %, baja el anclaje 6 cm e inclina el cañón unos 6°; vuelve a su posición algo más despacio que al recogerse. No cambia la mira, la colisión ni el disparo simulado. Es un rayo central, no un volumen del arma: las aristas laterales no activan por sí solas el gesto.

`ART_CAPTURE=1 bunx playwright test tests/e2e/assets-review.spec.ts` sirve `dist/` y captura Chromium táctil en `/tmp/vm-{wall,ads-wall,play,mobile}.png`, además de las fichas `/tmp/hero-{sidearm,rifle,scatter,play,ads,mobile}.png` y sus primeros planos en gris. La prueba empuja al jugador contra el pilar del sector y compara la máscara del arma del cuadro real con la del arma aislada; sin limpiar profundidad, la silueta desaparece en bajo. El presupuesto anterior mide el modelo sin destello. Un disparo con el AR-04 a 1280×720, sin reconstrucción de sombras, registró:

| Preset | Mundo (incluye post) | Arma + destello | Total |
|---|---:|---:|---:|
| Bajo | 12 draws / 39.522 tris | 9 / 3.924 | 21 / 43.446 |
| Medio | 18 / 39.552 | 9 / 3.924 | 27 / 43.476 |
| Alto | 23 / 39.580 | 9 / 3.924 | 32 / 43.504 |
