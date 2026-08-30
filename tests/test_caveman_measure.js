#!/usr/bin/env node
// Tests for the /caveman-measure hook integration: the UserPromptSubmit mode
// tracker wires the L4 runtime (l4/caveman-l4.mjs) so an in-session command
// measures the active transcript. Kept in its own file so the L4 feature stays
// cleanly separate from the caveman-stats changes.
// Run: node tests/test_caveman_measure.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TRACKER = path.join(ROOT, 'src', 'hooks', 'caveman-mode-tracker.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-measure-test-'));
  try { fn(tmp); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function makeSession(dir, lines) {
  const projDir = path.join(dir, '.claude', 'projects', 'p');
  fs.mkdirSync(projDir, { recursive: true });
  const sessFile = path.join(projDir, 's.jsonl');
  fs.writeFileSync(sessFile, lines.map(l => JSON.stringify(l)).join('\n'));
  return sessFile;
}

console.log('caveman-measure hook tests\n');

test('/caveman-measure relays an L4 measured result via additionalContext', (tmp) => {
  const sess = makeSession(tmp, [
    { type: 'assistant', message: { id: 'm1', usage: { output_tokens: 100 } } },
    { type: 'assistant', message: { id: 'm2', usage: { output_tokens: 50 } } },
  ]);
  const out = execFileSync(process.execPath, [TRACKER], {
    encoding: 'utf8',
    env: {
      ...process.env, CLAUDE_CONFIG_DIR: path.join(tmp, '.claude'), HOME: tmp,
      CAVEMAN_L4_STATE_DIR: path.join(tmp, 'l4state'),
      CAVEMAN_L4_PROFILES_DIR: path.join(tmp, 'l4profiles'),
    },
    input: JSON.stringify({ prompt: '/caveman-measure', transcript_path: sess }),
  });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(parsed.hookSpecificOutput.additionalContext, /"status"\s*:\s*"measured"/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /"turns"\s*:\s*2/);
});

test('/caveman-measure answers gracefully when no transcript is available', (tmp) => {
  const out = execFileSync(process.execPath, [TRACKER], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(tmp, '.claude'), HOME: tmp },
    input: JSON.stringify({ prompt: '/caveman-measure', cwd: tmp }),
  });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(parsed.hookSpecificOutput.additionalContext, /"status"\s*:\s*"error"/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);