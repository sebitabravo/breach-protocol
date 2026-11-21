# ADR 0003 — Replay-verified leaderboard

- Status: accepted
- Date: 2026-11
- Deciders: project owner

## Context

A browser game's leaderboard is only as honest as its submission path. The usual
design (client posts `{ score }`) is forgeable with one `fetch`. Obfuscation and
signatures held by the client do not change that: the client holds the key.

The simulation is already deterministic Rust (fixed 1/60 s step, seeded xorshift
RNG, no host state), which makes a stronger design possible.

## Decision

The client submits the **input log** of the run, not a score. The server
re-simulates it with the same `bp-core` crate and computes the score itself.

- The crate compiles to `wasm32` for the browser and natively inside a Vercel Rust
  Function. `core/src/replay.rs` defines the `BPL1` log (header: mode, map, flags,
  seed, ticks; body: run-length encoded quantized inputs) and `replay::run`.
- Inputs are quantized (movement to `i8`, look deltas to `i16` at 4096 units/rad)
  *before* the simulation consumes them, so the log is exactly what the sim saw.
- All transcendental math goes through the pure-Rust `libm` crate. `f32::sin` and
  friends delegate to the platform libm and can differ by one ulp between native and
  wasm32, which diverges a replay within seconds.
- Hosts never choose `dt`: `bp_tick_fixed` always advances `FIXED_DT`.
- Daily boards derive sector and mutator from the UTC date seed inside the core, so
  the server can reject a log whose header disagrees with the date. They require a
  finished run or a replay at the cap; mission boards still require a win.
- Overflow requires at least 60 simulated ticks and a replay-confirmed kill or
  natural death. Stopping the log does not count as dying. Clients can submit a
  capped prefix; it is scored at its last recorded tick and must still qualify.

## Evidence

- `core/src/replay.rs::golden_hash_is_pinned` pins the final-state hash of a
  4000-tick scenario natively. `tests/unit/determinism.test.ts` asserts the wasm
  produces the same 64-bit value, and that replaying a recorded wasm run reproduces
  the live state bit for bit on all three sectors.
- v3 adds a sixth cross-target pin (`825227913700778631`): a real Sector 01
  input sequence activates a terminal and advances the director. Existing pins
  0–4 stay unchanged; none completed a terminal.
- That cross-check found a real bug: `Game::reset` kept stale event-ring state, so a
  restarted match diverged from a fresh replay. Fixed, with a regression test.

## Consequences

- Forged scores are rejected (HTTP 422); the score on the board is computed by the
  server.
- Changes to simulation behaviour can change golden hashes and invalidate old logs.
  The submission API reports a score version and logs carry `LOG_VERSION`. All
  score versions and `LOG_VERSION` are now **4** (v2 preserved ammo on weapon switch;
  v4, from the `fix/game-audit-pass` audit, made mouse look 1:1, fixed the fire cadence,
  anchored patrols and added the `RELOAD_END` event; the golden and scenario pins in
  `core/src/replay.rs` are the current ones, not the numbers quoted above).
  With identical seed and inputs, a completed terminal now changes the wave, spawn
  schedule and enemies encountered, which can change survival and score. Overflow
  terminals no longer reset on a clear: repeatable healing and score let players
  farm the same terminals on the verified leaderboard. Overflow remains untimed
  and death-only; mission and Daily still extract after the third activation.
  The BPL1 encoding, snapshot layout and fixed-step ABI are unchanged; the ABI now
  also exposes `bp_score_version`. The v4 decoder rejects older logs. Before
  deploying v4, start with empty leaderboard storage (or archive and clear existing
  board entries); Redis keys are not versioned, so a version bump alone does not
  remove old scores.
- Weapon unlocks are client-side progression. BPL1 cannot prove a prior SECTOR_02
  win, so the server rejects runs with the SG-08 flag.

## Límites conocidos

- La semilla pública permite reintentar offline hasta conseguir una partida favorable.
- El replay no puede impedir los aimbots.
- Las partidas de Overflow que superan el máximo de ticks se puntúan por el prefijo registrado.
