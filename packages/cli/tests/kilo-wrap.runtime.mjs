import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "index.js");
const { PROFILES } = await import(pathToFileURL(join(here, "..", "dist", "agents.generated.js")).href);
const { buildWrapEnv } = await import(`${pathToFileURL(cli).href}?kilo-wrap`);
const kilo = PROFILES.find((profile) => profile.id === "kilo");

assert.ok(kilo, "compiled registry must contain Kilo Code");

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function withEnv(patch, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function kiloMcpFixture() {
  const root = mkdtempSync(join(tmpdir(), "cave-kilo-mcp-"));
  const home = join(root, "home");
  const cavemanHome = join(root, "caveman-home");
  const configPath = join(home, ".config", "kilo", "kilo.json");
  const jsoncPath = join(home, ".config", "kilo", "kilo.jsonc");
  const markerPath = join(cavemanHome, "mcp", "kilo.json");
  const mcpV1 = join(root, "caveman-mcp-v1");
  const mcpV2 = join(root, "caveman-mcp-v2");
  mkdirSync(dirname(configPath), { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    CAVEMAN_HOME: cavemanHome,
    CAVEMAN_MCP_BIN: mcpV1,
    NO_COLOR: "1",
  };
  return {
    root,
    configPath,
    jsoncPath,
    markerPath,
    mcpV1,
    mcpV2,
    env,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

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

test("Kilo MCP install is idempotent, marker-owned, upgradeable, and reversible", async () => {
  const fx = kiloMcpFixture();
  try {
    const sibling = { type: "remote", url: "https://mcp.example.test" };
    writeFileSync(fx.configPath, JSON.stringify({ theme: "dark", mcp: { sibling } }, null, 2) + "\n");

    const installed = await runCli(["mcp", "install", "kilo"], fx.env);
    assert.equal(installed.code, 0, installed.stderr);
    const firstBytes = readFileSync(fx.configPath, "utf8");
    const first = JSON.parse(firstBytes);
    assert.equal(first.theme, "dark");
    assert.deepEqual(first.mcp.sibling, sibling);
    assert.deepEqual(first.mcp.caveman, { type: "local", command: [fx.mcpV1], enabled: true });
    assert.deepEqual(JSON.parse(readFileSync(fx.markerPath, "utf8")), {
      tool: "caveman_retrieve",
      command: fx.mcpV1,
      args: [],
    });
    withEnv({ HOME: fx.env.HOME, CAVEMAN_HOME: fx.env.CAVEMAN_HOME }, () => {
      const config = JSON.parse(buildWrapEnv(kilo, "http://127.0.0.1:8787", "marker-only").KILO_CONFIG_CONTENT);
      assert.deepEqual(config.mcp.caveman, { type: "local", command: [fx.mcpV1], enabled: true });
    });

    const repeated = await runCli(["mcp", "install", "kilo"], fx.env);
    assert.equal(repeated.code, 0, repeated.stderr);
    assert.equal(readFileSync(fx.configPath, "utf8"), firstBytes);

    const upgraded = await runCli(["mcp", "install", "kilo"], { ...fx.env, CAVEMAN_MCP_BIN: fx.mcpV2 });
    assert.equal(upgraded.code, 0, upgraded.stderr);
    assert.deepEqual(JSON.parse(readFileSync(fx.configPath, "utf8")).mcp.caveman, {
      type: "local",
      command: [fx.mcpV2],
      enabled: true,
    });
    assert.equal(JSON.parse(readFileSync(fx.markerPath, "utf8")).command, fx.mcpV2);

    const removed = await runCli(["mcp", "uninstall", "kilo"], fx.env);
    assert.equal(removed.code, 0, removed.stderr);
    const final = JSON.parse(readFileSync(fx.configPath, "utf8"));
    assert.equal(final.theme, "dark");
    assert.deepEqual(final.mcp, { sibling });
    assert.equal(existsSync(fx.markerPath), false);
  } finally {
    fx.cleanup();
  }
});

test("Kilo MCP refuses conflicting unowned entries", async () => {
  const fx = kiloMcpFixture();
  try {
    const source = JSON.stringify({
      theme: "dark",
      mcp: { caveman: { type: "local", command: ["user-owned-mcp"], enabled: true } },
    }, null, 2) + "\n";
    writeFileSync(fx.configPath, source);

    const installed = await runCli(["mcp", "install", "kilo"], fx.env);
    assert.equal(installed.code, 0, installed.stderr);
    assert.match(installed.stderr, /not Caveman-journaled; refusing overwrite/);
    assert.equal(readFileSync(fx.configPath, "utf8"), source);
    assert.equal(existsSync(fx.markerPath), false);

    const removed = await runCli(["mcp", "uninstall", "kilo"], fx.env);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stderr, /not Caveman-journaled; refusing removal/);
    assert.equal(readFileSync(fx.configPath, "utf8"), source);
  } finally {
    fx.cleanup();
  }
});

test("Kilo MCP refuses user-modified owned entries and keeps marker", async () => {
  const fx = kiloMcpFixture();
  try {
    const installed = await runCli(["mcp", "install", "kilo"], fx.env);
    assert.equal(installed.code, 0, installed.stderr);
    const config = JSON.parse(readFileSync(fx.configPath, "utf8"));
    config.mcp.caveman.command = ["user-modified-mcp"];
    const modified = JSON.stringify(config, null, 2) + "\n";
    writeFileSync(fx.configPath, modified);

    const removed = await runCli(["mcp", "uninstall", "kilo"], fx.env);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stderr, /changed since Caveman installed it; refusing removal/);
    assert.equal(readFileSync(fx.configPath, "utf8"), modified);
    assert.equal(existsSync(fx.markerPath), true);
    withEnv({ HOME: fx.env.HOME, CAVEMAN_HOME: fx.env.CAVEMAN_HOME }, () => {
      const config = JSON.parse(buildWrapEnv(kilo).KILO_CONFIG_CONTENT);
      assert.equal(config.mcp?.caveman, undefined, "changed native entry must invalidate stale marker");
    });
  } finally {
    fx.cleanup();
  }
});

test("Kilo wrap rejects deleted registrations and malformed ownership journals", async (t) => {
  for (const mutation of ["deleted registration", "wrong marker tool", "extra marker field", "blank marker command"]) {
    await t.test(mutation, async () => {
      const fx = kiloMcpFixture();
      try {
        const installed = await runCli(["mcp", "install", "kilo"], fx.env);
        assert.equal(installed.code, 0, installed.stderr);
        if (mutation === "deleted registration") {
          writeFileSync(fx.configPath, "{}\n");
        } else {
          const marker = JSON.parse(readFileSync(fx.markerPath, "utf8"));
          if (mutation === "wrong marker tool") marker.tool = "different_tool";
          if (mutation === "extra marker field") marker.untrusted = true;
          if (mutation === "blank marker command") marker.command = " \t";
          writeFileSync(fx.markerPath, JSON.stringify(marker, null, 2) + "\n");
        }
        withEnv({ HOME: fx.env.HOME, CAVEMAN_HOME: fx.env.CAVEMAN_HOME }, () => {
          const config = JSON.parse(buildWrapEnv(kilo).KILO_CONFIG_CONTENT);
          assert.equal(config.mcp?.caveman, undefined);
        });
      } finally {
        fx.cleanup();
      }
    });
  }
});

test("Kilo MCP refuses malformed JSON and non-object mcp", async (t) => {
  await t.test("empty existing file", async () => {
    const fx = kiloMcpFixture();
    try {
      writeFileSync(fx.configPath, "");
      const installed = await runCli(["mcp", "install", "kilo"], fx.env);
      assert.equal(installed.code, 0, installed.stderr);
      assert.match(installed.stderr, /kilo\.json is empty; not modifying it/);
      assert.equal(readFileSync(fx.configPath, "utf8"), "");
      assert.equal(existsSync(fx.markerPath), false);
    } finally {
      fx.cleanup();
    }
  });

  await t.test("malformed JSON", async () => {
    const fx = kiloMcpFixture();
    try {
      const source = "{not-json\n";
      writeFileSync(fx.configPath, source);
      const installed = await runCli(["mcp", "install", "kilo"], fx.env);
      assert.equal(installed.code, 0, installed.stderr);
      assert.match(installed.stderr, /cannot read .*kilo\.json/);
      assert.equal(readFileSync(fx.configPath, "utf8"), source);
      assert.equal(existsSync(fx.markerPath), false);
    } finally {
      fx.cleanup();
    }
  });

  await t.test("non-object mcp", async () => {
    const fx = kiloMcpFixture();
    try {
      const source = JSON.stringify({ theme: "dark", mcp: [] }, null, 2) + "\n";
      writeFileSync(fx.configPath, source);
      const installed = await runCli(["mcp", "install", "kilo"], fx.env);
      assert.equal(installed.code, 0, installed.stderr);
      assert.match(installed.stderr, /mcp must be a JSON object; not modifying it/);
      assert.equal(readFileSync(fx.configPath, "utf8"), source);
      assert.equal(existsSync(fx.markerPath), false);
    } finally {
      fx.cleanup();
    }
  });
});

test("Kilo MCP preserves JSONC when kilo.json is absent", async () => {
  const fx = kiloMcpFixture();
  try {
    const source = "{\n  // user Kilo config\n  \"theme\": \"dark\"\n}\n";
    writeFileSync(fx.jsoncPath, source);
    const installed = await runCli(["mcp", "install", "kilo"], fx.env);
    assert.equal(installed.code, 0, installed.stderr);
    assert.match(installed.stderr, /refusing to create a second Kilo config or rewrite JSONC/);
    assert.equal(existsSync(fx.configPath), false);
    assert.equal(readFileSync(fx.jsoncPath, "utf8"), source);
    assert.equal(existsSync(fx.markerPath), false);

    mkdirSync(dirname(fx.markerPath), { recursive: true });
    writeFileSync(fx.markerPath, JSON.stringify({ tool: "caveman_retrieve", command: fx.mcpV1, args: [] }) + "\n");
    const removed = await runCli(["mcp", "uninstall", "kilo"], fx.env);
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stderr, /refusing to create a second Kilo config or rewrite JSONC/);
    assert.equal(readFileSync(fx.jsoncPath, "utf8"), source);
    assert.equal(existsSync(fx.markerPath), true);
  } finally {
    fx.cleanup();
  }
});
