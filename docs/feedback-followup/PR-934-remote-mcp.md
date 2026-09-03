# PR #934 — feat(mcp): host-agnostic Remote-MCP server

Status: **CLOSED** (2026-09-02). Shape rejection with a routing note.

## Feedback (verbatim key lines)

JuliusBrussee (closure):
> "A Remote-MCP server is a reasonable idea, but a new 700-line subsystem plus
> a CI workflow is outside what this repo is taking on right now; MCP surface
> work belongs with the Go caveman-mcp binary, not a parallel Node server that
> shells out to it. If a specific host needs one schema tweak (as #870 did), a
> small PR against the existing MCP server is the right shape."

Related: #956's closure repeats the routing note ("my note on #934 that MCP
surface work belongs with the Go binary was a routing note, not an invitation
to land the transport now") and credits #934 for having bearer-token auth that
the #956 draft dropped.

## Disposition

- Parallel Node Remote-MCP server: **rejected** shape.
- MCP surface work: **routed to the Go caveman-mcp binary**.
- The right small shape: one schema tweak per host need (like #870).
- The bearer-token-auth decision from #934 is the precedent for #956's v2
  security posture.

## Plan (draft)

1. **No re-file of the Node server.**
2. If a host needs a remote/HTTP MCP surface, the plan is the #956 v2 design
   (see PR-956 doc) implemented **in the Go binary** — strict Origin
   allowlist, loopback-only unless a token is set, SSE connection cap, stdlib
   flag parsing, docs in the same commit, and a zero-egress test that asserts
   the property rather than skipping by filename.
3. Per-host schema tweaks stay small PRs against the existing MCP server —
   draft one only when a concrete host asks (the #870 pattern).

## Trigger

A concrete host requirement (issue or maintainer request) for remote MCP, or
a specific schema tweak need from a host integration.

## Lesson (recorded)

Subsystem-size additions get routed, not accepted; capability goes to the
surface the maintainer designates (Go binary), shaped at the smallest useful
size (schema tweak).