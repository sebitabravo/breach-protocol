# ADR 0002 — Dirección visual según los mockups del humano

- Estado: aceptado
- Fecha: 2026-11 (vertical slice)
- Decide: el humano, dirección del proyecto

## Contexto

`SPEC.md` §5.2 definía una identidad visual monocromática ("Resolución": una
sola tinta técnica sobre superficies oscuras). Los mockups que el humano adjuntó
después contradicen esa regla: paleta azul-negra oscura con un acento menta
(~`#5ce08b`) y un acento de peligro (~`#ff5b6b`).

## Decisión

La dirección visual más reciente del humano gana sobre el documento. El juego
implementa los tokens de los mockups:

- Superficies técnicas oscuras azul-negras (fondo base ~`#080f14`, definido en
  `src/styles/tokens.css`).
- Un acento menta reservado para estado de acción y objetivo (retícula,
  nodos activos, feed positivo).
- Un acento de peligro para daño y alertas.
- Retícula de 1 px, marcos finos, tipografía mono/pixel y grilla de 8 px.

## Tradeoff

- Se pierde la pureza monocromática del §5.2; a cambio, el juego coincide con
  el material de diseño que el humano aprobó explícitamente.
- Los tokens son derivados de los mockups del humano, **no** copiados de
  sebita.dev; la proveniencia queda documentada en
  `THIRD_PARTY_NOTICES.md`.
- Si los mockups vuelven a cambiar, este ADR se actualiza o se supersede; el
  punto de verdad del color es `src/styles/tokens.css`.

## Consecuencias

- `SPEC.md` §5.2 queda marcado como superado por decisión del humano para
  paleta y acentos.
- Los tests de UI no pinean colores; el contraste y la legibilidad son
  revisables en Engineering Mode y en las capturas del smoke test de
  Playwright.
