// schema.mjs — OpenAI/ChatGPT-class JSON-Schema definitions for the 5 caveman tools.
//
// These mirror the stdio caveman-mcp server's tool surface exactly (names and
// contract from mcp/README.md). The reason this file exists is transport/schema
// (KB lesson from #870 + #709): ChatGPT/Gemini/pi MCP clients require plain
// JSON-Schema with {object,properties,required} — no Claude-only tool description
// shapes. Providing the schema here lets any host discover the whole cave surface
// without shelling out to the engine.

const string = { type: "string" };
const object = (properties, required = []) => ({ type: "object", properties, required });

export const tools = [
  {
    name: "caveman_compress",
    description:
      "Compress text with the Caveman engine. Returns compressed text, an inferred ratio, and a recovery_handle (null on pass-through). Lossy but reversible via caveman_retrieve; incompressible input passes through unchanged.",
    inputSchema: object({ input: string }, ["input"]),
  },
  {
    name: "caveman_retrieve",
    description:
      "Recover the byte-exact original for a recovery_handle produced by caveman_compress. Errors on an unknown handle.",
    inputSchema: object({ recovery_handle: string }, ["recovery_handle"]),
  },
  {
    name: "caveman_stats",
    description:
      "Session totals: tokens before/after, ratio, basis \"inferred\", scope \"session\". Never claims verified savings.",
    inputSchema: object({}),
  },
  {
    name: "caveman_toon_encode",
    description:
      "Explicitly encode a JSON string as TOON, returning sizes. Pass-through plus a note when not encodable.",
    inputSchema: object({ input: string }, ["input"]),
  },
  {
    name: "caveman_toon_decode",
    description:
      "Decode a TOON string back to JSON. Errors on invalid TOON.",
    inputSchema: object({ input: string }, ["input"]),
  },
];

export function toolByName(name) {
  return tools.find((t) => t.name === name) ?? null;
}