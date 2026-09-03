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

## Plan (execution log)

1. **Firefox e2e in CI (optional):** **NOT DONE — deliberately.** The maintainer
   made `test:firefox` opt-in precisely because it fetches web-ext via npx at
   test time; pinning web-ext + a Firefox install step + re-adding it to the
   gate would reverse his explicit decision. Stays a fork-side option if the
   user ever wants it.
2. **Manifest drift guard:** **DONE upstream, stronger than drafted** —
   `extension/test/package.test.mjs` now asserts (a) `package.json == Chrome
   manifest` version, (b) the Firefox template carries **no** hardcoded version
   (builder injects the shared one), and (c) `strict_min_version >= 140` for
   the AMO data-collection key. Shipped by the maintainer in `87325d8`.
3. **Doc accuracy (121-vs-140 lesson):** **DONE** — folded into the PR template
   (upstream PR #974): the verification checkbox requires counts/versions from
   what was actually run, not the PR body's memory.

## Trigger

~~User wants Firefox e2e enforced in CI, or the next extension release touches
the manifests~~ — the drift guard and doc-accuracy halves fired via `87325d8`
and #974; the CI-e2e half stays dormant unless the user opts in.

## Lesson (recorded)

Pinned devDependencies for e2e tooling; manifests must be derived or checked
against the single version source; PR bodies must match what was actually
tested.