# Caveman Mode — Firefox (#810)

Firefox port of the existing Chrome MV3 extension. It runs the **same** runtime files
(`../src/directive.js`, `../src/caveman.js`, `../src/indicator.css`, `../popup.html`) so
behaviour is identical to Chrome; only the manifest is Firefox-tuned.

Differences from the Chrome manifest:

- `browser_specific_settings.gecko.id` — a UUID-style id (`{2bcb73e7-…}`). AMO add-on ids
  are permanent, and a UUID-style id makes no domain claim. Must not change once
  published.
- `strict_min_version` 121.0 — a conservative MV3 floor; the extension is tested on
  current stable Firefox. (Firefox MV3 runs `background.scripts` event pages, not
  service workers, so the version rationale is unrelated to service-worker support.)
- Icons omit the non-standard 32px key.
- Background uses the Firefox MV3 event-page form: `"background": { "scripts": ["src/background.js"] }`.
  Firefox does not run `background.service_worker`; the Chrome manifest keeps the
  service-worker key, the Firefox manifest uses `scripts`.
- **No `version` field.** The `firefox` pack target injects the version from the shared
  source (`package.json` == Chrome manifest, validated by
  `scripts/build-extension-zip.mjs`) at pack time, so the two manifests can never drift
  (see Pack for AMO below).

## Load (temporary, local test)

1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**.
2. Select `manifest.json` from `extension/firefox/`.
3. Because Firefox packs the folder that *contains* the manifest, the shared files resolve
   from `extension/`; if you load `firefox/` standalone, copy the referenced shared assets
   in.A packaged build can alternatively be produced from the `extension/` root by pointing
  the publish step at `firefox/manifest.json`. The ZIP is built from the shared `extension/`
  root (WebExtensions forbid `../` escapes), swapping in this Firefox manifest at `manifest.json`.

## Pack for AMO

The `firefox` target is wired into `extension/scripts/build-extension-zip.mjs`:

```bash
node extension/scripts/build-extension-zip.mjs firefox   # -> dist/caveman-browser-firefox-<ver>.zip
node extension/scripts/build-extension-zip.mjs            # -> dist/caveman-browser-<ver>.zip (Chrome, default)
```

The Firefox zip stages the same shared runtime files flat (`icons/`, `src/`, `popup.*`) with this
root-relative manifest (`manifest_version:3` + `browser_specific_settings.gecko`), injects the
shared version, and verifies the stage against the package allowlist (including the
`background.scripts` reference), so it uploads as `manifest_version:3` to addons.mozilla.org. No
store-asset or popup changes are the responsibility of this target.

## Why this exists

https://github.com/JuliusBrussee/caveman/issues/810 — Firefox parity with the Chrome
extension so Firefox users also get caveman mode on ChatGPT, Claude and Gemini.---
