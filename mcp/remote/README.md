# caveman-mcp-remote

Streamable-HTTP (Remote MCP) server that registers the same 5 tools as the
[stdio `caveman-mcp`](../README.md) server — `caveman_compress`, `caveman_retrieve`,
`caveman_stats`, `caveman_toon_encode`, `caveman_toon_decode` — over HTTP so
MCP-capable hosts that do **not** run arbitrary subprocesses can register it. That is
ChatGPT.com, Claude, Gemini and pi.dev. The compression engine is never reimplemented
here: `tools/call` bridges to the reviewed engine binary over stdio.

See [`docs/remote-mcp.md`](../../docs/remote-mcp.md) for the per-host registration
matrix, security posture, and rationale for a single merged server.

- **Local-only by default**: binds `127.0.0.1`. Set `CAVEMAN_MCP_HOST=0.0.0.0` to expose.
- **Inferred-only**: never claims `verified` savings (matches upstream `mcp/` contract).
- **Auth**: when bound off-loopback, set `CAVEMAN_MCP_TOKEN`; a missing/wrong bearer is `401`.
- **Transport**: MCP Streamable HTTP — `GET /mcp` (SSE) + `POST /mcp` (JSON-RPC), with
  `Mcp-Session-Id`. Tools are described via OpenAI-class JSON Schema (see `schema.mjs`).

## Run

```bash
node server.mjs                 # http://127.0.0.1:8787/mcp
CAVEMAN_MCP_PORT=9000 node server.mjs
```

## Register as a Remote MCP server

MCP hosts that accept a remote (http/https) server URL point at `…/mcp`. The engine
binary must be reachable on the same machine (`CAVEMAN_MCP_BIN` or `npx caveman-mcp`).

## Licence

MIT launcher; the engine binary it spawns is BSL-1.1 (see `mcp/BINARY_LICENSE.md`).

## Test

```bash
node --test tests/*.test.mjs    # transport/schema/auth, no engine binary needed
```