#!/usr/bin/env node
// Tests for the caveman L4 runtime (l4/caveman-l4.mjs).
// Hermetic: state + profile dirs are redirected to a throwaway temp dir via the
// CAVEMAN_L4_STATE_DIR / CAVEMAN_L4_PROFILES_DIR env overrides, so a test run
// never writes into the checkout.
// Run: node l4/test_caveman_l4.mjs

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, writeFileSync, appendFileSync, rmSync, utimesSync, mkdirSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, 'caveman-l4.mjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'caveman-l4-test-'));
  try {
    fn(dir);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function envFor(dir) {
  return {
    ...process.env,
    CAVEMAN_L4_STATE_DIR: join(dir, 'state'),
    CAVEMAN_L4_PROFILES_DIR: join(dir, 'profiles'),
  };
}

function run(dir, args) {
  const out = execFileSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: envFor(dir),
  });
  return JSON.parse(out.trim());
}

function sessionLines() {
  // One multi-block response = several JSONL lines sharing a message.id under
  // ONE requestId (dedupe → count once). The SAME message.id under a DIFFERENT
  // requestId is a separate response and must still count (PR #794 parity).
  return [
    { type: 'assistant', requestId: 'req_a', message: { id: 'm1', usage: { output_tokens: 100, cache_read_input_tokens: 10 } } },
    { type: 'assistant', requestId: 'req_a', message: { id: 'm1', usage: { output_tokens: 100, cache_read_input_tokens: 10 } } },
    { type: 'assistant', requestId: 'req_b', message: { id: 'm1', usage: { output_tokens: 40, cache_read_input_tokens: 5 } } },
    { type: 'assistant', requestId: 'req_b', message: { id: 'm2', usage: { output_tokens: 20, cache_read_input_tokens: 2 } } },
  ];
}

console.log('caveman-l4 tests\n');

test('auto-measure dedupes multi-block responses and is idempotent', (dir) => {
  const sess = join(dir, 's.jsonl');
  writeFileSync(sess, sessionLines().map(o => JSON.stringify(o)).join('\n') + '\n');

  const first = run(dir, ['auto-measure', '--session-file', sess, '--mode', 'full', '--agent', 'claude']);
  assert.strictEqual(first.status, 'measured', 'first run measures');
  assert.strictEqual(first.measurement.turns, 3, 'req_a:m1 + req_b:m1 + req_b:m2 = 3');
  assert.strictEqual(first.measurement.outputTokens, 160, '100 + 40 + 20');
  assert.strictEqual(first.measurement.cacheReadTokens, 17);
  assert.strictEqual(first.checks.dedupe, 'PASS');

  // Same mtime → still within freshness → no-op re-run (watermark guard).
  const second = run(dir, ['auto-measure', '--session-file', sess, '--mode', 'full']);
  assert.strictEqual(second.status, 'fresh', 'unchanged transcript is skipped');
});

test('auto-measure re-measures only after the transcript grows', (dir) => {
  const sess = join(dir, 's.jsonl');
  writeFileSync(sess, JSON.stringify({ type: 'assistant', message: { id: 'm1', usage: { output_tokens: 50 } } }) + '\n');
  assert.strictEqual(run(dir, ['auto-measure', '--session-file', sess]).measurement.turns, 1);

  // Append a second response and force a clearly-later mtime so the staleness
  // probe sees growth even on coarse filesystem clocks.
  appendFileSync(sess, JSON.stringify({ type: 'assistant', message: { id: 'm2', usage: { output_tokens: 30 } } }) + '\n');
  const later = Date.now() / 1000 + 120;
  utimesSync(sess, later, later);
  const re = run(dir, ['auto-measure', '--session-file', sess, '--min-fresh-ms', '0']);
  assert.strictEqual(re.status, 'measured', 'grown transcript re-measures');
  assert.strictEqual(re.measurement.turns, 2);
});

test('verify-gate REFUSES a claim with no measured pair', (dir) => {
  const out = run(dir, ['verify-gate', '--finding', '{ "claim": { "mode": "full", "savingsPct": 65 } }']);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.verdict, 'REFUSED');
  assert.strictEqual(out.checks.evidence, 'FAIL');
});

test('verify-gate VERIFIES a measured before/after pair', (dir) => {
  const finding = JSON.stringify({
    claim: { mode: 'full', savingsPct: 65 },
    measured: { baselineOutputTokens: 1000, outputTokens: 350 },
  });
  const out = run(dir, ['verify-gate', '--finding', finding]);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.verdict, 'VERIFIED');
  assert.strictEqual(out.checks.savings, 'PASS');
});

test('verify-gate VERIFIES a pre-computed measured estimate', (dir) => {
  const finding = JSON.stringify({
    claim: { mode: 'full' },
    measured: { estSavedTokens: 650, turns: 10 },
  });
  const out = run(dir, ['verify-gate', '--finding', finding]);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.verdict, 'VERIFIED');
});

test('a stale lock (dead owner pid) is recovered, not stuck busy', (dir) => {
  const sess = join(dir, 's.jsonl');
  writeFileSync(sess, JSON.stringify({ type: 'assistant', message: { id: 'm1', usage: { output_tokens: 50 } } }) + '\n');
  // A crashed run leaves `<state>/<project>__<session>.lock/` with a dead owner
  // pid recorded. auto-measure must steal it and proceed, not report 'busy'.
  const lock = join(dir, 'state', 'default__s.lock');
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner'), '999999999 2020-01-01T00:00:00.000Z');
  const out = run(dir, ['auto-measure', '--session-file', sess]);
  assert.strictEqual(out.status, 'measured', 'leftover/crashed lock is recovered');
  assert.ok(!existsSync(lock), 'lock removed after the run');
});

test('a live lock is honored as busy (never double-write)', (dir) => {
  const sess = join(dir, 's.jsonl');
  writeFileSync(sess, JSON.stringify({ type: 'assistant', message: { id: 'm1', usage: { output_tokens: 50 } } }) + '\n');
  // A genuinely live owner (this runner process) must NOT be stolen.
  const lock = join(dir, 'state', 'default__s.lock');
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner'), `${process.pid} ${new Date().toISOString()}`);
  const out = run(dir, ['auto-measure', '--session-file', sess]);
  assert.strictEqual(out.status, 'busy', 'a live owner pid must not be stolen');
});

test('a live but OLD lock is still honored as busy (never double-write)', (dir) => {
  const sess = join(dir, 's.jsonl');
  writeFileSync(sess, JSON.stringify({ type: 'assistant', message: { id: 'm1', usage: { output_tokens: 50 } } }) + '\n');
  // Old enough to be past LOCK_STALE_MS, but the recorded owner pid is LIVE: a
  // hung-but-alive run must not be stolen into a second writer.
  const lock = join(dir, 'state', 'default__s.lock');
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner'), `${process.pid} ${new Date().toISOString()}`);
  const past = Date.now() / 1000 - 120;
  utimesSync(lock, past, past);
  const out = run(dir, ['auto-measure', '--session-file', sess]);
  assert.strictEqual(out.status, 'busy', 'a live owner pid is not stolen, even when the lock is old');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);