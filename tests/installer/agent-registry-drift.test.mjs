import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reporter = join(root, "agents", "drift-report.mjs");
const registry = JSON.parse(readFileSync(join(root, "agents", "agents.json"), "utf8"));
const profile = registry.agents.find((candidate) => candidate.id === "kilo");
if (!profile) throw new Error("kilo profile missing from registry fixture");

function nextPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`test requires a plain semver profile pin, got ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function validDrift() {
  return {
    schema: "caveman.agent-probe.v1",
    results: [{
      id: profile.id,
      status: "drift",
      binary: "/tmp/kilo",
      tested: profile.tested_agent_version,
      observed: nextPatch(profile.tested_agent_version),
      version_ok: true,
      help_ok: true,
      version_matches: false,
    }],
  };
}

function runReporter(t, artifact) {
  const dir = mkdtempSync(join(tmpdir(), "caveman-drift-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, "probe.json");
  const calls = join(dir, "gh-called");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(input, JSON.stringify(artifact));
  const gh = join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GH_CALLED_FILE"\nif [ "$1 $2" = "issue list" ]; then printf '[]'; fi\n`);
  chmodSync(gh, 0o755);
  const result = spawnSync(process.execPath, [reporter, "--input", input], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH || ""}`,
      GH_CALLED_FILE: calls,
    },
  });
  return {
    ...result,
    ghCalls: existsSync(calls) ? readFileSync(calls, "utf8") : "",
  };
}

test("validated drift artifact may call gh only after validation", (t) => {
  const result = runReporter(t, validDrift());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.ghCalls, /^issue list/m);
  assert.match(result.ghCalls, /^issue create/m);
});

const invalidCases = [
  ["wrong top-level schema", () => ({ ...validDrift(), schema: "caveman.agent-probe.v2" }), /top level must contain exactly/],
  ["extra top-level field", () => ({ ...validDrift(), attacker: true }), /top level must contain exactly/],
  ["result count above registry bound", () => ({
    schema: "caveman.agent-probe.v1",
    results: Array.from({ length: registry.agents.length + 1 }, () => structuredClone(validDrift().results[0])),
  }), /results count must be between/],
  ["duplicate profile id", () => ({
    schema: "caveman.agent-probe.v1",
    results: [structuredClone(validDrift().results[0]), structuredClone(validDrift().results[0])],
  }), /duplicates profile/],
  ["unknown profile id", () => {
    const artifact = validDrift();
    artifact.results[0].id = "unknown-agent";
    return artifact;
  }, /id must name a known profile/],
  ["tested version mismatch", () => {
    const artifact = validDrift();
    artifact.results[0].tested = "0.0.1";
    return artifact;
  }, /tested must exactly equal registry tested_agent_version/],
  ["unknown status", () => {
    const artifact = validDrift();
    artifact.results[0].status = "newer";
    return artifact;
  }, /unknown status or fields outside its exact status schema/],
  ["unsafe observed version", () => {
    const artifact = validDrift();
    artifact.results[0].observed = `${artifact.results[0].observed}\n--body=forged`;
    return artifact;
  }, /observed must be empty or a strict version/],
  ["non-newer drift version", () => {
    const artifact = validDrift();
    artifact.results[0].observed = artifact.results[0].tested;
    artifact.results[0].version_matches = true;
    return artifact;
  }, /drift status requires a strict observed version newer than tested/],
  ["extra result field", () => {
    const artifact = validDrift();
    artifact.results[0].title = "forged";
    return artifact;
  }, /unknown status or fields outside its exact status schema/],
];

for (const [name, artifact, message] of invalidCases) {
  test(`invalid drift artifact cannot invoke gh: ${name}`, (t) => {
    const result = runReporter(t, artifact());
    assert.equal(result.status, 2, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.match(result.stderr, message);
    assert.equal(result.ghCalls, "", "gh must not run before full artifact validation");
  });
}
