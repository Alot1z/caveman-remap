# PR #955 — ci: gate PR bodies against actual test counts

Status: **CLOSED** (2026-09-03). Shape cannot work; cheaper alternative given —
executed as upstream PR #974, then **withdrawn by the author as noise** (closed
2026-09-03). Convention not adopted; plan stays recorded with its trigger.

## Feedback (verbatim key lines)

JuliusBrussee (closure):
> "The CONFIG map is keyed by branch name and has one entry, its own branch,
> so the gate no-ops on every other PR. Making it real would mean each
> contributor adding their branch name to a map on main, with dead entries
> accumulating, and a PR without a Test status section passes silently either
> way."
>
> "There is also a counting bug ... summarize() runs three overlapping regexes
> over the same output, so '46 passed, 0 failed, 4 skipped' totals as 92
> passed. That looks like why the comment derives 181 while the code hardcodes
> 183."
>
> "statsPinPresent() bakes the merge choreography for #954 into repo CI, which
> is dead weight now that #954 has merged."
>
> "Credit where due: the env PR_BODY handling is the correct pattern.
> pull_request rather than pull_request_target, no template expansion in a run
> block, and read-only permissions."
>
> "The property that matters, the suite passing, is already enforced by the
> existing CI. If PR body accuracy becomes a recurring problem, a PR template
> checkbox is the cheaper fix."

## Disposition

- Gate shape: **rejected** (per-branch CONFIG map no-ops; dead entries; silent
  pass without a Test section).
- Counting logic: **buggy** (three overlapping regexes → 92 from 46/0/4) —
  the hardcoded 183 vs derived 181 mismatch explained.
- `statsPinPresent`: **dead weight** post-#954-merge.
- env PR_BODY handling: **endorsed** as the correct pattern.
- Suggested replacement: **PR template checkbox** — **EXECUTED, then withdrawn**: opened as
  upstream PR #974 (`docs: add PR template with test-status checkbox`,
  `.github/PULL_REQUEST_TEMPLATE.md`, one file, no CI changes); **closed by the author the
  same day** — the maintainer's own stance (CI already enforces the property that matters;
  a template cannot force honesty) means the standing guard is not justified; the
  recurring-problem precondition had only two in-campaign occurrences.

## Plan (execution log)

1. **PR template checkbox** (the maintainer's cheaper fix) — **DONE, then
   withdrawn**: upstream PR #974 added `.github/PULL_REQUEST_TEMPLATE.md` with a
   verification checkbox requiring actual counts (`N passed, M failed, K
   skipped`) or an explicit "no testable code changed" statement. Closed the
   same day as noise (see disposition): a template prompts but cannot force;
   the "cheaper fix" stays cheaper only while asked for.
2. **Do not re-attempt the gate** unless the maintainer asks; if asked later,
   the corrected design must (a) derive counts from a single parse of the test
   output, (b) not require per-branch config, and (c) not reference merged
   PRs' choreography.
3. Record the regex-overlap counting-bug class as a review checklist item — **done**:
   KB #6450 (root-cause, OBSERVED, TRUSTED via verify-gate, 2026-09-03).

## Trigger

~~User wants the convention adopted~~ — fired and resolved 2026-09-03: #974 was
opened, then closed as noise by the author. Re-open only if the maintainer asks
for the checkbox; otherwise the recorded lesson (item 3) is the durable output.

## Lesson (recorded)

Gates must be repo-wide by construction (no per-branch config), parse output
once with non-overlapping patterns, and never embed another PR's merge
choreography. The cheapest correct enforcement often isn't CI — it's a
template + review convention.