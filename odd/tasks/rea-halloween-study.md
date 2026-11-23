# REA study of halloween.dev → measurable improvements for Breach Protocol

Technical research of a reference browser game (evidence-based, no asset reuse) and the
resulting, individually validated improvements to Breach Protocol. Reference study never
replaces this project's architecture; every change ships with a measured before/after.

## Specs

S1. Purpose is engineering reference, not imitation: `"No quiero una copia de halloween.dev.
    Quiero utilizar sus técnicas demostrables como referencia de ingeniería para mejorar mi
    videojuego original."`

S2. Sources of the study: `https://halloween.dev/`, `https://github.com/midudev/halloween-issues`,
    `https://github.com/morluto/rea`, `https://rea.tools/guides/browser/`, using the
    `reverse-engineer-anything` skill and REA's MCP tools plus browser/profiling tooling where applicable.

S3. Honesty about capability: `"No atribuyas capacidades a herramientas que no estén realmente
    disponibles."` and `"Si un análisis no es posible, documenta la limitación y utiliza otro
    procedimiento legítimo."`

S4. Every technique is labeled CONFIRMED / INFERRED / UNVERIFIED with its evidence, benefit,
    CPU/GPU/memory cost, suitability for a browser FPS, how it would be implemented here, and how
    the improvement would be validated. `"No atribuyas configuraciones exactas basándote
    solamente en la apariencia visual."`

S5. Do not assume features exist unless identified: `"No asumas que una funcionalidad existe si
    no se ha identificado."` Same for settings and debug surfaces.

S6. No third-party content reuse: `"No copies ni redistribuyas modelos, texturas, sonidos o código
    de terceros sin autorización o licencia compatible."` Unknown origin is labeled unknown.

S7. Preserve project identity: `"Mantén el diseño de sebita.dev, los colores, las fuentes y la
    identidad original de Breach Protocol."`

S8. No unjustified visual cost and no architecture swap: `"No introduzcas efectos visuales cuya
    mejora estética no justifique el costo de rendimiento."` / `"No reemplaces toda la
    arquitectura por otra solamente porque el juego de referencia utiliza una tecnología
    diferente."`

S9. Validation per improvement, in order: run the game, verify the affected functionality, run
    applicable automated tests, compare performance against baseline, check for regressions,
    repeat with the same configuration and device, check PC and mobile controls, record the result.

S10. Targets: PC reference 60 FPS stable; modest phone 30 FPS stable; capable phone 60 FPS when
     viable; gameplay preserved at reduced quality; minimize perceived load time; no memory leaks
     across repeated matches. `"Estos objetivos no reemplazan las mediciones reales."`

S11. Deliverables in `docs/research/`: `HALLOWEEN_ANALYSIS.md`, `ASSETS_RESEARCH.md`,
     `RENDERING_COMPARISON.md`, `PERFORMANCE_BENCHMARKS.md`, `OPTIMIZATION_CHANGELOG.md`.

S12. No generic advice and no unjustified changes: `"No quiero recomendaciones genéricas sin
     comprobar."` / `"No quiero modificaciones que no puedas justificar."` No invented numbers:
     `"No inventes comparaciones numéricas si no existen mediciones equivalentes."`

S13. Any improvement is classified by visual impact, performance impact, player-experience impact,
     complexity, regression risk, mobile compatibility and portfolio value; prioritize high impact
     with low risk.

S14. The reference game is now the **visual quality bar** for this project: `"el de hallowing.dev que te pase ese es nuestro estandar para nuestro juego y todo lo que tiene que tener y tambien como tiene que ser"`. This raises look, readability and feature completeness to that bar while S1 and S6 still bind: no copying its code, assets, layouts or art direction.

S15. Robots must read as robots: `"los robots no parecen robots"`. Silhouette legibility is a functional requirement, not taste — a player must identify a hostile machine and its class from silhouette alone, at arena distance, in low light.

S16. World scale must be believable against the player: `"las terminales son mas grandes yo"`. Props are sized from player eye height and door/opening dimensions, never from each other.

## Tasks

- T1 (S2, S3, S9, S10) — Phase-1 readiness + **measured baseline** of the current build
  (`bun run build` + `scripts/measure-frames.mjs` over low/medium/high, plus boot/payload numbers
  already recorded in `docs/PERFORMANCE_REPORT.md`). Record device, browser and methodology. → parent + verify
- T2 (S1-S5) — Reference study: player experience and screens, rendering pipeline, delivered
  assets and licenses, performance evidence, dev/debug surface. → explore + browser capture
- T3 (S6, S12) — Asset/licensing research and legally reusable equivalents. → explore
- T4 (S4, S12, S13) — Comparison table and prioritized improvement backlog with per-item evidence
  and measurement plan. → parent decision
- T5 (S7, S8, S9) — Implement the approved improvements, one bounded writer unit per area, each
  with its own before/after numbers. → writers
  - T5a (S7, S9, S13) — Per-effect graphics overrides, parity with the reference's
    `perf:{rain,shadows,lights,ao,bloom,fxaa,dof,grain}`. Our equivalents: `auto|on|off` for
    bloom, shadows, environment (PMREM reflections), practical lights and atmosphere mist.
    Pixel budget, MSAA and DPR stay preset-owned so the budget math is untouched. `auto` must
    reproduce today's behavior exactly. → writer
  - T5b (S9, S10) — Persist the verified quality tier keyed by a GPU signature (parity with the
    reference's `tld.gfx.v1` record: `sig`, `tier`, `verified`, `scale`), invalidated when the
    signature changes, so a returning player does not re-climb presets every session. → writer
  - T5c (S3, S9) — Boot resilience: explicit unsupported-browser path with minimum versions and a
    stall/recovery path for a boot that never completes (evidence: `halloween-issues` #20, their
    `boot-unsupported`/`boot-slow` states). We have a 4-check boot list and a context-lost screen
    only (`index.html:48-60`, `src/core/game.ts:250`). → writer
  - T5d (S6, S10) — Compressed texture pipeline (KTX2/Basis) behind a graceful WebP fallback.
    Justified by measurement: 9x 1024x1024 WebP decode to **48.0 MiB VRAM with mips**; ETC1S
    would land near 6 MiB. Blocked on a toolchain decision (`toktx`/`basisu` are not installed);
    generated `.ktx2` artifacts would be committed so CI needs no new dependency. → pending decision
  - T5e (S3, S12) — Engineering-mode overlays beyond the existing panel: scene/camera/collision
    visualization and draw-call attribution. → writer
  - T6a (S14, S15, S9) — Robot silhouette rework: each enemy class must read as a machine and be
    class-identifiable at arena distance. Hard-surface semantics (armour plates, angular visor
    with an emissive eye strip, chest core, shoulder pauldrons wider than hips, exposed joint
    cylinders, heavy or digitigrade legs), no human facial read. Keeps the current architecture:
    one `InstancedMesh` per class and the pose-texture skinning pipeline, no per-object materials.
    Owns the tris: total at high must not exceed the T1 baseline (L5) by more than 10% at an
    identical spawn count. → writer
  - T6b (S14, S16, S9) — World-scale audit of the objective terminals: size them from player eye
    height and the arena door/opening dimensions, screen plane at readable height, and pin the
    derivation in a test so a future change cannot silently re-inflate them. → writer
- T6 (S3, S12) — Engineering mode: diagnostics that are measurable in-project. → writer
- T7 (S11) — Write `docs/research/*` from observed evidence only. → writers
- T8 (S9, S10) — Validation pass: unit + Playwright projects (chromium, mobile-landscape,
  mobile-portrait), PC and touch controls, memory soak, regression check against T1 numbers. → verify

## Log

L1. `# REA — Investigación técnica y optimización avanzada de SEBITA: BREACH PROTOCOL` — full brief:
    6 phases (preparation/verification, reference investigation A-E, comparison, implementation by
    priority, validation, professional documentation), with the constraint block quoted in Specs
    above. `"Empieza configurando REA, investigando halloween.dev y construyendo la línea base de
    Breach Protocol. Continúa con las mejoras más valiosas y documenta cada resultado."`

L2. Phase-1 evidence already established before this task: REA installed project-scoped and
    connected (`rea: connected, 263 tools (codemode, project)`), browser tools present
    (`list_browser_targets`, `inspect_web_page`, `observe_web_session`, `analyze_javascript_application`).
    Chromium available: system Google Chrome 157.0.8103.79 plus Playwright `chromium-1254`
    and `chromium_headless_shell-*`. Playwright projects configured for chromium,
    mobile-landscape (Pixel 7) and mobile-portrait (iPhone 13); no WebKit project.

L3. Reference study, static recon (CONFIRMED unless stated): halloween.dev is a standalone
    Astro + Preact page hydrating a Preact game island; Three.js TSL build split into
    `three.core` + `three.webgpu`; `navigator.gpu` WebGPU path with WebGL2 fallback and public
    `?gfx=webgpu|webgl`; Meshopt decoder + KTX2/Basis transcoder under `/basis/`; tiered models
    `high|medium|lo` and `/ktx2/` variants selected from `hardwareConcurrency`, `deviceMemory`,
    `(pointer:coarse)`, screen width and GPU regexes; `?quality=low|medium|high` plus
    `localStorage tld.gfx.v1`; boot gate requiring `Safari 16.4, Chrome 111, Firefox 114`; staged
    audio (`.mp3` → `.webm` Opus when supported); CCTV feeds rendered at fixed 384x216 in a worker;
    public flags `?scene`, `?keepsrc`, `?bakeExport`, `?nomodels`, `?noktx2`, `?nolate`.
    Reported in-game overlay by users: `draws 146 · tris 153k`. Three.js revision UNVERIFIED.
    No license or credits page found → all reference code/assets treated as off-limits.

L4. own-project map (CONFIRMED until noted): WebGL2 `WebGLRenderer({antialias:false,
    powerPreference:'high-performance'})` `src/render/renderer.ts:418`; ACES tone mapping,
    exposure 1.08 `:427`; `PCFShadowMap`, 2048 high / 1024 medium, off at low `:434,508`; DPR
    clamped by `playPixelRatio()` + pixel budgets `src/render/presets.ts:18-35`; composer
    `RenderPass → UnrealBloomPass → OutputPass` with HalfFloat 4x MSAA on medium/high, direct
    render at low `src/render/postfx.ts:1-24`; PMREM HDRI environment `src/render/environment.ts:3`;
    WebP PBR maps via `TextureLoader` `src/render/surfaces.ts:30-53`; procedural canvas textures;
    instanced robots/terminals/FX; fixed-step WASM sim with reused views `src/wasm/bridge.ts:238`;
    quality controller on p95 windows `src/core/quality.ts:18-115`; engineering overlay with
    fps/p50/p95/calls/tris `src/ui/engineering.ts`; harness `scripts/measure-frames.mjs`
    (rAF deltas, per-preset, `--soak`, writes `test-results/frames-<label>.json`).
    Existing desktop baseline in `docs/PERFORMANCE_REPORT.md:33-110` (~59-60 fps at
    1600x900 DPR2 on an M3 after the 3.5MP cap); its mobile rows are explicitly empty.
    Settings that already exist (do not re-propose): quality, sensitivity (mouse/touch),
    invertY, handedness, autoReload, aimAssistTouch, reduceMotion, reduceFlashes, audio volume
    (master/sfx/ui), hudScale, telemetry, locale.

L5. Baseline measured with the repo's own harness, `bun run build` then
    `bun scripts/measure-frames.mjs --label baseline-t1 --presets low,medium,high --seconds 20
    --viewport 1600x900 --dsf 2` on Apple M3 / Chromium 157, fixed-seed scripted match:
    low 523x294 canvas dpr 0.33 → 60 fps, p95 17.6 ms, 16 calls, 47,954 tris;
    medium 979x551 dpr 0.61 → 60 fps, p95 17.6 ms, 15 calls, 39,384 tris;
    high 2494x1403 dpr 1.56 → 59.9 fps, p95 17.3 ms, 26 calls, 47,854 tris.
    Result JSON: `test-results/frames-baseline-t1.json`. Mobile rows remain unmeasured (no device).

L6. Reference measured by the parent with Playwright + an init-script WebGL instrumentation on
    the same machine. WebGPU is the default path (`?gfx` unset): contexts seen `webgl2`,`2d`,
    `webgpu`; adapter `apple`/`metal-3` with 25 features; canvas 900x706 backing on 1200x942 CSS
    at DPR 2 (reduced-resolution render). Forced `?gfx=webgl` and started the game: WebGL2 only,
    canvas 1500x1177, and **draws p50 138 / p95 152 / max 184**, **tris p50 149,495 / p95 152,903**,
    frame p50 16.7 ms / p95 17.7 ms / p99 49.5 ms, mean 41.1 fps over the sample including
    transition stalls. Its own graphics state (`localStorage tld.settings.v1`) exposes per-effect
    toggles `rain, shadows, lights, ao, bloom, fxaa, dof, grain, fps`; `tld.gfx.v1` caches
    `sig`(GPU string+context+viewport), `tier`, `verified`, `scale`, `shed`, `noHigh`.
    Limitation: the game forces low tier when `navigator.webdriver`/HeadlessChrome is detected, so
    automated runs cannot observe the tier a real desktop visitor gets.

L7. Own textures, measured: 9 WebP maps at 1024x1024 decode to 4.00 MiB each as RGBA8, 5.33 MiB
    with mips, **48.0 MiB total**; `dist/` payload 4.9 MB; `bp_core.wasm` 88,097 bytes.
    Reference first-20s transfer measured at 10.77 MB across 368 requests (scripts 524 KB in 77
    files, fetch 9.22 MB, media 809 KB, fonts 131 KB) — a raw byte comparison is not a fair
    performance ranking, but it shows the reference trades payload for look while we do not.

L8. Comparison verdict (evidence over opinion): on the same machine and the same 60 fps target we
    pay 15-26 draw calls and 39-48k triangles where the reference pays 138-152 draws and ~150k
    triangles. We is not slower — we render roughly 3x less geometry with 5x fewer draw calls, so
    the honest gap is not raw cost but per-pixel richness, mobile validation and user-facing
    control. Nothing here justifies changing renderer architecture.

L9. User direction change, verbatim: `"implementa todo lo que nos falta ya que el de hallowing.dev
    que te pase ese es nuestro estandar para uestro jeugo y todo lo que tiene que tener y tambien
    como tiene que ser porfavor por ekemplo los robots no parecen robots las terminasles son mas
    grandes yo y muchas cosas mas eso que investiga en interneet y dale porfavor para que el jeugo
    quede bien y estandarizado"`. Interpretation applied: quality bar = the reference; content
    source = still legally clean only (S6). The two named defects become S15 and S16.

L10. Design constraint carried into T6a: an imported rigged GLTF mech would break the
    one-draw-call-per-class instancing the T1 baseline depends on (L5/L8), so the robot fix is
    authored in code, not swapped for a downloaded model. Quaternius "Animated Mech Pack" (QAL:
    commercial use inside a product permitted, standalone resale forbidden) stays the documented
    fallback if code-authored silhouettes prove insufficient.

L11. Measurement intent for the visual units: before/after screenshots at a fixed deterministic
    camera plus harness rows (calls / tris / fps / p95) on the same build and machine, so a visual
    gain cannot be claimed without its frame cost.
