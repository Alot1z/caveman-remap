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
import process from 'node:process';

const PR_BODY = process.env.PR_BODY ?? '';
const HEAD_REF = process.env.HEAD_REF ?? '';
const WORKSPACE = process.env.GITHUB_WORKSPACE ?? process.cwd();

// Branch -> suite definition. `setup` runs once before the checks; each
// `command` runs in the given subdir; `result` is the expected summary.
const CONFIG = {
  'stats-accounting-fixes': {
    setup: [],
    commands: [
      ['', 'node', ['tests/test_caveman_stats.js']],
      ['', 'python', ['tests/verify_repo.py']],
    ],
    result: '56 passed, 0 failed',
  },
  'compress-content-block-fix': {
    setup: [],
    commands: [
      ['', 'python', ['-m', 'pytest', '-q', 'tests/test_compress_safety.py', 'tests/test_compress_concurrency.py']],
    ],
    result: '47 passed, 0 failed, 4 skipped',
  },
  'l4-compression-runtime': {
    setup: [],
    commands: [
      ['', 'node', ['l4/test_caveman_l4.mjs']],
      ['', 'node', ['tests/test_caveman_measure.js']],
    ],
    result: '10 passed, 0 failed',
  },
  'whole-cave-web': {
    setup: [
      ['', 'go', ['build', '-o', 'bin/caveman-mcp', './mcp/cmd/caveman-mcp']],
    ],
    commands: [
      ['mcp/remote', 'node', ['--test', 'tests/remote.test.mjs', 'tests/engine.test.mjs', 'tests/drift.test.mjs']],
    ],
    result: '9 passed, 0 failed',
  },
  'feat/firefox-extension-810': {
    setup: [],
    commands: [
      ['extension', 'node', ['scripts/build-extension-zip.mjs', 'chrome']],
      ['extension', 'node', ['scripts/build-extension-zip.mjs', 'firefox']],
    ],
    result: 'build gate passed',
  },
};

const cfg = CONFIG[HEAD_REF];
if (!cfg) {
  console.log(`test-count-drift: no suite configured for branch "${HEAD_REF}" — skipping`);
  process.exit(0);
}

function run(cwd, cmd, args, env) {
  const out = execFileSync(cmd, args, {
    cwd: cwd ? pathJoin(WORKSPACE, cwd) : WORKSPACE,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out;
}

// The engine integration suite needs a freshly built binary on PATH-visible
// absolute path (Linux CI):
//   CAVEMAN_MCP_BIN=<workspace>/bin/caveman-mcp
// CAVEMAN_MCP_BIN_OVERRIDE exists for local validation on Windows, where
// node's spawn does not resolve an extensionless exe path (bin/caveman-mcp
// spawns as ENOENT until copied to an .exe name). CI never sets it.
function mcpEnv() {
  if (HEAD_REF !== 'whole-cave-web') return undefined;
  const override = process.env.CAVEMAN_MCP_BIN_OVERRIDE;
  return override
    ? { CAVEMAN_MCP_BIN: override }
    : { CAVEMAN_MCP_BIN: pathJoin(WORKSPACE, 'bin', 'caveman-mcp') };
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

const env = mcpEnv();
try {
  for (const [cwd, cmd, args] of cfg.setup ?? []) run(cwd, cmd, args, env);
} catch (e) {
  console.error(`test-count-drift: setup step failed: ${e.message.split('\n')[0]}`);
  process.exit(1);
}

const isGate = cfg.result === 'build gate passed';
let output = '';
try {
  for (const [cwd, cmd, args] of cfg.commands) {
    output += run(cwd, cmd, args, env) + '\n';
  }
} catch (e) {
  console.error(`test-count-drift: suite command failed: ${e.message.split('\n')[0]}`);
  process.exit(1);
}

const actual = isGate ? 'build gate passed' : summarize(output);
if (actual === null) {
  console.error(`test-count-drift: could not parse a test summary from suite output:\n${output.slice(0, 1500)}`);
  process.exit(1);
}

const bodyResult = (PR_BODY.match(/Result:\s*`([^`]+)`/) || [])[1] ?? null;

console.log(`branch:      ${HEAD_REF}`);
console.log(`expected:    ${cfg.result}`);
console.log(`actual:      ${actual}`);
console.log(`body says:   ${bodyResult ?? '(missing ## Test status Result line)'}`);

let fail = false;
if (actual !== cfg.result) {
  console.error(`test-count-drift FAIL: suite regressed — expected "${cfg.result}", got "${actual}"`);
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
