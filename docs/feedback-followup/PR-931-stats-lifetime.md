# PR #931 — stats: multi-block accounting, bound lifetime aggregation, number formatting

Status: **CLOSED** (2026-09-02). Partially absorbed upstream.

## Feedback (verbatim key lines)

JuliusBrussee (closure):
> "Fix 1 (multi-block accounting, #793) landed via #794, which is the reporter's
> own minimal patch. The rest of this PR bundles two more behavior changes, a
> new CI workflow, a verify_repo change, and skill doc edits into one 650-line
> diff, which is more than can be reviewed as a unit. If the bounded lifetime
> aggregation is something you have actually seen time out in practice, please
> open a separate issue with the history file size and timing so it can be
> sized on its own."

AmirF194 (inline): the dedupe at caveman-stats.js:192 is the same fix as #794
(key scheme, parseSession loop, test scenarios) — cross-linking needed so
neither PR orphans the other. (AmirF194 agreed with the land-#931-then-close-#794
containment analysis; upstream instead chose the reporter's minimal #794.)

## Disposition

- Multi-block accounting: **absorbed** via #794 (reporter's minimal patch).
- Number formatting: **shipped separately** as #954 (merged 2026-09-03).
- Bounded lifetime aggregation (`--all` / `--since` / `--reset`, bounded
  recent-window read): **not merged** — maintainer asked for measured evidence.

## Plan (draft)

1. **Measure first** — reproduce the timeout against a real (or synthetic-large)
   history file; record history file size, entry count, and wall-clock timing.
2. **File an issue** in JuliusBrussee/caveman with that data (the maintainer's
   stated precondition), naming the bounded-window approach.
3. **Split the change** into a single-purpose PR: lifetime aggregation only —
   no CI workflow, no verify_repo change, no skill-doc edits in the same diff.
4. Keep the dedupe hunk OUT (it is #794's, already landed).

## Trigger

A measured timeout on a real history file (size + timing documented in an
issue), or the maintainer asking for the feature.

## Lesson (recorded)

650-line multi-purpose diffs cannot be reviewed as a unit; a PR should be one
behavior change. Evidence issue first; implementation second.