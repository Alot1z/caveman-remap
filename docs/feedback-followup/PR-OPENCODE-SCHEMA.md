# Plan-only draft — OpenCode Go anthropic-messages compat mount (the #934 lane)

**Status: DRAFT ONLY. Not opened, not pushed as a PR.** Trigger-gated like
every other plan in this branch. Zero upstream interaction implied by this
document.

## The lane (why this shape is sanctioned)

The maintainer's #934 closure: *"If a specific host needs one schema tweak (as
#870 did), a small PR against the existing MCP server is the right shape."*
MCP surface work belongs in the **Go `caveman-mcp` binary** — never a
parallel Node server. This draft is one host (OpenCode Go), one schema tweak,
one small PR against the existing binary. It passes the #6509 rejection-class
screen: not a new product surface (1), not a parallel subsystem (2), no CI
gate (3), no unpinned e2e (4), uses the existing compat contract (5), no
mirrors (6), no new modes (7), no merged-PR choreography (8).

## The known seam (facts, cited)

- **KB #6552** (per-host provider map): the OpenCode Go client rejects
  `Authorization: Bearer` on the `anthropic-messages` path with
  `401 {"type":"error","error":{"type":"AuthError","message":"Missing API key."}}`.
  The opencode-go `anthropic-messages` models — `minimax-m3`, `qwen3.7-max`,
  `qwen3.7-plus`, `qwen3.8-max` — failed through the proxy and worked in
  direct mode.
- **KB #6458** (proxy auth seam, PR #969, MERGED): the fix pattern is already
  established at the proxy layer — a named compat mount maps the credential
  by the **wire protocol of the request path**: `/compat/<name>/v1/messages`
  gets `x-api-key` + a default `anthropic-version`; every other path keeps
  `Authorization: Bearer`; a real inbound Bearer token keeps its header on
  every path. The #969 verification included a protocol unit test for the
  `anthropic-messages` arm and a Go end-to-end test.

## The draft shape (what a real PR would contain)

1. **Ground-truth first (blocking):** confirm on CURRENT main whether the
   opencode-go MCP client actually drives `/v1/messages` through the Go
   binary's compat layer (the #969 facts are proxy-layer; the MCP-binary side
   must be reproduced, not assumed — the #6507 superseded discipline: the
   maintainer ships follow-ups fast, so re-check main before building).
2. **The change (one file region):** in the existing MCP/compat layer of the
   Go binary, apply the established #969 credential-by-wire-protocol mapping
   for the opencode-go host: requests on the `anthropic-messages` path carry
   `x-api-key` (+ default `anthropic-version`), all other paths keep Bearer,
   inbound Bearer preserved everywhere. Nothing else — no transport changes,
   no new endpoints, no gateway changes.
3. **Test shape (mirroring #969's verification):**
   - protocol unit test: `anthropic-messages` arm asserts `x-api-key` mapping
     and that a real inbound Bearer survives every path;
   - regression test: the exact `401 Missing API key.` case fails before,
     passes after;
   - Go end-to-end test through the binary's compat mount (as #969 did for
     the proxy).
4. **Docs:** any schema behavior change ships with its doc line in the same
   commit (#956 v2 requirement pattern).

## Trigger

Fires only when BOTH hold: (a) the ground-truth step confirms the gap on
current main (reproduced, not assumed), and (b) the maintainer signals the
#934 lane is open (no indication yet — the #956 v2 work is the other pending
MCP thread). Until then this stays a draft.

## Explicitly NOT in scope

- No parallel Node server (the rejected #934 shape).
- No new transports, no bearer-token auth redesign (that is the #956-v2
  precedent, separately scheduled).
- No model-list changes beyond the four documented opencode-go models.
- No upstream PR, no fork PR — this document is the plan.