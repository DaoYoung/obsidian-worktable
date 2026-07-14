/**
 * ai/types — provider abstraction shared by every direct-AI backend.
 *
 * The plugin used to ship with a single Anthropic-specific client
 * (`DirectAiClient.ts`). v0.3.0 broadens direct-AI support to nine providers,
 * each with its own URL/auth/body shape. To keep the surface small we model
 * every backend as an `AiProviderSpec` that knows how to build a request,
 * parse a successful response, and surface an error message — the rest of the
 * pipeline (timeouts, error wrapping, prompt construction, response
 * post-processing) is identical across providers.
 */

export type AiProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "deepseek"
  | "moonshot"
  | "zhipu"
  | "bailian"
  | "volcengine"
  | "minimax";

export const AI_PROVIDER_IDS: readonly AiProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "deepseek",
  "moonshot",
  "zhipu",
  "bailian",
  "volcengine",
  "minimax",
];

export interface AiCallArgs {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface BuiltAiRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface AiProviderSpec {
  id: AiProviderId;
  displayName: string;
  defaultBaseUrl: string;
  defaultModel: string;
  modelPlaceholder: string;
  /** Build the HTTP request — returns the URL, headers, and JSON body string. */
  buildRequest(args: AiCallArgs): BuiltAiRequest;
  /** Pull assistant text out of a 2xx JSON response. Empty string when missing. */
  parseResponse(json: unknown): string;
  /** Pull the human-readable error message from a non-2xx JSON body. */
  parseError(json: unknown, fallback: string): string;
}

/** True when `value` is one of the known provider ids. */
export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}
