# Cursor: from "type /caveman every session" to Tier 1

Status: plan. Written 2026-08-21 against `main` @ 2f49f0e.

Cursor is the only major agent where caveman ships a *worse* experience than
its own distribution table implies. The table in `CLAUDE.md` says Cursor
auto-activates via an always-on rule; in practice a Cursor user gets a
per-repo `.mdc` file only if they run `--with-init`, and the global skills
install may not land at all.

Meanwhile Cursor grew — in 2026 it shipped a hook system, a native skills
loader, a plugin format, and a CLI statusline that is byte-compatible with
Claude Code's. Every mechanism caveman already built for Claude Code now has
a Cursor counterpart. This plan wires them up.

---

## Ground truth (verified on this machine, 2026-08-21)

| Claim | Reality |
|---|---|
| `npx skills add -a cursor -g` installs the skill | `~/.cursor/skills/` is **empty**. `~/.cursor/skills-cursor/` (Cursor's 24 built-ins) is full. The advertised install is unproven at best. |
| caveman does not reach Cursor as a plugin | It already does — `~/.cursor/plugins/cache/caveman/…/655b7d9c` holds a full clone of this repo, pulled from `.claude-plugin/marketplace.json`. |
| …so hooks and commands work there | No. Cursor read it as an **Agent Plugin**, a format that loads *skills + MCP only*. `plugin.json`'s `hooks` block (SessionStart, UserPromptSubmit) is ignored. |
| Cursor transcripts are Claude-Code-compatible JSONL | Only for headless `cursor-agent`. The IDE transcript at `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl` is `{role, message:{content:[…]}}` + `{type:"turn_ended"}` — **no `usage`, no model, no per-line timestamp**. |
| Cursor can be routed through the caveman gateway | No. See "Non-goal" below. |

## What Cursor gives us now

| Surface | Path / mechanism | Claude Code equivalent |
|---|---|---|
| Hooks | `~/.cursor/hooks.json`, `<repo>/.cursor/hooks.json`, or a plugin's `hooks/hooks.json` | `settings.json` hooks |
| Session context injection | `sessionStart` → stdout `{"additional_context": "…", "env": {…}}` | SessionStart stdout |
| Prompt interception | `beforeSubmitPrompt` → gets `prompt`, returns `{continue, user_message}` — **cannot inject model context** | UserPromptSubmit (which can) |
| Mid-turn injection | `postToolUse` → `additional_context` | — |
| Turn end / follow-up | `stop` → `followup_message` (capped by `loop_limit`, default 5), `sessionEnd`, `afterAgentResponse` | Stop hook |
| Skills | `~/.cursor/skills/`, `.cursor/skills/`, **and `~/.claude/skills/` for compat**; `disable-model-invocation: true` makes one slash-only | skills/ |
| Plugins | `.cursor-plugin/plugin.json` → rules, skills, agents, commands, hooks, mcp | `.claude-plugin/plugin.json` |
| Statusline | `~/.cursor/cli-config.json` `statusLine` — same JSON payload as Claude Code's | `settings.json` statusLine |
| Transcripts | `CURSOR_TRANSCRIPT_PATH` env + `transcript_path` in every hook payload | `~/.claude/projects/**.jsonl` |

Every hook payload also carries `conversation_id`, `model`, `model_id`,
`cursor_version`, `workspace_roots`, `user_email`. `preCompact` carries
`context_usage_percent`, `context_tokens`, `context_window_size`.

---

## P0 — Stop shipping a claim we cannot prove (~1 hour)

The cheapest win is fixing what is already advertised.

1. Run `node bin/install.js --only cursor` on a clean box and check whether
   anything lands in `~/.cursor/skills/`. If the upstream `cursor` profile
   writes elsewhere (or fails silently), either fix the invocation or drop the
   `globalSkillsDir: ['.cursor','skills']` hint in `bin/install.js:240` — a
   dead hint is worse than none.
2. `CLAUDE.md`'s distribution table says Cursor "Auto-activates: Yes — always-on
   rule". That is only true after `--with-init`. Correct the row, or make P1
   true and then the row is honest.

Verify: `ls ~/.cursor/skills` non-empty after install, or table amended.

## P1 — Cursor plugin format (~half day, the whole Tier-1 unlock)

Add `.cursor-plugin/plugin.json` at the repo root, pointing at the directories
that already exist. No new content, no fork of any skill.

```json
{
  "name": "caveman",
  "description": "Talk like caveman. Cut ~75% tokens. Keep all technical accuracy.",
  "version": "…",
  "skills": "./skills",
  "agents": "./agents",
  "commands": "./commands",
  "rules": "./src/rules",
  "hooks": "./src/hooks/cursor-hooks.json"
}
```

Notes that decide the diff:

- **Explicit paths replace discovery.** Setting `"skills": "./skills"` means
  Cursor stops scanning conventional folders for that component. That is what
  we want — `agents/docs/` must not become subagents, exactly as documented in
  `CLAUDE.md` for the Claude Code loader.
- **Same wholesale-discovery trap.** Plugin root = repo root means every
  `skills/*/SKILL.md` ships to Cursor users too. `tests/verify_repo.py` should
  grow a Cursor arm so the two loaders can't drift.
- **`rules/` accepts `.md`/`.mdc`.** `src/rules/caveman-activate.md` becomes an
  always-on rule with no new file, provided it gets `alwaysApply: true`
  frontmatter. Check that this does not break `src/tools/caveman-init.js`,
  which consumes the same file.
- Marketplace: the existing `.claude-plugin/marketplace.json` already works for
  discovery. Add `.cursor-plugin/marketplace.json` only if the Cursor-format
  manifest needs to be selected over the Agent-Plugin one — test which wins
  when both are present, because today the Agent-Plugin read is what silently
  drops hooks.

Verify: install from the marketplace in Cursor, then confirm `/caveman` appears
as a command, the three cavecrew subagents exist, and the rule is listed under
Customize → Rules.

## P2 — Hook adapter (~1 day)

One new file, `src/hooks/cursor-adapter.js`, plus `src/hooks/cursor-hooks.json`.
Do **not** fork `caveman-activate.js` / `caveman-mode-tracker.js` — the adapter
translates Cursor's payload to the existing hooks' contract and re-wraps their
output.

| Cursor event | Reuses | Adapter work |
|---|---|---|
| `sessionStart` | `caveman-activate.js` | capture its stdout, emit `{"additional_context": <stdout>}`. Drop the statusline-nudge branch (Cursor's is CLI-only, see P3). |
| `beforeSubmitPrompt` | `caveman-parse.js` + `safeWriteFlag` | parse `/caveman <mode>` and the natural-language triggers, write the flag, return `{"continue": true}`. |
| `postToolUse` | mode tracker's reinforcement text | the only injection point mid-conversation. **Throttle it** — one reinforcement per N tool calls, not per call, or caveman becomes a token cost instead of a saving. Pick N from a measured run, not a guess. |
| `sessionEnd` | `caveman-stats.js` | roll up the session; `transcript_path` is in the payload. |

Blockers to clear first:

- `caveman-config.js` resolves the flag path from `CLAUDE_CONFIG_DIR` only. It
  needs a Cursor arm (`CURSOR_CONFIG_DIR` → `~/.cursor/.caveman-active`).
  Keep the write on `safeWriteFlag()` — the symlink rule in `CLAUDE.md` is not
  negotiable for a second predictable path.
- Cursor hooks **fail open** unless `failClosed: true`. That matches caveman's
  "never block the session" rule, so leave the default alone.
- `beforeSubmitPrompt` cannot inject context. The full ruleset arrives once at
  `sessionStart`; the always-on rule from P1 is what holds the line between
  turns. `postToolUse` is reinforcement, not the primary channel.
- Cloud agents ignore user-level hooks and prompt-type hooks. Project-level
  `.cursor/hooks.json` (via `--with-init`) is the only path that reaches them.

Verify: a Cursor session that answers in caveman with no `/caveman` typed;
`/caveman ultra` flips the flag file; `stop caveman` deletes it.

## P3 — Statusline for `cursor-agent` (~1 hour, opt-in)

`~/.cursor/cli-config.json` takes the same `statusLine` shape and the same JSON
payload as Claude Code, so `caveman-statusline.sh` works once it learns the
Cursor flag path from P2.

Ship it **off by default**. A custom `statusLine` in Cursor CLI *replaces* both
native footer rows — model, context, auto-review, branch, PR indicators all
disappear, and the payload omits approval mode so the script cannot rebuild
them. Offer it, warn about the trade, don't set it silently.

## P4 — `source_cursor.go` for learn (~1 day, do last, scope honestly)

`proxy/internal/store/` already has the abstraction: implement `sessionSource`
(`discover`, `scanSession`) over
`~/.cursor/projects/*/agent-transcripts/*/*.jsonl` and the `subagents/`
subdirectory. Root override: `CURSOR_DATA_PATH` / `CURSOR_STORE_ROOT`.

What works and what does not, from the real file on disk:

- Works: tool-call names and inputs → `toolPortfolio`, `readActivity`,
  `procedures`, `learn_loops`, subagent spend (the `subagents/` tree is a free
  `TaskSpawns` signal), skill-use detection (`Read` of a `SKILL.md` path).
- Does not work: **billing**. There is no `usage` block. `BillingUsagePresent`
  and `CacheUsagePresent` must stay `false` — the comment in
  `session_source.go:53` already says a source that cannot state a bucket must
  not guess a zero. No savings number for Cursor from IDE transcripts.
- Partial: timestamps are embedded in the user text as
  `<timestamp>Tuesday, Aug 18, 2026, 11:44 AM (UTC+2)</timestamp>`, parseable
  but locale-shaped; tool *outputs* are absent and some fields are `[REDACTED]`.
- The token numbers do exist for headless runs — `cursor-agent -p
  --output-format stream-json` emits per-turn input/output/cache totals and a
  `request_id`. If `caveman learn` wants real Cursor savings math, that is the
  path, and it means wrapping the CLI, not reading the IDE's files.

Decide before writing code: is behavior-only learn (no cost attribution) worth
shipping for Cursor, or does Cursor get prose compression and stats stay silent?
Shipping a Cursor row in `caveman learn` that shows behavior but a blank savings
column needs a deliberate answer, not a `0`.

---

## Non-goal: routing Cursor through the caveman gateway

Not possible for the Cursor app, and the plan should say so out loud rather
than leave it as future work:

- Composer / Composer 2.5 reject custom keys outright — *"This model does not
  support custom API keys."* They are Cursor-hosted and structurally cannot
  honor a base-URL override.
- Enabling "Override OpenAI Base URL" routes Anthropic traffic through an
  OpenAI-shaped endpoint and breaks Claude models with 422s.
- Tab completions never honor BYOK.

So there is no `agents/profiles/cursor.json` in this plan. Cursor gets the
prose-compression half of caveman (skills, rules, hooks) and, optionally, the
measurement half — never the engine half. Keep that distinction in the README:
the "What you get" table must not imply Cursor users see gateway savings.

---

## Order and cost

| Phase | Effort | Unlocks |
|---|---|---|
| P0 | 1h | the current claim becomes true |
| P1 | ~half day | commands, subagents, always-on rule, real plugin install |
| P2 | ~1 day | auto-activation, mode switching, per-turn reinforcement |
| P3 | 1h | statusline badge in `cursor-agent` (opt-in) |
| P4 | ~1 day | `caveman learn` sees Cursor sessions (behavior only) |

P0+P1+P2 is the feature. P3 is polish. P4 is a separate product decision.

## Installer work (spans P1–P3)

`bin/install.js`: change the Cursor row's `mech` from `npx skills add (cursor)`
to a native install and add `installCursor(ctx)` modeled on `installOpencode`
(`bin/install.js:730`) — same `owned-install.js` journal so uninstall removes
only bytes we still own. Targets: `~/.cursor/hooks.json` merge (JSONC-tolerant,
same discipline as `bin/lib/settings.js`), `~/.cursor/skills/`, and the
`cli-config.json` statusLine behind a prompt. Extend `uninstall()` to match.

## Sources

- [Cursor Hooks reference](https://cursor.com/docs/hooks)
- [Cursor Plugins reference](https://cursor.com/docs/reference/plugins)
- [Cursor Agent Skills](https://cursor.com/docs/skills)
- [Cursor CLI configuration](https://cursor.com/docs/cli/reference/configuration)
- [Cursor CLI changelog](https://cursor.com/docs/cli/changelog)
- [Composer rejects custom API keys](https://forum.cursor.com/t/composer-2-5-error-this-model-does-not-support-custom-api-keys/163374)
- [Base-URL override breaks Claude models](https://www.coderouter.io/blog/cursor-override-openai-base-url-claude-fix)
