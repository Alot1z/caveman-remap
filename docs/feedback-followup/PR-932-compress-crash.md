# PR #932 — fix(compress): crash-free, provider-agnostic model reply handling

Status: **CLOSED** (2026-09-02). Fully absorbed upstream.

## Feedback (verbatim key lines)

JuliusBrussee (closure):
> "The crash is real, but the fix landed as the smallest version of it in
> v2.5.0 (commit d6c1cd3): call_claude now takes the first content block whose
> type is text instead of trusting content[0]. caveman-compress only talks to
> the Anthropic SDK or the claude CLI, so the provider-agnostic extractor would
> be shape-handling for responses that never arrive here. Credit to this
> report."

AmirF194 (inline): `client.messages.create` at compress.py:466-470 passes no
`tools=` and no `thinking=`, so per the Anthropic API the reply should always
be a single text block — the tool-heavy-session trigger looks unreachable at
the current call site; precautionary hardening should say so plainly.

AmirF194 (follow-up): "Good, keeping it narrow makes sense here since
call_claude only ever goes through that one SDK or the CLI, never a second
provider."

## Disposition

- Crash fix: **absorbed** in v2.5.0 (d6c1cd3) — smallest version.
- Regression coverage: **shipped** via #957 (merged 2026-09-03).
- Provider-agnostic extractor: **rejected** as over-engineering (single call
  site, single provider family).

## Plan (draft)

1. **None upstream** — the loop is closed (fix + tests both merged).
2. Keep the extractor idea on the shelf ONLY if a second provider or a
   `tools=`/`thinking=` call site is ever added to compress.py; the plan then
   is to introduce the extractor in the same commit as that call site, with
   the trigger documented.

## Trigger

A second provider or a tool-call path added to `caveman-compress`'s call
surface. Until then: no action.

## Lesson (recorded)

Match fix size to the call site: smallest version first, credit the report,
close the loop with the missing tests (as #957 did).