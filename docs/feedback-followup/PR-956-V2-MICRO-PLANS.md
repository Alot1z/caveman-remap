# #956-v2 micro-PR plans — pre-drafted, trigger-gated

Six single-purpose PR plans for the maintainer-specified #956-v2 transport
security shape (see [PR-956-streamable-http.md](PR-956-streamable-http.md)
for the verbatim closure and the full design). Each plan is one reviewable
unit (review-unit discipline, rank 4: one PR = one behavior), pre-drafted now
so that when the v2 trigger fires, execution is mechanical — but every plan
**re-passes the #6509 screen against the then-current `main` before building**
(the maintainer ships follow-ups fast; the shape below may already be
implemented or superseded — #6507 implemented/superseded discipline).

**Trigger (all six plans):** a concrete host requirement for remote MCP, or
upstream starting #956-v2 transport work. Nothing here builds before that.
**Binary boundary (rank 1, class-2 screen):** every plan lands INSIDE the Go
`caveman-mcp` binary. No parallel Node server, ever.
**Suggested sequence:** 1 → 2 → 3 are the foundation (binding + auth +
origin); 4–6 are hardening/docs that ride with or after them. If the
maintainer prefers one PR, the six units compose in this order without
overlap — each touches a different axis (bind, auth, origin, resource cap,
docs, tests).

---

## Plan 1 — loopback-only binding unless a token is set

- **Behavior:** `caveman-mcp` HTTP listener binds to `127.0.0.1` by default;
  any non-loopback bind requires `--mcp-token` (or equivalent) to be set,
  else startup fails with a clear error.
- **Diff shape:** bind-address resolution at server construction + one
  startup guard + one error message. Stdlib only.
- **Test:** startup refuses non-loopback bind without a token (assert exit +
  stderr text); loopback bind works unchanged with and without a token.
- **Commit:** `fix(mcp): bind loopback-only unless a token is set`

## Plan 2 — bearer-token auth restored

- **Behavior:** when a token is set, every HTTP request (except a documented
  health/ready endpoint if one exists) must carry
  `Authorization: Bearer <token>`; missing/wrong token → 401.
- **Diff shape:** one middleware/wrapper around `dispatch` in the Go binary.
  This restores the #934 precedent that #956 dropped.
- **Test:** tools/list and tools/call round-trip with a correct token (200);
  401 without; 401 with a wrong token. No token in any log line.
- **Commit:** `fix(mcp): require bearer auth when a token is configured`

## Plan 3 — strict Origin allowlist (MCP 2025-06-18)

- **Behavior:** validate the `Origin` header against an explicit allowlist
  (default: reject all cross-origin; loopback tooling origins allowed
  explicitly). Rejects the cross-origin preflight + tools/call exploit the
  maintainer demonstrated end-to-end.
- **Diff shape:** origin check in the HTTP handler before dispatch;
  allowlist via flag/config; spec citation in the doc comment.
- **Test:** foreign Origin → preflight and POST both rejected (reproduce the
  maintainer's exploit as the regression test); allowed Origin passes;
  absent Origin on non-browser clients passes per spec.
- **Commit:** `fix(mcp): validate Origin against an allowlist (MCP
  2025-06-18)`

## Plan 4 — cap on SSE connections

- **Behavior:** bound concurrent SSE/streamable connections (small constant);
  over the cap → 503 with a retry hint; caps are per-process.
- **Diff shape:** a counting guard around stream establishment + the limit
  as a constant or flag.
- **Test:** cap+1 concurrent streams → the last gets 503; released slots
  become available again.
- **Commit:** `fix(mcp): cap concurrent SSE connections`

## Plan 5 — stdlib flag parsing only

- **Behavior:** all new v2 flags (`--mcp-bind`, `--mcp-token`,
  `--mcp-origin`, SSE cap) parse with the stdlib `flag` package — consistent
  with the repo's Go CLI conventions, no third-party parsing.
- **Diff shape:** flag registration + help text only; behavior lives in
  plans 1–4. This plan exists so the flag surface is reviewable as one unit.
- **Test:** flag round-trip; `--help` shows the new flags with correct
  defaults (loopback, no token, empty allowlist, default cap).
- **Commit:** `feat(mcp): add v2 transport flags (stdlib parsing)`

## Plan 6 — docs + zero-egress test with teeth (same commit as capability)

- **Behavior:** (a) mcp/README.md, CLAUDE.md, AGENTS.md stop claiming the
  binary "opens no network connection" and document the v2 listener posture
  exactly as shipped; (b) the zero-egress test asserts `Serve` cannot reach
  the network (no filename-based skip) — the maintainer's exact complaint.
- **Diff shape:** doc edits + one real assertion test. **Rule: these ride in
  the same commit as the capability they describe** — never a docs-only
  follow-up (the #956 lesson, verbatim).
- **Test:** the egress assertion runs in CI (not skipped by filename); docs
  grep-checked: no stale "no network" claim anywhere in the three files.
- **Commit:** per-capability (docs + test ride with plans 1–4), or as
  `test(mcp): assert Serve makes no network egress` if the transport lands
  as one PR.

---

## Discipline

- One PR = one behavior (rank 4). If upstream wants it as one PR, the six
  units compose in the sequence above with zero overlap.
- Re-pass the #6509 screen per plan at draft time against current `main`.
- Bearer-token auth restored per the #934 precedent (plan 2) — never dropped
  again (the exact regression the maintainer called out).
- Each security property carries its own test (plan 6's rule applies to all).
