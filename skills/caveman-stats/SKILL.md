---
name: caveman-stats
description: >
  Show real token usage and estimated savings for the current session, read
  from the session log. Trigger: /caveman-stats.
---

This skill is delivered by `hooks/caveman-stats.js` (read by `hooks/caveman-mode-tracker.js` on `/caveman-stats`). The model does not need to do anything when this skill fires — the hook returns `decision: "block"` with the formatted stats as the reason. The user sees the numbers immediately.

The hook also forwards lifetime flags straight to the script: `/caveman-stats --all`
(lifetime totals), `/caveman-stats --since 7d` (recent window), and
`/caveman-stats --reset` (archive `.caveman-history.jsonl` to a dated `.bak` and
clear the summary sidecar + statusline suffix so lifetime numbers start clean).
Lifetime rows are aggregated incrementally against a `.summary.json` sidecar, so
a stats call never re-parses the whole append-only history under the hook's
2.5s child watchdog.

Output also includes `Est. rule overhead` and `Est. net` lines wherever a savings estimate exists with a known turn count. Rule overhead is the estimated per-turn INPUT-token cost of the injected caveman rules (default 1,250 tokens/turn, override with `CAVEMAN_RULE_OVERHEAD_TOKENS`) times the turn count. Net is savings minus that overhead — when negative, the output says so plainly and suggests turning caveman off for that workload, rather than hiding the net-negative regime behind a gross-savings number (see `docs/HONEST-NUMBERS.md`).
