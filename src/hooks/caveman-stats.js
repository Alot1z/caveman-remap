#!/usr/bin/env node
// caveman-stats — read the active Claude Code session log, print real token
// usage plus an estimated savings figure from the benchmark in benchmarks/.
//
// Run directly:    node hooks/caveman-stats.js
// Inside Claude:   /caveman-stats triggers this via the UserPromptSubmit hook.
// Hook integration passes --session-file <transcript_path> so we always read
// the active session, not whichever JSONL was modified most recently.

const fs = require('fs');
const path = require('path');
const os = require('os');
// caveman-config.js is a mandatory sibling, but an incomplete install leaves
// it absent. A bare top-level require turns that into an uncaught
// MODULE_NOT_FOUND stack trace, which the calling mode-tracker hook can only
// report as an unexplained failure (#848). Print one actionable line instead.
//
// Deliberately inlined rather than extracted into a shared helper: a shared
// loader would itself be one more sibling that can go missing, which is the
// exact failure this guards against.
let cavemanConfig;
let configFailure = null;
try {
  cavemanConfig = require('./caveman-config');
} catch (primary) {
  // The opencode install layout renames the sibling to `.cjs` (its plugin dir
  // is "type": "module"), same fallback caveman-parse.js already does. Gate the
  // retry on the error naming THIS module: a MODULE_NOT_FOUND thrown by a
  // require *inside* a sibling that loaded fine must not be re-reported as
  // "./caveman-config.cjs is missing", blaming a file never meant to exist.
  const message = String((primary && primary.message) || primary);
  if (primary && primary.code === 'MODULE_NOT_FOUND' && message.includes("'./caveman-config'")) {
    try { cavemanConfig = require('./caveman-config.cjs'); } catch (e) { /* report primary */ }
  }
  if (!cavemanConfig) {
    const absent = !fs.existsSync(path.join(__dirname, 'caveman-config.js'))
                && !fs.existsSync(path.join(__dirname, 'caveman-config.cjs'));
    // Distinguish "the sibling is absent" from "the sibling loaded but its own
    // require failed" — naming the wrong cause is worse than no message. Only
    // the first line of error.message: Node appends a multi-line "Require
    // stack:" block, the very noise this guard exists to remove.
    configFailure = absent
      ? 'caveman-config.js is missing from ' + __dirname + ' — the install is incomplete.'
      : 'caveman-config could not load — ' + message.split('\n')[0];
  }
}
// A module that LOADS but exports the wrong shape is the plugin-cache-drift
// case #848 describes; without this check the first use dereferences undefined.
if (cavemanConfig && !(typeof cavemanConfig.readFlag === 'function'
    && typeof cavemanConfig.appendFlag === 'function'
    && typeof cavemanConfig.readHistory === 'function'
    && typeof cavemanConfig.safeWriteFlag === 'function'
    && Array.isArray(cavemanConfig.VALID_MODES))) {
  configFailure = 'caveman-config loaded but is missing expected exports — the install is inconsistent.';
}
if (configFailure) {
  process.stderr.write('caveman-stats: ' + configFailure + '\n'
    + 'Run `/plugin update caveman`, or rerun install.sh for standalone hooks.\n');
  // Unlike the two style hooks, stats has no useful degraded output — every
  // figure it prints comes from the flag/history the config module owns.
  // Exiting non-zero lets the mode-tracker's existing catch substitute its
  // "could not run stats script" message rather than injecting a half-report.
  process.exit(1);
}
const { readFlag, appendFlag, readHistory, safeWriteFlag, VALID_MODES, MODE_LOG_BASENAME } = cavemanConfig;

// Per-session helpers, resolved individually and NOT added to the shape check
// above: a config module from before per-session state still produces correct
// (machine-wide) figures, and hard-failing stats over the newer exports would
// turn a working report into an error. Each stub is the pre-per-session read.
const resolveActiveMode = cavemanConfig.resolveActiveMode
  || ((dir) => { const m = readFlag(path.join(dir, '.caveman-active')); return (!m || m === 'off') ? null : m; });
const validateSessionId = cavemanConfig.validateSessionId || (() => null);
const sessionActivePath = cavemanConfig.sessionActivePath || (() => null);
const legacyFlagPath = cavemanConfig.legacyFlagPath || ((dir) => path.join(dir, '.caveman-active'));

// Mean per-task savings from benchmarks/results/*.json (avg_savings: 65 across
// 10 tasks, sonnet-4-20250514). Only 'full' has measured data; lite / ultra /
// wenyan modes show no estimate until benchmarked. Add an entry here when a new
// run is committed.
const COMPRESSION = { 'full': 0.65 };

// Per-turn INPUT cost the rules add: SKILL.md (~5 KB) is injected into
// context, plus the per-turn reinforcement the mode tracker emits. This is
// the ~1-1.5k/turn figure docs/HONEST-NUMBERS.md admits and #145/#677 flag as
// hidden — gross output savings alone can look great while the session is
// still net-negative. 1250 sits mid-range; override with
// CAVEMAN_RULE_OVERHEAD_TOKENS if you've measured your own setup.
const DEFAULT_RULE_OVERHEAD_TOKENS_PER_TURN = 1250;

function ruleOverheadPerTurn() {
  const raw = process.env.CAVEMAN_RULE_OVERHEAD_TOKENS;
  if (raw === undefined) return DEFAULT_RULE_OVERHEAD_TOKENS_PER_TURN;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RULE_OVERHEAD_TOKENS_PER_TURN;
}

// Approximate Anthropic public output-token pricing, USD per million.
// Match by model id prefix so this stays correct across point releases
// (e.g. claude-sonnet-4-20250514, claude-sonnet-4-7). Update from
// https://www.anthropic.com/pricing if a release changes the tier.
// Most-specific prefixes MUST come first — priceForModel returns the first match.
const MODEL_OUTPUT_PRICE_PER_M = [
  // Claude 5 family. Fable/Mythos (models.anthropic.com naming) sit at the
  // top $50/M tier; Opus 5 dropped to $25/M. Sonnet 5's $10/M rate is the
  // permanent standard price — the increase to $15/M planned for
  // 2026-09-01 was cancelled (see anthropic.com/docs/en/about-claude/pricing).
  ['claude-fable-5',   50.00],
  ['claude-mythos-5',  50.00],
  ['claude-opus-5',    25.00],
  ['claude-sonnet-5',  10.00],
  // Legacy Opus 4.0 / 4.1 (pre-4.5) billed at the old $75/M output tier,
  // including the dated ids (e.g. claude-opus-4-20250514).
  ['claude-opus-4-0',    75.00],
  ['claude-opus-4-1',    75.00],
  ['claude-opus-4-2025', 75.00],
  // Opus 4.5–4.8 dropped to $25/M output (rate card held since 4.5).
  ['claude-opus-4',      25.00],
  ['claude-sonnet-4',    15.00],
  ['claude-haiku-4',      5.00],   // Haiku 4.5 = $5/M output
  ['claude-3-5-sonnet',  15.00],
  ['claude-3-5-haiku',    4.00],
  ['claude-3-opus',      75.00],
];

function priceForModel(model) {
  if (!model) return null;
  for (const [prefix, price] of MODEL_OUTPUT_PRICE_PER_M) {
    if (model.startsWith(prefix)) return price;
  }
  return null;
}

function formatUsd(amount) {
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}

// Deterministic number formatting. toLocaleString() alone inherits the host OS
// locale, which varies thousands separators between machines (1,250 vs 1.250)
// and makes CLI output — and the test suite — locale-dependent. Pin
// en-US so caveman-stats prints the same numbers everywhere, matching the rest
// of the tool's English output.
const fmt = (n) => n.toLocaleString('en-US');

function findRecentSession(claudeDir) {
  const projectsDir = path.join(claudeDir, 'projects');
  let entries;
  try { entries = fs.readdirSync(projectsDir, { withFileTypes: true }); }
  catch { return null; }

  let best = null;
  const stack = entries.map(e => path.join(projectsDir, e.name));
  while (stack.length) {
    const p = stack.pop();
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      try {
        for (const child of fs.readdirSync(p)) stack.push(path.join(p, child));
      } catch {}
    } else if (p.endsWith('.jsonl') && (!best || st.mtimeMs > best.mtime)) {
      best = { file: p, mtime: st.mtimeMs };
    }
  }
  return best ? best.file : null;
}

function parseSession(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch { return { outputTokens: 0, cacheReadTokens: 0, turns: 0, model: null, messages: [] }; }

  let outputTokens = 0;
  let cacheReadTokens = 0;
  let turns = 0;
  let model = null;
  const messages = []; // per-message {ts, outputTokens} for mode attribution (#601)
  // A single API response can land in the transcript as several JSONL lines
  // sharing one message id (one per content block, or streamed continuations).
  // Each such line repeats the full usage object, so naive per-line summing
  // inflates output tokens AND turns ~2x on tool-heavy sessions (#793). Count
  // each response once, keyed by message.id; lines without an id keep the
  // legacy per-line behavior (they are indistinguishable from distinct turns).
  // Each distinct API response counts once, keyed on (requestId, message.id)
  // to match upstream PR #794: a multi-block response lands as several JSONL
  // lines sharing one message.id (one per content block / streamed
  // continuation), but the SAME message.id under a DIFFERENT requestId is a
  // genuinely separate response and must still be counted. Lines without an id
  // keep the legacy per-line behavior (indistinguishable from distinct turns).
  const seenMessageKeys = new Set();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'assistant' || !entry.message) continue;
    const usage = entry.message.usage;
    if (!usage) continue;
    const msgId = entry.message.id;
    const requestId = typeof entry.requestId === 'string' ? entry.requestId : '';
    if (typeof msgId === 'string' && msgId !== '') {
      const key = requestId + ':' + msgId;
      if (seenMessageKeys.has(key)) continue;
      seenMessageKeys.add(key);
    }
    outputTokens    += usage.output_tokens           || 0;
    cacheReadTokens += usage.cache_read_input_tokens || 0;
    turns++;
    if (!model && entry.message.model) model = entry.message.model;
    const ts = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    messages.push({
      ts: Number.isFinite(ts) ? ts : null,
      outputTokens: usage.output_tokens || 0,
    });
  }
  return { outputTokens, cacheReadTokens, turns, model, messages };
}

// Detect *.original.md / *.md pairs left behind by caveman-compress. The
// presence of a *.original.md backup means the *.md sibling is a compressed
// memory file — every session start reads the compressed version, so the
// delta is per-session input-token savings (passive). Returns a summary or
// null if nothing was found in the given dirs.
function findCompressedPairs(dirs) {
  const pairs = [];
  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.original.md')) continue;
      const base = entry.name.slice(0, -'.original.md'.length);
      const originalPath = path.join(dir, entry.name);
      const compressedPath = path.join(dir, `${base}.md`);
      let oSize, cSize;
      try {
        oSize = fs.statSync(originalPath).size;
        cSize = fs.statSync(compressedPath).size;
      } catch { continue; }
      if (oSize <= cSize) continue;
      pairs.push({ name: base, dir, originalSize: oSize, compressedSize: cSize });
    }
  }
  return pairs;
}

function summarizeCompressed(pairs) {
  if (!pairs || pairs.length === 0) return null;
  const totalOriginal = pairs.reduce((s, p) => s + p.originalSize, 0);
  const totalCompressed = pairs.reduce((s, p) => s + p.compressedSize, 0);
  const bytesSaved = totalOriginal - totalCompressed;
  // English prose runs ~4 chars per token. Label result as approximate so we
  // don't make claims tighter than the method warrants.
  const tokensSaved = Math.round(bytesSaved / 4);
  return { count: pairs.length, bytesSaved, tokensSaved };
}

// ── Per-mode attribution (#601) ─────────────────────────────────────────────
// The whole session's tokens must never be credited to whatever mode the flag
// happens to hold at stats time — a mid-session mode change would inflate the
// estimate (verbose tokens counted as compressed) or zero it (caveman tokens
// counted as uncompressed). The mode tracker + SessionStart hook append
// {ts, mode, prev} rows to .caveman-mode-log.jsonl on every actual transition;
// stats joins those timestamps against the session JSONL message timestamps.

// Read + validate the transition log. Returns rows sorted by ts.
//
// When sessionId is given, rows belonging to a DIFFERENT session are dropped.
// Without this the log is a machine-wide interleaving: a mode switch in window
// B lands between two of window A's messages and gets joined onto A's timeline,
// skewing A's savings estimate. Rows with no session_id predate the tagging and
// are kept — for a single-session user they are still the right answer, and
// discarding them would silently downgrade attribution to 'whole-session'.
function readModeLog(logPath, sessionId) {
  const wanted = validateSessionId(sessionId);
  const rows = [];
  for (const line of readHistory(logPath)) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== 'object' || !Number.isFinite(e.ts)) continue;
    if (wanted && e.session_id != null && e.session_id !== wanted) continue;
    const norm = (v) => (v == null ? null : (VALID_MODES.includes(String(v)) ? String(v) : undefined));
    const mode = norm(e.mode);
    const prev = norm(e.prev);
    if (mode === undefined || prev === undefined) continue; // reject non-whitelisted values
    rows.push({ ts: e.ts, mode, prev });
  }
  rows.sort((a, b) => a.ts - b.ts);
  return rows;
}

// Attribute each message's output tokens to the mode active when it was
// generated. Sources, most to least exact:
//   'log'           — the transition log covers the message (rows at/before its
//                     ts, or the first row's `prev` for the pre-inception span).
//   'flag-mtime'    — no log rows, but the flag was written mid-session: tokens
//                     from the write onward belong to the current mode; earlier
//                     tokens have UNKNOWN mode and are excluded, never guessed
//                     (no-fake-savings). Messages without timestamps are also
//                     unknown in this case.
//   'whole-session' — no log and no evidence of a mid-session change: the
//                     current mode covers the whole session (correct when the
//                     mode never changed; pre-#601 behavior).
// Returns { byMode: {modeKey: tokens}, unknownTokens, basis } where modeKey is
// a mode string or 'none' (caveman inactive).
function attributeByMode({ messages, modeLog, mode, flagMtimeMs, outputTokens }) {
  const currentKey = mode || 'none';
  const msgs = messages || [];
  let firstTs = null;
  for (const m of msgs) {
    if (m.ts != null && (firstTs === null || m.ts < firstTs)) firstTs = m.ts;
  }

  let events = modeLog || [];
  let basis = 'log';
  let prefixMode; // mode for messages before the first event (undefined = unknown)
  if (events.length === 0) {
    if (flagMtimeMs != null && firstTs != null && flagMtimeMs > firstTs) {
      // Flag written mid-session with no transition log: only the span from
      // the write onward is attributable. The write may have been a
      // reaffirmation of the same mode, but assuming so would guess savings
      // into existence — exclude the prefix instead.
      events = [{ ts: flagMtimeMs, mode: mode || null }];
      basis = 'flag-mtime';
      prefixMode = undefined;
    } else {
      return { byMode: { [currentKey]: outputTokens || 0 }, unknownTokens: 0, basis: 'whole-session' };
    }
  } else {
    // Every transition since log inception is recorded, so the span before
    // the first row ran under that row's `prev` mode.
    prefixMode = events[0].prev;
  }

  const byMode = {};
  let unknownTokens = 0;
  const add = (key, tokens) => { byMode[key] = (byMode[key] || 0) + tokens; };
  for (const m of msgs) {
    if (m.ts == null) { unknownTokens += m.outputTokens; continue; }
    let active;
    for (const ev of events) {
      if (ev.ts <= m.ts) active = ev;
      else break;
    }
    if (active !== undefined) add(active.mode || 'none', m.outputTokens);
    else if (prefixMode !== undefined) add(prefixMode || 'none', m.outputTokens);
    else unknownTokens += m.outputTokens;
  }
  return { byMode, unknownTokens, basis };
}

// Attribution shape for callers without a session log to join against
// (kept for formatStats/formatShare backward compatibility in tests).
function wholeSessionAttribution(mode, outputTokens) {
  return { byMode: { [mode || 'none']: outputTokens || 0 }, unknownTokens: 0, basis: 'whole-session' };
}

// Compute the savings figures we want to log/share for one session snapshot.
// Sums per-mode: only spans whose mode has benchmark data earn an estimate;
// unknown spans earn nothing.
function deriveSavings({ byMode, model }) {
  let estSavedTokens = 0;
  for (const [key, tokens] of Object.entries(byMode || {})) {
    const ratio = COMPRESSION[key];
    if (ratio == null || tokens <= 0) continue;
    estSavedTokens += Math.round(tokens / (1 - ratio)) - tokens;
  }
  const price = priceForModel(model);
  const estSavedUsd = price !== null ? (estSavedTokens / 1_000_000) * price : 0;
  return { estSavedTokens, estSavedUsd };
}

// Net token effect = output tokens saved minus the input tokens the rules
// cost. Savings are OUTPUT tokens, overhead is INPUT tokens — different
// buckets, but summing them is the only honest whole-budget delta (see
// docs/HONEST-NUMBERS.md). Never called with an unattributed savings figure —
// callers only invoke this where mode attribution and turn counts both exist.
function deriveNet({ estSavedTokens, turns }) {
  const overheadTokens = Math.max(0, turns || 0) * ruleOverheadPerTurn();
  return { overheadTokens, netTokens: (estSavedTokens || 0) - overheadTokens };
}

// Shared "rule overhead" + "net" lines for the session and lifetime views.
function netLines({ estSavedTokens, turns }) {
  const perTurn = ruleOverheadPerTurn();
  const { overheadTokens, netTokens } = deriveNet({ estSavedTokens, turns });
  const overhead = `Est. rule overhead:    ${fmt(overheadTokens)} ` +
    `(input, ~${fmt(perTurn)}/turn over ${turns} turn${turns === 1 ? '' : 's'})`;
  const net = netTokens >= 0
    ? `Est. net:              +${fmt(netTokens)} (net saving after rule overhead)`
    : `Est. net:              ${fmt(netTokens)} (caveman cost more than it saved for this workload — consider turning it off)`;
  return `${overhead}\n${net}`;
}

// Parse "7d", "12h" etc. to milliseconds. Returns null on invalid input.
function parseDuration(spec) {
  if (!spec) return null;
  const m = /^(\d+)([dh])$/.exec(spec.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return m[2] === 'd' ? n * 86_400_000 : n * 3_600_000;
}

// ── Incremental lifetime aggregation ─────────────────────────────────────
// The history file (.caveman-history.jsonl) is append-only and grows without
// bound — a row is written on every /caveman-stats run, not per session. Naively
// re-reading and re-parsing the WHOLE file on every stats call under the hook's
// fixed 2.5s child watchdog eventually guarantees a timeout: once history
// clearly exceeds the per-run budget, stats silently dies, the statusline
// suffix stops updating, and no code trims the file to recover.
//   Fix: an incremental, watermark-backed aggregation. A sidecar summary keeps
// the latest-per-session entries; each run parses ONLY the bytes appended since
// the last watermark and merges them in. The cost of a stats call is therefore
// bounded by what was written since the previous call (usually a few lines),
// not by total history length.
const MAX_INCREMENTAL_BYTES = 8 * 1024 * 1024;

// Symlink-safe byte-slice read (mirrors readHistory's safety contract). Returns
// { entries, watermark } where entries are the parsed JSON objects from the
// complete lines in [from, to) and watermark is the byte offset of the first
// complete line after them (a partial trailing line is left for the next run).
function readHistorySlice(filePath, from, to) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return { entries: [], watermark: from };
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | O_NOFOLLOW);
    try {
      const end = Math.min(to, st.size);
      if (end <= from) return { entries: [], watermark: from };
      const buf = Buffer.alloc(end - from);
      const n = fs.readSync(fd, buf, 0, buf.length, from);
      const data = buf.slice(0, n);
      const nl = data.lastIndexOf('\n');
      // No newline: the slice is a partial line (concurrent append, crash mid-
      // write). Do not advance — that data may still be coming.
      if (nl === -1) return { entries: [], watermark: from };
      const newWatermark = from + nl + 1;
      const entries = [];
      for (const line of data.slice(0, nl + 1).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch (e) { /* skip malformed */ }
      }
      return { entries, watermark: newWatermark };
    } finally { fs.closeSync(fd); }
  } catch (e) {
    return { entries: [], watermark: from };
  }
}

function loadHistorySummary(path) {
  try {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (data && data.version === 1 && typeof data.watermark === 'number'
        && data.entries && typeof data.entries === 'object') return data;
  } catch (e) { /* corrupt or missing — callers rebuild */ }
  return null;
}

// Verify-on-write readback (mirrors compress backup-readback discipline): write to
// a temp file, read it back, and only rename into place when the round-trip is
// byte-lossless. A corrupt sidecar must never be installed silently — every run
// after the revert is a safe full rebuild, never a subtly-wrong lifetime total.
function saveHistorySummary(path, summary) {
  const tmp = path + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(summary));
    const back = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    const ok = back != null && back.version === 1
      && back.watermark === summary.watermark
      && back.entries && typeof back.entries === 'object'
      && JSON.stringify(back.entries) === JSON.stringify(summary.entries);
    if (!ok) { fs.unlinkSync(tmp); return false; }
    fs.renameSync(tmp, path);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (x) {}
    return false;
  }
}

// Persist an updated lifetime summary safely even when two /caveman-stats runs
// race the same history file. The rename is atomic (last-writer-wins) but a
// plain read-modify-write can drop the other run's increments if its slice is
// folded into an older summary. So before committing, fold in any summary that
// is already AHEAD of the one we built (a concurrent writer observed more
// appends), then save with verify-on-write. Bounded retries in case writers
// keep landing; on failure we simply skip persisting — the next run merges the
// whole appended delta anyway, so no increments are ever lost, only re-done.
function persistSummaryConcurrent(path, summary, maxRetries) {
  for (let attempt = 0; attempt < Math.max(1, maxRetries || 3); attempt++) {
    const onDisk = loadHistorySummary(path);
    if (onDisk && onDisk.watermark > summary.watermark) {
      // A peer already advanced past us — fold its rows in so our slice is not
      // clobbered by an older replacement.
      for (const [id, row] of Object.entries(onDisk.entries)) {
        mergeSession(summary.entries, id, row);
      }
      summary.watermark = onDisk.watermark;
    }
    if (saveHistorySummary(path, summary)) return true;
  }
  return false;
}

// Drop the latest snapshot for a session when the incoming row is newer.
// Equivalent to aggregateHistory's old latest-per-session rule.
function mergeSession(entries, id, row) {
  const prev = entries[id];
  if (!prev || (row.ts || 0) >= (prev.ts || 0)) entries[id] = row;
  return entries;
}

// The rows stored per session are exactly the fields aggregation reads, so a
// merged summary entry stays small and cheap to round-trip through JSON.
function toRow(e) {
  return {
    ts: e.ts || 0,
    output_tokens: e.output_tokens || 0,
    est_saved_tokens: e.est_saved_tokens || 0,
    est_saved_usd: e.est_saved_usd || 0,
    turns: e.turns == null ? undefined : e.turns,
  };
}

// Aggregate history into latest-per-session totals, optionally filtered to a
// time window. Returns { sessions, outputTokens, estSavedTokens, estSavedUsd }.
function aggregateHistory(historyPath, sinceMs) {
  const cutoff = sinceMs ? Date.now() - sinceMs : null;
  const summaryPath = historyPath + '.summary.json';
  const empty = () => ({ sessions: 0, outputTokens: 0, estSavedTokens: 0, estSavedUsd: 0, netSavedTokens: 0, netTurns: 0 });

  let st;
  try { st = fs.lstatSync(historyPath); } catch (e) { st = null; }
  if (!st || st.isSymbolicLink() || !st.isFile()) {
    // No usable history: drop a stale sidecar so a later recreation starts clean
    // and never serves numbers from a previous lifetime.
    try { fs.unlinkSync(summaryPath); } catch (e) {}
    return empty();
  }

  let summary = loadHistorySummary(summaryPath);
  const fullSize = st.size;
  const gapTooBig = summary != null && (fullSize - summary.watermark) > MAX_INCREMENTAL_BYTES;
  if (!summary || summary.watermark > fullSize || gapTooBig) {
    // First run, sidecar corrupt, the history was truncated/rotated, or the gap
    // since the last run is pathological — one full rebuild.
    const entries = {};
    for (const line of readHistory(historyPath)) {
      let e; try { e = JSON.parse(line); } catch (x) { continue; }
      if (!e || typeof e !== 'object') continue;
      mergeSession(entries, e.session_id || '_', toRow(e));
    }
    // Full rebuild: a fresh summary from the current (possibly rotated/truncated)
    // history. A plain verify-on-write — no peer folding: an on-disk summary from
    // BEFORE the rotation is stale (it spans rows that no longer exist), and
    // folding it in would silently resurrect sessions that were intentionally
    // rotated away.
    summary = { version: 1, watermark: fullSize, entries };
    saveHistorySummary(summaryPath, summary);
  } else {
    // Incremental: parse only the bytes appended since the last watermark.
    const slice = readHistorySlice(historyPath, summary.watermark, fullSize);
    for (const e of slice.entries) {
      if (!e || typeof e !== 'object') continue;
      mergeSession(summary.entries, e.session_id || '_', toRow(e));
    }
    summary.watermark = slice.watermark;
    // Monotonic append lineage: fold a peer summary that already advanced past
    // us so neither concurrent run's increments are dropped.
    persistSummaryConcurrent(summaryPath, summary);
  }

  // Filter the merged latest-per-session map to the requested window.
  const latestPerSession = summary.entries;
  const timeFiltered = {};
  for (const [id, row] of Object.entries(latestPerSession)) {
    if (cutoff !== null && (row.ts || 0) < cutoff) continue;
    timeFiltered[id] = row;
  }

  let outputTokens = 0, estSavedTokens = 0, estSavedUsd = 0;
  // Net (rule-overhead) figures only ever sum rows that actually logged a
  // turn count. Legacy history rows predate #145's `turns` field — folding
  // their savings into a net computed from someone else's turns would either
  // over- or under-state the overhead, so they're excluded from net entirely
  // (they still count toward the plain gross totals above, unchanged).
  let netSavedTokens = 0, netTurns = 0;
  for (const e of Object.values(timeFiltered)) {
    outputTokens   += e.output_tokens     || 0;
    estSavedTokens += e.est_saved_tokens  || 0;
    estSavedUsd    += e.est_saved_usd     || 0;
    if (e.turns != null) {
      netSavedTokens += e.est_saved_tokens || 0;
      netTurns       += e.turns            || 0;
    }
  }
  return { sessions: Object.keys(timeFiltered).length, outputTokens, estSavedTokens, estSavedUsd, netSavedTokens, netTurns };
}

// Deliberately clear lifetime tracking: rotate the history file to a dated
// backup (the numbers are the user's data, so we never hard-delete them), and
// drop the summary sidecar + statusline suffix so every counter starts clean.
// Concurrent with a stats call the rename and unlinks are each atomic — a racing
// run re-creates either file from the (rotated) history or an empty summary.
// Returns a short human summary of what was cleaned up.
function resetLifetime(historyPath) {
  const claudeDir = path.dirname(historyPath);
  const summaryPath = historyPath + '.summary.json';
  const suffixPath = path.join(claudeDir, '.caveman-statusline-suffix');
  const done = [];

  if (fs.existsSync(historyPath)) {
    const bak = historyPath + '.reset-' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak';
    try { fs.renameSync(historyPath, bak); done.push('.caveman-history.jsonl → ' + path.basename(bak)); } catch (e) { /* leave; report below */ }
  }
  for (const p of [summaryPath, suffixPath]) {
    try { if (fs.existsSync(p)) { fs.unlinkSync(p); done.push(path.basename(p)); } } catch (e) { /* best-effort */ }
  }
  if (done.length === 0) return 'No lifetime stats found — nothing to reset.';
  return 'Reset lifetime stats. Archived: ' + done.join(', ') + '.';
}

// Output-reduction share: saved / (saved + used) = the fraction of the
// would-be OUTPUT tokens that caveman avoided. That is the only ratio we can
// honestly compute from output counts alone. It is NOT a share of session or
// limit usage — input + cache tokens dominate agentic sessions, count against
// Pro/Max limits, and are not reduced by caveman, so real limit relief is far
// smaller (docs/HONEST-NUMBERS.md: session-level totals land ~14–21%, below
// zero on terse workloads). Never label this "usage" or "budget". Returns a
// rounded percent, or null when there is nothing measured to divide.
function outputReductionPct(savedTokens, usedTokens) {
  if (!Number.isFinite(savedTokens) || !Number.isFinite(usedTokens)) return null;
  if (savedTokens <= 0 || usedTokens < 0) return null;
  const total = savedTokens + usedTokens;
  if (total <= 0) return null;
  return Math.round((savedTokens / total) * 100);
}

function humanizeTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function formatHistory({ sessions, outputTokens, estSavedTokens, estSavedUsd, netSavedTokens, netTurns, since }) {
  const sep = '──────────────────────────────────';
  const window = since ? ` (last ${since})` : '';
  if (sessions === 0) {
    return `\nCaveman Stats — Lifetime${window}\n${sep}\nNo sessions logged yet — run /caveman-stats inside any session to start tracking.\n${sep}\n`;
  }
  const usdLine = estSavedUsd > 0 ? `Est. saved (USD):      ~${formatUsd(estSavedUsd)}\n` : '';
  const pct = outputReductionPct(estSavedTokens, outputTokens);
  const budgetLine = pct !== null
    ? `Est. output reduction: ~${pct}% (output tokens only, est.)\n`
    : '';
  // Only sessions that logged a turn count feed the net figure (older rows
  // predate #145) — omit rather than understate the overhead.
  const netBlock = netTurns > 0 ? netLines({ estSavedTokens: netSavedTokens, turns: netTurns }) + '\n' : '';
  return `\nCaveman Stats — Lifetime${window}\n${sep}\n` +
    `Sessions:   ${fmt(sessions)}\n${sep}\n` +
    `Output tokens:         ${fmt(outputTokens)}\n` +
    `Est. tokens saved:     ${fmt(estSavedTokens)}\n` +
    netBlock + budgetLine + usdLine + sep + '\n';
}

// Single-line tweetable summary. Stays human-friendly when no ratio is known.
// Savings come from per-mode attribution (#601) so a mid-session mode change
// never inflates the shared number.
function formatShare({ outputTokens, turns, mode, model, attribution }) {
  if (turns === 0) {
    return '🪨 caveman armed but no turns yet — caveman.sh';
  }
  const attr = attribution || wholeSessionAttribution(mode, outputTokens);
  const { estSavedTokens, estSavedUsd } = deriveSavings({ byMode: attr.byMode, model });

  if (estSavedTokens > 0) {
    const usd = estSavedUsd > 0 ? ` (~${formatUsd(estSavedUsd)})` : '';
    return `🪨 Saved ${fmt(estSavedTokens)} output tokens${usd} across ${turns} turns this session — caveman.sh`;
  }
  return `🪨 ${turns} turns, ${fmt(outputTokens)} output tokens this session — caveman.sh`;
}

// Pure formatter — separated from main() so tests can pass synthetic inputs.
// `attribution` (from attributeByMode, #601) splits output tokens per mode;
// when omitted, the current mode is assumed for the whole session.
function formatStats({ outputTokens, cacheReadTokens, turns, mode, model, sessionPath, compressed, attribution }) {
  const sep = '──────────────────────────────────';
  const shortPath = sessionPath && sessionPath.length > 45
    ? '...' + sessionPath.slice(-45)
    : (sessionPath || '');

  if (turns === 0) {
    return `\nCaveman Stats\n${sep}\nNo conversation yet — stats available after first response.\n${sep}\n`;
  }

  const attr = attribution || wholeSessionAttribution(mode, outputTokens);
  const activeKeys = Object.keys(attr.byMode).filter(k => attr.byMode[k] > 0);
  // Uniform = every token ran under the CURRENT mode. Anything else — a
  // second mode, tokens under a mode the flag no longer shows, or spans we
  // could not attribute — gets the per-mode breakdown below.
  const uniform = attr.unknownTokens === 0 &&
    (activeKeys.length === 0 || (activeKeys.length === 1 && activeKeys[0] === (mode || 'none')));

  const ratio = COMPRESSION[mode] != null ? COMPRESSION[mode] : null;
  const price = priceForModel(model);

  let savings;
  let footer = '';
  if (!uniform) {
    const { estSavedTokens, estSavedUsd } = deriveSavings({ byMode: attr.byMode, model });
    const lines = [attr.basis === 'flag-mtime'
      ? 'Mode was set mid-session — only output after the change is attributed:'
      : 'Mode changed mid-session — output attributed per mode:'];
    for (const key of activeKeys) {
      const tokens = attr.byMode[key];
      const r = COMPRESSION[key];
      const label = key === 'none' ? 'caveman off' : key;
      const note = r != null
        ? `est. ${fmt(Math.round(tokens / (1 - r)) - tokens)} saved`
        : 'no benchmark estimate';
      lines.push(`  ${label}: ${fmt(tokens)} tokens (${note})`);
    }
    if (attr.unknownTokens > 0) {
      lines.push(`  unattributed: ${fmt(attr.unknownTokens)} tokens (mode unknown — excluded from estimate)`);
    }
    lines.push(`Est. tokens saved:     ${fmt(estSavedTokens)}`);
    if (estSavedUsd > 0) lines.push(`Est. saved (USD):      ~${formatUsd(estSavedUsd)}`);
    savings = lines.join('\n');

    footer = 'Savings est. from benchmarks/ (mean per-task), applied only to spans whose mode is known.';
    if (estSavedUsd > 0) footer += ` Pricing for ${model}.`;
    if (attr.basis === 'flag-mtime') {
      footer += ' Tokens before the mode change could not be attributed and are excluded rather than guessed.';
    } else if (attr.unknownTokens > 0) {
      footer += ' Unattributed tokens are excluded rather than guessed.';
    }
    footer += ' Reduction is of output tokens only; input/cache usage is unchanged.';
  } else if (ratio !== null) {
    const estNormal = Math.round(outputTokens / (1 - ratio));
    const estSaved = estNormal - outputTokens;
    let usdLine = '';
    if (price !== null) {
      const usd = (estSaved / 1_000_000) * price;
      usdLine = `Est. saved (USD):      ~${formatUsd(usd)}\n`;
      footer = `Savings est. from benchmarks/ (mean per-task). Pricing for ${model}. Actual varies by task.`;
    } else {
      footer = 'Savings est. from benchmarks/ (mean per-task). Actual varies by task.';
    }
    // No "% of your usage/budget" line here on purpose: from output tokens
    // alone the only computable ratio is the output reduction already shown
    // on the line above, and input + cache tokens (which dominate agentic
    // sessions and count against Pro/Max limits) are untouched by caveman —
    // any session-usage % would overstate real limit relief. See
    // docs/HONEST-NUMBERS.md.
    footer += ' Reduction is of output tokens only; input/cache usage is unchanged.';
    footer += ` Net subtracts the rules' est. input cost (~${fmt(ruleOverheadPerTurn())}/turn — docs/HONEST-NUMBERS.md).`;
    savings = (`Est. without caveman:  ${fmt(estNormal)}\n` +
              `Est. tokens saved:     ${fmt(estSaved)} (~${Math.round(ratio * 100)}% of output)\n` +
              usdLine).replace(/\n$/, '');
    // Net only makes sense where the savings figure above is unambiguous: a
    // single benchmarked mode ran the whole span (uniform) with a known turn
    // count. Mixed-mode or partially-unattributed spans (the !uniform branch
    // above) intentionally get no net line rather than a guessed one.
    if (turns > 0) savings += '\n' + netLines({ estSavedTokens: estSaved, turns });
  } else if (mode && mode !== 'off') {
    savings = `No savings estimate for '${mode}' mode — only 'full' has benchmark data.`;
  } else {
    savings = 'Caveman not active this session.';
  }

  let memoryLine = '';
  if (compressed && compressed.count > 0) {
    const tokensApprox = fmt(compressed.tokensSaved);
    memoryLine = `${sep}\nMemory compressed:     ${compressed.count} file${compressed.count === 1 ? '' : 's'}, ` +
      `~${tokensApprox} tokens saved per session start (approx)\n`;
  }

  return `\nCaveman Stats\n${sep}\n` +
    (shortPath ? `Session:  ${shortPath}\n` : '') +
    `Turns:    ${turns}\n${sep}\n` +
    `Output tokens:         ${fmt(outputTokens)}\n` +
    `Cache-read tokens:     ${fmt(cacheReadTokens)}\n${sep}\n` +
    `${savings}\n` +
    memoryLine +
    (footer ? footer + '\n' : '');
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--session-file');
  const sessionFileArg = i !== -1 ? args[i + 1] : null;
  const sessionIdIdx = args.indexOf('--session-id');
  const sessionIdArg = sessionIdIdx !== -1 ? args[sessionIdIdx + 1] : null;
  const share = args.includes('--share');
  const all = args.includes('--all');
  const sinceIdx = args.indexOf('--since');
  const sinceArg = sinceIdx !== -1 ? args[sinceIdx + 1] : null;

  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const historyPath = path.join(claudeDir, '.caveman-history.jsonl');

  // Explicit lifetime reset: rotate history + drop sidecar/suffix, then exit.
  if (args.includes('--reset')) {
    process.stdout.write(resetLifetime(historyPath) + '\n');
    return;
  }

  // Lifetime aggregation paths short-circuit before we need a live session.
  if (all || sinceArg) {
    const sinceMs = parseDuration(sinceArg);
    if (sinceArg && sinceMs === null) {
      process.stderr.write(`caveman-stats: --since takes Nh or Nd (e.g. 7d, 24h), got: ${sinceArg}\n`);
      process.exit(2);
    }
    const agg = aggregateHistory(historyPath, sinceMs);
    process.stdout.write(formatHistory({ ...agg, since: sinceArg || null }));
    return;
  }

  const sessionFile = sessionFileArg || findRecentSession(claudeDir);

  if (!sessionFile) {
    process.stderr.write('caveman-stats: no Claude Code session found.\n');
    process.exit(1);
  }

  const parsed = parseSession(sessionFile);

  // Session id: the hook forwards --session-id from the UserPromptSubmit
  // payload. Falling back to the transcript filename is not a guess — Claude
  // Code names transcripts by session id, which is why the lifetime history has
  // always keyed on it.
  const sessionId = validateSessionId(sessionIdArg)
    || validateSessionId(path.basename(sessionFile, '.jsonl'));

  // Read whichever layer holds this session's state, and take the mtime from
  // that same file so the 'flag-mtime' attribution fallback measures the right
  // thing. resolveActiveMode collapses a durable 'off' to null, matching the
  // pre-existing "no flag file means no mode" contract the formatters expect.
  const sessionPath = sessionActivePath(claudeDir, sessionId);
  const flagPath = (sessionPath && fs.existsSync(sessionPath))
    ? sessionPath
    : legacyFlagPath(claudeDir);
  const mode = resolveActiveMode(claudeDir, sessionId);

  // #601: attribute tokens to the mode active when each message happened,
  // via the transition log the hooks maintain (fallbacks documented on
  // attributeByMode). Never credit the whole session to the current flag.
  let flagMtimeMs = null;
  try { flagMtimeMs = fs.statSync(flagPath).mtimeMs; } catch (e) {}
  const modeLog = readModeLog(path.join(claudeDir, MODE_LOG_BASENAME), sessionId);
  const attribution = attributeByMode({
    messages: parsed.messages,
    modeLog,
    mode,
    flagMtimeMs,
    outputTokens: parsed.outputTokens,
  });

  // Append a snapshot of this session's totals to the lifetime log. Multiple
  // /caveman-stats calls in one session emit multiple lines for the same
  // session_id; aggregateHistory keeps only the latest per session_id.
  if (parsed.turns > 0) {
    const { estSavedTokens, estSavedUsd } = deriveSavings({ byMode: attribution.byMode, model: parsed.model });
    appendFlag(historyPath, JSON.stringify({
      ts: Date.now(),
      session_id: sessionId || path.basename(sessionFile, '.jsonl'),
      mode: mode || null,
      model: parsed.model || null,
      output_tokens: parsed.outputTokens,
      turns: parsed.turns,
      est_saved_tokens: estSavedTokens,
      est_saved_usd: estSavedUsd,
    }));

    // Statusline suffix: tiny pre-rendered string the shell statusline can
    // cat without parsing JSONL. Updated on every /caveman-stats run.
    // Routed through safeWriteFlag — the suffix path is predictable and
    // user-owned, same symlink-clobber surface as the .caveman-active flag.
    const agg = aggregateHistory(historyPath, null);
    const suffix = agg.estSavedTokens > 0 ? `⛏  ${humanizeTokens(agg.estSavedTokens)}` : '';
    safeWriteFlag(path.join(claudeDir, '.caveman-statusline-suffix'), suffix);
  }

  if (share) {
    process.stdout.write(formatShare({ ...parsed, mode, attribution }) + '\n');
  } else {
    const scanDirs = [claudeDir, process.cwd()].filter((d, i, a) => a.indexOf(d) === i);
    const compressed = summarizeCompressed(findCompressedPairs(scanDirs));
    process.stdout.write(formatStats({ ...parsed, mode, sessionPath: sessionFile, compressed, attribution }));
  }
}

if (require.main === module) main();  module.exports = {
  formatStats, formatShare, formatHistory, aggregateHistory, resetLifetime, persistSummaryConcurrent,
  parseDuration, deriveSavings,
  deriveNet, ruleOverheadPerTurn, parseSession, priceForModel, formatUsd, COMPRESSION,
  MODEL_OUTPUT_PRICE_PER_M, findCompressedPairs, summarizeCompressed, humanizeTokens,
  outputReductionPct, readModeLog, attributeByMode,
};
