# Investigación de assets y licencias (estudio halloween.dev)

Documento T3/T7 (S6, S11) de la tarea REA (`odd/tasks/rea-halloween-study.md`): qué
licencias publican los orígenes de assets evaluados, qué trampas enfrentan los assets en
un juego que se sirve por navegador, cómo debe exponerse la atribución CC-BY 4.0 en este
formato, qué opciones reales de pipeline existen y qué candidatos concretos por categoría
son legalmente reutilizables. Cada afirmación lleva la etiqueta del sistema de la tarea
(`CONFIRMADO`, `INFERIDO`, `NO VERIFICADO`); el detalle de observación de la referencia
está en [`HALLOWEEN_ANALYSIS.md`](HALLOWEEN_ANALYSIS.md) y las cifras propias en
[`PERFORMANCE_BENCHMARKS.md`](PERFORMANCE_BENCHMARKS.md).

**Aviso de alcance:** este documento describe qué licencias aplican y con qué límites; no vuelve reutilizable nada de la
referencia (S6). La referencia no publicó página de licencias ni
créditos, así que sus modelos, texturas y audio se tratan como fuera de límites (ver la
última sección). Los textos de licencia ya usados por este proyecto sí están capturados y
citados abajo.

## Por qué un juego de navegador es el caso duro

En un juego de escritorio, el código y el arte viven dentro de un binario: quien recibe
el asset es quien instala el juego y acepta una licencia de EULA. En un juego de
navegador **cada asset es una URL pública que cualquier visitante descarga** al abrir la
página: no hay una transacción de licencia previa, y el punto de descarga es el propio
producto. De ahí las restricciones que esta sección aplica por fuente:

- **La obligación de atribución de CC-BY vive dentro del producto.** Si una textura CC-BY
  viaja en el bundle, el receptor es cada visitante: la atribución no puede quedarse en el
  README del repositorio, donde el jugador nunca llega (`INFERIDO` del requisito de la
  licencia: crédito al recibir la obra). El proyecto ya lo aplica: los avisos viven en
  `THIRD_PARTY_NOTICES.md` con licencias copiadas en `public/assets/licenses/`.
- **ShareAlike contamina.** Un asset CC-BY-SA dentro del juego obliga a esa parte
  derivada a salir con la misma licencia: en un juego original, aceptar la contaminación
  de propósito es una decisión que solo el dueño puede tomar y que este proyecto no toma
  (`INFERIDO` del término ShareAlike de la CC; no hay dependencia ShareAlike en el árbol).
- **"Royalty-free" no es "dominio público".** Royalty-free elimina el pago por uso, no
  necesariamente el derecho del autor a prohibir la redistribución de los archivos crudos
  (`INFERIDO` del término; ver Sonniss abajo, donde la restricción es explícita).
- **Procedencia IA.** Los marketplaces alojan modelos generados por IA cuya licencia la
  declara el uploader, no el titular real del derecho: un asset puede llevar CC por parte
  de quien no tenía derechos para concederla. Requiere verificación de procedencia por
  pack, no confiar en el badge del sitio (`INFERIDO` a partir de la práctica actual de los
  marketplaces; ningún caso evaluado en este estudio dependió de un asset así).

## Lo que publica cada fuente evaluada

### Kenney — packs de assets del sitio

- **Licencia del sitio:** CC0 1.0 con una concesión redactada por Kenney que declara el
  uso comercial permitido sin pedir permiso ni exigir atribución. URL del anuncio de la
  política: `https://kenney.nl/support` (explicación citada también en `SPEC.md:358`).
- El texto exacto de esa concesión es **NO VERIFICADO** en este repositorio: no hay
  captura local de la frase. Lo que sí es `CONFIRMADO` es el uso que este proyecto hizo:
  `Starter Kit FPS` (repositorio GitHub de Kenney) entra bajo **MIT**, no CC0 — el texto
  está copiado en `public/assets/licenses/kenney-starter-kit-fps.txt` y registrado en la
  tabla de assets de `THIRD_PARTY_NOTICES.md`.

### Quaternius — QAL v1.0

- **Licencia declarada:** "Quaternius Active License" (QAL) v1.0, con URL del anuncio en
  `https://quaternius.com/licensing.html`.
- La cláusula decisiva: se permite el uso comercial del asset **dentro de un producto
  propio**, y se prohíbe **redistribuir o revender los assets en sí** ("as-is", incluso
  gratis). Esa prohibición de redistribución autónoma es la que separa QAL de CC0 y la
  que obliga a tratar un pack Quaternius como dependencia integrada, nunca como
  descarga re-subida.
- La cita textual exacta es **NO VERIFICADO** en este repositorio (sin captura del texto
  QAL). Lo declarado coincide con lo que la ficha del pack publica; verificar otra vez al
  descargar, como exige la política de assets del proyecto (`SPEC.md`, sección 6).

### Poly Pizza

- **Licencia por modelo:** cada ficha declara su propia licencia (mayormente CC-BY 4.0 u
  otras variantes, con autor visible); no hay una licencia única del sitio. URL:
  `https://poly.pizza`.
- **Efecto práctico:** una licencia por ficha — el crédito del autor del modelo debe
  llevarse al producto junto con el modelo. La redacción exacta de cada ficha es
  **NO VERIFICADO** en este repositorio; la estructura por-modelo es la práctica
  observable del sitio.

### Poly Haven

- **Licencia: CC0 1.0**, `CONFIRMADO` con captura local: `public/assets/licenses/polyhaven-cc0.txt`
  (fetched de `https://polyhaven.com/license` el 2026-11-20). La frase decisiva capturada:
  *"All assets ( HDRIs , textures and 3D models ) on this site are the original work of
  Poly Haven staff, or artists who willingly and directly donate/sell their work to Poly
  Haven. Our assets are all licensed as CC0"*.
- Este proyecto ya usa HDRIs de Poly Haven: `industrial_pipe_and_valve_02_1k.hdr` CC0 1.0
  registrado en `THIRD_PARTY_NOTICES.md`. Sin restricciones a vigilar más allá de la
  cortesía de crédito.

### ambientCG

- **Licencia declarada:** CC0 1.0 para todo el catálogo de materiales PBR — sin variantes
  por asset, todo el catálogo es dominio público homogéneo. URL:
  `https://ambientcg.com/license`.
- La cita textual exacta de ambientCG es **NO VERIFICADO** en este repositorio (sin
  captura local).

### Sketchfab

- **Licencia por modelo:** cada ficha declara una; entre las comunes: CC y las variantes
  de "Store Standard". URL: `https://sketchfab.com/licenses` (resumen) y ficha por modelo.
- **Store Standard** permite usar el modelo en un producto propio; la variante **Editorial
  use only** lo prohíbe fuera de usos editoriales: un juego no es un uso editorial, así
  que un modelo marcado así **no puede entrar nunca** en el proyecto.
- **Cláusula de no-extracción autónoma:** las descargas del sitio/API están sujetas a
  términos que prohíben usarlas para replicar el servicio o re-distribuir el contenido
  fuera de él: "descargar y subir a otro sitio" no es un uso concedido. La cita textual
  exacta de ambos puntos es **NO VERIFICADO** en este repositorio.

### Sonniss — packs GDC

- **Licencia: royalty-free para uso en productos, no CC0.** Los packs de audio que Sonniss
  distribuye con GDC conceden el uso sin pago en juegos y otros productos, y retienen el
  derecho de prohibir la venta o redistribución de los archivos de audio en sí. URL:
  `https://sonniss.com/gameaudiogdc`.
- Ese par (uso libre dentro del producto / redistribución prohibida) es el mismo orden de
  restricción que QAL. La cita textual exacta es **NO VERIFICADO** en este repositorio.

## Atribución CC-BY 4.0: los campos y dónde se exponen

CC-BY 4.0 obliga a dar crédito apropiado con un **nombre del creador, título de la obra,
enlace a la fuente y enlace a la licencia** (convención TASL: Title, Author, Source,
License), e indicar si la obra fue modificada. El código legal está en
`https://creativecommons.org/licenses/by/4.0/legalcode` (sección 3a); la traducción a
campos concretos es la práctica documentada de la CC (`INFERIDO` del requisito a una lista
de campos concretos).

En un juego de navegador los assets se sirven a todo visitante sin otra transacción, así
que la exposición debe ocurrir dentro del producto (`INFERIDO`, ver arriba):

1. Una pantalla de **"Créditos / Licencias"** alcanzable desde el menú del propio juego
   (humano-legible): lista por asset con autor, obra, fuente y licencia.
2. El **texto de licencia o su enlace** junto a cada entrada cuando la licencia lo pide.
3. Indicación de **modificación** si el proyecto retocó el asset (el proyecto ya lo
   declara: "atlas modificado" en `THIRD_PARTY_NOTICES.md` para el colormap de Kenney).
4. No delegar el cumplimiento a la página del repositorio ni a un archivo fuera del build.

## Pipeline: opciones reales con nombres de herramientas

Contexto propio medido (`PERFORMANCE_BENCHMARKS.md`): 9 texturas WebP 1024×1024 decodifican
a 48.0 MiB de VRAM con mips. Ese es el problema que un pipeline comprimido ataca.

- **KTX2 / Basis Universal.** Compresión transcodificable: la GPU recibe un formato
  nativo, no píxel descomprimido. Herramienta de autoría: **`toktx`** (del proyecto
  KTX-Software) genera `.ktx2` ETC1S/UASTC desde PNG/source. Runtime: el **`KTX2Loader`**
  de three (`three/addons/loaders/KTX2Loader.js`) con `.setTranscoderPath('/basis/')`
  sirviendo `basis_transcoder.js` + `.wasm`, y `detectSupport(renderer)` para decidir el
  formato por capacidad; fallback a WebP con el `TextureLoader` actual cuando el
  transcoder no está soportado.
  - El ahorro estimado para ETC1S (~6 MiB frente a los 48.0 MiB medidos) es
    **INFERIDO por formato, no medido con artefactos reales** (T5d quedó pendiente de la
    decisión de toolchain: `toktx`/`basisu` no estaban instalados).
- **Draco vs Meshopt para geometría.** Draco comprime más agresivamente pero su decodificador
  es pesado y típicamente corre de forma asíncrona (worker/promesa): más latencia de primer
  uso y coordinación extra. **Meshopt** usa un decodificador chico y síncrono; la
  referencia misma sirve Meshopt (`HALLOWEEN_ANALYSIS.md`, huellas de stack,
  `CONFIRMADO`) y este proyecto no depende de descargas GLB de terceros. La razón de
  preferencia aquí es operativa: el hilo principal ya corre una simulación WASM de paso
  fijo, y un decodificador grande o asíncrono compite por el mismo tiempo de frame
  (`INFERIDO`: razonamiento de ingeniería sobre coste, no una medición de este proyecto).
- Nota de alcance: hoy la geometría del juego es de autoría en código y los UVs existen
  para las texturas CC0/MIT ya registradas; el pipeline KTX2 es la opción identificada,
  no un cambio ya hecho en este proyecto.

## Candidatos legalmente reutilizables por categoría

| Categoría / necesidad | Candidato | Licencia | Restricción que aplica |
| --- | --- | --- | --- |
| Robots / mechs animados (fallback de silueta) | Quaternius — **Animated Mech Pack** | QAL v1.0 | Uso comercial solo dentro de un producto; prohibido revender o redistribuir el pack como tal (incluso gratis). Además: un mech riggeado GLB rompe la instancing de 1 draw por clase, por eso quedó como fallback documentado (L10 de la tarea) y no como cambio. |
| Modular sci-fi / piezas de arena | Quaternius — **Ultimate Modular Sci-Fi Pack** | QAL v1.0 | Ídem QAL: integrado al producto, nunca re-subido. Normalizar escala/color antes de mezclar con piezas propias si alguna vez entra. |
| Props industriales / sci-fi | Kenney — **Factory Kit** | CC0 1.0 (política del sitio de Kenney) | Sin atribución obligatoria; verificar la licencia del zip al descargar (política del proyecto). |
| Texturas PBR (suelos, paredes, metal) | **Poly Haven** y **ambientCG** | CC0 1.0 | Sin atribución obligatoria (crédito de cortesía); procedencia IA a verificar por asset igual que en cualquier marketplace. |
| HDRI de interiores | **Poly Haven** (HDRI) | CC0 1.0 | Ídem; ya en uso por el proyecto (`industrial_pipe_and_valve_02_1k.hdr`). |

Fuentes ya usadas y registradas en este repositorio (`CONFIRMADO`, `THIRD_PARTY_NOTICES.md`
y `public/assets/manifest.json`): Poly Haven (HDRI + las nueve texturas floor/wall/metal,
CC0 1.0) y Kenney Starter Kit FPS (MIT). Los decals, la geometría de la arena, los
enemigos y el audio son de autoría propia.

## Qué nunca se reutiliza y por qué

Los modelos, texturas y audio **entregados** por el juego de referencia (halloween.dev) no
tienen licencia publicada: no hay página de créditos ni grant de ningún tipo. **La ausencia
de una concesión significa que no hay permiso** — no CC0, no uso justo, no "estaba
público": nada autoriza copiarlos, redistribuirlos o imitarlos directamente. Por eso este
estudio los trata como fuera de límites y cada mejora de este proyecto se resolvió con
autoría propia o con orígenes con licencia publicada en positivo (S6, S7).
