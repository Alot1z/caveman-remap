---
name: caveman-contribution-lifecycle
description: Use when preparing a caveman change for upstream contribution to JuliusBrussee/caveman through the Alot1z/caveman-remap fork — runs the gate from discovery to a verified, PR-ready branch: ground-truth against live main first, rejection-class screen, measured evidence with full runtime coverage, then the fork drafts surface. Requires gh authenticated (read-only GETs are sufficient until the final push).
---

# Caveman Contribution Lifecycle

Contribute to upstream caveman the way the 2026-09-03 campaign did: reproduce
against the exact live head, classify, ground-truth before drafting, prove
red/green with full runtime coverage, size the change to one small
single-purpose PR — then offer it through the fork. Evidence before claims,
always. Companion to `/caveman-contribution` (the leveled workflow); this is
the gate.

## When to use

- A fork draft needs to become an upstream PR, or a maintainer ask needs a fix.
- Before pushing/opening anything: run this gate and record the evidence.

## The 16-step gate

1. **DISCOVER** — identify the defect/ask and the exact symptom or ask text.
2. **RECOVER CONTEXT** — read the campaign cluster (`knowledge/caveman/CLUSTER.md`)
   and the fork drafts (`docs/feedback-followup/` on the drafts branch).
3. **CHECK LIVE UPSTREAM FIRST** — confirm the gap still exists on current main
   before drafting anything. Code-level ground truth outranks memory: the
   OpenCode schema draft was withdrawn OBSERVED-AS-REFUTED when main already
   shipped the compat mount (#969 + built-in `/compat/opencode-go/`). A draft
   built on an unverified premise is the "already on main" closure class.
4. **SEARCH DUPLICATES** — no existing fix or duplicate PR:
   ```bash
   gh api "search/issues?q=<term>+repo:JuliusBrussee/caveman+type:pr"
   gh api repos/JuliusBrussee/caveman/pulls?state=all --jq '.[] | .number, .title'
   ```
5. **REPRODUCE** — against the live head, not memory. Write/confirm the failing
   test first, on the exact main SHA (`9911e5f` as of 2026-09-03 — re-check).
6. **CLASSIFY** — regression / pre-existing bug / duplicate / already-on-main /
   false positive / informational. Record which.
7. **SCREEN AGAINST THE REJECTION-CLASS TAXONOMY** (KB #6509, 8 classes):
   a plan that maps to a known rejected shape is dead on arrival. The standing
   bar (KB #6507): measured evidence + full runtime coverage, or close — that
   is what the maintainer closes on (and what misleading measurements get
   closed for).
8. **ADVERSARIAL TEST** — attack the inverse: what else can the change match?
   Can the opposite implementation also pass? (The #955 counting-bug class:
   three overlapping regexes summing 46+0+4 as 92 passed — check the math of
   the check itself.)
9. **VERIFY COMMIT** — minimal diff at the right layer. For per-host schema
   tweaks the right layer is the Go binary's compat layer or the proxy
   `/compat/<name>/` mount — never a parallel server (KB #6511: synced mirrors
   are obsolete; one unified provider/compiler architecture).
10. **PUBLISH FORK DRAFT** — branch on `Alot1z/caveman-remap`, offer the PR
    body + test evidence as a draft/plan, never as a competing fix.
11. **VERIFY REMOTE** — confirm remote state (ancestry, not existence) and the
    fork's own CI before the ask.
12. **UPDATE DRAFTS** — BACKLOG statuses, per-PR docs, rejection-screen pass at
    draft time against the then-current tree.
13. **CHECK PR COMMUNICATION** — state readiness explicitly: "reproduced
    against head X; no duplicate found; suite N/N; ready for review."
14. **OPEN PR** — only with explicit authorization. One small single-purpose
    PR per change; docs in the same commit.
15. **VERIFY COMMUNICATION** — confirm the PR/comment landed as written; if a
    fork-head run sits queued at the merge second, expect termination — see
    below.
16. **FINAL REPORT** — evidence trail: head, red/green, mutation, measurements,
    duplicates, readiness, closure.

## CI facts that govern the gate (KB #6449, OBSERVED 2026-09-03)

- Approval-queued fork-head runs are **TERMINATED by GitHub at the merge
  second** (18:32:13/18:32:17/18:39:17) — they never execute a job, so their
  "failure" conclusion is a termination artifact, never a code failure.
- Real validation runs on the **squash commits on main** and was all-green
  (#954/#957, 18:32–35Z).
- The maintainer can act within ~30 minutes of a surfaced ask.
- Merged PRs need no CI green — main has no branch protection.
- Closed PRs carry reasons; read the closure before re-proposing.

## Red/green — mandatory (never skip)

```bash
# green: fix applied — run the FULL affected suite (not just the new block)
node tests/test_caveman_stats.js      # stats, e.g. 56/56
python -m pytest tests/               # compress, e.g. 47 passed, 4 skipped

# red: revert ONLY the source fix, tests must fail
git checkout origin/main -- <source-file>
<re-run the suite>                    # the fix's tests must fail
git checkout HEAD -- <source-file>    # restore
```

If the red run passes, the test does not exercise the defect — fix the test.

## Rebase onto current main

```bash
git worktree add -b prep/<change> <worktree-dir> fork/<draft-branch>
cd <worktree-dir> && git rebase origin/main
# resolve conflicts; for test-file overlaps keep BOTH sides' tests
git add -A && GIT_EDITOR=true git rebase --continue
git log --oneline origin/main..HEAD   # must contain ONLY the fix commits
```

## Verdict taxonomy

`CONFIRMED-VERBATIM` · `CONFIRMED` · `REFINED` · `NOT-FOUND-IN-SOURCE` ·
`OBSERVED-AS-REFUTED` · `OPEN`. Record each claim with the command that
produced the evidence (FACT = code read; INFERENCE = reasoned; UNKNOWN =
needs a live provider call/key — say so, never fabricate a runtime result).

## Caveman-specific knowledge (verified 2026-09-03)

- **Two binaries, two layers:** `mcp/` is stdio-only (v1); HTTP transport and
  `caveman mcp` are v2. Per-host compat mounts live in the **proxy**
  (`/compat/<name>/`, e.g. `/compat/opencode-go/v1/messages`) — that is where
  per-host schema tweaks land, not in the MCP binary (KB #6552).
- **Author identity:** git AUTHOR env (`Alot1z <alot1z@users.noreply.github.com>`),
  never a Co-Authored-By footer — the repo guard strips trailers.
- **Provider facts:** opencode-go rejects Bearer on the anthropic-messages
  path and needs an x-api-key compat mount (already shipped, #969); Codex has
  a 2 MiB pipe cap that fails open (KB #6459); Pi uses `x-api-key` on
  `/v1/messages` (fixed #969).

## Stop conditions

Stop and report (do not push/PR) when: the gap no longer reproduces on live
main (already-on-main closure class); the fix fails red/green; a duplicate
exists; the plan maps to a rejection class; or no authorization to push/open
exists. Never claim "ready" without the red/green evidence in this session.