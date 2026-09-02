#!/usr/bin/env node
// Test-count drift gate for review-ready PRs.
//
// The PR body carries a machine-readable "## Test status" section:
//   ## Test status
//   - Result: `46 passed, 0 failed, 4 skipped`
//
// This script runs the suite configured for the head branch, computes the
// actual summary, and fails when:
//   - the branch's suite no longer matches the configured expectation (a
//     regression the PR owner must re-verify), OR
//   - the PR body's declared Result differs from what the suite actually
//     produces (the body drifted from reality and must be corrected).
//
// Commands come from the per-branch CONFIG map, never from the PR body, so a
// malicious body cannot inject commands; it can only fail the gate.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

const PR_BODY = process.env.PR_BODY ?? '';
const HEAD_REF = process.env.HEAD_REF ?? '';
const WORKSPACE = process.env.GITHUB_WORKSPACE ?? process.cwd();

// Branch -> suite factory. `setup` runs once before the checks; each
// `command` runs in the given subdir; `result` is the expected summary.
//
// This is the standalone drift gate (own PR, own branch). It protects the
// main-branch baseline, so it runs main's suites and expects main's counts.
// When a later PR changes the suites (adds/removes tests), that PR must bump
// the expected `result` in the same change — that is the drift contract.
//
// The caveman-stats suite is locale-dependent: on non-en-US machines
// toLocaleString() without a locale renders 1.250 instead of 1,250 and the
// suite fails there. The locale pin PR (C4) fixes the source by adding the
// fmt() helper anchored on toLocaleString('en-US'). Instead of narrating that
// handoff in a comment, the gate DERIVES the expectation from the actual
// source (machine-enforced, not documented):
//
//   pin present -> the C4 stats suite must be enabled and the total must be
//                  233 (181 base + 52 stats tests); forgetting to enable the
//                  suite, or merging C4 without it, fails the gate with a hint.
//   pin absent  -> the stats suite must stay excluded and the total is 181
//                  (150 node custom-harness + 31 pytest compress).
//
// So the handoff is checked by the gate itself: C4's merge either lands with
// the stats suite enabled (total 233) or the gate fails and says exactly why.
const CONFIG = {
  'ci/test-count-drift': buildDriftConfig,
};

// statsPinPresent reports whether the locale pin landed in the stats source:
// the fmt() helper is the only place the file contains toLocaleString('en-US').
function statsPinPresent() {
  const src = pathJoin(WORKSPACE, 'src', 'hooks', 'caveman-stats.js');
  try {
    return fs.readFileSync(src, 'utf8').includes("toLocaleString('en-US')");
  } catch {
    return false; // source unreadable/missing: treat as no pin, cannot verify
  }
}

function buildDriftConfig() {
  const pin = statsPinPresent();
  return {
    setup: [],
    commands: [
      // All custom-harness node suites except test_cavecrew_model_overrides.js
      // (its "All N tests passed." summary is a different format).
      //
      // test_caveman_stats.js is excluded UNTIL the C4 merge, which must add
      // it to this loop in the same change — the derived expectation below
      // fails the gate if that is forgotten (actual 181 vs required 233).
      ['', 'bash', ['-c', 'for t in tests/test_*.js; do case "$t" in *cavecrew*|*caveman_stats*) continue;; esac; echo "== $t =="; node "$t" || exit 1; done']],
      ['', 'python', ['-m', 'pytest', '-q', 'tests/test_compress_safety.py', 'tests/test_compress_concurrency.py']],
    ],
    // 150 (node, stats excluded) + 31 (pytest) = 181; +52 (stats suite) = 233.
    result: pin ? '233 passed, 0 failed, 4 skipped' : '181 passed, 0 failed, 4 skipped',
    pin,
  };
}

const makeCfg = CONFIG[HEAD_REF];
if (!makeCfg) {
  console.log(`test-count-drift: no suite configured for branch "${HEAD_REF}" — skipping`);
  process.exit(0);
}
const cfg = makeCfg();

function run(cwd, cmd, args) {
  const out = execFileSync(cmd, args, {
    cwd: cwd ? pathJoin(WORKSPACE, cwd) : WORKSPACE,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out;
}

function pathJoin(...parts) {
  return parts.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
}

// Sum summary lines in several known formats:
//   "56 passed, 0 failed"                          (custom harnesses)
//   "46 passed, 4 skipped"                         (pytest, 0 failed)
//   "46 passed, 0 failed, 4 skipped"               (pytest, explicit)
//   "tests 9 · pass 9 · fail 0 · skipped 0"        (node --test aggregate)
//   ℹ pass 9 / ℹ fail 0 / ℹ skipped 0 lines        (node --test spec reporter; take the last block)
function summarize(output) {
  let passed = 0, failed = 0, skipped = 0, saw = false;

  for (const m of output.matchAll(/(\d+) passed, (\d+) failed, (\d+) skipped/g)) {
    passed += +m[1]; failed += +m[2]; skipped += +m[3]; saw = true;
  }
  for (const m of output.matchAll(/(\d+) passed, (\d+) failed/g)) {
    passed += +m[1]; failed += +m[2]; saw = true;
  }
  for (const m of output.matchAll(/(\d+) passed, (\d+) skipped/g)) {
    passed += +m[1]; skipped += +m[2]; saw = true;
  }
  for (const m of output.matchAll(/tests (\d+) · pass (\d+) · fail (\d+) · skipped (\d+)/g)) {
    passed += +m[2]; failed += +m[3]; skipped += +m[4]; saw = true;
  }

  // node --test spec reporter: "ℹ pass 9", "ℹ fail 0", "ℹ skipped 0" on
  // separate lines. Multiple files emit one block each, so the LAST block is
  // the aggregate.
  let tPass = null, tFail = null, tSkip = null;
  for (const line of output.split('\n')) {
    let m;
    if ((m = line.match(/^ℹ pass (\d+)/))) tPass = +m[1];
    else if ((m = line.match(/^ℹ fail (\d+)/))) tFail = +m[1];
    else if ((m = line.match(/^ℹ skipped (\d+)/))) tSkip = +m[1];
  }
  if (tPass !== null) {
    passed += tPass; failed += tFail ?? 0; skipped += tSkip ?? 0; saw = true;
  }

  if (!saw) return null;
  const parts = [`${passed} passed`, `${failed} failed`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return parts.join(', ');
}

try {
  for (const [cwd, cmd, args] of cfg.setup ?? []) run(cwd, cmd, args);
} catch (e) {
  console.error(`test-count-drift: setup step failed: ${e.message.split('\n')[0]}`);
  process.exit(1);
}

let output = '';
try {
  for (const [cwd, cmd, args] of cfg.commands) {
    output += run(cwd, cmd, args) + '\n';
  }
} catch (e) {
  console.error(`test-count-drift: suite command failed: ${e.message.split('\n')[0]}`);
  process.exit(1);
}

const actual = summarize(output);
if (actual === null) {
  console.error(`test-count-drift: could not parse a test summary from suite output:\n${output.slice(0, 1500)}`);
  process.exit(1);
}

const bodyResult = (PR_BODY.match(/Result:\s*`([^`]+)`/) || [])[1] ?? null;

console.log(`branch:      ${HEAD_REF}`);
console.log(`pin:         ${cfg.pin ? 'PRESENT (locale pin) — stats suite required, 233 total' : 'absent — stats suite excluded, 181 total'}`);
console.log(`expected:    ${cfg.result}`);
console.log(`actual:      ${actual}`);
console.log(`body says:   ${bodyResult ?? '(missing ## Test status Result line)'}`);

let fail = false;
if (actual !== cfg.result) {
  console.error(`test-count-drift FAIL: suite regressed — expected "${cfg.result}", got "${actual}"`);
  if (cfg.pin) {
    console.error('hint: the locale pin is present — the C4 merge must enable the stats suite');
    console.error('      (add tests/test_caveman_stats.js to the node loop) so the total reaches 233.');
  }
  fail = true;
}
if (bodyResult === null) {
  console.error('test-count-drift FAIL: PR body has no "## Test status" Result line');
  fail = true;
} else if (bodyResult !== cfg.result) {
  console.error(`test-count-drift FAIL: PR body drifted — body says "${bodyResult}", reality is "${actual}"`);
  fail = true;
}
process.exit(fail ? 1 : 0);
