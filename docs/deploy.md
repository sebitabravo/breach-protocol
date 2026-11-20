# Deploy: static web + leaderboard API on Vercel

Status: **blocked on one layout decision** (see "Decision needed"). The API crate, the
static build config and the CI workflow are complete and gated locally. Nothing has been
deployed: this work had no Vercel account, and the CLI was not used against a project.

## Layout

| Path | What it is |
|---|---|
| `vercel.json` | Static output (`dist`), build and install commands, function limits, cache and security headers |
| `.vercelignore` | Local build artifacts only. It never excludes `core/`, `scripts/`, `src/` or `tests/` (`tsconfig.json` includes `tests/unit`) |
| `api/Cargo.toml` | Own workspace root for the API crate (`bp-api`). Depends on `../core` as `bp-core` |
| `api/src/` | Pure logic and adapters: `board`, `name`, `client`, `store`, `upstash`, `submit`, `leaderboard`, `wire`, `error` |
| `api/runs.rs`, `api/leaderboard.rs` | The two Vercel functions (`[[bin]]`), thin wrappers over `api/src` |
| `api/tests/` | End-to-end `submit()` tests built from real BPL1 logs with `bp_core` |
| `.github/workflows/api.yml` | fmt, clippy `-D warnings`, `cargo test --locked` for `api/**` and `core/**` |

## Decision needed (blocks deploy)

Vercel's Rust runtime reads `Cargo.toml` from the **project root** and declares each
handler as a `[[bin]]` with a path such as `api/hello.rs` (see Sources, runtime doc). This
repo was asked to keep the Cargo workspace at `api/Cargo.toml`, and the root `Cargo.toml`
is outside the scope granted to this change. So as written, Vercel will not find the two
functions.

Proposed fix, for the owner to approve (not applied):

- Add a root `Cargo.toml`: a package (for example `bp-api-entry`) with
  `[[bin]] name = "runs" path = "api/runs.rs"` and
  `[[bin]] name = "leaderboard" path = "api/leaderboard.rs"`, depending on
  `bp-api = { path = "api" }`, `vercel_runtime`, `tokio`. Keep `api/Cargo.toml` as the
  library and CI target.
- `vercel.json` `functions` keys already use the `api/<name>.rs` paths, so they stay valid.

Second open question, also unverified: whether Vercel treats **every** `api/**/*.rs` as a
function entry point. If it does, `api/src/*` and `api/tests/*` would be picked up as functions.
In that case the library has to move out of `api/` (for example to `lib/`). That change is
outside this task's ownership and needs its own decision.

Third risk: Vercel may fail the whole build when a `functions` pattern matches no detected
function ("doesn't match any Serverless Functions"). **Unverified.** If it does, the `functions`
block in `vercel.json` also breaks the static site's deploy until the root `Cargo.toml` exists.
**Do not merge `vercel.json` ahead of the layout decision.**

None of this has been tested against a real Vercel build.

## Sources and findings

Every finding below was checked against the page or the registry, on the date of this
work. Items marked **unverified** could not be checked without an account or a real build.

| # | Claim | Source |
|---|---|---|
| 1 | Rust runtime is in beta. `Cargo.toml` goes in the project root, each handler is a `[[bin]]` with `path = "api/<name>.rs"`, and a `[profile.release]` with `lto = "fat"`, `codegen-units = 1`, `opt-level = 3` is the documented template | https://vercel.com/docs/functions/runtimes/rust |
| 2 | `vercel_runtime` latest stable is **2.4.1** (published 2026-09-22) | https://crates.io/api/v1/crates/vercel_runtime |
| 3 | Handlers return types implementing `IntoFunctionResponse`, including `Result<Response<String>, Error>`. `Error = Box<dyn std::error::Error + Send + Sync>`. The request type is `hyper::Request<Incoming>` | https://docs.rs/crate/vercel_runtime/2.4.1/source/src/types.rs and `…/src/lib.rs` |
| 4 | Duration: Hobby 300 s default and maximum; Pro 300 s default, 800 s maximum | https://vercel.com/docs/functions/limitations |
| 5 | Request and response body limit: **4.5 MB** (413 `FUNCTION_PAYLOAD_TOO_LARGE` above it). Our cap is 1 MiB per the contract | https://vercel.com/docs/functions/limitations |
| 6 | Build image is Amazon Linux 2023. The page lists Node, Python, Ruby and Go. **rustup and cargo are not listed as preinstalled**, so they are installed in `installCommand` | https://vercel.com/docs/builds/build-image |
| 7 | The docs do not say whether `installCommand` and `buildCommand` share a shell or environment. `buildCommand` therefore sets `PATH` itself | https://vercel.com/docs/project-configuration/vercel-json (checked: silent on this) |
| 8 | `x-forwarded-for` is overwritten by Vercel and external IPs are not forwarded, so the first hop is not client-forged. `x-real-ip` is documented as identical | https://vercel.com/docs/headers/request-headers |
| 9 | Upstash REST: a single command is a JSON array POSTed with `Authorization: Bearer`. Replies are `{"result": …}` or `{"error": …}`. `/pipeline` is **not atomic**; `/multi-exec` is atomic | https://upstash.com/docs/redis/features/restapi |
| 10 | `ZADD … NX` returns the number of members added (0 for a duplicate) and needs Redis 3.0.2 or newer | https://redis.io/docs/latest/commands/zadd/ |
| 11 | `ZREVRANGE` orders by score descending, then lexicographically descending on ties. Redis marks it deprecated since 6.2 in favour of `ZRANGE … REV`; Upstash still accepts it, and the crate uses it as the contract asks | https://redis.io/docs/latest/commands/zrevrange/ |
| 12 | Upstash's Vercel integration page does not name the Redis variables (it names only QStash, Vector and Search). A redeploy is required after adding them | https://upstash.com/docs/redis/howto/vercelintegration |
| 13 | rustup installer flags, verified from source: `-y`/`--yes`, `--default-toolchain`, `--profile`, `-t`/`--target` (comma list), `--no-modify-path` | https://raw.githubusercontent.com/rust-lang/rustup/master/src/cli/setup_mode.rs |
| 14 | Stable Rust is **1.100.0** (released 2026-11-12). The pinned toolchain matches the local one | https://static.rust-lang.org/dist/channel-rust-stable.toml |
| 15 | Current rustup is **1.29.3** (`release-stable.toml`). The versioned archive `rustup/archive/1.29.3/x86_64-unknown-linux-gnu/rustup-init` has SHA-256 `b1c8cb14e30889e7e2999e6b69e62d9e9b9ffc0f4df8180564d306d9680e6c55`, which matches its published `.sha256` and the pin in `installCommand`. The unversioned `rustup/dist/…/rustup-init` always serves the newest release, so using it would break the pin on the next rustup release | https://static.rust-lang.org/rustup/release-stable.toml ; https://static.rust-lang.org/rustup/archive/1.29.3/x86_64-unknown-linux-gnu/rustup-init.sha256 |
| 16 | `'wasm-unsafe-eval'` is the CSP keyword that lets WebAssembly compile under `script-src` without enabling JS `eval`. Seen in search results (the sqlite.org CSP guide, not fetched). Browser support was **checked only in Chromium** (see CSP section) | https://sqlite.org/wasm/doc/tip/csp.md (search snippet) |

### Pinned dependencies (versions resolved from the crates.io index)

| Crate | Version | Why it is here |
|---|---|---|
| `vercel_runtime` | 2.4.1 | Vercel Rust function runtime |
| `tokio` | 1.54.1 (`macros`, `rt-multi-thread`) | Required by the runtime's `main` pattern; `spawn_blocking` keeps replay and store I/O off the async workers |
| `http-body-util` | 0.1.5 | Reads the request body with a hard `Limited` cap (413) |
| `http-body` | 1.1.0 | Trait bound on `read_capped`, so the 413 path is unit-tested with an in-memory body |
| `bytes` | 1.12.2 | `Bytes` type in the same bound. Already in the tree through `vercel_runtime` |
| `serde_json` | 1.0.154 | Parse the request and build the JSON responses |
| `base64` | 0.22.1 | Strict standard base64 for `log`. Same major as the runtime's own dependency |
| `sha2` + `hmac` | 0.11.1 + 0.13.0 | HMAC-SHA256 of the client IP with a secret salt (RustCrypto) |
| `ureq` | 3.5.2, `rustls` + `json` only | Blocking HTTPS client for Upstash, no gzip, no OpenSSL |
| `bp-core` | path `../core` | Re-simulation and log decoding |

Why `ureq` and not `reqwest`: same base crates (`vercel_runtime`, `tokio`, `serde_json`),
resolved with `cargo generate-lockfile` in scratch crates: **98** unique normal dependencies
with `ureq` against **147** with `reqwest 0.12.28` (rustls). The HTTP/TLS subset is 17 against
24. `ureq` also needs no async client, which fits the blocking store trait.

Why no OpenSSL: `cargo tree` shows no `openssl`, `native-tls` or `hyper-tls`. TLS is `rustls`
with `ring`. `ring` compiles with the C toolchain on macOS only when `SDKROOT` is set,
which is a local-host quirk and does not apply to the Linux builder.

`cargo audit` is **not installed** here, so no advisory scan was run. Run it before the first
deploy, or add it to CI.

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Vercel project env (Preview and Production) | `https://` only. The code refuses `http://` so the token never travels in clear |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel project env, marked **sensitive** | Never logged. `Debug` prints `<redacted>` |
| `IP_HASH_SALT` | Vercel project env, marked **sensitive** | **Not in the original contract.** Added because the IP must be salted before it is used in Redis keys. Without it `POST /api/runs` returns 503 instead of storing raw IPs. Generate with `openssl rand -hex 32` |

The Marketplace integration may create differently named variables (for example legacy
`KV_REST_API_*`). Check the names in the dashboard after installing it, and set the two
`UPSTASH_REDIS_REST_*` names by hand if they differ. **Unverified**: the exact names the
integration creates.

## Storage layout (Upstash)

| Key | Type | Content |
|---|---|---|
| `lb:<board>` | sorted set | member `"<name>|<hash16>"`, score = verified score |
| `lbat:<board>` | hash | member → unix seconds when first accepted (`HSETNX`, never overwritten) |
| `rl:<client-hmac>:<minute>` | integer | `INCR` plus `EXPIRE 60` in one transaction. Limit 10 per minute |

Boards: `overflow`, `mission:s01`, `mission:s02`, `mission:s03`, `daily:YYYY-MM-DD`. Practice
never gets a board. Rollback is safe for this storage: there is no schema or migration, and
the rate-limit keys expire on their own.

## Error codes

The contract fixes the HTTP statuses but not the codes. These are the stable codes the
service returns. Codes marked "added" are not in `docs/api-contract.md`.

| Status | Code | When |
|---|---|---|
| 400 | `malformed_log` | Not a BPL1 v1 log: bad magic or version, too short, truncated, trailing bytes, bad field, out-of-range mode or map, ticks above 72 000 |
| 400 | `bad_json` (added) | Body is not JSON |
| 400 | `bad_request` (added) | `name` or `log` missing or not a string |
| 400 | `bad_name` (added) | Empty after stripping, or longer than 16 characters |
| 400 | `bad_base64` (added) | `log` is not standard base64 |
| 400 | `bad_board` (added) | Unknown or malformed `board` on `GET` |
| 400 | `bad_limit` (added) | `limit` is not an integer (out-of-range values are clamped to 1..50, default 10) |
| 405 | `method_not_allowed` (added) | Wrong verb; `Allow` header set |
| 413 | `body_too_large` | Body over 1 MiB |
| 422 | `log_invalid` | Decodes, but re-simulation fails (for example frames after the match ended) |
| 422 | `not_qualified` | Verified run that counts for no board: practice, mission loss, daily from another day or still running |
| 429 | `rate_limited` | More than 10 submissions per minute from one client |
| 500 | `internal` (added) | Task panic or join failure |
| 503 | `store_unavailable` | Upstash unreachable, misconfigured, or missing `IP_HASH_SALT` |

Choices the contract left open, recorded here so they can be reviewed:

- Name: letters are Unicode (`é`, `ñ` kept), digits ASCII, plus space `_ - .`. Anything
  else is stripped, then the result is trimmed and length-checked. Over 16 characters is
  rejected, not truncated.
- Idempotency: the member is `name|hash16`, where `hash16` is the verified outcome hash.
  The same run under a **different name is a separate entry**, as the contract's member
  format implies. This lets one verified run be entered under several names. Raise this
  with the contract owner if it matters.
- Check order: size, then rate limit, then parse, then verify, then board, then store.
  The rate limit counts malformed requests too, so it also caps CPU spent on re-simulation.

## Build

`installCommand` (in `vercel.json`):

1. `curl` the pinned `rustup-init` **1.29.3** from `static.rust-lang.org/rustup/archive/1.29.3/…`.
2. Check its SHA-256 against the pinned value (fails the build on mismatch).
3. Run `rustup-init -y --profile minimal --default-toolchain 1.100.0 -t wasm32-unknown-unknown --no-modify-path`.
4. `npm ci`.

The builder is **assumed to be x86_64** (Amazon Linux 2023). If it is aarch64, step 1 fetches a
binary of the wrong architecture and the build fails loudly. This is unverified.

**Bumping rustup**: on every rustup release, read `https://static.rust-lang.org/rustup/release-stable.toml`,
download `archive/<ver>/x86_64-unknown-linux-gnu/rustup-init` and its `.sha256`, check the hash, then
update the version in the URL and the SHA in `vercel.json`. Do this in its own commit.

`buildCommand`: `export PATH="$HOME/.cargo/bin:$PATH" && npm run build`. The build runs
`cargo build --target wasm32-unknown-unknown` through `scripts/build-wasm.mjs`, then
`tsc --noEmit` and `vite build`.

Measured locally (macOS aarch64, not the Vercel image): `npm run build` passes, the API
release binaries build in about 14 s once dependencies are compiled, and the first release
build including `bp-core` and its dependencies took about 28 s. A cold build on Vercel,
including the toolchain download and the wasm target, is slower. **Unverified**: the total on Vercel, and whether the Rust function build
(`api/*.rs`) finds `cargo` on `PATH` from the install step. Check both on the first preview.

Risk: `lto = "fat"` with `codegen-units = 1` is the slowest setting. Switch to `"thin"` if
preview builds approach the build timeout.

Local macOS note: `ring` compiles C code. Without the Xcode SDK on the C compiler's path,
`cargo test --manifest-path api/Cargo.toml` fails with `TargetConditionals.h not found`. Run
it with `SDKROOT="$(xcrun --show-sdk-path)"` set. Linux CI and Vercel are not affected.

## Replay cost

Measured in this repo's test harness: a worst-case 72 000-tick log (8 KB) re-simulates in
about 31 ms in release and about 42 ms with the dev profile on this host. A Vercel instance
is slower, but this is far below the 300 s Hobby limit. Each `POST` makes up to four
store calls at a 5 s timeout each, so the 30 s `maxDuration` for `runs` covers the worst case.

## Security headers and CSP

`vercel.json` sets, on every route:

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
and `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.

Why each directive, based on the built output (`npm run build`, then grep of `dist/`):

- `script-src 'self' 'wasm-unsafe-eval'`: the only script is a same-origin module. Nothing
  is inline and nothing calls `eval` or `new Function`. `'wasm-unsafe-eval'` lets
  `WebAssembly.instantiate` run on the fetched bytes (`src/wasm/bridge.ts`) without enabling
  JS `eval`.
- `style-src 'unsafe-inline'`: the built HTML has no `<style>` and no `style=""`
  attributes, so this could be tightened. It is kept as requested because the
  renderer and HUD may set inline styles at runtime. Tightening it needs a runtime check.
- `connect-src 'self'`: the only network call is `fetch('/bp_core.wasm')`. The leaderboard
  is same-origin too.
- `img-src 'self' data: blob:`: the favicon is a `data:` SVG. `blob:` is kept for canvas
  or texture object URLs.
- `worker-src 'self' blob:`: there are no workers in the code today. Kept as requested.
- No external origin is loaded. Pointer lock, `AudioContext` and `localStorage` are not
  governed by CSP, and the Permissions-Policy does not restrict pointer lock.

**Verified**: the built app was served with these exact headers from `vercel.json` and
loaded in headless Chromium (Playwright). Result: **0 CSP violations, 0 page errors, 0
console errors**; the calibration screen rendered with three canvases; `/bp_core.wasm`
returned `200` with `application/wasm` and `max-age=0, must-revalidate`.

**Unverified**: Firefox and Safari. The pinned Playwright Firefox build was not installed
locally, and Safari cannot be driven from Playwright here. The sources reviewed for
`'wasm-unsafe-eval'` were search snippets and disagreed on Safari support, so check the
preview in Safari before production.

Caching:

- `/bp_core.wasm` has no content hash in its name, so it is **not** `immutable`. It uses
  `max-age=0, must-revalidate`. Caching it longer could pair a new JS bundle with an old wasm.
- `/assets/*` is content-hashed by Vite, so it is `immutable` for a year.
- API responses: `POST` and all errors are `no-store`. `GET /api/leaderboard` is
  `public, s-maxage=5, stale-while-revalidate=30`, so the CDN absorbs read bursts.

## Human steps (not run here)

1. Resolve the layout decision above, and merge.
2. `vercel login` (needs your account).
3. `vercel link` from the repo root and pick or create the project. Confirm Root Directory
   is the repo root (`api/` depends on `../core`).
4. In the dashboard: Storage → Marketplace → Upstash Redis. Create or link the database.
   Check the variable names it created (see "Environment variables").
5. Set `IP_HASH_SALT` (sensitive) in Preview and Production:
   `openssl rand -hex 32`, then `vercel env add IP_HASH_SALT preview` (and `production`).
   Set the two `UPSTASH_REDIS_REST_*` names too if the integration used other names.
6. **Preview first.** `vercel deploy` (no `--prod`) prints a preview URL. Then:
   - `curl -sS -X POST https://<preview>/api/runs -H 'content-type: application/json' -d '{"name":"X","log":"AA=="}'`
     → `400` `malformed_log`
   - `curl -sS -X POST https://<preview>/api/runs` → `405` `method_not_allowed`
   - `curl -sS 'https://<preview>/api/leaderboard?board=overflow&limit=5'` → `200`, `total` 0 or more
   - `curl -sS 'https://<preview>/api/leaderboard?board=practice'` → `400` `bad_board`
   - 11 quick `POST`s with `{}` → the 11th is `429` `rate_limited`
   - Load `https://<preview>/` in a browser and check the console for CSP errors.
   Note: the client does not submit runs yet, so the accept path is covered by the cargo
   tests, not by the deployed endpoint.
7. **Production only after you confirm.** `vercel deploy --prod`, then repeat the smoke
   checks against the production URL.
8. Rollback: promote the previous deployment (`vercel rollback --help` for the exact
   syntax on your CLI version, or use the Deployments tab). Storage needs no rollback. If an
   env var is wrong, fix it and redeploy, because Upstash requires a redeploy to pick up
   changes.

## Unverifiable here

- Builder architecture: assumed x86_64 (the rustup pin is x86_64 only).
- Whether Vercel treats every `api/**/*.rs` as a function, and whether a `functions`
  pattern with no match fails the whole deploy (see "Decision needed").
- Vercel's build with the rustup install, the wasm target and the Rust function build
  (no account, no build run).
- Whether the Rust runtime accepts `api/Cargo.toml` in place of a root manifest (the docs say
  root; not tested).
- Vercel's runtime behaviour for the two handlers: the `[[bin]]` handler glue
  (`api/runs.rs`, `api/leaderboard.rs`) was compiled for macOS but never executed under the
  Vercel runtime.
- The exact Redis variable names the Marketplace integration creates.
- Build time and memory on the Vercel builder.
- The Linux release build of the API crate (checked on macOS only; CI on `ubuntu-24.04` is the
  first real check).
- Firefox and Safari CSP behaviour (see CSP section).
- Vulnerabilities in the dependency tree (`cargo audit` not installed).
