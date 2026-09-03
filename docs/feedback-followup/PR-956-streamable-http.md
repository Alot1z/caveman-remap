# PR #956 — feat(mcp): add streamable-HTTP transport

Status: **CLOSED** (2026-09-03). Deferred to v2 with a full security critique.

## Feedback (verbatim key lines)

JuliusBrussee (closure):
> "The reuse of serveOne/dispatch and the size caps is the right shape, and
> go vet and go test ./mcp/... are green on the branch. Closing on scope and
> on security posture."
>
> "Scope: HTTP transport is scheduled as v2 in mcp/CLAUDE.md and no host is
> asking for it yet. No issue or doc mentions streamable or remote MCP. My
> note on #934 that MCP surface work belongs with the Go binary was a routing
> note, not an invitation to land the transport now."
>
> "Security: the endpoint sets Access-Control-Allow-Origin: * with no Origin
> validation and no auth. I confirmed a cross-origin preflight and a full
> tools/call round-trip against the built binary from a foreign Origin. Any
> web page the user has open can reach tools/list, caveman_compress, and
> caveman_retrieve, and retrieve reads the shared ~/.caveman/ccr.db. The MCP
> 2025-06-18 spec requires Origin validation for exactly this reason. Your
> earlier #934 had bearer-token auth, and this version dropped it."
>
> "Two smaller things: the zero-egress test is skipped by filename instead of
> being replaced by an assertion that Serve cannot reach the network, and
> mcp/README.md, CLAUDE.md, and AGENTS.md still say the binary opens no
> network connection."

The target shape (maintainer-specified):
> "a strict Origin allowlist, loopback-only unless a token is set, a cap on
> SSE connections, stdlib flag parsing, docs updated in the same commit, and a
> zero-egress test that still has teeth."

## Disposition

- Transport: **deferred** to v2 by maintainer decision (no host asking).
- Security posture: **rejected as-is** (ACAO:* + no Origin validation + no
  auth; proven exploitable from a foreign Origin).
- The v2 design is **specified by the maintainer** — the plan below is his
  shape, not ours.

## Plan (draft)

1. **Hold.** No implementation until a host asks (issue or maintainer
   request). The v2 design doc:
   - strict Origin allowlist (required by MCP 2025-06-18);
   - loopback-only binding unless a token is set;
   - cap on SSE connections;
   - stdlib flag parsing;
   - docs (mcp/README.md, CLAUDE.md, AGENTS.md) updated in the SAME commit —
     no more "opens no network connection" while a listener exists;
   - a zero-egress test that asserts Serve cannot reach the network (no
     filename-based skips).
2. If we ever draft the v2 implementation on the fork: implement in the Go
   binary (per the #934 routing note), with bearer-token auth restored (the
   #934 precedent), each security property carrying its own test.
3. **Security lesson (universal):** an HTTP MCP endpoint without Origin
   validation and auth lets any web page the user has open drive local MCP
   tools that read the shared CCR database — extract to the knowledge base
   (done: see inspirations).

## Trigger

A concrete host requirement for remote MCP, or upstream starting v2 work.

## Lesson (recorded)

Local data services need Origin validation + auth before they listen on any
interface; docs and tests must move with the capability in the same commit.