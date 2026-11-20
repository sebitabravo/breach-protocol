# Leaderboard API contract

The server never trusts a score from the client. A submission carries an input
log; the server re-simulates it with the same Rust crate (`bp-core`) that runs as
WebAssembly in the browser and computes the score itself.

## Replay log

Binary format defined in `core/src/replay.rs` (`BPL1`, version 1). Header holds
`mode`, `map`, `flags` (bit0 aim assist, bit1 auto reload, bit2 shotgun unlocked),
`seed` and `ticks`. Body is run-length encoded quantized inputs (60 Hz fixed step).
Hard limits: 72 000 ticks (20 min), 1 MiB request body.

## `POST /api/runs`

Request (JSON):

```json
{ "name": "SEBITA", "log": "<base64 of the BPL1 log>" }
```

- `name`: 1-16 chars after trimming; letters, digits, space, `_`, `-`, `.`. Anything
  else is stripped; an empty result is rejected.
- `log`: standard base64.

Server steps: validate size and shape, decode the log, re-simulate, derive the board,
`ZADD` the verified score, return rank.

Boards (`board` field):

| Mode | Board key | Counts when |
|---|---|---|
| mission | `mission:s01` / `mission:s02` / `mission:s03` | the run is a WIN |
| overflow | `overflow` | always (ends on death or at log end) |
| daily | `daily:YYYY-MM-DD` | WIN or LOSE; seed must equal the UTC date `YYYYMMDD` of today or yesterday |
| practice | rejected | never |

Response `200`:

```json
{ "ok": true, "board": "mission:s01", "score": 2310, "scoreVersion": 1,
  "won": true, "rank": 4, "total": 31 }
```

Errors: `400` malformed JSON/base64/log, `413` body too large, `422` log failed
verification or does not qualify for any board, `429` rate limited, `503` store
unavailable. Error body: `{ "ok": false, "error": "<stable code>" }`.

A repeated submission of the same verified run (same replay hash, same name) is
idempotent: it returns the existing rank.

## `GET /api/leaderboard?board=<key>&limit=<1..50>`

```json
{ "board": "overflow", "total": 12,
  "entries": [{ "rank": 1, "name": "SEBITA", "score": 9100, "at": 1766000000 }] }
```

Unknown board keys return `400`.

## Known limit

Replay verification stops forged scores. It does not stop an aimbot or a script that
produces valid inputs. The board is "mathematically honest", not "anti-cheat".

## Storage

Upstash Redis over REST. Sorted set per board: member `"<name>|<hash16>"`, score =
verified score. Rate limit: `INCR rl:<ip-hash>:<minute>` with `EXPIRE 60`, 10 submissions
per minute per IP. Env vars only: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
