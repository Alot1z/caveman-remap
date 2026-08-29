import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "index.js");
const { PROFILES } = await import(pathToFileURL(join(here, "..", "dist", "agents.generated.js")).href);
const { buildWrapEnv } = await import(`${pathToFileURL(cli).href}?kilo-wrap`);
const kilo = PROFILES.find((profile) => profile.id === "kilo");

assert.ok(kilo, "compiled registry must contain Kilo Code");

function runKiloAlias(invokedAs, installedBinary) {
  const root = mkdtempSync(join(tmpdir(), `cave-${invokedAs}-`));
  const home = join(root, "home");
  const binDir = join(root, "bin");
  const configDir = join(home, ".config", "kilo");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(home, ".caveman-cloud"), { recursive: true });
  mkdirSync(configDir, { recursive: true });

  const sentinel = '{"theme":"caveman-test","provider":{"custom":true}}\n';
  const userConfig = join(configDir, "kilo.json");
  writeFileSync(userConfig, sentinel);
  writeFileSync(
    join(home, ".caveman-cloud", "config.json"),
    JSON.stringify({ wrap: { proxy: false, shrink: false, mcp: false, browse: false } }),
  );
  writeFileSync(
    join(binDir, installedBinary),
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  argv: process.argv.slice(2),
  config: process.env.KILO_CONFIG_CONTENT || "",
  openaiKey: process.env.OPENAI_API_KEY || ""
}));
`,
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    HOME: home,
    CAVEMAN_HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    OPENAI_API_KEY: "sk-kilo-upstream-test",
    NO_COLOR: "1",
  };
  delete env.CAVE_GATEWAY_URL;
  delete env.CAVE_API_KEY;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, invokedAs, "run", "hello", "--model", "openai/test"], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      const userConfigAfter = readFileSync(userConfig, "utf8");
      rmSync(root, { recursive: true, force: true });
      resolve({ code, signal, stdout, stderr, userConfigAfter, sentinel });
    });
  });
}

test("Kilo profile exposes both published CLI binaries", () => {
  assert.deepEqual(kilo.binary_names, ["kilo", "kilocode"]);
  assert.equal(kilo.tested_agent_version, "7.5.6");
  assert.equal(kilo.injection.method, "config-env-content");
  assert.equal(kilo.injection.env_var, "KILO_CONFIG_CONTENT");
});

for (const binary of ["kilo", "kilocode"]) {
  test(`caveman ${binary} routes Kilo without mutating user config`, async () => {
    const out = await runKiloAlias(binary, binary);
    assert.equal(out.code, 0, `exit ${out.code}/${out.signal}: ${out.stderr}`);
    const child = JSON.parse(out.stdout);
    assert.deepEqual(child.argv, ["run", "hello", "--model", "openai/test"]);
    assert.equal(child.openaiKey, "sk-kilo-upstream-test");

    const config = JSON.parse(child.config);
    assert.equal(config.provider.caveman.options.baseURL, "http://127.0.0.1:8787/w/kilo/v1");
    assert.equal(config.provider.caveman.options.apiKey, "{env:OPENAI_API_KEY}");
    assert.equal(config.provider.caveman.options.headers["X-Cave-Agent"], "kilo");
    assert.equal(config.model, "caveman/gpt-5.5");
    assert.equal(out.userConfigAfter, out.sentinel);
  });
}

test("managed Kilo config keeps gateway and upstream credentials separate", () => {
  const previousCaveKey = process.env.CAVE_API_KEY;
  const previousOpenAIKey = process.env.OPENAI_API_KEY;
  process.env.CAVE_API_KEY = "cave_gateway_secret";
  process.env.OPENAI_API_KEY = "sk_upstream_secret";
  try {
    const env = buildWrapEnv(kilo, "https://gateway.example");
    const raw = env.KILO_CONFIG_CONTENT;
    assert.ok(raw);
    const config = JSON.parse(raw);
    const options = config.provider.caveman.options;
    assert.equal(options.baseURL, "https://gateway.example/w/kilo/v1");
    assert.equal(options.apiKey, "{env:CAVE_API_KEY}");
    assert.equal(options.headers["x-cave-upstream-key"], "{env:OPENAI_API_KEY}");
    assert.equal(options.headers["X-Cave-Agent"], "kilo");
    assert.doesNotMatch(raw, /cave_gateway_secret|sk_upstream_secret/);
  } finally {
    if (previousCaveKey === undefined) delete process.env.CAVE_API_KEY;
    else process.env.CAVE_API_KEY = previousCaveKey;
    if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAIKey;
  }
});
