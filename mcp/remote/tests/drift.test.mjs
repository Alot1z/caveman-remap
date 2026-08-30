import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tools } from "../schema.mjs";

// Drift gate (KB: two transports must not silently diverge). The Remote-MCP
// server advertises the same 5 tools as the stdio Go engine. This asserts the
// NAME surface of schema.mjs always equals the engine's registered tool names
// by reading the Go source constants (no binary needed). If a tool is added to
// the Go engine but not schema.mjs (or renamed in one place only), this REDs.
const enginePath = join(dirname(fileURLToPath(import.meta.url)), "../../engine_tools.go");
const goSrc = readFileSync(enginePath, "utf8");
const engineNames = [...goSrc.matchAll(/^\s*Tool\w*\s*=\s*"([a-z_0-9]+)"/gm)]
  .map((m) => m[1]);

test("schema.mjs tool surface matches the Go engine's registered tool names", () => {
  assert.ok(engineNames.length >= 5, `expected >=5 engine tools, got ${engineNames.length}`);
  const schemaNames = tools.map((t) => t.name);
  assert.deepEqual(
    [...schemaNames].sort(),
    [...engineNames].sort(),
    "schema.mjs tool names diverge from mcp/engine_tools.go"
  );
  // no duplicates either side, and every schema tool has a description
  assert.equal(new Set(schemaNames).size, schemaNames.length);
  for (const t of tools) {
    assert.ok(t.description && t.description.length > 0, `${t.name} missing description`);
    assert.equal(t.inputSchema.type, "object");
  }
});