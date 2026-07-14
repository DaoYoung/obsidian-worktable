/**
 * ai/anthropic — helpers for the Anthropic Messages API shape.
 *
 * Shared by the official `anthropic` spec and third-party Anthropic-compatible
 * proxies (e.g. `minimax`). The only host-specific bit is the
 * `anthropic-dangerous-direct-browser-access` opt-in header, which we only
 * add when targeting Anthropic's own endpoint — proxies don't whitelist the
 * header and reject the CORS preflight when it is present.
 */

import type { AiCallArgs, AiProviderSpec, BuiltAiRequest } from "./types";

const ANTHROPIC_VERSION = "2023-06-01";

/** Returns true when the configured baseUrl points at Anthropic's own host. */
export function isOfficialAnthropicHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).host.toLowerCase();
    return host === "api.anthropic.com";
  } catch (_err) {
    return false;
  }
}

function buildRequest(args: AiCallArgs): BuiltAiRequest {
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": args.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (isOfficialAnthropicHost(baseUrl)) {
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const body = JSON.stringify({
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });
  return { url: `${baseUrl}/v1/messages`, headers, body };
}

function parseResponse(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type?: string; text?: string } => !!block && typeof block === "object")
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}

function parseError(json: unknown, fallback: string): string {
  if (json && typeof json === "object") {
    const err = (json as { error?: { message?: unknown } }).error;
    if (err && typeof err === "object" && typeof err.message === "string" && err.message) {
      return err.message;
    }
  }
  return fallback;
}

/** Reusable helper bundle — spread into any Anthropic-compat provider spec. */
export const anthropicHelpers = {
  buildRequest,
  parseResponse,
  parseError,
} satisfies Pick<AiProviderSpec, "buildRequest" | "parseResponse" | "parseError">;
