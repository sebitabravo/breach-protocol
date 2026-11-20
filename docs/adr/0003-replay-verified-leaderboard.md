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
  the server can reject a log whose header disagrees with the date.

## Evidence

- `core/src/replay.rs::golden_hash_is_pinned` pins the final-state hash of a
  4000-tick scenario natively. `tests/unit/determinism.test.ts` asserts the wasm
  produces the same 64-bit value, and that replaying a recorded wasm run reproduces
  the live state bit for bit on all three sectors.
- That cross-check found a real bug: `Game::reset` kept stale event-ring state, so a
  restarted match diverged from a fresh replay. Fixed, with a regression test.

## Consequences

- Forged scores are rejected (HTTP 422); the score on the board is computed by the
  server.
- **Known limit**: replay verification does not stop aimbots or scripts that
  produce valid inputs. The board is mathematically honest, not anti-cheat.
- A chosen seed is public. A player can retry offline until a seed is favourable;
  Daily avoids this because the seed is the date.
- Any change to simulation behaviour changes the golden hash and invalidates stored
  logs. Boards therefore record `SCORE_VERSION` and logs carry `LOG_VERSION`; a
  behaviour change requires bumping them and starting a new board.
- Weapon unlocks are client-side progression; the server records the shotgun flag
  but does not judge it.
