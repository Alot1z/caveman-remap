# Remote-MCP — Caveman compression as a host-agnostic server

## Summary

Caveman already ships an MCP server over **stdio** (`caveman-mcp`). The gap: most
new text hosts — ChatGPT.com, Gemini, pi.dev — do **not** run arbitrary stdio
subprocesses, so that server can't be registered there. All the agent-enabled
hosts DO speak MCP over HTTP, uncoupled from how many subprocesses the host is
willing to spawn.

`mcp/remote/` closes that gap with one server that **any** MCP host can register.
It is transport/schema work, not new compression: the server exposes the *same*
5 tools as the stdio server and bridges `tools/call` to the reviewed engine
binary over stdio. No payload bytes are reimplemented.

- `mcp/remote/server.mjs` — Remote-MCP (Streamable HTTP) server.
- `mcp/remote/schema.mjs` — OpenAI-class JSON-Schema for the 5 tools (the
  `{object, properties, required}` shape ChatGPT/Gemini/pi parsers require; see
  `#870`, `#709`).
- `mcp/remote/package.json` — `caveman-mcp-remote`, MIT launcher, `npm test`.

## How a host registers it

ChatGPT, Claude, Codex and Gemini all register an MCP server the same way: point
them at the server's `…/mcp` endpoint (Remote/Streamable HTTP), and authenticate
with the bearer token (or a future OAuth flow). One server, every host — there is
no per-feature or per-host server to build.

| Host | Register | Notes |
|---|---|---|
| ChatGPT.com (Work / desktop) | Remote MCP URL → `…/mcp` | needs a reachable host + engine binary; `CAVEMAN_MCP_TOKEN` bearer. ChatGPT web consumes remote MCP-backed plugin tools; the desktop app also accepts a local Streamable-HTTP server. |
| Codex (CLI / IDE) | Streamable HTTP URL, or stdio | documented: `codex mcp add <name> --url <…>/mcp`; `/mcp` lists connected servers |
| Claude | `claude mcp add` (stdio or remote) | the existing stdio path is unchanged and still supported |
| Gemini CLI | remote or stdio + this schema | schema is Gemini-compatible (no Claude-only shapes) |
| pi.dev | remote MCP | the one-schema gap that closed the earlier run (`#870`) is now covered |
| Firefox / Chrome | browser extension | the other surface: directive injection on chatgpt/claude/gemini (`extension/firefox/`, `#810`) |

> Server-instruction guidance: if the server is later extended, keep the first
> ~512 chars of an `instructions` field self-contained — MCP hosts read it as
> server-wide guidance and use it to decide when to invoke the tools.

## What the 5 tools are

`caveman_compress`, `caveman_retrieve`, `caveman_stats`, `caveman_toon_encode`,
`caveman_toon_decode` — the same surface as the stdio server, with
`{object, properties, required}` schemas. `initialize` and `tools/list` answer
from `schema.mjs` with no engine needed; `tools/call` requires the engine binary
(`CAVEMAN_MCP_BIN`, falling back to `npx caveman-mcp`).

## Security posture

- Binds `127.0.0.1` by default. Exposing on a non-loopback interface requires
  `CAVEMAN_MCP_HOST` **and** `CAVEMAN_MCP_TOKEN` (mandatory `401` otherwise).
- `inferred-only` — never claims `verified` savings (the upstream `mcp/` contract).
- `tools/call` spawns the **reviewed** engine binary only (checksum-verified by
  the existing installer path); the bridge never touches payload bytes.
- For public hosting, TLS termination is the operator's responsibility; OAuth
  (MCP `authorizationServer`) is a natural follow-up but out of scope for v1.

## Why remote MCP, not a per-feature split

Caveman exposes **one** tool surface. Spinning a separate server or doc per tool
or per host would multiply moving parts for zero added capability — every host
registers the same single `caveman-mcp-remote` server and enables the 5 tools it
wants. This RFC is the single reference for that server; anything that is truly
separate (the browser extension, the engine binary contract) lives in its own doc.

## Testing

`cd mcp/remote && npm test` — 6 unit tests cover initialize, tools/list,
error handling, notifications, token auth, and schema shape (no engine needed).
Two conditional engine-binary integration tests (`tests/engine.test.mjs`) run the
real `tools/call` round-trip when `CAVEMAN_MCP_BIN` is set and skip cleanly
otherwise, so CI never fails on a build without the Go engine.

## Out of scope / frozen

`caveman-code`, `cavemem`, `cavekit` are frozen and untouched; `caveman-agent-sdk`
and `cavegemma` remain in their own repos.

## References

`#810` · `#870` · `#709` · `#373` · `#403` · `#228` · `#908` · `#921` · `#742` ·
`#775`

---

Co-Authored-By: Alot1z <Alot1z@users.noreply.github.com>