# Caveman — Canonical Verified Facts (shared by the contribution skills)

Single owner of the verified facts shared by `/caveman-contribution` and
`/caveman-contribution-lifecycle`. Both skills reference THIS file and
restate nothing; identical copies sit beside each skill (sync rule at the
bottom). Facts were verified 2026-09-03 against the live API + CI of
JuliusBrussee/caveman and the race-free corpus (510 PRs / 394 issues), and
oracle-graded against live sources on 2026-09-04 where noted. The narrative
trail (how each fact was found, any correction) is the session digest
`session-digests/2026-09-03-caveman-upstream-mission.md`, append-only per
the item-85 canonical-owner rule.

## 1. Fork-PR CI mechanics — the approval gate (KB #6449, OBSERVED)

- Fork-head `pull_request` runs queue behind the base repo's approval gate:
  `mergeable_state=unstable`, `mergeable=true`, checks pending /
  `action_required`. No fork-side action (rerun, empty-commit push) clears it.
- **At the merge second GitHub TERMINATES the still-queued runs**
  (18:32:13 / 18:32:17 / 18:39:17 on 2026-09-03) — they never execute a job;
  their `failure` conclusion is a termination artifact, NOT a code failure.
- Real validation = the squash-commit runs on main (all-green for #954/#957,
  18:32–35Z).
- Merged PRs need no CI green — main has no branch protection.
- The maintainer acts fast once an ask is surfaced (~30 min observed:
  18:07Z ask → 18:32–18:39Z action).
- Closed PRs carry reasons; read the closure before re-proposing.

## 2. The standing evidence bar + closure taxonomy (KB #6507, OBSERVED)

Any new mode/language/behavior needs reproducible quality/token evidence +
full runtime coverage, or it is closed (Korean #54/#215, Japanese #85,
Spanish #118, Russian #144, Turkish #179, "precise" #302).

- One trial is not a benchmark (#143); cached cost is not token reduction;
  wrong-tokenizer measurements cannot support honest savings claims (#73);
  a canary that itself spends tokens contradicts the contract (#236).
- Implemented/superseded discipline: "equivalent behavior is now on main
  through `<commit>`, shipped in tag `<tag>`" — check main BEFORE building;
  old-layout patches close as superseded.
- False integration claims close (#132: "does not integrate with ChatGPT;
  only changes wording").
- Invented settings/contracts close (#192: `pluginConfigs.defaultLevel` is
  not a contract — supported is `CAVEMAN_DEFAULT_MODE` or
  `.caveman/config.json`; #269: a label without a behavior contract is
  unsafe).
- Safety regressions outweigh cleanup (#116: `--force` regression on a
  destructive tool).
- Shape first: small single-purpose units; 650-line multi-behavior diffs are
  rejected (#931). One PR = one behavior.
- No dead weight: nothing referencing merged-PR choreography in CI (#955).
- Security is checked end-to-end: #956's ACAO:* exploit was verified live
  from a foreign Origin (any open web page can drive local MCP tools and
  read `~/.caveman/ccr.db` — KB #6451). Local HTTP/MCP servers must validate
  Origin + require auth.
- env-based inputs endorsed: `PR_BODY` env handling with `pull_request`
  (never `pull_request_target`), no template expansion in run blocks,
  read-only permissions (#955 credit).
- Zero-egress tests must assert — "skipped by filename" is not a test
  (#956 critique).
- Praise triggers: "follows existing patterns exactly"; standalone; does not
  touch core SKILL.md.

## 3. Second reviewer — AmirF194 (KB #6508, OBSERVED)

- Oracle-verified reviews: clones the PR head into a clean container
  (node:20-alpine / python:3.12-slim) and re-runs the changed code,
  reporting measured before/after (#794/#798/#889/#891/#896).
- Credits main's fixes while confirming the gap was real (#590/#615).
- Cross-PR awareness: flags overlapping PRs on the same file (#795→#849).
- Queue hygiene: self-closes stale PRs; six open PRs at once is "more review
  load than is reasonable" for a solo-maintained project (#636).
- Scope lift-outs: names files that belong in a separate PR (#654).

## 4. Rejected-shape taxonomy (KB #6509, OBSERVED — 8 classes)

1. New product surface (#933 l4 runtime — "scope-narrowing repo").
2. Parallel subsystem vs the Go binary (#934 — MCP surface belongs in the Go
   `caveman-mcp` binary, not a Node server that shells out).
3. Per-branch CI gate (#955 — repo-wide by construction or nothing; "a PR
   without a Test status section passes silently either way").
4. Unpinned CI e2e — fetches unpinned tools at test time; `test:firefox` is
   deliberately opt-in (bare `npx web-ext`).
5. Contract bypass (#315).
6. Checked-in mirror (#117/#337).
7. Unmeasured mode expansion (the #6507 standing bar).
8. Merged-PR choreography dead weight (`statsPinPresent` class, #954).

## 5. Unified provider/compiler architecture (KB #6511, OBSERVED)

All host integrations (Copilot #48, Codex #67/#241/#273, Kiro #87/#139/#219,
Warp #91, Antigravity #117, OpenCode #284, Pi #162/#274, Gemini #390, Kimi
#315) ship through ONE shared path — provider profiles, `agents/compile.mjs`
frontmatter transformation, the plugin/config registry, the installer —
never checked-in mirrors. Directly editing synced copies is obsolete (#337);
checked-in mirrors are "no longer owned here" (#117); a shadowing copy can
make the wrong body win (#333). A new host lands as a verified profile
adapter through the shared path, never a standalone mirror tree.

## 6. Per-host provider map — the #934 lane (KB #6552, #6458, #6459)

- Two binaries, two layers: `mcp/` is stdio-only (v1); HTTP transport and
  `caveman mcp` are v2. Per-host compat mounts live in the **proxy**
  (`/compat/<name>/`, e.g. `/compat/opencode-go/v1/messages`) — that is
  where per-host schema tweaks land, not in the MCP binary (KB #6552).
- **opencode-go** rejects Bearer on the anthropic-messages path and needs an
  x-api-key compat mount — already shipped upstream (#969 + built-in
  opencode-go mount; the fork's OpenCode schema draft was withdrawn
  OBSERVED-AS-REFUTED on ground-truthing, 2026-09-03).
- **Codex** has a 2 MiB pipe cap that fails open (KB #6459) — preserve the
  cap and the fail-open behavior.
- **Pi** uses `x-api-key` on `/v1/messages` (fixed #969).
- The auth seam maps credential by wire protocol per request path: compat
  mounts key on x-api-key vs Bearer (KB #6458).

## 7. The 16-step gate model

The contribution gate is a 16-step model (DISCOVER → RECOVER CONTEXT →
CHECK LIVE UPSTREAM FIRST → SEARCH DUPLICATES → REPRODUCE → CLASSIFY →
SCREEN AGAINST THE TAXONOMY → ADVERSARIAL TEST → VERIFY COMMIT → PUBLISH
FORK DRAFT → VERIFY REMOTE → UPDATE DRAFTS → CHECK PR COMMUNICATION → OPEN
PR → VERIFY COMMUNICATION → FINAL REPORT), mirroring the
`ix-contribution-lifecycle` 16-step gate. The model's procedural steps live
in `/caveman-contribution-lifecycle` (the gate itself); this entry records
its origin and what it gates: ground-truth against live main first,
rejection-class screen (FACTS §4), measured evidence with full runtime
coverage (FACTS §2), one small single-purpose PR per change, red/green
mandatory, fork drafts before upstream.

## Sync rule (do not fork this file)

- Edits land in `knowledge/caveman/FACTS.md` (this file) FIRST, then the
  identical copy is written beside every skill: the two installed skills
  (`C:/Users/Mose/.agents/skills/{caveman-contribution,
  caveman-contribution-lifecycle}/FACTS.md`), the two KB mirrors
  (`E:/E-github-repos/agent-knowledge-base/skills/{caveman-contribution,
  caveman-contribution-lifecycle}/FACTS.md`), and the fork-drafts copy
  (`docs/feedback-followup/FACTS.md`).
- `tools/facts-parity.test.mjs` fails if the in-repo copies drift from this
  file (hash comparison, same pattern as the cluster-parity test).
- Narrative about these facts (discovery, corrections) lives in the session
  digest, never here (item 85). Skills reference this file; they restate
  nothing.