# caveman-stats

Real session token receipts. No AI estimation.

## What it does

Reads the current Claude Code session log directly and reports actual input/output token usage plus estimated savings versus a non-caveman baseline. Numbers come from the JSONL session log on disk — the model itself does not compute or estimate them. Output is injected by the `caveman-mode-tracker` hook, which intercepts `/caveman-stats` and returns the formatted stats as a blocked-decision reason.

Output also includes an `Est. rule overhead` and `Est. net` line whenever the savings figure above them is unambiguous (a single benchmarked mode with a known turn count — no guessing across mixed or unattributed spans). Overhead estimates the per-turn INPUT-token cost of the rules the skill injects every turn — default 1,250 tokens/turn, override with `CAVEMAN_RULE_OVERHEAD_TOKENS` if you've measured your own setup. Net is savings minus that overhead. On short, terse replies this can go negative — caveman's OUTPUT savings don't clear its INPUT cost — and the line says so directly instead of hiding it behind a gross-savings number. Background: `docs/HONEST-NUMBERS.md`.

Each run also writes a lifetime-savings suffix file used by the statusline badge (`⛏ 12.4k`). That badge stays a gross-savings figure on purpose — it is a glanceable summary, not a full accounting; run `/caveman-stats` for the net picture.

## How to invoke

```
/caveman-stats
```

## Lifetime view

Every `/caveman-stats` run appends a snapshot of the current session's totals
to `$CLAUDE_CONFIG_DIR/.caveman-history.jsonl`. The lifetime view aggregates
those rows incrementally — a small `.summary.json` sidecar keeps the
latest-per-session totals so each run only re-reads the bytes appended since
the last call, never the whole (unbounded) file. Pass a flag to switch from
the session view to lifetime:

```
/caveman-stats --all          # lifetime totals across every session
/caveman-stats --since 7d      # sessions active in the last 7d (also 24h, 2h…)
/caveman-stats --reset         # archive lifetime history and start clean
```

`--since` takes `Nh`/`Nd` durations. `--reset` rotates `.caveman-history.jsonl`
to a dated `.bak` and clears both the summary sidecar and the statusline
suffix — history is archived, never deleted, so nothing is unrecoverable. A
direct `node src/hooks/caveman-stats.js --…` invocation accepts the same flags.

## Example output

```
Session: 47 turns
Input:   12,304 tokens
Output:   3,891 tokens (caveman)
Baseline: 11,247 tokens (estimated without caveman)
Saved:    7,356 tokens (~65%)
Est. rule overhead: 58,750 (input, ~1,250/turn over 47 turns)
Est. net: -51,394 (caveman cost more than it saved for this workload — consider turning it off)
```

(Numbers above are illustrative — see `docs/HONEST-NUMBERS.md` for why short, terse-reply sessions tend to land net-negative even at a healthy output-savings percentage.)

## Integrity

Because `src/hooks/` is integrity-pinned, changing `caveman-stats.js` (or any
hook) requires regenerating `src/hooks/checksums.sha256` — see
`docs/testing-session-modes.md`. `tests/verify_repo.py` enforces it.

## See also

- [`SKILL.md`](./SKILL.md) — hook contract and mechanics
- [Caveman README](../../README.md) — repo overview
