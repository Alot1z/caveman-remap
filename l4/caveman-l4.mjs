#!/usr/bin/env node
// caveman-l4 — the Level 4 dynamic layer: a zero-dependency runtime that turns
// caveman from a passive, manually-read skill into an active compression ledger.
//
// L4 turns caveman from a passive manual into a compression runtime:
//   L4-1 auto-measure — staleness-triggered, watermark-guarded token
//       measurement per session; idempotent re-run (never re-measures a fresh
//       session). Consumes Claude Code session JSONL (the same shape
//       caveman-stats reads) with the #793 dedupe: one count per message id.
//   L4-2 verify-gate  — a compression claim with no measured before/after
//       pair is REFUSED. Verdict: { ok, verdict, checks }.
//
// Safety rails (WEP-style, per the L4 design):
//   * lock-guard mutating runs (auto-measure) so two writers never collide;
//   * backup before apply, verify after, rollback on failure;
//   * idempotent via watermark — a crashed run restarts clean, never dupes;
//   * evidence is never invented: no measured pair -> no VERIFIED -> no promote;
//   * no secrets: token counts only; transcripts stay on disk, never copied.
//
// Zero dependencies: Node built-ins only (fs, path, os). Node >= 18.
//
// Usage:
//   node l4/caveman-l4.mjs auto-measure --session-file <path> [--agent <name>]
//       [--mode <lite|full|ultra|...|off>] [--project <root>] [--min-fresh-ms <ms>]
//   node l4/caveman-l4.mjs verify-gate --finding <file.json | inline-json>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const L4_ROOT = __dirname;
// State + profile dirs are overridable so tests (and packaged installs) can
// point the runtime at a hermetic, writable location instead of the checkout.
const STATE_DIR = process.env.CAVEMAN_L4_STATE_DIR || path.join(L4_ROOT, 'state');
const PROFILES_DIR = process.env.CAVEMAN_L4_PROFILES_DIR || path.join(L4_ROOT, 'profiles');
const DEFAULT_MIN_FRESH_MS = 60_000;

// ── helpers ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function fail(msg, code = 1) {
  process.stderr.write(`caveman-l4: ${msg}\n`);
  process.exit(code);
}

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

function readJson(pathStr, fallback = null) {
  try { return JSON.parse(fs.readFileSync(pathStr, 'utf8')); }
  catch { return fallback; }
}

function writeJsonAtomic(pathStr, value) {
  const tmp = `${pathStr}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  try { fs.renameSync(tmp, pathStr); }
  catch (err) {
    // Windows rename-over-existing can fail; fall back to copy + unlink.
    fs.copyFileSync(tmp, pathStr);
    fs.unlinkSync(tmp);
  }
}

// Staleness probe + lock guard (WEP: trigger on staleness -> lock -> apply ->
// verify -> rollback). Returns an unlock function or null when the run is
// already in progress. The lock must be recoverable after a crash: a killed
// process leaves the directory behind, and without recovery the next run would
// report 'busy' forever. We steal the lock when the recorded owner pid is
// provably dead, or the lock has simply aged past LOCK_STALE_MS.
const LOCK_STALE_MS = 60_000;

function ownerPidAlive(ownerFile) {
  try {
    const pid = Number(fs.readFileSync(ownerFile, 'utf8').trim().split(/\s+/)[0]);
    if (!Number.isFinite(pid) || pid <= 0) return null; // unparseable — unknown
    try { process.kill(pid, 0); return true; }
    catch (e) { return e.code === 'EPERM' ? true : false; }
  } catch { return null; }
}

function stealLock(lockPath) {
  const ownerFile = path.join(lockPath, 'owner');
  try {
    const alive = ownerPidAlive(ownerFile);
    const tooOld = Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS;
    // Never steal a PROVABLY-LIVE lock, even if old: a >60s lock with a live
    // owner means a hung/slow run, and stealing it would create a second writer
    // (double-write) while the first is still alive. Steal only when the owner
    // is provably dead, or the owner is unknown AND the lock has aged out.
    if (alive === false || (alive !== true && tooOld)) {
      fs.rmSync(lockPath, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch { return false; }
}

function acquireLock(lockPath) {
  try {
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, 'owner'), `${process.pid} ${nowIso()}`);
    return () => { try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch {} };
  } catch {
    // Lock dir already exists — busy unless it is a stale/crashed lock we can
    // recover. Try once; if the steal raced, fall back to 'busy'.
    if (stealLock(lockPath)) {
      try { return acquireLock(lockPath); } catch { return null; }
    }
    return null;
  }
}

// ── L4-1 auto-measure ────────────────────────────────────────────────────────

// Parse assistant usage from session JSONL, counting each API response once.
function parseSession(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }
  let outputTokens = 0, cacheReadTokens = 0, turns = 0, model = null;
  const seen = new Set();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'assistant' || !entry.message) continue;
    const usage = entry.message.usage;
    if (!usage) continue;
    // Count each API response once, keyed on (requestId, message.id) — the same
    // rule caveman-stats' parseSession applies (issue #793 / PR #794): one
    // multi-block response repeats a message.id across JSONL lines, but the SAME
    // id under a different requestId is a separate response.
    const msgId = entry.message.id;
    const requestId = typeof entry.requestId === 'string' ? entry.requestId : '';
    if (typeof msgId === 'string' && msgId !== '') {
      const key = requestId + ':' + msgId;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    outputTokens += usage.output_tokens || 0;
    cacheReadTokens += usage.cache_read_input_tokens || 0;
    turns++;
    if (!model && entry.message.model) model = entry.message.model;
  }
  return { outputTokens, cacheReadTokens, turns, model };
}

// A measurement row is only owed when the transcript grew since the last
// watermark (WEP staleness). Idempotent: same mtime -> "fresh", no-op.
function autoMeasure(opts) {
  const sessionFile = path.resolve(opts.sessionFile);
  const stats = (() => { try { return fs.statSync(sessionFile); } catch { return null; } })();
  if (!stats) fail(`session file not found: ${sessionFile}`);

  const agent = opts.agent || 'claude';
  const project = (opts.project && path.basename(path.resolve(opts.project))) || 'default';
  const minFresh = Number.isFinite(Number(opts.minFreshMs)) ? Number(opts.minFreshMs) : DEFAULT_MIN_FRESH_MS;

  ensureDirs();
  const sessionId = path.basename(sessionFile, '.jsonl');
  const watermarkPath = path.join(STATE_DIR, `${project}__${sessionId}.watermark.json`);
  const lockPath = path.join(STATE_DIR, `${project}__${sessionId}.lock`);
  const unlock = acquireLock(lockPath);
  if (!unlock) { process.stdout.write(JSON.stringify({ status: 'busy', sessionId }) + '\n'); return; }
  // Backup the previous profile row-set before appending (WEP: backup, then
  // verify after apply, roll back on failure). Created lazily so a 'fresh'
  // skip never churns disk.
  const profilePath = path.join(PROFILES_DIR, `${agent}.jsonl`);
  const backup = profilePath + '.bak';
  try {
    const watermark = readJson(watermarkPath, null);
    const fresh = watermark && stats.mtimeMs <= watermark.mtimeMs + minFresh;
    if (fresh) {
      process.stdout.write(JSON.stringify({
        status: 'fresh', sessionId, reason: 'transcript unchanged since last watermark, skipping', checks: { mtime: 'PASS' },
      }) + '\n');
      return;
    }

    if (fs.existsSync(profilePath)) fs.copyFileSync(profilePath, backup);

    const parsed = parseSession(sessionFile);
    if (!parsed) throw new Error(`could not parse session JSONL: ${sessionFile}`);

    const measurement = {
      ts: nowIso(),
      session: sessionId,
      agent,
      mode: opts.mode || null,
      model: parsed.model,
      turns: parsed.turns,
      outputTokens: parsed.outputTokens,
      cacheReadTokens: parsed.cacheReadTokens,
      source: sessionFile,
      sourceMtime: stats.mtimeMs,
    };

    fs.appendFileSync(profilePath, JSON.stringify(measurement) + '\n');
    // Verify after apply: the row must read back.
    const rows = readJsonLines(profilePath);
    const last = rows[rows.length - 1];
    const verified = last && last.session === sessionId && last.ts === measurement.ts;
    if (!verified) throw new Error(`append verification failed; profile rolled back (${profilePath})`);

    writeJsonAtomic(watermarkPath, { mtimeMs: stats.mtimeMs, lastMeasuredAt: measurement.ts, lineCount: rows.length });
    process.stdout.write(JSON.stringify({
      status: 'measured', sessionId, agent, measurement,
      checks: { staleness: 'PASS', dedupe: 'PASS', append_verify: 'PASS' },
    }) + '\n');
  } catch (err) {
    // Best-effort rollback to the pre-append state; then rethrow so the CLI
    // reports the error AFTER finally has released the lock — never a wedged
    // 'busy' session for a transient parse/verify failure.
    if (fs.existsSync(backup)) { try { fs.copyFileSync(backup, profilePath); } catch {} }
    throw err;
  } finally {
    unlock();
  }
}

function readJsonLines(filePath) {
  const rows = [];
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch {}
    }
  } catch {}
  return rows;
}

// ── L4-2 verify-gate ─────────────────────────────────────────────────────────

// A compression claim is VERIFIED only when a measured before/after pair (or a
// measured estimate) supports it. No evidence -> REFUSED, never guessed.
//   finding: {
//     claim:  { mode, savingsPct?: number, savedTokens?: number },
//     measured: {                          // REQUIRED for PASS
//       baselineOutputTokens?: number,     // tokens without caveman
//       outputTokens?: number,             // tokens with caveman
//       estSavedTokens?: number,           // or a pre-computed estimate
//       turns?: number,
//     }
//   }
function verifyGate(opts) {
  let finding = opts.finding;
  if (typeof finding === 'string') {
    const trimmed = finding.trim();
    const fromPath = /\.json$/i.test(trimmed) && fs.existsSync(trimmed)
      ? readJson(trimmed, null) : null;
    finding = fromPath || (() => { try { return JSON.parse(trimmed); } catch { return null; } })();
  }
  if (!finding || typeof finding !== 'object') fail('verify-gate: --finding must be a JSON object or a path to one');

  const claim = finding.claim || {};
  const measured = finding.measured || {};

  const checks = {};
  const hasPair = measured.baselineOutputTokens != null && measured.outputTokens != null;
  const hasEstimate = measured.estSavedTokens != null;

  // Evidence check: a real before/after pair OR a measured estimate; a bare
  // claim (no measured block) is the classic "no evidence" refusal.
  checks.evidence = hasPair || hasEstimate ? 'PASS' : 'FAIL';

  if (checks.evidence === 'FAIL') {
    return { ok: false, verdict: 'REFUSED', reason: 'no measured before/after pair or estimate — evidence is never invented', checks };
  }

  const measuredSaved = hasPair
    ? Math.max(0, measured.baselineOutputTokens - measured.outputTokens)
    : measured.estSavedTokens;

  const claimSaved = claim.savedTokens != null
    ? claim.savedTokens
    : (claim.savingsPct != null && measured.baselineOutputTokens != null
        ? Math.round(measured.baselineOutputTokens * (claim.savingsPct / 100))
        : null);

  checks.mode = typeof claim.mode === 'string' && claim.mode ? 'PASS' : 'WARN';
  checks.savings = claimSaved == null ? 'WARN' : (measuredSaved >= claimSaved ? 'PASS' : 'FAIL');

  const pass = checks.evidence === 'PASS' && checks.savings !== 'FAIL';
  return {
    ok: pass,
    verdict: pass ? 'VERIFIED' : 'REJECTED',
    checks,
    measured: { savedTokens: measuredSaved, baselineOutputTokens: measured.baselineOutputTokens ?? null, outputTokens: measured.outputTokens ?? null },
    claim: { mode: claim.mode ?? null, savingsPct: claim.savingsPct ?? null, savedTokens: claimSaved },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const sub = args[0];
function flag(name, dflt = undefined) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : dflt;
}

switch (sub) {
  case 'auto-measure': {
    const sessionFile = flag('session-file');
    if (!sessionFile) fail('auto-measure: --session-file <path> is required');
    try {
      autoMeasure({
        sessionFile,
        agent: flag('agent'),
        mode: flag('mode'),
        project: flag('project'),
        minFreshMs: flag('min-fresh-ms'),
      });
    } catch (err) {
      fail(String((err && err.message) || err));
    }
    break;
  }
  case 'verify-gate': {
    const finding = flag('finding');
    if (!finding) fail('verify-gate: --finding <file.json | inline-json> is required');
    process.stdout.write(JSON.stringify(verifyGate({ finding }), null, 2) + '\n');
    break;
  }
  default:
    fail(`unknown subcommand: ${sub || '(none)'} — expected auto-measure | verify-gate`, 2);
}