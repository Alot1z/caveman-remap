---
name: caveman-contribution
description: >-
  Complete, leveled workflow for contributing to JuliusBrussee/caveman through
  the Alot1z/caveman-remap fork: identity & token handling, fork sync, the
  fork-PR CI approval gate (KB #6449), commit/PR conventions, maintainer
  review patterns, baseline-first CI discipline, and the plan-only drafts
  surface. Use when contributing to caveman, drafting PRs, responding to
  maintainer feedback, or deciding whether a change should reach upstream at
  all. Harness-neutral — one SKILL.md that works in any agent harness.
version: 1.0.0
domain: contribution
tokens: 1100
---

# Caveman Contribution Skill (v1)

Complete workflow and knowledge for contributing to the caveman project
(JuliusBrussee/caveman) through the Alot1z/caveman-remap fork. All facts below
were OBSERVED on 2026-09-03 from the live API and CI (see KB entries cited
inline; full corpus: `knowledge/caveman/CORPUS-INDEX.md`).

## Level map

| Level | Loaded | Content |
|-------|--------|---------|
| **L0 — Foundations** | Always | Topology, iron rules, when NOT to open a PR |
| **L1 — Identity & Access** | Session start | Token resolver, author identity, remotes |
| **L2 — Workspace & Readiness** | Before any work | Fork sync, branch base rules, CI mechanics incl. the approval gate |
| **L3 — Authoring** | When creating a change | Commit rules, PR rules, maintainer review patterns |
| **L4 — Deep Context** | On demand | Baselines, extension facts, proxy/MCP knowledge (refs in KB) |
| **L5 — Learning Loop** | Session end | Digest + KB extraction (agentception) |

---

## L0 — Foundations (always)

### Topology

| Thing | Reality |
|---|---|
| Upstream `JuliusBrussee/caveman` | The target. **No branch protection** — merged PRs need no CI green (KB #6449). Fork PRs land by maintainer merge. |
| Fork `Alot1z/caveman-remap` | The writable sandbox. Local checkout: `E:/E-github-repos/my-claude-code-repos/caveman-remap` (has `.claude/skills`, `_bmad/`). |
| Drafts surface | `docs/feedback-followup/` on branch `docs/feedback-followup-drafts` → fork-local DRAFT PR #2 (plan-only docs: per-PR plans, BACKLOG.md, PR-SPLIT-ANALYSIS.md). |

### Iron rules (non-negotiable)

1. **Never open a PR that isn't good.** Judge every change against the
   maintainer's own words and the current upstream tree BEFORE building; a
   direction-rejected or already-shipped idea stays a draft (the
   "extra work not correct upstream" class).
2. **No pushes to upstream** — branches and PRs come from the fork; upstream
   main is read-only.
3. **Branch hygiene:** each PR branch touches ONLY its intended files — zero
   carried diffs (the #974 `dist/caveman.skill` pollution lesson).
4. **No AI attribution footers** in commits or PRs; author identity via
   git author env (`Alot1z <alot1z@users.noreply.github.com>`). The repo's
   commit-msg hook strips footers automatically.
5. **Draft-first:** commits/pushes/PRs only after explicit user go-ahead.
6. **Evidence never upgrades silently** (FSP): OBSERVED/VERIFIED claims carry
   an oracle + date; baseline-vs-regression must be distinguished.

### When NOT to open a PR (observed rejections)

- New product surfaces (#933 l4 runtime — "scope-narrowing repo").
- Parallel subsystems that duplicate the Go binary (#934 — MCP surface work
  belongs in the Go `caveman-mcp` binary, not a Node server that shells out).
- CI gates needing per-branch config (#955 — repo-wide by construction or
  nothing; "a PR without a Test status section passes silently either way").
- Anything referencing a merged PR's choreography as CI dead weight
  (`statsPinPresent` class).
- CI e2e that fetches unpinned tools at test time — `test:firefox` is
  deliberately opt-in (bare `npx web-ext`); pushing it into CI reverses the
  maintainer's explicit decision.

### What IS welcome (maintainer-specified shapes)

- **Small schema-tweak PRs against the existing MCP server** — one host, one
  tweak, as #870 did (#934 closure).
- **A PR template checkbox** — only if the maintainer asks (#955 closure:
  "a PR template checkbox is the cheaper fix"; attempted #974, withdrawn by
  the author as noise — do not re-open unprompted).
- Smallest-version fixes with regression tests following separately
  (#932 fix d6c1cd3 → #957 tests; #954 en-US pin).
- Docs in the same commit as the code they describe (#956 v2 requirement).

---

## L1 — Identity & Access (session start)

```bash
export GH_TOKEN=$(cat "${IX_GH_TOKEN_FILE:-C:/Users/jacob/.env-files/tokens/github-new.token}")
gh api user --jq .login   # must be Alot1z (KB #6278)
```

- Token order: `IX_GH_TOKEN_FILE` → `C:/Users/jacob/.env-files/tokens/github-new.token`
  → `$HOME` → `$USERPROFILE`. Keyring login is also durable (`gh auth status`).
- Every `gh` command gets the token export first — no browser popups.
- Author for commits: `GIT_AUTHOR_NAME=Alot1z GIT_AUTHOR_EMAIL=alot1z@users.noreply.github.com`
  per commit; never a footer trailer.

## L2 — Workspace & Readiness (before any work)

### Fork sync and branch base

```bash
cd "E:/E-github-repos/my-claude-code-repos/caveman-remap"
git fetch origin && git fetch upstream   # upstream = JuliusBrussee/caveman
```

- **Fork `main` DIVERGES from upstream main** (observed 2026-09-03: fork main
  `b32e41c` is a sibling, not an ancestor). **Never base a PR branch on fork
  main** — it pollutes the PR diff with fork-only files. Base on
  `upstream/main` directly:
  `git checkout -b <topic> upstream/main`.
- Rebase onto upstream main before opening; verify
  `git diff upstream/main --stat` shows exactly the intended files.
- PR heads are addressed `Alot1z:<branch>` when opening upstream PRs.

### CI mechanics — the fork-PR approval gate (KB #6449, OBSERVED)

- Fork-head `pull_request` runs queue behind the base repo's approval gate:
  `mergeable_state=unstable`, `mergeable=true`, checks pending/`action_required`.
  No fork-side action (rerun, empty-commit push) clears it.
- **At the merge second GitHub TERMINATES the still-queued runs** (18:32:13 /
  18:32:17 / 18:39:17 on 2026-09-03) — they never execute a job; their
  `failure` conclusion is a termination artifact, NOT a code failure.
- Real validation = the squash-commit runs on main (all-green for #954/#957).
- Merged PRs need no CI green (no branch protection).
- The maintainer acts fast once an ask is surfaced (~30 min observed).
- Evidence discipline: post CI evidence only on state change; name the run IDs
  and trees.

## L3 — Authoring

### Commit rules

- Conventional Commits: `feat|fix|test|docs|refactor|ci|chore([scope]): <imperative>`.
- Subject one line ≤ ~72 chars; body = WHY, never restate the diff.
- Author via env (L1); the repo hook strips AI trailers — never add them.

### PR rules

- Title the PR for what it does, not what it promises (#62/#936 lesson:
  "The PR body still says 121; that was stale").
- Test status section: actual `N passed, M failed, K skipped` from a real run,
  or explicit "no testable code changed". One canonical line — the
  181-vs-183 fiction class came from three overlapping regexes summing
  46+0+4 as 92 (KB #6450).
- Reference issues with `#NNN`; never claim a fix closes an issue it only refs.
- Allow edits by maintainers.
- Before opening: re-check the CURRENT tree — the maintainer ships follow-ups
  fast (e.g. the #936 drift guard landed in `87325d8` before any fork draft).

### Maintainer review patterns (JuliusBrussee, observed)

- **Shape first:** small single-purpose units; 650-line multi-behavior diffs
  are rejected (#931). One PR = one behavior.
- **No dead weight:** nothing referencing merged-PR choreography in CI (#955).
- **Security is checked end-to-end:** #956's ACAO:* exploit was verified
  live from a foreign Origin (any open web page can drive local MCP tools and
  read `~/.caveman/ccr.db` — KB #6451). Local HTTP/MCP servers must validate
  Origin + require auth.
- **env-based inputs endorsed:** `PR_BODY` env handling with
  `pull_request` (never `pull_request_target`), no template expansion in run
  blocks, read-only permissions (#955 credit).
- **Zero-egress tests must assert** — "skipped by filename" is not a test
  (#956 critique).
- Reviewers: JuliusBrussee (maintainer) and AmirF194 (in-depth inline review).

## L4 — Deep Context (on demand — all in the KB)

| Topic | KB |
|---|---|
| Fork-PR CI termination mechanics | #6449 |
| Overlapping-regex counting bug | #6450 |
| MCP-over-HTTP Origin/auth security | #6451 |
| Generated artifacts regenerated, never hand-merged | #6452 |
| Content-script CSS url() page-origin (Chrome) + guard | #6441 |
| OpenCode Go `x-api-key` vs Bearer seam | #6458 |
| Codex 2 MiB payload cap + fail-open | #6459 |
| Go shrink tests environmental baseline | #6460 |
| Windows symlink EPERM baseline | #6461 |
| Full corpus + phased mining plan | knowledge/caveman/CORPUS-INDEX.md |

### Baselines (record BEFORE attributing failures)

- `test 290` sandbox-timeout (`packages/agent`): one-off timing flake observed
  (2026-09-03); identical tree green on main.
- Go `shrink` tests: fail environmentally on clean main (sandbox denies TEMP
  writes) — KB #6460.
- Windows: symlink tests EPERM without elevation/Developer Mode — KB #6461;
  bash-hook command parsing fails in some Windows env checks (#966).

### Extension facts

- `verify-extension-stage.mjs` scans manifest-registered content-script CSS and
  fails the pack on relative `url()` there (page-origin resolution) — KB #6441.
- Version-drift guard shipped: `package.test.mjs` asserts single version
  source (package.json == Chrome manifest; Firefox template carries no
  hardcoded version; ≥140 floor).
- Firefox `strict_min_version` = 140 (the 142 floor is Android-only);
  `test:firefox` is opt-in; addons-linter and both zip builds are the gate.

## L5 — Learning Loop (session end)

1. Append a digest item to `session-digests/2026-09-03-caveman-upstream-mission.md`
   (or the current session file) recording decisions, evidence, ledger.
2. Run `agentception-extract.mjs --json` over the session digest, review the
   JSON, insert only non-duplicate OBSERVED/DERIVED claims (rule 8 — verify
   with targeted kb.mjs searches), then `verify-gate` + `promote`.
3. Update the fork drafts (BACKLOG statuses, per-PR docs) so the next session
   resumes from disk, not memory.

## Cross-cutting

- This skill is one file, readable by any harness; token/auth handling is
  mechanical (L1) — no client auth flow, no popups.
- `bmad-build`/`bmad-build-auto` live in the fork checkout's `.claude/skills`
  (uv-gated via `_bmad/scripts/render_skill.py`); use them only when a build
  iteration loop is actually warranted (proportionality, KB #6313).
- Mirroring this skill to other profiles (jacob/Administrator/mccr) requires
  user authorization — Mose's base is the primary copy (v1.0.0).