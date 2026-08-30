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

## Architecture note: the MCP server and the browser extension are complementary

Two surfaces ship Caveman's compression, both driving the **same** engine:

| Surface | How it works | Where it's strong |
|---|---|---|
| **Browser extension** (Chrome + `extension/firefox/` #810) | Injects a compression directive into the composer DOM on chatgpt.com / claude.ai / gemini.google.com | Always-on, per-message, client-side; needs no server and no official plugin API; works on any host the browser visits |
| **This Remote-MCP server** | Registers the 5 tools as an MCP connector a host invokes as function calls | Official, structured surface; one server registers into ChatGPT, Claude, Codex, Cursor, Gemini, pi simultaneously |

Why keep both: an MCP tool cannot rewrite the user's outgoing text the way a
DOM injection can, and a browser extension cannot appear in a host's plugin list
the way an MCP connector can. They complement rather than overlap. This is the
same split chat-on-steroids-style extensions draw against MCP plugins: the
browser extension has full presentation/DOM power but is per-browser; an MCP
server is a narrow (schema-declared, model-invoked) tool but is host-portable and
officially listed.

Recorded against the host capabilities this targets:

- ChatGPT/Codex MCP support covers **read and write tools** (not read-only actions), with
  `readOnlyHint`/`openWorldHint` annotations; plugin/GPT-over-Actions is ChatGPT-platform-only,
  while MCP is the open standard one server can register into many clients.
- Realizing this server: **Codex registers a Streamable-HTTP server at a URL with a bearer
token or OAuth** — exactly the transport + auth this server exposes. ChatGPT desktop
actions the same path; ChatGPT web consumes remote MCP-backed plugin tools.
- inference-only and local-first defaults are unchanged (see Security posture).

## Register Caveman in ChatGPT (Work / desktop)

ChatGPT registers MCP connectors by URL (Streamable HTTP), not by subprocess, so
this server (not the stdio one) is what you point it at. Mirror the flow OpenAI
ships for its own MCP onboarding — exact labels move between releases, but the
shape is stable:

1. **Run the server** where ChatGPT can reach it: `node mcp/remote/server.mjs`
   (loopback for the desktop app) or behind a TLS reverse proxy for Web/Work, with
   `CAVEMAN_MCP_TOKEN` set if off-loopback. `…/mcp` is the endpoint.
2. **Open ChatGPT Settings → Apps** and turn on **Developer mode** (or Settings →
   Connectors → Advanced, depending on the version).
3. **Create a new Connector**, choose **Remote / Streamable HTTP**, and paste the
   endpoint `https://…/mcp`.
4. **Set the token** to the `CAVEMAN_MCP_TOKEN` value for the bearer credential.
5. **Enable the 5 tools**, then `/mcp` (or the Apps/Connectors panel) lists the
   connected server. From there the model can call `caveman_compress` etc. on
   demand.

The engine binary must be reachable on the server host for `tools/call`;
`initialize` and `tools/list` answer before any call.

## Caveman anywhere — broadening the launch

The MCP server and the extension are two install points for one behavior. The
recommended audience split:

- **Expose the server** wherever a host lists connectors/plugins (ChatGPT Work,
  Claude, Codex, Cursor, Gemini, pi) — anyone who uses that host gets the tools
  natively.
- **Ship the extension** to browser users on those same chat sites — the
  always-on, per-message path that needs no server.

Treat them as a pair, not a fork: keep `docs/remote-mcp.md` as the single
reference for the server and point to `extension/` (and its Firefox port #810)
for the browser surface.

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