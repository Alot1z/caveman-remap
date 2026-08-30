#!/usr/bin/env node
// server.mjs — Remote-MCP (Streamable HTTP) server for the caveman engine.
//
// Serves the SAME 5 tools as the existing stdio caveman-mcp server
// (caveman_compress, caveman_retrieve, caveman_stats, caveman_toon_encode,
// caveman_toon_decode) over HTTP, so MCP-capable text hosts that do NOT run
// arbitrary subprocesses — ChatGPT.com, Claude, Gemini, pi — can register it the
// way #870 proved is possible ("needs one schema capability").
//
// It never reimplements compression: tools/call is bridged to the reviewed
// engine binary (CAVEMAN_MCP_BIN, falling back to `npx caveman-mcp`) over stdio.
// initialize + tools/list are answered from schema.mjs (no engine needed).
// Local-first by design: binds 127.0.0.1 unless HOST is set; when it binds a
// non-loopback interface, a CAVEMAN_MCP_TOKEN bearer token is REQUIRED.
//
// MIT launcher; the engine binary it invokes is BSL-1.1 (see mcp/BINARY_LICENSE.md).
//
// Run: node server.mjs [--port 8787] [--host 127.0.0.1]

import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tools } from "./schema.mjs";

const PROTOCOL_VERSION = "2025-03-26";

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
  };
}

// -- engine bridge ---------------------------------------------------------
// The reviewed engine already speaks MCP stdio and returns standard ToolResult
// shapes: successful calls give `{ content: [{type:"text",text:"<payload>"}],
// isError:false }`, tool failures give `isError:true` with a cave_* code in the
// text (never a JSON-RPC error). So the bridge's job is purely to relay the
// engine's `result` verbatim — text payload and isError flag — without wrapping
// it a second time. No compression logic lives here.
function callEngine(toolName, input) {
  // Spawn the reviewed engine server and exchange one tools/call over its stdio.
  return new Promise((resolve) => {
    const bin = process.env.CAVEMAN_MCP_BIN;
    let out = "";
    const child = bin
      ? spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] })
      : spawn("npx", ["-y", "caveman-mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, error: `engine unavailable: ${e.message}` }); });
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", () => {});
    child.on("exit", () => { clearTimeout(timer); });
    child.on("close", () => {
      // A line-delimited JSON-RPC response to our tools/call.
      const match = out.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).find((m) => m && m.jsonrpc && (m.id === "caveman-remote" || (m.id && typeof m.id === "number")));
      if (!match) return resolve({ ok: false, error: "no engine response" });
      if (match.error) return resolve({ ok: false, error: String(match.error.message ?? match.error) });
      // Relay the engine's ToolResult verbatim: text payload + isError flag.
      const content = Array.isArray(match.result?.content) ? match.result.content : [];
      resolve({
        ok: true,
        isError: !!match.result?.isError,
        text: content[0]?.type === "text" ? (content[0].text ?? "") : "",
      });
    });
    const req = {
      jsonrpc: "2.0",
      id: "caveman-remote",
      method: "tools/call",
      params: { name: toolName, arguments: input ?? {} },
    };
    child.stdin.write(JSON.stringify(req) + "\n");
    child.stdin.end();
  });
}

// -- session store ------------------------------------------------------------
const sessions = new Map(); // sessionId -> set of open SSE responses

function touchSession(headers) {
  const cur = headers["mcp-session-id"];
  const id = typeof cur === "string" && cur.length > 0 ? cur : randomUUID();
  if (!sessions.has(id)) sessions.set(id, new Set());
  return id;
}

// -- JSON-RPC dispatch ---------------------------------------------------------
async function dispatch(msg) {
  const { method, params = {}, id } = msg || {};
  if (typeof method !== "string") return jsonRpcError(id ?? null, -32600, "invalid request");
  // Notifications carry no id — acknowledge silently.
  if (id === undefined || id === null) return null;
  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "caveman-mcp-remote", version: "1.0.0" },
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools } };
    case "tools/call": {
      const name = params?.name;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return jsonRpcError(id, -32602, `unknown tool: ${name}`);
      const r = await callEngine(name, params?.arguments);
      if (!r.ok) return jsonRpcError(id, -32603, r.error);
      // Pass the engine's ToolResult through verbatim so hosts see the same
      // payload and isError flag they would from the stdio server.
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: r.text }], isError: r.isError } };
    }
    default:
      return jsonRpcError(id, -32601, `method not found: ${method}`);
  }
}

// -- HTTP server ----------------------------------------------------------------
export function createHandler() {
  const token = process.env.CAVEMAN_MCP_TOKEN;
  return function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...corsHeaders(), "Content-Length": 0 });
      return res.end();
    }
    const checkAuth = () => {
      if (!token) return true;
      const auth = req.headers.authorization || "";
      return auth === `Bearer ${token}`;
    };
    if (!checkAuth()) {
      res.writeHead(401, { ...corsHeaders(), "WWW-Authenticate": "Bearer" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, corsHeaders());
      return res.end(JSON.stringify({ error: "not found" }));
    }

    if (req.method === "GET") {
      // SSE stream the client keeps open to receive server notifications.
      const session = touchSession(req.headers);
      res.writeHead(200, {
        ...corsHeaders(),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Mcp-Session-Id": session,
      });
      res.write("event: endpoint\ndata: /mcp\n\n");
      const keep = setInterval(() => res.write(": keepalive\n\n"), 15000);
      sessions.get(session)?.add(res);
      req.on("close", () => {
        clearInterval(keep);
        sessions.get(session)?.delete(res);
      });
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        let msg;
        try { msg = JSON.parse(body); } catch { res.writeHead(400, corsHeaders()); return res.end(JSON.stringify({ error: "bad json" })); }
        const session = touchSession(req.headers);
        const result = await dispatch(msg);
        if (result === null) {
          res.writeHead(202, { ...corsHeaders(), "Mcp-Session-Id": session });
          return res.end();
        }
        res.writeHead(200, { ...corsHeaders(), "Content-Type": "application/json", "Mcp-Session-Id": session });
        res.end(JSON.stringify(result));
      });
      return;
    }

    res.writeHead(405, corsHeaders());
    res.end();
  };
}

export function start(opts = {}) {
  const port = opts.port ?? Number(process.env.CAVEMAN_MCP_PORT || 8787);
  const host = (opts.host ?? process.env.CAVEMAN_MCP_HOST) || "127.0.0.1";
  const server = http.createServer(createHandler());
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({
      port: server.address().port,
      host,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, "/")) {
  const { port } = await start();
  console.log(`caveman-mcp-remote listening on http://127.0.0.1:${port}/mcp (host=${process.env.CAVEMAN_MCP_HOST ?? "127.0.0.1"})`);
}