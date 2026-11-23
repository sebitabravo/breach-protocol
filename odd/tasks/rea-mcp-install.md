# REA (Reverse Engineer Anything) available to Pi inside this project

Adds REA's local MCP server as a **project-scoped** Pi MCP server and vendors REA's
`reverse-engineer-anything` workflow skill into this repository's `.agents/skills/`.
No application code, no `package.json` dependency, no CI change.

## Specs

S1. The user asked to install REA *in this project* so that it works with Pi
    *in this project*: `"quiero que instales esto en el proyecto para que funcione
    con pi en el proyecto porfavor."` Registration must be project-scoped
    (`.pi/mcp.json`), not user-level, and it must not require the user to edit
    `~/.pi/agent/mcp.json`.

S2. The two official sources given are `"https://github.com/morluto/rea"` and
    `"https://rea.tools/guides/browser/"`. REA must be acquired only from the
    official npm package `rea-agents` and the browser workflow must be usable:
    connecting to an existing Chrome started with
    `--remote-debugging-port=9222` (example endpoint `http://127.0.0.1:9222`),
    listing page targets, and capturing a window of network/script evidence.
    Static JavaScript/Electron analysis must need no native analysis engine
    (no Hopper, Ghidra, IDA, JADX install is part of this task).

S3. Pi reads project MCP servers from `.pi/mcp.json` and project skills from
    `.agents/skills/<name>/`. The REA version must be pinned exactly in the
    registration so the project does not silently drift between releases.

## Tasks

- **T1** (S1, S3) — Create `.pi/mcp.json` with a `rea` stdio server:
  `command: "npx"`, `args: ["-y", "rea-agents@6.10.1", "mcp"]`, a one-line
  `description`, and a per-request `timeout` large enough for observation
  windows and analysis reads. Validate it. → writer
- **T2** (S2, S3) — Vendor REA's bundled skill at the same pinned version into
  `.agents/skills/reverse-engineer-anything/` (byte copy from the published
  package, `SKILL.md` plus its `references/`), record the third-party
  attribution, and document the project setup briefly. → writer

## Log

L1. `quiero que instales esto en el proyecto para que funcione con pi en el proyecto porfavor. "https://github.com/morluto/rea\n\nhttps://rea.tools/guides/browser/"`

L2. Discovery: `rea-agents` 6.10.1 (latest, MIT), requires Node
`^22.23.4 || ^24.22.1 || >=26.12.1`; host has Node v24.22.3, so it satisfies the
range. `rea setup` has no Pi client, so manual project registration is required
(Pi documents `.pi/mcp.json` as the project MCP file and reads project config
only under project trust).

L3. Discovery: the published tarball ships `package/skills/reverse-engineer-anything/`
with `SKILL.md` + 8 `references/*.md` files — the same workflow `rea setup`
installs for supported clients.
