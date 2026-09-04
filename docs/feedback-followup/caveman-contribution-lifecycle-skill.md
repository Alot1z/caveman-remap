---
name: caveman-contribution-lifecycle
description: Use when preparing a caveman change for upstream contribution to JuliusBrussee/caveman through the Alot1z/caveman-remap fork — runs the gate from discovery to a verified, PR-ready branch: ground-truth against live main first, rejection-class screen, measured evidence with full runtime coverage, then the fork drafts surface. Requires gh authenticated (read-only GETs are sufficient until the final push).
version: 1.1.0
---

# Caveman Contribution Lifecycle

Contribute to upstream caveman the way the 2026-09-03 campaign did: reproduce
against the exact live head, classify, ground-truth before drafting, prove
red/green with full runtime coverage, size the change to one small
single-purpose PR — then offer it through the fork. Evidence before claims,
always. Companion to `/caveman-contribution` (the leveled workflow); this is
the gate. This file holds the gate PROCEDURE; every verified fact it gates
on (CI mechanics, standing bar, taxonomy, architecture, provider map, gate
model) lives in `FACTS.md` beside this skill, with its KB citations.

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
7. **SCREEN AGAINST THE REJECTION-CLASS TAXONOMY** (FACTS.md §4, KB #6509,
   8 classes): a plan that maps to a known rejected shape is dead on
   arrival. The standing bar (FACTS.md §2, KB #6507): measured evidence +
   full runtime coverage, or close — that is what the maintainer closes on
   (and what misleading measurements get closed for).
8. **ADVERSARIAL TEST** — attack the inverse: what else can the change match?
   Can the opposite implementation also pass? (The #955 counting-bug class:
   three overlapping regexes summing 46+0+4 as 92 passed — check the math of
   the check itself.)
9. **VERIFY COMMIT** — minimal diff at the right layer. For per-host schema
   tweaks the right layer is the Go binary's compat layer or the proxy
   `/compat/<name>/` mount — never a parallel server (FACTS.md §5, KB #6511:
   synced mirrors are obsolete; one unified provider/compiler architecture).
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

## CI facts that govern the gate (facts: FACTS.md §1, KB #6449)

The verified mechanics (approval-queued fork-head runs TERMINATED by GitHub
at the merge second — never executed, so their "failure" is a termination
artifact; real validation on the squash commits on main, all-green
#954/#957; no branch protection, so merged PRs need no CI green; ~30-minute
maintainer response; closed PRs carry reasons) are in FACTS.md §1.
Operational consequence for step 15: if a fork-head run sits queued at the
merge second, expect termination — report it as such, never as a code
failure.

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

## Caveman-specific facts (facts: FACTS.md §6, KB #6552/#6458/#6459)

The verified per-host provider facts (two binaries/two layers; compat
mounts in the proxy `/compat/<name>/`; opencode-go Bearer rejection →
x-api-key compat mount, shipped #969; Codex 2 MiB fail-open cap; Pi
x-api-key on `/v1/messages`) are in FACTS.md §6. The procedural
consequence for step 9: per-host schema tweaks target the proxy compat
layer, never a parallel server.

- **Author identity:** git AUTHOR env (`Alot1z <alot1z@users.noreply.github.com>`),
  never a Co-Authored-By footer — the repo guard strips trailers.

## Version history

- **1.1.0 (2026-09-04):** verified facts consolidated into `FACTS.md` beside
  this skill (CI mechanics §1, standing bar/taxonomy §2, rejected shapes §4,
  unified architecture §5, per-host provider map §6, 16-step gate model §7);
  this file keeps the gate procedure + pointers only.

## Stop conditions

Stop and report (do not push/PR) when: the gap no longer reproduces on live
main (already-on-main closure class); the fix fails red/green; a duplicate
exists; the plan maps to a rejection class; or no authorization to push/open
exists. Never claim "ready" without the red/green evidence in this session.