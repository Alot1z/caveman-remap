# PR Split Analysis — were the 10 PRs right-sized, and what smaller tasks remain?

Analysis of the full Alot1z campaign surface on JuliusBrussee/caveman
(#931–#957 + #974), 2026-09-03. Question per PR: did it make sense, and could
it (or its residue) be split into smaller, maintainer-shaped tasks?

## Verdict table

| PR | Verdict | Right-sized? | Remaining smaller tasks |
|---|---|---|---|
| #974 template checkbox | Closed by author as noise | Yes — already the smallest unit | None (re-open only if maintainer asks) |
| #957 compress regression tests | Merged | Yes — tests-only follow-up to the #932 fix | None |
| #956 streamable-HTTP transport | Closed → v2 | No — was a 700-line+ subsystem; the v2 target shape splits into **6 micro-PRs** | (a) Origin allowlist, (b) loopback-only unless token, (c) SSE cap, (d) stdlib flags, (e) docs-in-same-commit, (f) zero-egress test asserting no network — each against the Go `caveman-mcp` binary, when v2 opens |
| #955 test-count gate | Closed (shape) | No — the gate was the wrong shape entirely | Counting-bug lesson → KB #6450 (done); env `PR_BODY` pattern kept for future gates; template checkbox closed as noise |
| #954 en-US number pin | Merged | Yes — single-purpose | Regeneration rule → KB #6452 (done) |
| #936 Firefox port | Merged | Yes — maintainer already split the follow-ups | Drift guard shipped (`87325d8`); pinned web-ext + Firefox e2e stays fork-only unless requested |
| #934 Remote-MCP | Closed (shape) | No — 700-line subsystem was rejected | Maintainer-blessed shape: **one small schema-tweak PR per host** against the existing MCP Go server (the #870 shape) — feasible without drifting; bearer-token auth is the #956-v2 precedent |
| #933 l4 runtime | Closed (direction) | — | Measurement idea's sanctioned home = caveman-stats; no further splits |
| #932 compress crash | Closed (absorbed) | Yes — fix (d6c1cd3) + tests (#957) split correctly | None |
| #931 stats/lifetime | Closed (partially absorbed) | No — one 650-line unit; maintainer decomposed it himself | (a) multi-block accounting → absorbed via #794; (b) number pin → #954; (c) lifetime aggregation → blocked on a measured-timeout issue |

## The honest read

The maintainer's own actions already performed most of the decomposition:
#931 → #794 + #954, #932 → fix + #957. What remains is NOT re-opening the
closed items — it is (1) the #956-v2 micro-PR queue (six small PRs, each
independently reviewable, all inside the maintainer's specified shape), and
(2) the #934 per-host schema-tweak lane (one host per PR, e.g. the first
tweak when a host's schema drifts). Both are pre-sized to the review-unit
discipline (KB #6313) and both wait on their triggers: v2 transport work
starting, or a concrete host schema gap.

## Feasibility of the #934 shape (asked directly)

Yes — and without drifting. The maintainer's own words: "If a specific host
needs one schema tweak (as #870 did), a small PR against the existing MCP
server is the right shape." That is a bounded unit: one host, one schema
change, its protocol test, nothing else. The two anti-drift guards are:
(a) the change targets the Go `caveman-mcp` binary (never a parallel Node
server — the rejected shape), and (b) the PR touches only the compat layer for
that host — no gateway, no transport, no workflow changes. Everything else
belongs in the drafts until its trigger fires.