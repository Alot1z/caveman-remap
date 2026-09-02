# Caveman Mode — Firefox (#810)

Firefox port of the existing Chrome MV3 extension. It runs the **same** runtime files
(`../src/directive.js`, `../src/caveman.js`, `../src/indicator.css`, `../popup.html`) so
behaviour is identical to Chrome; only the manifest is Firefox-tuned.

Differences from the Chrome manifest:

- `browser_specific_settings.gecko.id` (+ `strict_min_version` 121, first stable MV3
  service-worker support). Firefox requires a stable add-on ID for AMO; the value lives
  here and must not change once published.
- Icons omit the non-standard 32px key.
- Background stays a single MV3 `service_worker` declaration (no dual
  `service_worker` + `scripts` block — WebExtensions reject both keys together).

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
root-relative manifest (`manifest_version:3` + `browser_specific_settings.gecko`), verified against
the package allowlist, so it uploads as `manifest_version:3` to addons.mozilla.org. No store-asset
or popup changes are the responsibility of this target.

## Why this exists

https://github.com/JuliusBrussee/caveman/issues/810 — Firefox parity with the Chrome
extension so Firefox users also get caveman mode on ChatGPT, Claude and Gemini.

---

Co-Authored-By: Alot1z <Alot1z@users.noreply.github.com>