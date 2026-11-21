# Leaderboard API contract

The server never trusts a score from the client. A submission carries an input
log; the server re-simulates it with the same Rust crate (`bp-core`) that runs as
WebAssembly in the browser and computes the score itself.

## Replay log

Binary format defined in `core/src/replay.rs` (`BPL1`, version 5). Logs of any
other version are rejected (v2 added ammo preserved on switch, v3 terminal-driven waves, v4 the
simulation fixes of the audit pass, v5 the harder enemy AI). Header holds
`mode`, `map`, `flags` (bit0 aim assist, bit1 auto reload, bit2 shotgun unlocked),
`seed` and `ticks`. Body is run-length encoded quantized inputs (60 Hz fixed step).
Hard limits: 72 000 ticks (20 min), 1 MiB request body.

## `POST /api/runs`

Request (JSON):

```json
{ "name": "SEBITA", "log": "<base64 of the BPL1 log>" }
```

- `name`: trim Unicode whitespace at the edges, except control characters. The
  remaining name must contain 1 to 16 Unicode scalar values. Only Unicode
  `Alphabetic` characters, ASCII digits, ASCII space, `_`, `-` and `.` are
  allowed. Other characters, including control and format characters anywhere,
  cause rejection; no stripping, normalization or truncation. `José` is stored
  verbatim.
- `log`: standard base64, with padding.

### Rate limits

The server caps the body at 1 MiB, then classifies it by read/size, JSON shape, name,
base64 and BPL1 structure. Each POST is charged to exactly one of two independent quotas
of **10 per client per fixed Unix minute**:

- Malformed requests (including unreadable or oversized bodies) use `rlbad`. The first ten
  return their validation error; the eleventh and later return `429`. None are replayed.
- Structurally valid requests use `rl` before SG-08 eligibility or simulation. Retries and
  structurally valid logs later rejected by replay or board rules still use this quota.

Exhausting `rlbad` cannot consume `rl`, even on the same client key. Classification is
bounded but still happens before the counter: this is not an ingress limit on bandwidth,
body parsing, or Redis traffic. A platform-level flood limit would be separate. If the
server cannot check the selected quota, it returns `503` rather than proceeding.

Boards (`board` field):

| Mode | Board key | Counts when |
|---|---|---|
| mission | `mission:s01` / `mission:s02` / `mission:s03` | the run is a WIN |
| overflow | `overflow` | at least 60 simulated ticks (1 second) and at least one simulated kill **or** a natural death; the tick minimum applies to both |
| daily | `daily:YYYY-MM-DD` | the run ended (WIN or LOSE), or it reached the tick cap still playing (see "Tick cap"); seed must equal the UTC date as `YYYYMMDD` for today or yesterday |
| practice | never | never |

`src/core/progress.ts::isShotgunUnlocked` requires a **prior SECTOR_02 win**. BPL1's
SG-08 flag is a claim, not a progression record; the current sector is not proof of a
prior win, and winning this run cannot grant the weapon at its start. The server rejects
any ranked submission with that flag (`422 not_qualified`), even for a player who really
has unlocked it. Accepting those runs would require server-verifiable progression.

Response `200`:

```json
{ "ok": true, "board": "mission:s01", "score": 2310, "scoreVersion": 5,
  "won": true, "rank": 4, "total": 31 }
```

### One entry per verified run

A board holds at most one entry per verified replay. The member is the replay hash
(`hash16`: 16 lowercase hex digits of the outcome hash computed by `bp-core`), not the name.

- The first accepted submission of a run creates the entry. Its name, score and time are
  kept.
- A later submission of the same run returns `200` with the existing `rank` and `total`.
  It changes nothing, whatever name it was sent under, and whichever client sent it.
- The same run on two different boards is two entries, one per board.

### Errors

Error body: `{ "ok": false, "error": "<code>" }`.

| Status | Code | When |
|---|---|---|
| 400 | `malformed_log` | Not a valid BPL1 v5 log: bad magic or version, too short, truncated, trailing bytes, out-of-range field or map, ticks above 72 000 |
| 400 | `bad_json` | Body is not JSON |
| 400 | `bad_request` | `name` or `log` missing or not a string |
| 400 | `bad_name` | Empty after trimming, longer than 16 Unicode scalar values, or contains a disallowed character |
| 400 | `bad_base64` | `log` is not standard base64 |
| 405 | `method_not_allowed` | Wrong verb; response carries an `Allow` header |
| 413 | `body_too_large` | Body over 1 MiB |
| 422 | `log_invalid` | Decodes, but re-simulation fails: frames after the match ended, or a daily seed that is not a real calendar date (the core refuses to start it) |
| 422 | `not_qualified` | An unproven SG-08 unlock, practice, mission without a win, Overflow below 60 ticks or with neither a kill nor death, or Daily from outside the date window or still in progress below the cap |
| 429 | `rate_limited` | More than 10 requests in the client's selected quota for that minute |
| 500 | `internal` | Task panic or join failure |
| 503 | `store_unavailable` | Upstash unreachable or misconfigured, or `IP_HASH_SALT` missing |

### Tampered logs

The request carries no claimed score, so there is nothing to tamper with except the log
itself. A byte change that still replays and qualifies is accepted with its own
verified score. This is by design: see "Known limit". Structural damage (magic,
version, truncation, trailing bytes) gives `400 malformed_log`. Damage that decodes but
fails re-simulation (for example, a log padded after the match ended) gives
`422 log_invalid`.

### Tick cap

The replay format stops at `MAX_TICKS` = 72 000 ticks (20 minutes at 60 Hz). An overflow run
can outlive that cap: it has no timer, and only death ends it. The core stops recording at
tick 72 001, and the header carries no mark of the truncation. So a log is only ever
`header.ticks == MAX_TICKS` with the run still playing when it was cut short.

The server applies this rule, in `server/src/board.rs` (`ended_for_scoring`): **a log whose
header is at `MAX_TICKS` and whose run is still playing (PLAYING or EXTRACTION) is scored as
ending at the log end.** The score is the one the core computes at that tick, and it counts
for the board the mode allows:

- overflow: counts if it meets the same qualification rule as any other Overflow run.
  A capped prefix still playing needs a kill in that prefix; the cap is not a death.
- daily: counts, because the run is treated as ended, subject to the date window.
- mission: still needs a WIN. A cut-short run is not a win.
- practice: never counts.

The client can submit capped logs; the server judges the recorded prefix, not the
unrecorded remainder. A log one tick shorter than the cap, still playing, does
not count for Daily.

## `GET /api/leaderboard?board=<key>&limit=<1..50>`

```json
{ "board": "overflow", "total": 12,
  "entries": [{ "rank": 1, "name": "SEBITA", "score": 9100, "at": 1766000000 }] }
```

- `board` is required. Accepted keys: `overflow`, `mission:s01` to `mission:s03` (one per
  core map, `MAP_COUNT` = 3), and `daily:YYYY-MM-DD` for a real calendar date within
  the daily retention window: **today or yesterday in UTC**, the same window as POST.
  Impossible, future and expired dates are `400 bad_board` before any store call. This
  limits access, not physical Redis retention. Keys are percent-decoded, so `mission%3As01` works.
- `limit` defaults to 10. A value that is not an integer is `400 bad_limit`. Integers
  outside 1 to 50 are clamped into that range.
- `name` is the submitter's name at first acceptance. `at` is the Unix time (seconds)
  of that first acceptance.
- Successful mission and Overflow reads are cached briefly by the CDN (`s-maxage=5`).
  Daily reads use `no-store` so a cached board cannot outlive its UTC date window.

## Known limit

Replay verification stops forged scores. It does not stop an aimbot or a script that
produces valid inputs. The board is "mathematically honest", not "anti-cheat".

## Storage

Upstash Redis over REST. All keys are per board:

| Key | Type | Content |
|---|---|---|
| `lb:<board>` | sorted set | member `hash16`, score = verified score |
| `lbat:<board>` | hash | member → unix seconds of first acceptance |
| `lbname:<board>` | hash | member → name of first submitter |
| `rl:<client>:<minute>` | integer | structurally valid submissions; `INCR` then `EXPIRE 60` in one transaction |
| `rlbad:<client>:<minute>` | integer | malformed submissions, using the same atomic increment/expiry |

Writes of a new entry run as one transaction (`/multi-exec`): `ZADD … NX`, `HSETNX` time,
`HSETNX` name. A duplicate fails the `NX` and leaves the side hashes alone.

Client identity is `HMAC-SHA256(IP_HASH_SALT, ip)`, truncated to 128 bits and written as
hex. The IP is the first hop of `x-forwarded-for`, or `x-real-ip` if that is missing. The
raw IP is never stored or logged.

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | yes | `https://` only |
| `UPSTASH_REDIS_REST_TOKEN` | yes | never logged |
| `IP_HASH_SALT` | yes | secret salt for the client identity. Without it, submissions return `503` |

## Changes from the original draft

These were approved by the owner. Each one is a deliberate departure from the first
version of this document.

1. `IP_HASH_SALT` is a third environment variable. The client identity needs a secret
   salt, so raw IPs never reach Redis keys.
2. Error codes are now stable named codes. The 400 and 422 cases are split into
   `malformed_log`, `log_invalid` and `not_qualified`. `405` and `500` are added.
3. Member format changed from `"<name>|<hash16>"` to `hash16`. A run is identified by its
   verified hash, so one run gets one entry per board regardless of the name it was sent
   under. The name moved to `lbname:<board>`.
4. `at` is stored in `lbat:<board>`, because the member no longer carries it.
5. Key names `lb:`, `lbat:`, `lbname:` and `rl:` are specified here. The draft named only
   the rate-limit key.
6. Names: letters are Unicode, a name over 16 characters is rejected instead of truncated.
7. `limit` defaults to 10 and is clamped into 1 to 50. A non-integer is a `400`.
8. Malformed requests and structurally valid submissions now use separate quotas; simulation
   remains behind the replay quota.
9. `GET` and `POST` share the daily UTC window. On `POST` a run counts once it ended, or
   once it reached the tick cap still playing (see "Tick cap"). The cap rule is a server
   decision, approved with the core's Overflow rule.
10. Core constants are used directly from `bp_core` (`MODE_*`, `MAP_COUNT`, `MAX_TICKS`,
    `WIN`, `LOSE`, `is_valid_date`, `Header`). The server no longer keeps its own copies.
    Daily seed validity comes from the core: `Game::start` refuses a seed that is not a real
    date.
