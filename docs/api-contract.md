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

- `name`: trimmed after stripping. Letters (Unicode, so `José` is kept), ASCII digits,
  space, `_`, `-` and `.` are kept; anything else is removed. The result must be
  1 to 16 characters. A longer name is rejected, not truncated.
- `log`: standard base64, with padding.

Check order, which is also the order of the status codes below: body size, rate limit,
JSON shape, log verification, board, store. The rate limit runs before parsing and before
re-simulation, so it also caps CPU spent on replays.

Boards (`board` field):

| Mode | Board key | Counts when |
|---|---|---|
| mission | `mission:s01` / `mission:s02` / `mission:s03` | the run is a WIN |
| overflow | `overflow` | always (ends on death or at log end) |
| daily | `daily:YYYY-MM-DD` | the run ended (WIN or LOSE); seed must equal the UTC date as `YYYYMMDD` for today or yesterday |
| practice | never | never |

Response `200`:

```json
{ "ok": true, "board": "mission:s01", "score": 2310, "scoreVersion": 1,
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
| 400 | `malformed_log` | Not a valid BPL1 v1 log: bad magic or version, too short, truncated, trailing bytes, out-of-range field or map, ticks above 72 000 |
| 400 | `bad_json` | Body is not JSON |
| 400 | `bad_request` | `name` or `log` missing or not a string |
| 400 | `bad_name` | Empty after stripping, or longer than 16 characters |
| 400 | `bad_base64` | `log` is not standard base64 |
| 405 | `method_not_allowed` | Wrong verb; response carries an `Allow` header |
| 413 | `body_too_large` | Body over 1 MiB |
| 422 | `log_invalid` | Decodes, but re-simulation fails (for example frames after the match ended) |
| 422 | `not_qualified` | Verified, but counts for no board: practice, mission loss, daily from another day, or a run still in progress |
| 429 | `rate_limited` | More than 10 submissions per minute from one client |
| 500 | `internal` | Task panic or join failure |
| 503 | `store_unavailable` | Upstash unreachable or misconfigured, or `IP_HASH_SALT` missing |

### Tampered logs

The request carries no claimed score, so there is nothing to tamper with except the log
itself. A byte change that still decodes is a different, valid run, and it is accepted
with its own score. This is by design: see "Known limit". Structural damage (magic,
version, truncation, trailing bytes) gives `400 malformed_log`. Damage that decodes but
fails re-simulation (for example, a log padded after the match ended) gives
`422 log_invalid`.

## `GET /api/leaderboard?board=<key>&limit=<1..50>`

```json
{ "board": "overflow", "total": 12,
  "entries": [{ "rank": 1, "name": "SEBITA", "score": 9100, "at": 1766000000 }] }
```

- `board` is required. Accepted keys: `overflow`, `mission:s01`, `mission:s02`,
  `mission:s03`, and `daily:YYYY-MM-DD` for any real calendar date. Anything else is
  `400 bad_board`. Keys are percent-decoded, so `mission%3As01` works.
- `limit` defaults to 10. A value that is not an integer is `400 bad_limit`. Integers
  outside 1 to 50 are clamped into that range.
- `name` is the submitter's name at first acceptance. `at` is the Unix time (seconds)
  of that first acceptance.
- Responses are cached briefly by the CDN (`s-maxage=5`).

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
| `rl:<client>:<minute>` | integer | submissions this minute for this client; `INCR` then `EXPIRE 60` in one transaction |

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
8. The rate limit runs before body parsing, so malformed requests also count toward it.
9. Daily boards: any real calendar date is accepted on `GET`, and only runs that ended
   count on `POST`.
