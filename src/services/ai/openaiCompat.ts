/**
 * ai/openaiCompat — helpers for the OpenAI Chat Completions shape.
 *
 * Used by OpenAI itself plus the long tail of OpenAI-compatible Chinese
 * providers: DeepSeek, Moonshot (Kimi), Zhipu (GLM), Alibaba Bailian
 * (DashScope / Qwen), and Volcengine (Ark / Doubao). All of them expose
 * `POST {baseUrl}/chat/completions` with `Authorization: Bearer <key>` and a
 * `messages: [{role:system,...},{role:user,...}]` body.
 */

import type { AiCallArgs, AiProviderSpec, BuiltAiRequest } from "./types";

function buildRequest(args: AiCallArgs): BuiltAiRequest {
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "authorization": `Bearer ${args.apiKey}`,
  };
  const body = JSON.stringify({
    model: args.model,
    max_tokens: args.maxTokens,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  });
  return { url: `${baseUrl}/chat/completions`, headers, body };
}

function parseResponse(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === "string" ? content : "";
}

function parseError(json: unknown, fallback: string): string {
  if (json && typeof json === "object") {
    const err = (json as { error?: { message?: unknown } | string }).error;
    if (typeof err === "string" && err) return err;
    if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
      return (err as { message: string }).message;
    }
  }
  return fallback;
}

export const openaiCompatHelpers = {
  buildRequest,
  parseResponse,
  parseError,
} satisfies Pick<AiProviderSpec, "buildRequest" | "parseResponse" | "parseError">;
