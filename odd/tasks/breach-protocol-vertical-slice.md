# breach-protocol — playable vertical slice

Rust simulation core (`bp-core`) compiled to WebAssembly, driven by a TypeScript + Three.js
renderer and a DOM/CSS HUD in the Resolución-inspired visual language. Arena `SECTOR_01`.

## Specs

S1. The simulation core is written in Rust and shipped as WebAssembly, so the game keeps
    deterministic fixed-step logic and native-speed hot loops in the browser: "si el compilador
    puede estar en ese lenguaje para que sea rapido y todo funcione en un buen performance".

S2. The deliverable is a finished, running game, not a scaffold: "hasta que el jeugo no lo
    termines y no este funcionando no pares".

S3. FPS arcade, single player, runs in desktop and mobile browsers with no install and no
    sign-up. Keyboard + mouse and real multitouch (independent `pointerId` per control) are both
    first-class.

S4. Match loop: `Protocol Run` of 180 s max, 5 waves, 3 recoverable network terminals.
    Activating all three starts a 12 s extraction window; surviving it wins. Losing all health
    or running out of time loses.

S5. Terminal channel: hold `E` / the touch button inside 1.8 m for 1.2 s. Releasing or taking a
    hit above 15 damage cancels it. Activating a terminal is worth 500 score.

S6. Enemies are deterministic finite-state machines, never LLMs: `Scout` (chase + melee windup)
    and `Sentinel` (scan, aim telegraph, 3-shot burst with line of sight). AI decides at 12 Hz,
    movement integrates every fixed step.

S7. Two hitscan weapons in data tables: `PB-01` semiautomatic sidearm and `AR-04` automatic
    carbine, both with magazine, reserve, reload, spread and recoverable recoil. Headshots score
    double damage.

S8. Deterministic simulation: 60 Hz fixed step, seeded RNG, no frame-rate-dependent movement.
    The same seed and the same input sequence produce the same world state.

S9. Visual identity: dark technical surfaces, 8 px grid, thin 1 px frames, mono/pixel typography,
    one mint accent used only for action and objective state, one danger accent for damage.

S10. UI screens: boot/compatibility, home, calibration, HUD, pause with settings tabs, results,
    and a live Engineering Mode with real metrics (FPS, P50/P95 frame time, draw calls,
    triangles, simulation ticks, dropped ticks, quality preset, DPR). No fake numbers.

S11. Accessibility: sensitivity and Y-invert, HUD scale, handedness, auto-reload, touch aim
    assist, reduced motion, audio toggle, keyboard-navigable menus, visible focus.

S12. Engineering quality: Rust unit tests for every simulation rule, Vitest for TypeScript
    modules, a Playwright smoke test that boots the game and proves the loop advances, CI for
    the whole pipeline, and documentation of the architecture decisions.

S13. Pause/safety rules: pointer lock released on pause, no accumulated simulation time on
    resume, simulation stops on `visibilitychange`/`blur`, WebGL2 absence shows a recoverable
    fallback screen instead of a blank page.

S14. Assets are procedural or CC0 only. No commercial game assets, no runtime dependency on
    `sebita.dev`, fonts referenced from a documented fallback stack pending license review.

## Tasks

| ID | Task | Specs | Route | Commit |
| --- | --- | --- | --- | --- |
| T1 | Scaffold repo, Vite + TS strict, Rust crate, wasm build script | S1, S12 | inline | — |
| T2 | Rust math, AABB arena, raycasts | S1, S8 | inline | — |
| T3 | Rust player controller, collision, movement feel | S3, S8 | inline | — |
| T4 | Rust weapons, hitscan, damage, recoil | S7, S8 | inline | — |
| T5 | Rust enemy FSM (Scout, Sentinel), spawn, waves | S6, S8 | inline | — |
| T6 | Rust terminals, phases, scoring, snapshot + events ABI | S4, S5, S8 | inline | — |
| T7 | wasm bridge + no-copy snapshot reader in TS | S1, S8 | inline | — |
| T8 | Three.js renderer: arena, instanced cover, enemy views, viewmodel, FX pool | S9 | inline | — |
| T9 | Input: pointer lock, keyboard, multitouch with pointerId | S3, S13 | inline | — |
| T10 | HUD, minimap, screens, settings, results, engineering mode | S10, S11, S13 | inline | — |
| T11 | Web Audio synthesized SFX, persistence, quality controller | S9, S11 | inline | — |
| T12 | Tests: cargo, vitest, playwright smoke; CI; docs | S12 | inline | — |

## Log

L1 (verbatim user request):
> ya mira quiero que realices el sigueitne proyecto lo que si mira yo estoy muy visiado con la
> tecnologia de rust entonces si el compilador puede estar en ese lenguaje para que sea rapido y
> todo funcione en un buen performance seria perfecto. utiliza internet, mcp todo lo que este al
> alcance porfavor para que realices bien el trabajo eso que dale levanta agenes y hasta que el
> jeugo no lo termines y no este funcionando no pares porfavor.

L2 (decision): the human's Rust preference overrides the original spec's TypeScript-only
recommendation. Simulation goes to Rust/WASM; rendering and UI stay on the web platform
(Three.js + DOM) because shaders and accessibility live there. ADR-0001 records the tradeoff.

L3 (decision): the attached design mockups are the newer explicit visual direction and use a
dark blue-black palette with a mint accent, which the spec's §5.2 monochrome rule does not
allow. Human instruction outranks the document; ADR-0002 records the conflict and the chosen
tokens.

L4 (decision): no third-party asset downloads. Arena, weapons, enemies, reticle and audio are
procedural, so provenance is trivially auditable and the payload stays inside budget.

L5 (slice record, 2026-11-20): v0.3 landed as one integration pass by parallel workers, so the
branch is recorded in six reviewable slices rather than invented intermediate states. Each slice
is self-contained by path and the tree was green at every boundary.

- 1f1684a chore(toolchain): move the whole toolchain to Bun
- eacc07e chore(agents): vendor the project-level game-dev skills
- 50f5508 fix(leaderboard): close two replay exploits and harden submission
- 60ac655 feat(art): real CC0/MIT assets, authored weapons and an industrial arena
- 5f74801 feat(gameplay): terminal-driven waves, objective markers and tutorial handoff
- 5ecaf78 perf(boot): paint the shell without three.js and stop shipping sourcemaps

Authored size: ~16.6k changed lines, past the ~400-line guideline. Rationale: the pass touched
system boundaries (Rust sim, replay verification, server, renderer, HUD) that were developed and
verified together; splitting mid-file would have produced commits that never compiled. Next
feature should return to one slice per behaviour.
