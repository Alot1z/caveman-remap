# OpenCode Go compat seam — ground-truth verdict (was: PR-OPENCODE-SCHEMA draft)

**Status: OBSERVED-AS-REFUTED (2026-09-03). The seam this draft was sized
against is already handled on current main. Draft withdrawn; this document is
now the finding record.** No PR was opened; none is due.

## What the draft claimed (original premise, from KB #6552/#6458)

That the opencode-go `anthropic-messages` models (minimax-m3, qwen3.7-max,
qwen3.7-plus, qwen3.8-max) fail through the proxy with
`401 {"type":"error","error":{"type":"AuthError","message":"Missing API key."}}`
because OpenCode Go rejects `Authorization: Bearer` on the anthropic-messages
path, and that a single-purpose schema-tweak PR against the **Go
`caveman-mcp` binary** should add an x-api-key compat mount (the #934 lane,
per the #870 blessing).

## Ground truth (current main `9911e5f`, static code read; go1.26.5 available)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | The MCP binary has an anthropic-messages HTTP path to fix | **REFUTED** | `mcp/` has no `net/http` server (only `server_test.go`); `mcp/CLAUDE.md` L48: "v1 is **stdio-only**… HTTP transport + `caveman mcp` subcommand are **v2**". The MCP binary is a tool server; the anthropic-messages path belongs exclusively to the proxy. |
| 2 | The x-api-key wire-protocol mapping exists as the fix pattern | **FACT** | `proxy/internal/gateway/auth_fallback.go` (merged #969): `openai_compatible` case sets `x-api-key` when the request carries it, else Bearer; `x-api-key` is a usable provider key; "A named compat mount maps an Anthropic-protocol path to x-api-key." |
| 3 | opencode-go is a recognized compat mount | **FACT** | Built-in route `/compat/opencode-go/v1/messages` → `https://opencode.ai/zen/go/v1/messages` (+ `/v1/responses`, `/v1/chat/completions`), with a user escape hatch (`compat.opencode-go` config entry, `OPENCODE_ZEN_API_KEY` env) — `standalone_test.go` `TestBuildAdapters_OpenCodeGoRouteUsesOpenCodeUpstream` / `TestBuildAdapters_OpenCodeGoUserEntryReplacesBuiltin` / `TestCreds_OpenCodeGoBuiltinCompatCredential`. |
| 4 | The four models are hardcoded routing | **REFUTED** | `minimax-m3`/`qwen3.7-*` appear only in test fixtures (`auth_fallback_test.go`, `standalone_test.go`) — provider-mapped via config, not hardcoded. |
| 5 | A live repro of the 401 is possible here | **UNKNOWN (blocked)** | No provider keys on this machine and no live opencode-go client; a runtime repro is impossible without both. The static level fully answers the seam question; the behavioral level (does opencode-go's client actually send `x-api-key` on the compat path, does zen/go accept it) needs a keyed live call. |
| 6 | The #934 lane targets the MCP binary | **REFUTED** | Per-host compat mounts live in the PROXY (`proxy/internal/standalone`, `/compat/<name>/`); the MCP binary's only host-specific surface is v2 HTTP transport, which is the #956-v2 track (KB #6451 Origin/auth). |

## Verdict

**The gap the draft was sized against is already closed on current main.**
The pre-#969 failure recorded in KB #6552 was fixed by #969 (credential by
wire protocol) plus the built-in opencode-go compat mount. A new PR would be
duplicate work — exactly the "already on main" closure class of KB #6507.

## What the #934 lane actually holds now (re-scoped)

- Per-host schema tweaks live in the **proxy's** compat-mount layer, not the
  MCP binary. opencode-go: built-in route exists; a future PR is due only if
  the user-entry escape hatch proves insufficient (needs a live keyed repro —
  UNKNOWN).
- Codex pipe 2 MiB cap + fail-open: proxy-side contract, already recorded
  (KB #6459).
- The MCP binary's real open item is the **v2 HTTP transport** (#956-v2):
  streamable-HTTP with Origin validation + auth per KB #6451 — the six-PR
  queue in PR-SPLIT-ANALYSIS.md, still trigger-gated.
- Trigger for any of this: a maintainer signal or a live-keyed failure. None
  has fired.

## Ledger note

Draft created 2026-09-03 (18ec9bb), ground-truthed same day, marked
OBSERVED-AS-REFUTED. Zero upstream PRs; zero fork PRs.