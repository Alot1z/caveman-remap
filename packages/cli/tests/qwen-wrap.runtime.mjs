import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "index.js");
const { PROFILES } = await import(pathToFileURL(join(here, "..", "dist", "agents.generated.js")).href);
const { buildWrapEnv } = await import(`${pathToFileURL(cli).href}?qwen-wrap`);
const qwen = PROFILES.find((profile) => profile.id === "qwen");

assert.ok(qwen, "compiled registry must contain Qwen Code");

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

function readInjected(env) {
  const path = env.QWEN_CODE_SYSTEM_SETTINGS_PATH;
  assert.ok(path, "Qwen system settings path must be injected");
  return { path, raw: readFileSync(path, "utf8"), config: JSON.parse(readFileSync(path, "utf8")) };
}

function qwenFixture() {
  const root = mkdtempSync(join(tmpdir(), "cave-qwen-wrap-"));
  const home = join(root, "home");
  const binDir = join(root, "bin");
  const systemConfig = join(root, "enterprise-system-settings.json");
  const userConfig = join(home, ".qwen", "settings.json");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dirname(userConfig), { recursive: true });
  mkdirSync(join(home, ".caveman-cloud"), { recursive: true });

  const systemBytes = JSON.stringify({
    general: { enableAutoUpdate: false },
    security: { folderTrust: { enabled: true } },
    modelProviders: { sibling: [{ id: "sibling-model", envKey: "SIBLING_KEY" }] },
  }, null, 2) + "\n";
  const userBytes = JSON.stringify({
    security: { auth: { selectedType: "qwen-oauth" } },
    model: { name: "user-model" },
  }, null, 2) + "\n";
  writeFileSync(systemConfig, systemBytes);
  writeFileSync(userConfig, userBytes);
  writeFileSync(
    join(home, ".caveman-cloud", "config.json"),
    JSON.stringify({ wrap: { proxy: false, shrink: false, mcp: false, browse: false } }),
  );
  writeFileSync(
    join(binDir, "qwen"),
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const path = process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH || "";
process.stdout.write(JSON.stringify({
  argv: process.argv.slice(2),
  config: path ? JSON.parse(readFileSync(path, "utf8")) : null,
  openaiKey: process.env.OPENAI_API_KEY || "",
  caveKey: process.env.CAVE_API_KEY || ""
}));
`,
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    HOME: home,
    CAVEMAN_HOME: home,
    PATH: `${binDir}:${process.env.PATH}`,
    QWEN_CODE_SYSTEM_SETTINGS_PATH: systemConfig,
    OPENAI_API_KEY: "sk-qwen-upstream-test",
    NO_COLOR: "1",
  };
  delete env.CAVE_GATEWAY_URL;
  delete env.CAVE_API_KEY;
  return {
    root,
    env,
    systemConfig,
    systemBytes,
    userConfig,
    userBytes,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function qwenMcpFixture() {
  const root = mkdtempSync(join(tmpdir(), "cave-qwen-mcp-"));
  const home = join(root, "home");
  const cavemanHome = join(root, "caveman-home");
  const qwenHome = join(root, "relocated-qwen-home");
  const configPath = join(qwenHome, "settings.json");
  const systemConfigPath = join(root, "system-settings.json");
  const systemDefaultsPath = join(root, "system-defaults.json");
  const markerPath = join(cavemanHome, "mcp", "qwen.json");
  const mcpV1 = join(root, "caveman-mcp-v1");
  const mcpV2 = join(root, "caveman-mcp-v2");
  mkdirSync(dirname(configPath), { recursive: true });
  return {
    root,
    configPath,
    systemConfigPath,
    markerPath,
    mcpV1,
    mcpV2,
    env: {
      ...process.env,
      HOME: home,
      CAVEMAN_HOME: cavemanHome,
      QWEN_HOME: qwenHome,
      QWEN_CODE_SYSTEM_SETTINGS_PATH: systemConfigPath,
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: systemDefaultsPath,
      CAVEMAN_MCP_BIN: mcpV1,
      NO_COLOR: "1",
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("Qwen profile uses high-precedence system settings without static model args", () => {
  assert.deepEqual(qwen.binary_names, ["qwen"]);
  assert.deepEqual(qwen.args, []);
  assert.equal(qwen.tested_agent_version, "0.22.3");
  assert.equal(qwen.injection.method, "config-file");
  assert.equal(qwen.injection.env_var, "QWEN_CODE_SYSTEM_SETTINGS_PATH");
  assert.equal(qwen.injection.base_config.platform_default, "qwen-system-settings");
});

test("local Qwen config preserves system policy and keeps secrets out of temp JSON", () => {
  const fx = qwenFixture();
  try {
    withEnv({
      HOME: fx.env.HOME,
      CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
      QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfig,
      OPENAI_API_KEY: "sk-local-secret",
      CAVE_API_KEY: undefined,
    }, () => {
      const injected = readInjected(buildWrapEnv(qwen, "http://127.0.0.1:8787"));
      assert.notEqual(injected.path, fx.systemConfig);
      assert.equal(injected.config.general.enableAutoUpdate, false);
      assert.equal(injected.config.security.folderTrust.enabled, true);
      assert.equal(injected.config.security.auth.selectedType, "openai");
      assert.deepEqual(injected.config.modelProviders.sibling, [{ id: "sibling-model", envKey: "SIBLING_KEY" }]);
      assert.equal(injected.config.model.name, "gpt-5.5");
      assert.deepEqual(injected.config.modelProviders.openai.map((model) => model.id), ["gpt-5.5", "gpt-5.4-mini"]);
      for (const model of injected.config.modelProviders.openai) {
        assert.equal(model.envKey, "OPENAI_API_KEY");
        assert.equal(model.baseUrl, "http://127.0.0.1:8787/w/qwen/v1");
        assert.equal(model.generationConfig.customHeaders["X-Cave-Agent"], "qwen");
      }
      assert.doesNotMatch(injected.raw, /sk-local-secret/);
      assert.equal(readFileSync(fx.systemConfig, "utf8"), fx.systemBytes);
      assert.equal(readFileSync(fx.userConfig, "utf8"), fx.userBytes);
    });
  } finally {
    fx.cleanup();
  }
});

test("managed Qwen config separates gateway bearer from upstream credential", () => {
  const fx = qwenFixture();
  try {
    withEnv({
      HOME: fx.env.HOME,
      CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
      QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfig,
      CAVE_API_KEY: "cave-managed-secret",
      OPENAI_API_KEY: "sk-upstream-secret",
    }, () => {
      const injected = readInjected(buildWrapEnv(qwen, "https://gateway.example"));
      for (const model of injected.config.modelProviders.openai) {
        assert.equal(model.envKey, "CAVE_API_KEY");
        assert.equal(model.baseUrl, "https://gateway.example/w/qwen/v1");
        assert.equal(model.generationConfig.customHeaders["x-cave-upstream-key"], "$OPENAI_API_KEY");
        assert.equal(model.generationConfig.customHeaders["X-Cave-Agent"], "qwen");
      }
      assert.doesNotMatch(injected.raw, /cave-managed-secret|sk-upstream-secret/);
    });
  } finally {
    fx.cleanup();
  }
});

test("managed Qwen omits upstream header when only stored gateway credentials are available", () => {
  const fx = qwenFixture();
  try {
    const base = JSON.parse(fx.systemBytes);
    base.modelProviders.openai = [{
      id: "stale-provider",
      generationConfig: { customHeaders: { "x-cave-upstream-key": "stale-literal" } },
    }];
    writeFileSync(fx.systemConfig, JSON.stringify(base));
    for (const upstreamKey of [undefined, "  "]) {
      withEnv({
        HOME: fx.env.HOME,
        CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
        QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfig,
        CAVE_API_KEY: "cave-managed-secret",
        OPENAI_API_KEY: upstreamKey,
      }, () => {
        const injected = readInjected(buildWrapEnv(qwen, "https://gateway.example"));
        for (const model of injected.config.modelProviders.openai) {
          assert.equal(model.envKey, "CAVE_API_KEY");
          assert.equal(Object.hasOwn(model.generationConfig.customHeaders, "x-cave-upstream-key"), false);
          assert.equal(model.generationConfig.customHeaders["X-Cave-Agent"], "qwen");
        }
        assert.doesNotMatch(injected.raw, /\$OPENAI_API_KEY|cave_optional_openai_key_env|cave-managed-secret|stale-literal/);
      });
    }
  } finally {
    fx.cleanup();
  }
});

test("caveman qwen passes user args and never mutates Qwen settings", async () => {
  const fx = qwenFixture();
  try {
    const out = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "qwen", "--model", "gpt-5.4-mini", "-p", "review this"], { env: fx.env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    assert.equal(out.code, 0, `exit ${out.code}/${out.signal}: ${out.stderr}`);
    const child = JSON.parse(out.stdout);
    assert.deepEqual(child.argv, ["--model", "gpt-5.4-mini", "-p", "review this"]);
    assert.equal(child.openaiKey, "sk-qwen-upstream-test");
    assert.equal(child.caveKey, "");
    assert.equal(child.config.model.name, "gpt-5.5");
    assert.equal(child.config.modelProviders.openai[0].baseUrl, "http://127.0.0.1:8787/w/qwen/v1");
    assert.equal(readFileSync(fx.systemConfig, "utf8"), fx.systemBytes);
    assert.equal(readFileSync(fx.userConfig, "utf8"), fx.userBytes);
  } finally {
    fx.cleanup();
  }
});

test("Qwen MCP install is idempotent, marker-owned, upgradeable, and reversible", async () => {
  const fx = qwenMcpFixture();
  try {
    const sibling = { command: "sibling-mcp", args: ["serve"] };
    writeFileSync(fx.configPath, JSON.stringify({ general: { vimMode: true }, mcpServers: { sibling } }, null, 2) + "\n");

    withEnv({
      HOME: fx.env.HOME,
      CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
      QWEN_HOME: fx.env.QWEN_HOME,
      QWEN_CODE_SYSTEM_SETTINGS_PATH: join(fx.root, "missing-system-settings.json"),
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: fx.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH,
      QWEN_CODE_LEGACY_MCP_BLOCKING: "0",
    }, () => {
      assert.equal(buildWrapEnv(qwen).QWEN_CODE_LEGACY_MCP_BLOCKING, "0");
    });

    const installed = await runCli(["mcp", "install", "qwen"], fx.env);
    assert.equal(installed.code, 0, installed.stderr);
    const firstBytes = readFileSync(fx.configPath, "utf8");
    const first = JSON.parse(firstBytes);
    assert.equal(statSync(fx.configPath).mode & 0o777, 0o600);
    assert.equal(first.general.vimMode, true);
    assert.deepEqual(first.mcpServers.sibling, sibling);
    assert.deepEqual(first.mcpServers.caveman, { command: fx.mcpV1, args: [] });
    assert.deepEqual(JSON.parse(readFileSync(fx.markerPath, "utf8")), {
      tool: "caveman_retrieve",
      command: fx.mcpV1,
      args: [],
    });
    withEnv({
      HOME: fx.env.HOME,
      CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
      QWEN_HOME: fx.env.QWEN_HOME,
      QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfigPath,
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: fx.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH,
      QWEN_CODE_LEGACY_MCP_BLOCKING: "0",
    }, () => {
      const wrapped = buildWrapEnv(qwen, "http://127.0.0.1:8787", "marker-only");
      assert.equal(wrapped.QWEN_CODE_LEGACY_MCP_BLOCKING, "1");
      const config = readInjected(wrapped).config;
      assert.deepEqual(config.mcpServers.caveman, { command: fx.mcpV1, args: [] });
    });

    const repeated = await runCli(["mcp", "install", "qwen"], fx.env);
    assert.equal(repeated.code, 0, repeated.stderr);
    assert.equal(readFileSync(fx.configPath, "utf8"), firstBytes);

    const upgraded = await runCli(["mcp", "install", "qwen"], { ...fx.env, CAVEMAN_MCP_BIN: fx.mcpV2 });
    assert.equal(upgraded.code, 0, upgraded.stderr);
    assert.deepEqual(JSON.parse(readFileSync(fx.configPath, "utf8")).mcpServers.caveman, {
      command: fx.mcpV2,
      args: [],
    });
    assert.equal(JSON.parse(readFileSync(fx.markerPath, "utf8")).command, fx.mcpV2);

    const removed = await runCli(["mcp", "uninstall", "qwen"], fx.env);
    assert.equal(removed.code, 0, removed.stderr);
    const final = JSON.parse(readFileSync(fx.configPath, "utf8"));
    assert.equal(final.general.vimMode, true);
    assert.deepEqual(final.mcpServers, { sibling });
    assert.equal(existsSync(fx.markerPath), false);
  } finally {
    fx.cleanup();
  }
});

test("Qwen MCP refuses conflicting or user-modified entries", async (t) => {
  await t.test("unowned conflict", async () => {
    const fx = qwenMcpFixture();
    try {
      const source = JSON.stringify({
        mcpServers: { caveman: { command: "user-owned-mcp", args: [] } },
      }, null, 2) + "\n";
      writeFileSync(fx.configPath, source);
      const installed = await runCli(["mcp", "install", "qwen"], fx.env);
      assert.equal(installed.code, 0, installed.stderr);
      assert.match(installed.stderr, /not Caveman-journaled; refusing overwrite/);
      assert.equal(readFileSync(fx.configPath, "utf8"), source);
      assert.equal(existsSync(fx.markerPath), false);

      const removed = await runCli(["mcp", "uninstall", "qwen"], fx.env);
      assert.equal(removed.code, 0, removed.stderr);
      assert.match(removed.stderr, /not Caveman-journaled; refusing removal/);
      assert.equal(readFileSync(fx.configPath, "utf8"), source);
    } finally {
      fx.cleanup();
    }
  });

  await t.test("owned entry changed by user", async () => {
    const fx = qwenMcpFixture();
    try {
      const installed = await runCli(["mcp", "install", "qwen"], fx.env);
      assert.equal(installed.code, 0, installed.stderr);
      const config = JSON.parse(readFileSync(fx.configPath, "utf8"));
      config.mcpServers.caveman.command = "user-modified-mcp";
      const modified = JSON.stringify(config, null, 2) + "\n";
      writeFileSync(fx.configPath, modified);

      const removed = await runCli(["mcp", "uninstall", "qwen"], fx.env);
      assert.equal(removed.code, 0, removed.stderr);
      assert.match(removed.stderr, /changed since Caveman installed it; refusing removal/);
      assert.equal(readFileSync(fx.configPath, "utf8"), modified);
      assert.equal(existsSync(fx.markerPath), true);
      withEnv({
        HOME: fx.env.HOME,
        CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
        QWEN_HOME: fx.env.QWEN_HOME,
        QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfigPath,
        QWEN_CODE_SYSTEM_DEFAULTS_PATH: fx.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH,
        QWEN_CODE_LEGACY_MCP_BLOCKING: "0",
      }, () => {
        const wrapped = buildWrapEnv(qwen);
        assert.equal(wrapped.QWEN_CODE_LEGACY_MCP_BLOCKING, "0");
        const effective = readInjected(wrapped).config;
        assert.equal(effective.mcpServers?.caveman, undefined);
        assert.ok(effective.mcp.excluded.includes("caveman"));
      });
    } finally {
      fx.cleanup();
    }
  });
});

test("Qwen wrap fails closed for stale, shadowed, filtered, and CLI-replaced MCP registrations", async (t) => {
  const cases = [
    {
      name: "deleted native entry",
      mutate: (fx) => writeFileSync(fx.configPath, "{}\n"),
    },
    {
      name: "wrong marker tool",
      mutate: (fx) => {
        const marker = JSON.parse(readFileSync(fx.markerPath, "utf8"));
        marker.tool = "different_tool";
        writeFileSync(fx.markerPath, JSON.stringify(marker, null, 2) + "\n");
      },
    },
    {
      name: "enterprise server shadow",
      mutate: (fx) => writeFileSync(fx.systemConfigPath, JSON.stringify({
        mcpServers: { caveman: { command: "enterprise-owned", args: [] } },
      })),
    },
    {
      name: "enterprise exclusion",
      mutate: (fx) => writeFileSync(fx.systemConfigPath, JSON.stringify({ mcp: { excluded: ["cave*"] } })),
    },
    {
      name: "enterprise allowlist omission",
      mutate: (fx) => writeFileSync(fx.systemConfigPath, JSON.stringify({ mcp: { allowed: ["approved-only"] } })),
    },
    {
      name: "enterprise permission denial",
      mutate: (fx) => writeFileSync(fx.systemConfigPath, JSON.stringify({ permissions: { deny: ["mcp__caveman"] } })),
    },
    {
      name: "enterprise empty-call permission denial",
      mutate: (fx) => writeFileSync(fx.systemConfigPath, JSON.stringify({ permissions: { deny: ["mcp__caveman__caveman_retrieve()"] } })),
    },
    {
      name: "enterprise wildcard permission denial",
      mutate: (fx) => writeFileSync(fx.systemConfigPath, JSON.stringify({ permissions: { deny: ["mcp__cave*"] } })),
    },
    {
      name: "enterprise disabled tool",
      mutate: (fx) => writeFileSync(fx.systemConfigPath, JSON.stringify({ tools: { disabled: ["mcp__caveman__caveman_retrieve"] } })),
    },
    {
      name: "unresolved enterprise deny variable",
      mutate: (fx) => writeFileSync(fx.systemConfigPath, JSON.stringify({ permissions: { deny: ["$QWEN_DENY_RECOVERY"] } })),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const fx = qwenMcpFixture();
      try {
        const installed = await runCli(["mcp", "install", "qwen"], fx.env);
        assert.equal(installed.code, 0, installed.stderr);
        fixture.mutate(fx);
        withEnv({
          HOME: fx.env.HOME,
          CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
          QWEN_HOME: fx.env.QWEN_HOME,
          QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfigPath,
          QWEN_CODE_SYSTEM_DEFAULTS_PATH: fx.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH,
          QWEN_CODE_LEGACY_MCP_BLOCKING: "0",
          QWEN_CODE_SAFE_MODE: undefined,
          QWEN_CODE_SIMPLE: undefined,
          QWEN_DENY_RECOVERY: undefined,
        }, () => {
          const wrapped = buildWrapEnv(qwen);
          assert.equal(wrapped.QWEN_CODE_LEGACY_MCP_BLOCKING, "0");
          const effective = readInjected(wrapped).config;
          assert.notDeepEqual(effective.mcpServers?.caveman, { command: fx.mcpV1, args: [] });
          assert.ok(effective.mcp.excluded.includes("caveman"));
        });
      } finally {
        fx.cleanup();
      }
    });
  }

  for (const blocked of [
    { name: "CLI MCP replacement", args: ["--mcp-config", "replacement.json"] },
    { name: "CLI excluded tool", args: ["--exclude-tools", "mcp__cave*"] },
    { name: "CLI excluded tool equals form", args: ["--exclude-tools=mcp*"] },
    { name: "CLI bare mode", args: ["--bare=true"] },
    { name: "bare-mode environment", args: [], env: { QWEN_CODE_SIMPLE: "on" } },
  ]) {
    await t.test(blocked.name, async () => {
      const fx = qwenMcpFixture();
      try {
        const installed = await runCli(["mcp", "install", "qwen"], fx.env);
        assert.equal(installed.code, 0, installed.stderr);
        withEnv({
          HOME: fx.env.HOME,
          CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
          QWEN_HOME: fx.env.QWEN_HOME,
          QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfigPath,
          QWEN_CODE_SYSTEM_DEFAULTS_PATH: fx.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH,
          QWEN_CODE_LEGACY_MCP_BLOCKING: "0",
          QWEN_CODE_SAFE_MODE: undefined,
          QWEN_CODE_SIMPLE: undefined,
          ...blocked.env,
        }, () => {
          const wrapped = buildWrapEnv(qwen, "http://127.0.0.1:8787", "auto", blocked.args);
          assert.equal(wrapped.QWEN_CODE_LEGACY_MCP_BLOCKING, "0");
          const effective = readInjected(wrapped).config;
          assert.equal(effective.mcpServers?.caveman, undefined);
          assert.ok(effective.mcp.excluded.includes("caveman"));
        });
      } finally {
        fx.cleanup();
      }
    });
  }

  for (const blocked of [
    { name: "CLI safe mode", args: ["--safe-mode"] },
    { name: "safe-mode environment", args: [], env: { QWEN_CODE_SAFE_MODE: "yes" } },
    {
      name: "safe-mode settings environment",
      args: [],
      mutate: (fx) => writeFileSync(fx.systemConfigPath, JSON.stringify({ env: { QWEN_CODE_SAFE_MODE: "on" } })),
    },
  ]) {
    await t.test(blocked.name, async () => {
      const fx = qwenMcpFixture();
      try {
        const installed = await runCli(["mcp", "install", "qwen"], fx.env);
        assert.equal(installed.code, 0, installed.stderr);
        blocked.mutate?.(fx);
        withEnv({
          HOME: fx.env.HOME,
          CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
          QWEN_HOME: fx.env.QWEN_HOME,
          QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfigPath,
          QWEN_CODE_SYSTEM_DEFAULTS_PATH: fx.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH,
          QWEN_CODE_SAFE_MODE: undefined,
          ...blocked.env,
        }, () => {
          assert.throws(
            () => buildWrapEnv(qwen, "http://127.0.0.1:8787", "auto", blocked.args),
            /Qwen safe mode ignores Caveman system settings/,
          );
        });
      } finally {
        fx.cleanup();
      }
    });
  }
});

test("Qwen policy parser preserves reachable MCP registrations", async (t) => {
  for (const allowed of [
    { name: "bare permission wildcard", settings: { permissions: { deny: ["*"] } } },
    { name: "nonempty permission specifier", settings: { permissions: { deny: ["mcp__caveman__caveman_retrieve(handle)"] } } },
    { name: "malformed permission specifier", settings: { permissions: { deny: ["mcp__caveman__caveman_retrieve)"] } } },
    { name: "disabled wildcard is exact-only", settings: { tools: { disabled: ["mcp__*"] } } },
    { name: "argument scan stops at separator", args: ["--", "--safe-mode", "--exclude-tools=mcp*"] },
    { name: "explicit safe false overrides environment", args: ["--safe-mode=false"], env: { QWEN_CODE_SAFE_MODE: "yes" } },
  ]) {
    await t.test(allowed.name, async () => {
      const fx = qwenMcpFixture();
      try {
        const installed = await runCli(["mcp", "install", "qwen"], fx.env);
        assert.equal(installed.code, 0, installed.stderr);
        if (allowed.settings) writeFileSync(fx.systemConfigPath, JSON.stringify(allowed.settings));
        withEnv({
          HOME: fx.env.HOME,
          CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
          QWEN_HOME: fx.env.QWEN_HOME,
          QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfigPath,
          QWEN_CODE_SYSTEM_DEFAULTS_PATH: fx.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH,
          QWEN_CODE_LEGACY_MCP_BLOCKING: "0",
          QWEN_CODE_SAFE_MODE: undefined,
          QWEN_CODE_SIMPLE: undefined,
          ...allowed.env,
        }, () => {
          const wrapped = buildWrapEnv(qwen, "http://127.0.0.1:8787", "auto", allowed.args ?? []);
          assert.equal(wrapped.QWEN_CODE_LEGACY_MCP_BLOCKING, "1");
          assert.deepEqual(readInjected(wrapped).config.mcpServers.caveman, { command: fx.mcpV1, args: [] });
        });
      } finally {
        fx.cleanup();
      }
    });
  }
});

test("Qwen recovery follows QWEN_HOME and policy values loaded from dotenv", async () => {
  const fx = qwenMcpFixture();
  try {
    const installed = await runCli(["mcp", "install", "qwen"], fx.env);
    assert.equal(installed.code, 0, installed.stderr);
    mkdirSync(fx.env.HOME, { recursive: true });
    writeFileSync(join(fx.env.HOME, ".env"), `QWEN_HOME=${fx.env.QWEN_HOME}\n`);
    writeFileSync(join(fx.env.QWEN_HOME, ".env"), "QWEN_DENY_RECOVERY=mcp__caveman\n");
    writeFileSync(fx.systemConfigPath, JSON.stringify({ permissions: { deny: ["$QWEN_DENY_RECOVERY"] } }));
    withEnv({
      HOME: fx.env.HOME,
      CAVEMAN_HOME: fx.env.CAVEMAN_HOME,
      QWEN_HOME: undefined,
      QWEN_CODE_SYSTEM_SETTINGS_PATH: fx.systemConfigPath,
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: fx.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH,
      QWEN_DENY_RECOVERY: undefined,
      QWEN_CODE_LEGACY_MCP_BLOCKING: "0",
    }, () => {
      const wrapped = buildWrapEnv(qwen);
      assert.equal(wrapped.QWEN_CODE_LEGACY_MCP_BLOCKING, "0");
      const effective = readInjected(wrapped).config;
      assert.equal(effective.mcpServers?.caveman, undefined);
      assert.ok(effective.mcp.excluded.includes("caveman"));
    });
  } finally {
    fx.cleanup();
  }
});

test("Qwen MCP fails closed on malformed or incompatible settings", async (t) => {
  for (const fixture of [
    { name: "empty file", source: "", message: /settings\.json is empty; not modifying it/ },
    { name: "JSON with comments", source: "{\n  // keep comment\n  \"general\": {}\n}\n", message: /cannot read .*settings\.json/ },
    { name: "non-object mcpServers", source: "{\n  \"mcpServers\": []\n}\n", message: /mcpServers must be a JSON object/ },
  ]) {
    await t.test(fixture.name, async () => {
      const fx = qwenMcpFixture();
      try {
        writeFileSync(fx.configPath, fixture.source);
        const installed = await runCli(["mcp", "install", "qwen"], fx.env);
        assert.equal(installed.code, 0, installed.stderr);
        assert.match(installed.stderr, fixture.message);
        assert.equal(readFileSync(fx.configPath, "utf8"), fixture.source);
        assert.equal(existsSync(fx.markerPath), false);
      } finally {
        fx.cleanup();
      }
    });
  }
});
