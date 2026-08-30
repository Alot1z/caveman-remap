import test from "node:test";
import assert from "node:assert/strict";
import { start } from "../server.mjs";
import { tools } from "../schema.mjs";

async function withServer(fn, extraEnv = {}) {
  const prev = { ...(process.env.CAVEMAN_MCP_TOKEN ? { CAVEMAN_MCP_TOKEN: process.env.CAVEMAN_MCP_TOKEN } : {}) };
  if (extraEnv.CAVEMAN_MCP_TOKEN) process.env.CAVEMAN_MCP_TOKEN = extraEnv.CAVEMAN_MCP_TOKEN;
  else delete process.env.CAVEMAN_MCP_TOKEN;
  const srv = await start({ port: 0, host: "127.0.0.1" });
  try { await fn(srv); } finally { await srv.close(); }
  for (const [k, v] of Object.entries(prev)) process.env[k] = v;
  for (const k of Object.keys(extraEnv).filter((k) => k !== "CAVEMAN_MCP_TOKEN")) delete process.env[k];
}

function post(url, body, headers) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("initialize handshake returns protocol + capabilities", async () => {
  await withServer(async (srv) => {
    const r = await post(`http://127.0.0.1:${srv.port}/mcp`, {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("mcp-session-id"));
    const j = await r.json();
    assert.equal(j.jsonrpc, "2.0");
    assert.deepEqual(Object.keys(j.result.capabilities), ["tools"]);
    assert.ok(j.result.serverInfo.name === "caveman-mcp-remote");
  });
});

test("tools/list exposes exactly the 5 caveman tools with object schemas", async () => {
  await withServer(async (srv) => {
    const r = await post(`http://127.0.0.1:${srv.port}/mcp`, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const j = await r.json();
    const names = j.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "caveman_compress",
      "caveman_retrieve",
      "caveman_stats",
      "caveman_toon_decode",
      "caveman_toon_encode",
    ].sort());
    for (const t of j.result.tools) {
      assert.equal(t.inputSchema.type, "object");
      assert.ok(Array.isArray(t.inputSchema.properties) === false);
      assert.equal(typeof t.inputSchema.properties, "object");
    }
  });
});

test("unknown method returns a JSON-RPC error, not a crash", async () => {
  await withServer(async (srv) => {
    const r = await post(`http://127.0.0.1:${srv.port}/mcp`, { jsonrpc: "2.0", id: 9, method: "nope" });
    const j = await r.json();
    assert.equal(j.error.code, -32601);
  });
});

test("notification (no id) is acknowledged with 202", async () => {
  await withServer(async (srv) => {
    const r = await post(`http://127.0.0.1:${srv.port}/mcp`, { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(r.status, 202);
  });
});

test("token auth: required when server is token-gated, 401 without a token", async () => {
  await withServer(async (srv) => {
    const r = await post(`http://127.0.0.1:${srv.port}/mcp`, { jsonrpc: "2.0", id: 1, method: "initialize" });
    assert.equal(r.status, 401);
    const ok = await post(`http://127.0.0.1:${srv.port}/mcp`, { jsonrpc: "2.0", id: 1, method: "initialize" }, { Authorization: "Bearer secret-token" });
    assert.equal(ok.status, 200);
  }, { CAVEMAN_MCP_TOKEN: "secret-token" });
});

test("schema.mjs is host-agnostic (OpenAI-class JSON Schema)", () => {
  assert.equal(tools.length, 5);
  for (const t of tools) assert.equal(typeof t.description, "string");
  assert.ok(tools.find((t) => t.name === "caveman_compress").inputSchema.required.includes("input"));
});