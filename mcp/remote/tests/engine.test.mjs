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

test("tools/call round-trips caveman_toon_encode -> caveman_toon_decode byte-exactly", { skip: bin ? false : skipMsg }, async () => {
  const original = "{\"ok\":1,\"msg\":\"whole cave\"}";
  const srv = await start({ port: 0, host: "127.0.0.1" });
  try {
    // Encode: the real engine turns JSON into a TOON token, reported as JSON with `output`.
    const enc = await callTool(srv, "caveman_toon_encode", { input: original });
    assert.equal(enc.status, 200);
    const encBody = enc.json.result.content[0];
    assert.equal(encBody.type, "text");
    const payload = JSON.parse(encBody.text);
    assert.equal(typeof payload.output, "string");
    assert.ok(payload.output.length > 0);
    assert.equal(payload.encoded, true);

    // Decode the token back: byte-exact original from the same engine.
    const dec = await callTool(srv, "caveman_toon_decode", { input: payload.output });
    assert.equal(dec.status, 200);
    assert.equal(dec.json.result.content[0].text, original);
  } finally {
    await srv.close();
  }
});

test("tools/call fails closed on invalid TOON (engine error becomes JSON-RPC error)", { skip: bin ? false : skipMsg }, async () => {
  const srv = await start({ port: 0, host: "127.0.0.1" });
  try {
    const r = await callTool(srv, "caveman_toon_decode", { input: "not-valid-toon" });
    assert.equal(r.status, 200);
    // The engine reports isError content; the bridge surfaces it as -32603.
    assert.equal(r.json.error.code, -32603);
    assert.ok(r.json.error.message.length > 0);
  } finally {
    await srv.close();
  }
});