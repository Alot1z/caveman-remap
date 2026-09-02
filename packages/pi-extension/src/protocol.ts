// Bounded shared types for the Pi ⇄ Caveman native-runtime bridge. Mirrors the
// caps enforced by the CLI (validNativeRuntimeResponse) and the Go runtime so an
// oversized field degrades to "absent" instead of crossing the boundary.

export const MAX_CONTEXT_BYTES = 64 * 1024;
export const MAX_MESSAGE_BYTES = 4 * 1024;
export const MAX_OUTPUT_REPLACEMENT_BYTES = 2 * 1024 * 1024;
export const MAX_RECOVERY_REF_BYTES = 1024;
export const MAX_DECISION_ID_BYTES = 256;
// Hook stdin is capped at 2 MiB on the CLI side; tool output beyond this is not
// truncated (a partial payload could yield a wrong replacement) — it is skipped.
export const MAX_TOOL_OUTPUT_BYTES = 2 * 1024 * 1024;

export type HookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "ModelBefore"
  | "ModelAfter"
  | "Stop"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PreCompact"
  | "PostCompact"
  | "SessionEnd";

export type HookResponse = {
  action?: string;
  context?: string;
  message?: string;
  output_replacement?: string;
  recovery_ref?: string;
  decision_id?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
    updatedToolOutput?: string;
  };
};

function fits(value: unknown, max: number): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= max;
}

// sanitizeHookResponse drops any field that is missing, mistyped, or over its
// byte cap. Fail-open: a degenerate response becomes an empty object.
export function sanitizeHookResponse(raw: unknown): HookResponse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const out: HookResponse = {};
  if (fits(value.context, MAX_CONTEXT_BYTES)) out.context = value.context;
  if (fits(value.message, MAX_MESSAGE_BYTES)) out.message = value.message;
  if (fits(value.output_replacement, MAX_OUTPUT_REPLACEMENT_BYTES)) out.output_replacement = value.output_replacement;
  if (fits(value.recovery_ref, MAX_RECOVERY_REF_BYTES)) out.recovery_ref = value.recovery_ref;
  if (fits(value.decision_id, MAX_DECISION_ID_BYTES)) out.decision_id = value.decision_id;
  if (typeof value.action === "string") out.action = value.action;
  const hso = value.hookSpecificOutput;
  if (hso && typeof hso === "object" && !Array.isArray(hso)) {
    const nested = hso as Record<string, unknown>;
    const cleaned: NonNullable<HookResponse["hookSpecificOutput"]> = {};
    if (typeof nested.hookEventName === "string") cleaned.hookEventName = nested.hookEventName;
    if (fits(nested.additionalContext, MAX_CONTEXT_BYTES)) cleaned.additionalContext = nested.additionalContext;
    if (fits(nested.updatedToolOutput, MAX_OUTPUT_REPLACEMENT_BYTES)) cleaned.updatedToolOutput = nested.updatedToolOutput;
    out.hookSpecificOutput = cleaned;
  }
  return out;
}

export function additionalContextOf(response: HookResponse | undefined): string | undefined {
  const context = response?.hookSpecificOutput?.additionalContext ?? response?.context;
  return context ? context : undefined;
}

export function outputReplacementOf(response: HookResponse | undefined): string | undefined {
  const replacement = response?.hookSpecificOutput?.updatedToolOutput ?? response?.output_replacement;
  return replacement ? replacement : undefined;
}

// This route table maps each Pi model API to a path under the local gateway.
// An API that is not in this table is unsupported, for example azure, bedrock,
// vertex, mistral, and codex-responses. The extension never routes such an API,
// because it does not guess a wire protocol.
export const ROUTES_BY_API: Readonly<Record<string, string>> = {
  "anthropic-messages": "/w/pi",
  "openai-completions": "/w/pi/openai/v1",
  "openai-responses": "/w/pi/openai/v1",
  "google-generative-ai": "/w/pi/v1beta",
};

// OpenCode Go uses the OpenAI and Anthropic wire protocols, but its upstream is
// not api.openai.com. This provider mount gives the proxy the correct upstream.
const ROUTES_BY_PROVIDER_API: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "opencode-go": {
    "anthropic-messages": "/w/pi/compat/opencode-go",
    "openai-completions": "/w/pi/compat/opencode-go/v1",
    "openai-responses": "/w/pi/compat/opencode-go/v1",
  },
};

// If the caller gives a provider, this function routes only the providers that the
// local proxy can resolve. If the caller gives no provider, the function keeps the
// API-only behavior for existing callers.
export function routeForApi(gateway: string, api: string | undefined, provider?: string): string | undefined {
  const providerRoutes = provider ? ROUTES_BY_PROVIDER_API[provider] : undefined;
  if (provider && providerRoutes) {
    const path = api ? providerRoutes[api] : undefined;
    return path ? joinUrl(gateway, path) : undefined;
  }
  if (provider && provider !== "anthropic" && provider !== "openai" && provider !== "google") return undefined;
  const path = api ? ROUTES_BY_API[api] : undefined;
  return path ? joinUrl(gateway, path) : undefined;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

// Only a loopback gateway may be routed: managed gateways need separate auth
// proof that v1 does not carry.
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "localhost";
  } catch {
    return false;
  }
}

export function boundedString(value: string, max: number): string {
  if (Buffer.byteLength(value, "utf8") <= max) return value;
  return Buffer.from(value, "utf8").subarray(0, max).toString("utf8").replace(/�+$/, "");
}
