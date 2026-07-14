/**
 * ai/gemini — helpers for Google Generative Language (`generateContent`).
 *
 * Gemini is the odd one out: it has its own URL path with the model encoded
 * in it, an `x-goog-api-key` header instead of `Authorization: Bearer`, and
 * the system prompt is split into a top-level `systemInstruction` field. Body
 * uses `maxOutputTokens` rather than `max_tokens`.
 */

import type { AiCallArgs, AiProviderSpec, BuiltAiRequest } from "./types";

function buildRequest(args: AiCallArgs): BuiltAiRequest {
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-goog-api-key": args.apiKey,
  };
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: args.system }] },
    contents: [{ role: "user", parts: [{ text: args.user }] }],
    generationConfig: { maxOutputTokens: args.maxTokens },
  });
  const url = `${baseUrl}/models/${encodeURIComponent(args.model)}:generateContent`;
  return { url, headers, body };
}

function parseResponse(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const first = candidates[0] as { content?: { parts?: Array<{ text?: unknown }> } } | undefined;
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p): p is { text?: string } => !!p && typeof p === "object")
    .map((p) => (typeof p.text === "string" ? p.text : ""))
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

export const geminiHelpers = {
  buildRequest,
  parseResponse,
  parseError,
} satisfies Pick<AiProviderSpec, "buildRequest" | "parseResponse" | "parseError">;
