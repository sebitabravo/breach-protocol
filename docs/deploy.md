# Deploy: static web + leaderboard API on Vercel

Status: the layout follows the Vercel Rust runtime docs (root `Cargo.toml`, one `[[bin]]` per
function at `api/<name>.rs`). Nothing has been deployed: there was no Vercel account, and the
CLI was not used against a project. Remaining uncertainties are listed at the end.

## Layout

| Path | What it is |
|---|---|
| `Cargo.toml` (root) | Package `bp-api`. Two `[[bin]]` entries: `runs` → `api/runs.rs`, `leaderboard` → `api/leaderboard.rs`. Workspace root: members `server`; `core` excluded. Release profile is the Vercel template |
| `Cargo.lock` (root) | Lock for the root workspace (`bp-api`, `bp-server`, and `bp-core` as a path dependency) |
| `api/runs.rs`, `api/leaderboard.rs` | The only files in `api/`. The two Vercel functions: thin wrappers over `bp-server` |
| `server/` | Package `bp-server`: `src/` (board, name, client, store, upstash, submit, leaderboard, wire, error) and `tests/` (end-to-end `submit()` from real BPL1 logs built with `bp_core`) |
| `core/` | Package `bp-core`, unchanged. Own `Cargo.toml` and `Cargo.lock`. Excluded from the root workspace; the root workspace reaches it as a path dependency |
| `vercel.json` | Static output (`dist`), build and install commands, function limits, cache and security headers |
| `.vercelignore` | Local build artifacts only. It never excludes `core/`, `server/`, `api/`, `scripts/`, `src/` or `tests/` |
| `.github/workflows/api.yml` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked -D warnings`, `cargo test --workspace --locked`, on changes to `api/`, `server/`, `core/` or the root manifests |
| `docs/api-contract.md` | The public API contract, including the changes approved from the original draft |

Cargo searches parent directories for a manifest, so `cd api && cargo test` runs the root
workspace. Use `--manifest-path Cargo.toml` to make that explicit.

## Layout: what the docs require and what is still open

The Vercel Rust runtime docs say: "Create a `Cargo.toml` file in your project root", and
"Each handler has to be specified as `[[bin]]`", with `path = "api/hello.rs"` as the example
(source 1). This repo matches that shape. Local compile evidence (Rust 1.100.0):

```sh
cargo build --release --bins --target aarch64-apple-darwin --workspace --locked --message-format=json-render-diagnostics \
  | python3 scripts/check-api-bins.py
# Verified release executables: leaderboard, runs
```

`x86_64-unknown-linux-gnu` is not installed locally. `.github/workflows/api.yml` runs the
same check on Ubuntu using that target. This checks Cargo's actual executable artifacts,
not Vercel's routing, packaging, or live Upstash credentials.

The local Cargo registry source `vercel_runtime-2.4.1/src/lib.rs` defines `Request` as
`hyper::Request<hyper::body::Incoming>` (line 16) and accepts a stateless one-argument
handler via `IntoServiceFn<(Request,)>`. `src/types.rs` implements `IntoFunctionResponse`
for both `Result<T, Error>` and `Response<String>`. The existing `run(service_fn(handler))`
contract therefore compiles as written with the exact 2.4.1 pin.

Still unverified, because none of it has run on Vercel:

- Whether Vercel accepts a root `Cargo.toml` that sits next to a Vite `package.json`, and
  whether framework detection still picks Vite.
- Whether the Rust builder can resolve path dependencies outside `api/` (`server/`, `core/`).
  The whole repo is uploaded or cloned, so the files are present; the resolution is not tested.
- Whether Vercel ignores `api/tests/*.rs` when discovering functions. Cargo does not
  produce function binaries from those tests; only the two `[[bin]]` targets are functions.
- Whether a `functions` pattern that matches no function fails the whole deploy. Both
  patterns in `vercel.json` match a real `[[bin]]`, so this should not trigger.
- Whether `.vercelignore` applies to Git-based builds. It only lists build artifacts, so it
  should be harmless either way.

Verify all of these on the first preview deploy.

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
| 13 | rustup installer flags, verified from source: `-y`/`--yes`, `--default-toolchain`, `--profile`, `-t`/`--target` (comma list), `--no-modify-path`. Confirmed against the 1.29.3 binary: its strings include `no-modify-path`, `default-toolchain` and "Disable confirmation prompt" | https://raw.githubusercontent.com/rust-lang/rustup/master/src/cli/setup_mode.rs |
| 14 | Stable Rust is **1.100.0** (released 2026-11-12). The pinned toolchain matches the local one | https://static.rust-lang.org/dist/channel-rust-stable.toml |
| 15 | Current rustup is **1.29.3** (`release-stable.toml`). The versioned archive `rustup/archive/1.29.3/x86_64-unknown-linux-gnu/rustup-init` has SHA-256 `b1c8cb14e30889e7e2999e6b69e62d9e9b9ffc0f4df8180564d306d9680e6c55`, which matches its published `.sha256` and the pin in `installCommand`. The unversioned `rustup/dist/…/rustup-init` always serves the newest release, so using it would break the pin on the next rustup release | https://static.rust-lang.org/rustup/release-stable.toml ; https://static.rust-lang.org/rustup/archive/1.29.3/x86_64-unknown-linux-gnu/rustup-init.sha256 |
| 16 | `'wasm-unsafe-eval'` is the CSP keyword that lets WebAssembly compile under `script-src` without enabling JS `eval`. Seen in search results (the sqlite.org CSP guide, not fetched). Browser support was **checked only in Chromium** (see CSP section) | https://sqlite.org/wasm/doc/tip/csp.md (search snippet) |

### Pinned dependencies (versions resolved from the crates.io index)

| Crate | Version | Why it is here |
|---|---|---|
| `vercel_runtime` | 2.4.1 | Vercel Rust function runtime (root package and `bp-server`) |
| `tokio` | 1.54.1 (`macros`, `rt-multi-thread`) | Required by the runtime's `main` pattern; `spawn_blocking` keeps replay and store I/O off the async workers. In `bp-server` only as a dev-dependency (`macros`, `rt`) for async tests |
| `http-body-util` | 0.1.5 | Reads the request body with a hard `Limited` cap (413) |
| `http` | 1.5.0 | Generic request type shared by Vercel's `Incoming` body and in-process test fixtures |
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
with `ring`.

`cargo audit` is **not installed** here, so no advisory scan was run. Run it before the first
deploy, or add it to CI.

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Vercel project env (Preview and Production) | `https://` only. The code refuses `http://` so the token never travels in clear |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel project env, marked **sensitive** | Never logged. `Debug` prints `<redacted>` |
| `IP_HASH_SALT` | Vercel project env, marked **sensitive** | A third variable, approved as a deviation from the original contract. Salts the client identity so raw IPs never reach Redis. Without it `POST /api/runs` returns 503. Generate with `openssl rand -hex 32` |

The Marketplace integration may create differently named variables (for example legacy
`KV_REST_API_*`). Check the names in the dashboard after installing it, and set the two
`UPSTASH_REDIS_REST_*` names by hand if they differ. **Unverified**: the exact names the
integration creates.

## Storage layout (Upstash)

Per board, with the board key `<board>` (`overflow`, `mission:s01`–`s03`, `daily:YYYY-MM-DD`):

| Key | Type | Content |
|---|---|---|
| `lb:<board>` | sorted set | member `hash16` (the verified replay hash), score = verified score |
| `lbat:<board>` | hash | member → unix seconds of first acceptance (`HSETNX`, never overwritten) |
| `lbname:<board>` | hash | member → name of the first submitter (`HSETNX`, never overwritten) |
| `rl:<client>:<minute>` | integer | `INCR` plus `EXPIRE 60` in one transaction. Limit 10 per minute |

A new entry is written in one `/multi-exec` transaction: `ZADD … NX`, `HSETNX` time, `HSETNX`
name. A duplicate fails the `NX` and leaves the side hashes alone. Rollback is safe for this
storage: there is no schema or migration, and the rate-limit keys expire on their own.

## Errors and choices

The full table of statuses and codes, and the list of approved deviations from the original
draft, are in `docs/api-contract.md`. This file does not repeat them.

## Compilación

`installCommand` (en `vercel.json`):

1. Descarga `rustup-init` **1.29.3** desde `static.rust-lang.org/rustup/archive/1.29.3/…`.
2. Verifica el SHA-256 fijado y aborta si no coincide.
3. Ejecuta `rustup-init -y --profile minimal --default-toolchain 1.100.0 -t wasm32-unknown-unknown --no-modify-path`.
4. Instala Bun **1.4.4** explícitamente con `curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"` bajo Bash con `pipefail`, para que un error de descarga también aborte la instalación.
5. Exporta `PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH"` y ejecuta `bun install --frozen-lockfile` con `bun.lock`.

Se **supone que el entorno de compilación es x86_64** (Amazon Linux 2023). Si es aarch64,
el paso 1 descarga un binario de otra arquitectura y la instalación falla. Esto no está verificado.

**Actualizar rustup**: en cada versión de rustup, consultá `https://static.rust-lang.org/rustup/release-stable.toml`,
descargá `archive/<ver>/x86_64-unknown-linux-gnu/rustup-init` y su `.sha256`, verificá el hash y
actualizá la versión en la URL y el SHA en `vercel.json` en un commit separado.

`buildCommand` vuelve a exportar `PATH` porque podría ejecutarse en otro shell:

```sh
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH" && bun run build
```

El comando compila el wasm con Cargo a través de `scripts/build-wasm.mjs`, luego ejecuta
`bunx tsc --noEmit` y `bunx vite build`. `core/` usa su propio manifiesto, así que la exclusión
del workspace raíz no afecta la compilación del wasm.

Medición previa en macOS aarch64 (no en Vercel): los binarios de la API tardaron unos 14 s
con las dependencias ya compiladas, y la primera compilación en release con `bp-core` y
sus dependencias tardó unos 28 s. En el primer despliegue de vista previa, verificá el tiempo
total y si el entorno que compila las funciones Rust encuentra `cargo` en su `PATH`.

Risk: `lto = "fat"` with `codegen-units = 1` is the slowest setting. Switch to `"thin"` if
preview builds approach the build timeout.

Local macOS note: `ring` compiles C code. Without the Xcode SDK on the C compiler's path, the
workspace fails to build with `TargetConditionals.h not found`. Run cargo commands with
`SDKROOT="$(xcrun --show-sdk-path)"` set, for example
`SDKROOT="$(xcrun --show-sdk-path)" cargo test --workspace --locked`. The committed
configuration does not depend on it. Linux CI and Vercel are not affected.

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

Motivo de cada directiva, según los artefactos generados (`bun run build` y luego una búsqueda en `dist/`):

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

1. Merge the branch, then confirm the CI workflow `API` is green.
2. `vercel login` (needs your account).
3. `vercel link` from the repo root and pick or create the project. Root Directory must be the
   repo root, because the root `Cargo.toml` and `core/` live there.
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
- The layout uncertainties listed under "Layout: what the docs require and what is still open".
- La compilación en Vercel con la instalación de rustup y Bun, el target wasm y las funciones
  Rust (sin cuenta ni despliegue de prueba).
- Both handlers compiled for macOS. `cargo test --test http_api` used their real HTTP
  request/response logic, real re-simulation, and the Upstash JSON adapter with an
  in-process transport. It does not test Vercel's live runtime, `ureq` over HTTPS, or
  real Upstash; no remote request was made.
- The exact Redis variable names the Marketplace integration creates.
- Build time and memory on the Vercel builder.
- The Linux release build of the API crate (checked on macOS only; CI on `ubuntu-24.04` is the
  first real check).
- Firefox and Safari CSP behaviour (see CSP section).
- Vulnerabilities in the dependency tree (`cargo audit` not installed).
