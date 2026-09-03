# PR #933 — feat(l4): measured, evidence-gated compression runtime

Status: **CLOSED** (2026-09-02). Direction rejection.

## Feedback (verbatim key lines)

JuliusBrussee (closure):
> "This adds a new top-level runtime (l4/) plus a new slash command wired into
> the hook, which is a new product surface rather than a fix, and it lands in a
> repo that is actively narrowing scope. The measurement side of the project
> lives in caveman-stats and the proxy's own ledger; a parallel measurement
> runtime with its own state directory is not something we want to maintain.
> Thanks for the work regardless."

## Disposition

- New top-level runtime + slash command: **rejected** — new product surface in
  a scope-narrowing repo.
- The *capability* (measured, evidence-gated compression) is not rejected per
  se; its sanctioned home is **caveman-stats and the proxy's ledger** —
  existing surfaces, no new state directory.

## Plan (draft)

1. **Do not re-file the runtime.** Treat the closure as a durable boundary:
   no new top-level runtime in caveman.
2. If the auto-measure/verify-gate idea is worth keeping at all, scope it as an
   *extension of caveman-stats* (measurement) — a small PR shaped like the
   maintainer's own stats conventions, not a parallel runtime. Draft only;
   nothing to file without a concrete user pain.
3. Record the boundary in the fork's own planning notes (this doc) so a future
   pass does not re-propose the same shape.

## Trigger

A concrete, measured user pain with compression outcomes (e.g., degradation
observed in caveman-stats data) that a stats-extension could address.

## Lesson (recorded)

"New product surface rather than a fix" is a hard rejection class in this repo;
measurement belongs in the existing measurement surfaces.