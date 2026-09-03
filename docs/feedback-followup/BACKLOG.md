# Ranked Backlog — what the good feedback becomes

Ranked implementation backlog derived from the 10 ideas in
[inspirations.md](inspirations.md) (feedback on JuliusBrussee/caveman
#931–#957, read 2026-09-03). Every code item is **sized for a small,
single-purpose PR** (review-unit discipline, KB #6313 / #931 lesson); every
item carries a trigger and stays dormant until it fires. Rank weights
maintainer endorsement × value × actionability-now.

## Ranking

| Rank | Idea (origin) | Class | Size | Trigger | Status |
|---|---|---|---|---|---|
| 1 | MCP-over-HTTP Origin/auth posture (#956) | KB security entry (universal) | S (capture); code deferred | Next MCP HTTP transport work (#956-v2 shape) | **CAPTURED — KB #6451 (TRUSTED)**; code still deferred to #956-v2 |
| 2 | Chrome vs Firefox content-script CSS `url()` resolution (#936) | KB fact (universal, OBSERVED) | S | Any cross-browser extension work | **CAPTURED — KB #6441 (TRUSTED)**; Firefox-side comparison recorded in PR-936 draft |
| 3 | Manifest files are generated artifacts — regenerate, never hand-merge (#954) | Repo-hygiene rule | S | Any checksums/manifest merge | **CAPTURED — KB #6452 (TRUSTED)** |
| 4 | Review-unit discipline — one PR = one behavior (#931) | Convention + KB principle | S | Next multi-behavior diff starts forming | Open |
| 5 | Smallest-version fixes, credit the reporter, shape-handling only for real providers (#932) | Review-checklist item | S | Any fix PR | Open |
| 6 | Oracle-backed replies get confirmed, not re-reviewed (#954) | Reply-style convention | S | Next campaign reply | Open |
| 7 | Bounded lifetime aggregation, evidenced (#931) | Upstream issue → single-purpose PR | M | A **measured** timeout/history-size incident exists (maintainer precondition) | BLOCKED on evidence |
| 8 | Firefox e2e in CI, pinned web-ext (#936) | Fork-only CI (upstream: reverses maintainer's opt-in) | M | User wants Firefox coverage enforced | Deferred by design |
| 9 | Manifest version-drift guard (#936) | Shipped upstream already | — | Next manifest-touching release → run upstream's own guard (`87325d8`), add nothing | No-op |
| 10 | PR template checkbox (#955) | Executed then withdrawn | — | Only if the maintainer asks for it | Closed as noise (2026-09-03) |

## Item detail

### 1. MCP-over-HTTP security posture (rank 1 — highest value)
- **Feedback:** ACAO:`*` + no Origin validation + no auth let any open web
  page drive local MCP tools; the maintainer verified the exploit end-to-end;
  MCP 2025-06-18 requires Origin validation.
- **Action (KB capture, small):** universal-scope security entry — "local MCP
  HTTP servers must validate Origin and require auth before listening;
  loopback-only unless a token is set." Evidence OBSERVED (maintainer's
  verified note), provenance = session digest.
- **Action (code, deferred):** the exact v2 shape is already specified by the
  maintainer (#956 closure): Origin allowlist, loopback-only unless token,
  SSE cap, stdlib-only flags, docs in the same commit, zero-egress test with
  teeth — one single-purpose PR when v2 transport work starts.

### 2. Cross-browser CSS `url()` resolution (rank 2)
- **Feedback (#936):** Chrome resolves `url()` in content-script CSS against
  the page origin; Firefox against the stylesheet. The relative font path
  only worked in Firefox; deleting it was correct for both.
- **Action:** KB fact entry (universal, OBSERVED). Single capture, no code.

### 3. Generated artifacts must be regenerated (rank 3)
- **Feedback (#954):** `checksums.sha256` hand-merge produced merge debris;
  reviewer confirmed the fixed head.
- **Action:** repo-hygiene rule (KB + fork AGENTS note): "generated artifacts
  are regenerated, never hand-merged — one canonical line per file." No code.

### 4. Review-unit discipline (rank 4)
- **Feedback (#931):** a 650-line multi-behavior diff is unreviewable as one
  unit; one PR = one behavior change.
- **Action:** fork convention + KB principle (already partially in PR-931
  lesson). Enforced going forward; every backlog item above is pre-sized to
  this rule.

### 5. Smallest-version fixes (rank 5)
- **Feedback (#932):** land the minimal fix (first text block, not
  `content[0]`), credit the reporter; provider-agnostic shape-handling for
  providers that never appear is over-engineering.
- **Action:** review-checklist item (KB). Applied to any future fix PR.

### 6. Oracle-backed replies (rank 6)
- **Feedback (#954):** state exactly what was verified and how; reviewers
  confirm rather than re-review.
- **Action:** reply-style convention for future campaign PR bodies/replies.
  Practice-level; no artifact beyond this doc.

### 7. Bounded lifetime aggregation, evidenced (rank 7 — blocked)
- **Feedback (#931):** the maintainer asked for an issue with history-file
  size + timing **before** sizing the feature.
- **Trigger:** a measured timeout / history-growth incident (real numbers,
  not predicted). Then: one upstream issue → one single-purpose PR.
- **Status:** BLOCKED on the evidence precondition — do not build early.

### 8. Firefox e2e in CI, pinned (rank 8 — deferred by design)
- **Feedback (#936):** `test:firefox` falls back to bare `npx web-ext`;
  maintainer specified pinned devDependency + explicit install step.
- **Reality check:** the maintainer then made `test:firefox` **opt-in**
  precisely to avoid fetching web-ext in CI. Pushing it into upstream CI
  reverses his decision — the "extra work not correct upstream" class.
- **Status:** fork-only if the user wants enforced Firefox coverage on the
  fork; otherwise dormant.

### 9. Manifest version-drift guard (rank 9 — already shipped)
- **Feedback (#936):** Firefox manifest hardcoded a version only the Chrome
  manifest was checked against.
- **Reality:** the maintainer's follow-up `87325d8` ships the guard
  (`package.test.mjs` single-version-source assertions).
- **Status:** no-op. At the next manifest-touching release, run upstream's
  own guard; never re-add a parallel one.

### 10. PR template checkbox (rank 10 — closed as noise)
- **Feedback (#955):** "a PR template checkbox is the cheaper fix."
- **History:** executed as upstream #974 (2026-09-03), withdrawn same day —
  CI already enforces the property that matters; a template prompts but
  cannot force; two in-campaign occurrences did not clear the
  "recurring problem" bar.
- **Trigger:** re-open only if the maintainer asks. Durable output: the
  counting-bug class is recorded as KB #6450.

## Backlog policy

- Nothing here ships without its trigger firing; a fired trigger produces one
  small, single-purpose PR (upstream or fork per item), never a bundle.
- Items 1–6 are capture/convention work (S-sized, doable immediately if
  wanted); 7–10 are gated on evidence, maintainer behavior, or explicit ask.
- This file supersedes the ad-hoc "next steps" lists in the per-PR docs; the
  per-PR docs keep the full feedback verbatim + disposition.
