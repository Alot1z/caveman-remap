# PR #954 — fix(stats): pin number formatting to en-US

Status: **MERGED** (2026-09-03, squash `7b889f0`). Feedback resolved in-head.

## Feedback (verbatim key lines)

AmirF194 (inline on `src/hooks/checksums.sha256:10`):
> "leftover merge conflict debris. Lines 6-10 read: `HEAD` / hash line /
> blank / duplicated hash line / `edd4205` ... the stray lines are silently
> skipped [by loadRemoteHookChecksums' regex] and the real hash is correct, so
> this does not break the integrity check today. It would be worth squashing
> back down to one line per file before merge."

Resolution (my reply, 15:25Z, on `9707930`): manifest rewritten to exactly
one canonical line per file; every hash re-verified against the working tree.
AmirF194 (15:29Z): "Confirmed, 9707930 leaves one canonical line per file and
the hashes still check out. Thanks for the fast turnaround."

## Disposition

- Debris: **fixed and confirmed** in the merged head.
- Number-formatting pin: **merged**.

## Plan (draft)

1. **None required.** The feedback loop closed with the confirm.
2. Repo-hygiene rule to carry forward: any commit that refreshes
   `src/hooks/checksums.sha256` must regenerate the file (one canonical line
   per file, no conflict markers) rather than hand-merge it.

## Trigger

The next manifest refresh touches `checksums.sha256`.

## Lesson (recorded)

Oracle-backed containment replies work: state exactly what was verified, then
the reviewer confirms (AmirF194's "Confirmed" pattern). Manifest files are
generated artifacts — regenerate, never hand-edit.