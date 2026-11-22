# Product reset: recover a compact arcade FPS from accumulated iterations

Diagnosis of deviations from the declared vision and a staged complexity-reduction plan.
No new mechanics, no rewrites, no technology migration. Every removal decision waits for an
explicit dependency analysis and the owner's call.

## Specs

S1. Recover the existing concept, do not build another game: "Tu responsabilidad es recuperar el
    concepto original y profesionalizar la implementación existente, no desarrollar otro videojuego."

S2. Core loop is the product: start fast, enter a 3D arena, move and shoot with satisfying controls,
    fight robots in waves, survive, score, end and retry immediately. Matches of 2-5 minutes.
    "El núcleo del producto es un FPS arcade compacto, fluido, visualmente cuidado y rejugable."

S3. Identity is not up for invention. The interface follows https://sebita.dev/ and the local
    portfolio checkout ("Resolución"): monochrome palette, Geist Pixel and Geist Mono, 8 px grid,
    minimal editorial aesthetic, discrete animation, defined type hierarchy.
    "No inventes una nueva identidad gráfica." / "No conviertas el menú ni el HUD en un dashboard
    cyberpunk lleno de elementos decorativos."

S4. The 3D world keeps an industrial sci-fi look with credible materials, atmospheric lighting and
    controlled effects. Interface and world are related systems with different jobs.

S5. Scope stays at arena, player, one well-implemented weapon, one or two enemy types, combat,
    waves, health and ammo, score, menu, pause, essential settings, results, retry, brief tutorial,
    PC and touch controls.

S6. Additional features are classified CORE / SUPPORT / OPTIONAL / EXCESS / UNKNOWN and nothing is
    removed automatically: "No elimines contenido ni código automáticamente. Presenta su impacto y
    dependencias antes de retirarlo."

S7. Over-engineering is judged by demonstrated debt, not by file or line count: "Diferencia deuda
    técnica demostrada de simples preferencias de estilo." Simplify responsibilities, dependencies
    and execution flow, not volume.

S8. UX is reduced to the screens that are needed: main menu (identity, play, how to play, settings),
    gameplay HUD (health, ammo, wave, score, current objective only if necessary, touch controls),
    pause (continue, restart, settings, quit to menu), results (score, waves survived, essential
    statistics, retry, back to menu). No redundant menus, no options without real functionality.

S9. Gameplay first: verify that moving, aiming, shooting, hitting, dodging, surviving and retrying
    is fun before improving effects, models or interfaces. "No añadas nuevas mecánicas mientras las
    existentes presenten problemas importantes."

S10. Optimisation proportional to the game, measured before and after: "No agregues complejos
     sistemas de optimización si no existe un cuello de botella que los justifique." Never declare a
     performance improvement without a measurement. Do not reduce visual quality indiscriminately.

S11. Staged recovery: freeze scope and register a recoverable state in Git, audit, simplify the
     product, reduce technical debt in small justified refactors, recover visual identity against
     the real tokens, validate on PC and mobile.

S12. Restrictions: no rewrite from scratch, no technology migration without evidence, no new
     mechanics, no unnecessary architectural patterns, no excessive documentation, no deletion
     without dependency analysis, no design changes on personal taste alone, no copying
     halloween.dev.

## Diagnosis

State frozen for recovery: four commits on `feat/visual-combat-pass` (tooling, research docs, render
systems, world+UX). Suite at that point: 506 unit tests green, typecheck and build clean.

### What is already solid (do not touch it)

- Simulation is a Rust/WASM fixed-step core with zero-copy snapshot reads and no per-frame
  allocation on the hot path (`src/wasm/bridge.ts:238`, `src/core/loop.ts:1`), deterministic and
  covered by golden-hash tests (`core/src/lib.rs`, `tests/unit/determinism*`).
- Rendering is cheap for what it draws: 16/21/26 draw calls and ~47.8k triangles at 60 fps versus
  the reference study's 138-152 draws and ~150k triangles on the same machine (`docs/research/
  PERFORMANCE_BENCHMARKS.md`).
- Gameplay numbers are coherent: walk 4.7 / run 6.9 m/s with 62 accel and 11 friction
  (`core/src/player.rs:21`), hitscan resolved in the same tick as the input
  (`core/src/sim.rs:548`), TTK 1-4 shots per enemy class (`core/src/weapons.rs:33`), 3:00 match
  window (`core/src/sim.rs:20`).
- Only one runtime dependency (`three`), justified. The safety net (unit + e2e + determinism) is
  real, not decorative.

### D1 — Identity drift is the largest and most visible deviation (S3, S4)

The interface stopped speaking the portfolio's system and invented its own. Measured against
`/Users/sebitabravo/Developer/portfolio` tokens:

| Role | Resolución | This project | Consequence |
|---|---|---|---|
| Display face | Geist Pixel 400, ls 0 | system sans 700 | headlines read as a different brand |
| Brand colour | none: monochrome fg/bg inversion | mint `#5ce08b` + `#4de3c6` on CTAs, focus, tabs | everything signals "mint game" |
| Neutrals | `#000/#141414/#262626` pure | `#080f14/#101820/#2e3f4f` blue-black | permanent blue cast on every screen |
| Body | Geist Mono 15/24 | system sans 16/24 | different voice on every paragraph |
| Surfaces | flat `--fill` + 1 px border | `linear-gradient` panels and sheets | sheen the system forbids |
| Motion | 80 ms `steps(4)` / 480 ms `steps(8)`, press = `translateY(2px)`, disabled = colour swap | 120 ms `steps(3)` / 220 ms bezier, `opacity:.45` disabled | the UI feels smooth where it should feel stepped |

Defensible exceptions, keep them: danger/warning colours and damage feedback (a shooter needs a
failure vocabulary), HUD scale, scrims, vignette, circular crosshair/minimap/touch targets, and the
engineering overlay's own dialect.

### D2 — Scope grew past the declared core (S5, S6)

Present and not in the brief's core list: sectors/campaign chain with briefings
(`src/core/sectors.ts:20`), overflow/daily/practice modes (`src/core/screens.ts:18`), a
server-verified leaderboard with replay re-simulation (`src/net/leaderboard.ts:89`, `server/`),
shotgun unlock gated behind S02 clear (`src/core/weapons.rs:79`), an achievements/streak/record
layer (`src/core/progress.ts:32`), an About screen, an engineering mode surfaced in the player menu,
and a two-locale copy layer that triples every string (`src/core/game.ts:230`,
`src/ui/settings-form.ts:48`). These are not bugs; they are product surface that competes with the
core loop and with 2-5 minute sessions.

### D3 — Flow friction before the first shot (S2, S8)

Eleven screens in the state machine (`src/core/screens.ts:11`). Shortest boot-to-shooting path is two
clicks plus a load (menu → calibrate → simulator), but the default path adds sector selection and
briefing. `calibrate` is a forced gate for a first-time player and duplicates settings that already
exist in the pause pane (`src/ui/settings-form.ts:28`).

### D4 — Duplication of truth, the highest-value debt category (S7)

- Eye height and player dimensions exist in three places: `core/src/player.rs`,
  `src/render/camera.ts:15` (`EYE_HEIGHT=1.62`) and `src/render/terminal-model.ts:26`.
- The brand colour exists in CSS (`src/styles/tokens.css:18`), in `src/render/themes.ts:12`, and
  hard-coded again in `src/ui/hud.ts:406` and `src/ui/engineering.ts:212`.
- The graphics-effect list exists in three places: `GFX_KEYS` (`src/core/settings.ts:19`),
  `GFX_EFFECTS` (`src/ui/settings-form.ts:69`) and `resolveGfxPlan` (`src/render/presets.ts:76`).
- Match length lives as 180 s in `core/src/sim.rs:20`, as `3:00` in HUD copy, and as "Completá antes
  de 3:00" in `src/core/sectors.ts:28`.
- Locale strings are sourced from `BOOT_COPY`, `GFX_LABELS` and static Spanish markup.

### D5 — Three things govern resolution, one owner needed (S7, S10)

`QualityController.sample` (`src/core/quality.ts:200`), the newer `AdaptiveScale.sample`
(`src/core/quality.ts:300`) and the persisted `bp.gfx.tier` record (`src/core/settings.ts:150`) all
change render resolution. Each was added with measurements, but precedence lives in comments and in
call order rather than in one policy object. This is the clearest demonstrated architectural debt the
reset should fix — by consolidating the decision, not by deleting the measured features.

### D6 — Oversized modules (S7)

`src/core/game.ts` exceeds 1,295 lines and mixes boot, flow, settings application, input wiring and
HUD orchestration; `src/render/renderer.ts` mixes scene ownership, quality application, adaptive
scale and debug overlays. Size is not the defect — mixed responsibilities are.

### D7 — Unverified items (S6, S11)

Dead code and true line counts need tooling (`knip`, `wc -l`) that was not run; `server/` and
`api/` reachability was not audited; the no-hack-minigame claim is a grep-level inference. These stay
UNKNOWN until checked.

### Decisions the owner must make (S6)

1. **Server-verified leaderboard + replay re-simulation.** Classified EXCESS for a compact arcade
   game, but it is also the strongest single engineering artefact in the repository for a portfolio
   audience. Recommendation: keep it and decouple it — local best score is always the default path,
   the server board becomes an explicit, clearly-labelled feature.
2. **Overflow / daily / practice modes.** Cost is four match paths, several board keys and copy.
   Recommendation: reduce the visible entry points to "Jugar" and, at most, one secondary mode;
   keep the code paths only if they are already covered by tests and cost nothing to maintain.
3. **Two locales.** Recommendation: keep the capability, collapse it to one source of truth; the
   defect is triple-sourced strings, not bilingual support.

## Plan

Ordered by (value ÷ risk). Each stage is one bounded unit with its own validation.

- **P1 Identity recovery (S3, S4).** Adopt the Resolución tokens: pure-neutral palette
  (`#000/#141414/#262626` family), Geist Pixel for display and Geist Mono for body, the stepped
  motion language (80 ms `steps(4)` feedback, 480 ms `steps(8)` entry, `translateY(2px)` press,
  no opacity-based disabled), remove gradient panel fills, keep 1 px borders. Keep the gameplay
  state colours and every HUD/3D element that serves readability. The world's materials and fog stay
  untouched. Risk: low — tokens and CSS only. Validation: screenshots of every screen before/after
  plus a token diff against the portfolio.
- **P2 Single sources of truth (S7).** One owner for player dimensions, palette, the graphics-effect
  list and match length; derived values import instead of mirroring. Risk: low. Validation: unit
  tests pinning the derivation, plus a grep gate that fails on a re-introduced literal.
- **P3 One resolution owner (S10).** Consolidate preset, adaptive scale and persisted tier behind a
  single policy that exposes the decision and its reason; keep every measured behaviour. Risk:
  medium — touches the quality path, so before/after frame rows are mandatory.
- **P4 Flow simplification (S8).** Menu shows identity, Jugar, Cómo jugar, Ajustes. Remove the forced
  calibrate gate (becomes a first-run hint), take engineering mode out of the player menu behind a
  dev flag, and reduce mode entry points per the owner's decision. Risk: medium — the flow is covered
  by `tests/unit/flow*` and `tests/e2e/screens*`, which must be updated deliberately, never skipped.
- **P5 Oversized-module split (S7).** Extract boot/flow application from `game.ts` and debug overlays
  from `renderer.ts` into owned modules, with no behaviour change. Risk: medium; do it last, after the
  tests that pin flow are already adjusted in P4.
- **P6 Module capture (S9, S11).** Verify the core loop end to end on PC and in both mobile Playwright
  projects after P1-P5, with the baseline frame rows as the regression reference. Mobile GPU FPS
  remains unmeasured until a physical device is available; no claim will be made without one.

Out of scope, by the brief: no new mechanics, no engine migration, no rewrite, no deletion before its
dependencies are listed, no tuning pass on gameplay feel without a playtest session.

## Log

L1. Brief delivered verbatim as the mission: product reset and technical-debt reduction for SEBITA:
    BREACH PROTOCOL, with stages, acceptance criteria, restrictions and the instruction
    "Empieza comparando el estado actual con esta visión. Entrega primero un diagnóstico de
    desviaciones y un plan de reducción de complejidad. Después aplica las correcciones de forma
    incremental, validando cada cambio."

L2. Etapa 1 executed: the working tree was frozen in four commits on `feat/visual-combat-pass`
    (tooling, research docs, render systems, world+UX) with 506 unit tests, typecheck and build green
    before the first commit, so the reset starts from a recoverable state.

L3. Audit evidence: two read-only audits were run (visual identity against the portfolio tokens, and
    product/scope/over-engineering against the declared core). Findings with locators are folded into
    D1-D7 above. Items the audits could not establish are marked UNKNOWN rather than assumed.
