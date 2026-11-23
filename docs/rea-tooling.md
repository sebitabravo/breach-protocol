# REA tooling (Reverse Engineer Anything)

REA is a local MCP server (npm package `rea-agents`, MIT,
github.com/morluto/rea) that ships reverse-engineering and
browser/network observation tools. It is registered for this project only,
via `.pi/mcp.json`; it is not installed user-level and is not a
`package.json` dependency — Pi launches it on demand with
`npx -y rea-agents@6.10.1 mcp`.

Pi reads `.pi/mcp.json` for projects it trusts and reads project skills from
`.agents/skills/`. This setup vendors REA's workflow skill (byte-exact copy
from the published package) at `.agents/skills/reverse-engineer-anything/`.
Attribution lives in `THIRD_PARTY_NOTICES.md`.

## Pinned version and upgrades

The version is pinned exactly as `rea-agents@6.10.1` in both the
registration and the vendored skill. The project does not drift with new
releases. To bump:

1. Change the version in both `args` entries of `.pi/mcp.json`
   (never use `@latest`).
2. Re-vendor the skill from the new package:
   `npm pack rea-agents@<version>` and copy only
   `package/skills/reverse-engineer-anything/` into
   `.agents/skills/reverse-engineer-anything/`.
3. Update the pinned version in `THIRD_PARTY_NOTICES.md`.

## Scope: what works without a native engine

Only static JavaScript/Electron analysis and browser/CDP observation need
no native analysis engine. Those are fully usable with this setup. Native
binary analysis (Hopper, Ghidra, IDA, JADX) is **not** installed by this
setup; those tools must be installed separately if such targets come up.

## Browser quickstart (official guide)

Start Chrome with remote debugging, list targets, then capture a window of
network/script evidence from one target:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/rea-profile <url>
npx -y rea-agents@6.10.1 list-browser-targets http://127.0.0.1:9222 --json
npx -y rea-agents@6.10.1 inspect-web-page http://127.0.0.1:9222 <TARGET_ID> \
  --observation-ms 10000 --include-accessibility-text \
  --include-json-body-shapes --json
```

On Linux, `google-chrome` works in place of the first line, and on Windows
or other setups you substitute your browser's executable path.

Caveat: the capture window starts when you launch `inspect-web-page`, so it
starts **before** the click you want to observe — begin the capture first,
then perform the action you intend to record.

## Disable or inspect

To turn REA off without deleting the registration, set `"enabled": false`
on the `rea` entry in `.pi/mcp.json`. Inside a session, `/mcp` shows
connection state, tool counts, and per-server status; outside a session,
`pi mcp list` reports the same and exits nonzero when an entry is invalid
or an enabled server is not connected.
