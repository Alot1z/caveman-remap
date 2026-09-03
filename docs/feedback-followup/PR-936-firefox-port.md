# PR #936 — feat(extension): Firefox port of the Caveman Mode extension (#810)

Status: **MERGED** (2026-09-03, merge commit `478688d` + maintainer follow-up `87325d8`).

## Feedback (verbatim key lines)

JuliusBrussee (pre-merge, 3 required fixes):
1. "The gecko id is `caveman-mode@outdated-athletically.ru`, a domain this
   project does not control. AMO ids are permanent ... Please use a UUID-style
   id instead."
2. "`extension/firefox/manifest.json` hardcodes `version: 1.2.0`. The build
   script checks that the Chrome manifest matches package.json but not this
   one, so it will silently drift on the next release."
3. "Firefox MV3 does not run `background.service_worker`; only
   `background.scripts` (event page) is honored ... drop the service_worker key
   ... set the minimum to whatever you actually tested on."

JuliusBrussee (post-merge follow-up, `87325d8`):
- `test:firefox` is out of `test:all` — the e2e falls back to a bare
  `npx web-ext` (unpinned download at test time inside the release gate).
  "It stays runnable standalone with `npm run test:firefox`. If you want it in
  CI, add web-ext as a pinned devDependency plus an explicit Firefox install
  step."
- `npm run package` now also runs the firefox target (the AMO zip is produced
  by the gate — the version-drift guard).
- `strict_min_version` is 140.0 (the PR body still said 121 — stale).
- Chrome-side insight: content-script CSS `url()` resolves against the **page
  origin** in Chrome (relative font path never loaded; indicator always
  rendered in ui-monospace), and against the **stylesheet** in Firefox (the
  font would have worked there). Deletion was a fine call.

## Disposition

- Port itself: **merged**; all three pre-merge fixes applied (by the
  maintainer's follow-up commit).
- Remaining feedback = three optional follow-ups, none blocking.

## Plan (draft)

1. **Firefox e2e in CI (optional):** add `web-ext` as a pinned devDependency
   and an explicit Firefox install step, then re-add `test:firefox` to the
   gate. Draft the change on the fork; run the e2e locally first (verified
   5/5 vs Firefox 153 by the maintainer's own note).
2. **Manifest drift guard:** the `package`-runs-firefox-target change covers
   release builds; if a lighter check is wanted, a `test:`-side comparison of
   firefox manifest version vs package.json (mirror of the Chrome check).
3. **Doc accuracy:** PR bodies must reflect the actual `strict_min_version`
   tested (121-vs-140 lesson) — fold into the fork's PR template draft.

## Trigger

The user wants Firefox e2e enforced in CI, or the next extension release
touches the manifests.

## Lesson (recorded)

Pinned devDependencies for e2e tooling; manifests must be derived or checked
against the single version source; PR bodies must match what was actually
tested.