# caveman L4 — the Dynamic Layer (runtime, self-adapting)

The L4 layer is the jump from caveman as a **passive, manually-read skill**
(SKILL.md + rule files) to an **active runtime** that measures, gates, and
learns from real sessions. It is a zero-dependency Node program (`l4/caveman-l4.mjs`)
that consumes the same Claude Code session JSONL `caveman-stats` reads, applies
the #793 dedupe, and records measured before/after token numbers. It then
**refuses** to verify any compression claim that lacks a measured pair — evidence
is never invented.

## What exists

| Function | Command | Status |
|---|---|---|
| L4-1 `auto-measure` | `node l4/caveman-l4.mjs auto-measure --session-file <path> [--agent <name>] [--mode <mode>] [--project <root>] [--min-fresh-ms <ms>]` | **implemented** |
| L4-2 `verify-gate` | `node l4/caveman-l4.mjs verify-gate --finding <file.json | inline-json>` | **implemented** |
| L4-3 `promote` | — | planned (candidate rules → `skills/caveman/rules/<language>/`) |
| L4-4 `merge` | — | planned (per-agent × per-language profiles) |
| L4-5 `self-improve` | — | planned (failures → rule candidates) |
| L4-6 `index` | — | planned (active profile registry) |

## L4-1 auto-measure

Staleness-triggered, watermark-guarded measurement. Reads Claude Code session
JSONL (the same shape `caveman-stats` reads — with the **#793 dedupe**: one
count per `message.id`, never once per content-block line), appends a
measurement row to `l4/profiles/<agent>.jsonl`, and writes a watermark so a
fresh session is never re-measured.

```
node l4/caveman-l4.mjs auto-measure \
  --session-file ~/.claude/projects/<slug>/<session>.jsonl \
  --agent claude --mode full --project my-project
```

Safety (WEP): lock-guard per session · backup profile before append · verify
the appended row reads back · roll back on failure · idempotent via watermark.

## L4-2 verify-gate

A compression claim with **no measured before/after pair (or measured
estimate) is REFUSED** — evidence is never invented. Verdict:

```json
{ "ok": true, "verdict": "VERIFIED", "checks": { "evidence": "PASS", "mode": "PASS", "savings": "PASS" }, ... }
```

```
node l4/caveman-l4.mjs verify-gate --finding '{"claim":{"mode":"full","savingsPct":65},"measured":{"baselineOutputTokens":1000,"outputTokens":350}}'
```

## Data layout

```
l4/
  caveman-l4.mjs        # the runtime (zero-dep, Node >= 18)
  README.md
  state/                # watermark + lock files (gitignored)
  profiles/<agent>.jsonl  # measurement rows (gitignored)
```

## Roadmap (from the L4/L5 design)

- L4-3 `promote` — verified rule variants become **candidate** rules in
  `skills/caveman/rules/<language>/`, evidence-tagged, never silently merged.
- L4-4 `merge` — per-tokenizer × per-agent profile composition.
- L4-5 `self-improve` — distill failures (e.g. the #812 language-drift class)
  into rule candidates; candidate-only, never silent self-modification.
- L4-6 `index` — active registry + staleness reports.
- L5 `dispatch` — a verified finding dispatches its continuation (benchmark
  matrix, adversarial rule review, upstream PR packs) through a local
  orchestrator with an evidence requirement of `verified-compression`,
  dry-run by default.
