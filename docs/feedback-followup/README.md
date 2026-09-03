# Feedback Follow-up — Draft Plans (fork-only)

Plan-only drafts derived from the maintainer's and reviewer's feedback on the
Alot1z caveman campaign PRs (JuliusBrussee/caveman #931–#957). **Nothing here
is an implementation** — each document states the feedback, the disposition,
and a plan with a concrete trigger for when to act. This branch lives only in
`Alot1z/caveman-remap`; no upstream PR or comment is implied.

## Disposition matrix

| PR | What | Reviewer feedback | Disposition | Plan doc |
|---|---|---|---|---|
| #936 | Firefox port | 3 required fixes; applied by maintainer post-merge with follow-up notes | MERGED; follow-ups resolved (drift guard + doc accuracy shipped, CI-e2e stays opt-in by maintainer choice) | [PR-936](PR-936-firefox-port.md) |
| #954 | en-US number formatting | checksums merge-debris (AmirF194) | MERGED; fixed + confirmed | [PR-954](PR-954-stats-format.md) |
| #957 | compress regression tests | none (tests-only) | MERGED; closes #932 loop | [PR-957](PR-957-compress-tests.md) |
| #931 | stats accounting + lifetime aggregation | fix 1 absorbed via #794; rest too large a unit; evidence issue requested | CLOSED; partially absorbed | [PR-931](PR-931-stats-lifetime.md) |
| #932 | crash-free compress | absorbed as smallest version (v2.5.0 d6c1cd3); provider-agnostic = over-engineering | CLOSED; fully absorbed | [PR-932](PR-932-compress-crash.md) |
| #933 | measured compression runtime | new product surface in a scope-narrowing repo | CLOSED; direction rejection | [PR-933](PR-933-l4-runtime.md) |
| #934 | host-agnostic Remote-MCP | MCP surface belongs in the Go binary; 700-line subsystem out of scope | CLOSED; shape rejection | [PR-934](PR-934-remote-mcp.md) |
| #955 | test-count gate | shape no-ops (per-branch map); counting bug; dead weight; template checkbox suggested | CLOSED; cheaper alternative executed then withdrawn (upstream PR #974 opened, closed as noise by author); counting-bug class recorded as KB #6450 | [PR-955](PR-955-test-count-gate.md) |
| #956 | streamable-HTTP transport | security critique (ACAO:* + no Origin validation); v2-scheduled; target shape specified | CLOSED; deferred to v2 | [PR-956](PR-956-streamable-http.md) |

Cross-cutting ideas from the good feedback: [inspirations.md](inspirations.md).

## How to use this branch

- Browse the plan docs here, or via the draft PR's file view.
- Each doc ends with a **Trigger** — the observable condition that makes the
  plan actionable. Until a trigger fires, the plan stays a plan.
- When a plan is executed, it becomes its own focused PR (per the review-unit
  discipline in PR-931: small, single-purpose diffs).

## Executed plans (2026-09-03)

| Plan | Result |
|---|---|
| #955 template checkbox | Upstream PR **#974** opened, then **closed as noise** by the author (2026-09-03) — a template prompts but cannot enforce; trigger re-recorded |
| #936 drift guard | Shipped by the maintainer in `87325d8` (`package.test.mjs` version-source assertions); nothing to add |
| #936 CI e2e | Deliberately **not** executed — reverses the maintainer's opt-in decision |

## Provenance

Feedback read 2026-09-03 from the live API of `JuliusBrussee/caveman`
(PRs #931, #932, #933, #934, #936, #954, #955, #956, #957): all review
comments, inline review comments, and closure reasons. Reviewers:
JuliusBrussee (maintainer) and AmirF194. KB session digest:
2026-09-03-caveman-upstream-mission (items 62–68).