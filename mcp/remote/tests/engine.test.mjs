import test from "node:test";
import assert from "node:assert/strict";
import { start } from "../server.mjs";

// Conditional engine-binary integration test.
//
// The Remote-MCP server never reimplements compression — tools/call is bridged
// over stdio to the reviewed engine binary (CAVEMAN_MCP_BIN). The unit tests in
// remote.test.mjs cover the transport/schema/auth surface with no engine. This
// file additionally proves the tools/call bridge works END-TO-END against the
// real engine when a binary is available. No binary on this machine → the tests
// skip cleanly (node:test reports them as skipped) instead of failing CI.
const bin = process.env.CAVEMAN_MCP_BIN;
// The engine opens the shared on-disk recovery store (~/.caveman) so
// caveman_retrieve handles resolve across processes. In the test we want a
// hermetic run that touches no user state: force the in-memory store. TOON
// encode/decode and stats are store-independent, so this doesn't weaken the
// assertions. (Production keeps the shared store — the bridge inherits env.)
if (bin) process.env.CAVEMAN_MCP_EPHEMERAL = "1";
const skipMsg =
  "CAVEMAN_MCP_BIN not set — engine integration skipped (set it to the caveman-mcp Go binary to run).";

function post(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callTool(srv, name, args) {
  const r = await post(`http://127.0.0.1:${srv.port}/mcp`, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return { status: r.status, json: await r.json() };
}

test("tools/call round-trips caveman_toon_encode -> caveman_toon_decode with no data loss", { skip: bin ? false : skipMsg }, async () => {
  const original = "{\"ok\":1,\"msg\":\"whole cave\"}";
  const srv = await start({ port: 0, host: "127.0.0.1" });
  try {
    // Encode: the real engine returns the ToolText payload JSON verbatim in
    // content[0].text — the bridge must NOT wrap it a second time.
    const enc = await callTool(srv, "caveman_toon_encode", { input: original });
    assert.equal(enc.status, 200);
    const encBody = enc.json.result.content[0];
    assert.equal(encBody.type, "text");
    assert.equal(enc.json.result.isError, false);
    const payload = JSON.parse(encBody.text);
    assert.equal(typeof payload.output, "string");
    assert.ok(payload.output.length > 0);
    assert.equal(payload.encoded, true);
    assert.equal(typeof payload.input_bytes, "number");

    // Decode the token back: the engine re-serializes with canonical (sorted)
    // key order, so assert semantic equality — same object, not same byte
    // order. Round-trip must lose nothing.
    const dec = await callTool(srv, "caveman_toon_decode", { input: payload.output });
    assert.equal(dec.status, 200);
    assert.equal(dec.json.result.isError, false);
    assert.deepEqual(JSON.parse(dec.json.result.content[0].text), JSON.parse(original));
  } finally {
    await srv.close();
  }
});

test("tools/call fails closed on invalid TOON (engine isError ToolResult relayed verbatim)", { skip: bin ? false : skipMsg }, async () => {
  const srv = await start({ port: 0, host: "127.0.0.1" });
  try {
    // "[1,2" is an unbalanced TOON array — the engine rejects it (verified
    // against the real binary: cave_invalid_toon, isError=true).
    const r = await callTool(srv, "caveman_toon_decode", { input: "[1,2" });
    assert.equal(r.status, 200);
    // The engine returns a ToolError (isError=true, cave_invalid_toon) — the
    // bridge relays it as a result with isError, never a raw echo of the input.
    assert.equal(r.json.result.isError, true);
    const payload = JSON.parse(r.json.result.content[0].text);
    assert.equal(payload.error, "cave_invalid_toon");
    assert.ok(payload.message.length > 0);
  } finally {
    await srv.close();
  }
});