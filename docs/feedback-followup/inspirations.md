# Inspirations — what the good feedback suggests

Plan-only ideas extracted from feedback that was constructive, specific, or
both. Each has a home and a trigger; none is implemented.

## 1. PR template checkbox for body accuracy (from #955)

The maintainer's own cheaper alternative to the rejected gate: a PR-template
checkbox that the Test-counts line matches the latest local run. Home: the
fork's PR template. Trigger: adopting the convention in the fork.

## 2. Firefox e2e in CI, properly pinned (from #936)

`test:firefox` currently falls back to a bare `npx web-ext` (unpinned download
inside the release gate). The maintainer specified the fix: web-ext as a
pinned devDependency + an explicit Firefox install step. Home: fork CI draft.
Trigger: user wants Firefox coverage enforced.

## 3. Manifest version drift guard (from #936)

The Firefox manifest hardcoded `1.2.0` while only the Chrome manifest was
checked against package.json. The merged follow-up made `package` build the
firefox target; a `test:`-side comparison would catch drift earlier. Home:
fork extension tests. Trigger: next release touching manifests.

## 4. Bounded lifetime aggregation, evidenced (from #931)

The maintainer explicitly asked for an issue with history-file size + timing
before sizing the feature. Home: issue on upstream, then a single-purpose PR.
Trigger: a measured timeout.

## 5. MCP-over-HTTP security posture (from #956) — knowledge-worthy

ACAO:* + no Origin validation + no auth = any web page the user has open can
drive `tools/list`, `caveman_compress`, and `caveman_retrieve`, and retrieve
reads the shared `~/.caveman/ccr.db`. MCP 2025-06-18 requires Origin
validation. The maintainer verified the exploit end-to-end from a foreign
Origin. → Extract as a KB security entry (universal scope): "local MCP HTTP
servers must validate Origin and require auth before listening; loopback-only
unless a token is set."

## 6. Chrome vs Firefox content-script CSS url() resolution (from #936)

Chrome resolves `url()` in content-script CSS against the **page origin**;
Firefox resolves it against the **stylesheet**. The relative font path never
loaded in Chrome (indicator always rendered ui-monospace) and would have
worked only in Firefox — so deleting it was correct for both. → KB-worthy
cross-browser fact (universal scope, OBSERVED via maintainer's verified note).

## 7. Review-unit discipline (from #931)

A 650-line multi-behavior diff is unreviewable as a unit; one PR = one
behavior change. → Fork convention + KB principle.

## 8. Smallest-version fixes (from #932)

Land the minimal fix (first text block, not content[0]) and credit the
report; the tests follow separately (#957). Shape-handling for providers that
never appear is over-engineering. → Review checklist item.

## 9. Manifest files are generated artifacts (from #954)

`checksums.sha256` must be regenerated (one canonical line per file), never
hand-merged; the reviewer confirmed the fixed head. → Repo-hygiene rule.

## 10. Oracle-backed replies get confirmed (from #954)

State exactly what was verified and how; reviewers confirm rather than
re-review. → Reply-style convention for future campaigns.