import {
  CloakfetchError,
  type CloakfetchQuestion,
  type ExpandedKnowledge,
} from "./CloakfetchClient";
import {
  knowledgeExpandPrompt,
  keyPointsExtractionPrompt,
  questionGenerationPrompt,
  renderExpandedMarkdown,
} from "./aiPrompts";

export interface DirectAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Direct Anthropic Messages API client used by CloakfetchClient when the user
 * has filled in direct AI settings (provider/apiKey/baseUrl/model). Mirrors
 * the server-side AI endpoints so callers (LearningWidget) keep working
 * unchanged regardless of whether the request is routed to the local service
 * or handled here.
 */
export class DirectAiClient {
  private readonly config: DirectAiConfig;

  constructor(config: DirectAiConfig) {
    this.config = {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...config,
    };
  }

  get model(): string {
    return this.config.model;
  }

  get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, "");
  }

  async generateQuestions(title: string, text: string, count = 3): Promise<CloakfetchQuestion[]> {
    const { system, user } = questionGenerationPrompt(title, text, count);
    const raw = await this.callAnthropic(system, user, 2048, this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const parsed = parseQuestionsResponse(raw);
    return sanitizeQuestions(parsed, count);
  }

  async extractKeyPoints(title: string, text: string, maxPoints = 8): Promise<string[]> {
    const { system, user } = keyPointsExtractionPrompt(title, text, maxPoints);
    const raw = await this.callAnthropic(system, user, 1024, this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return parseKeyPointsResponse(raw, maxPoints);
  }

  async expandKnowledge(name: string, context = ""): Promise<ExpandedKnowledge> {
    const { system, user } = knowledgeExpandPrompt(name, context);
    const raw = await this.callAnthropic(system, user, 1800, this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return parseExpandedResponse(name, raw);
  }

  /**
   * Lightweight health check. Sends a 1-token ping against the configured
   * endpoint. Returns true on 2xx, false otherwise.
   */
  async ping(): Promise<boolean> {
    if (!this.config.apiKey.trim()) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: controller.signal,
      });
      return res.ok;
    } catch (_err) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async callAnthropic(system: string, user: string, maxTokens: number, timeoutMs: number): Promise<string> {
    if (!this.config.apiKey.trim()) {
      throw new CloakfetchError("Direct AI is not configured (apiKey is empty)", {
        status: 0,
        body: "",
        endpoint: `${this.baseUrl}/v1/messages`,
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const message = extractErrorMessage(text) || `HTTP ${res.status}`;
        throw new CloakfetchError(message, {
          status: res.status,
          body: text.slice(0, 1000),
          endpoint: "/v1/messages",
        });
      }
      let parsed: AnthropicMessagesResponse | null = null;
      try {
        parsed = JSON.parse(text) as AnthropicMessagesResponse;
      } catch (_err) {
        throw new CloakfetchError("Invalid JSON from AI provider", {
          status: res.status,
          body: text.slice(0, 1000),
          endpoint: "/v1/messages",
        });
      }
      const content = parsed?.content ?? [];
      const text0 = content
        .filter((block) => block && block.type === "text" && typeof block.text === "string")
        .map((block) => block.text ?? "")
        .join("");
      if (!text0) {
        throw new CloakfetchError("AI provider returned no text content", {
          status: res.status,
          body: text.slice(0, 1000),
          endpoint: "/v1/messages",
        });
      }
      return text0;
    } catch (err) {
      if (err instanceof CloakfetchError) throw err;
      if ((err as { name?: string })?.name === "AbortError") {
        throw new CloakfetchError(`Direct AI request timed out after ${timeoutMs}ms`, {
          status: 0,
          body: "",
          endpoint: "/v1/messages",
        });
      }
      throw new CloakfetchError(`Direct AI request failed: ${(err as Error).message ?? String(err)}`, {
        status: 0,
        body: "",
        endpoint: "/v1/messages",
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractErrorMessage(text: string): string | null {
  if (!text) return null;
  try {
    const obj = JSON.parse(text) as { error?: { message?: string } };
    if (obj?.error?.message) return obj.error.message;
  } catch (_err) {
    // not JSON
  }
  return null;
}

interface ParsedQuestionsJson {
  questions?: unknown[];
}

function parseQuestionsResponse(raw: string): ParsedQuestionsJson {
  let candidate = raw;
  // Strip leading/trailing code fences if present.
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fence && fence[1]) candidate = fence[1].trim();
  // Find a JSON object if there is surrounding prose.
  const objMatch = /\{[\s\S]*\}/.exec(candidate);
  if (objMatch) candidate = objMatch[0];
  try {
    const parsed = JSON.parse(candidate) as ParsedQuestionsJson;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function isQuestionType(value: unknown): value is CloakfetchQuestion["type"] {
  return value === "mc" || value === "cloze" || value === "tf" || value === "short";
}

function sanitizeQuestions(parsed: ParsedQuestionsJson, count: number): CloakfetchQuestion[] {
  const arr = Array.isArray(parsed.questions) ? parsed.questions : [];
  const out: CloakfetchQuestion[] = [];
  for (const candidate of arr) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const type = item.type;
    const text = item.text;
    const answer = item.answer;
    if (!isQuestionType(type) || typeof text !== "string" || typeof answer !== "string") continue;
    let opts = Array.isArray(item.options)
      ? (item.options.filter((o): o is string => typeof o === "string") as string[])
      : [];
    let resolvedAnswer = answer;
    if (type === "mc") {
      if (opts.length < 4) continue;
      opts = opts.slice(0, 6);
      // Accept "A/B/C/D" or 0/1/2/3 as the answer shorthand.
      if (/^[A-Da-d]$/.test(resolvedAnswer)) {
        const idx = resolvedAnswer.toUpperCase().charCodeAt(0) - 65;
        if (idx >= 0 && idx < opts.length) resolvedAnswer = opts[idx] ?? resolvedAnswer;
      } else if (!opts.includes(resolvedAnswer)) {
        opts.push(resolvedAnswer);
      }
    }
    out.push({
      type,
      text,
      answer: resolvedAnswer,
      options: type === "mc" ? opts : opts.length > 0 ? opts : undefined,
      explanation: typeof item.explanation === "string" ? item.explanation : undefined,
    });
    if (out.length >= count) break;
  }
  return out;
}

function parseKeyPointsResponse(raw: string, maxPoints: number): string[] {
  let candidate = raw;
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fence && fence[1]) candidate = fence[1].trim();
  // Try direct parse.
  try {
    const obj = JSON.parse(candidate);
    if (Array.isArray(obj)) {
      return obj
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter((s) => s.length > 0)
        .slice(0, maxPoints);
    }
    if (obj && typeof obj === "object" && Array.isArray((obj as { keyPoints?: unknown }).keyPoints)) {
      return ((obj as { keyPoints: unknown[] }).keyPoints)
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter((s) => s.length > 0)
        .slice(0, maxPoints);
    }
  } catch (_err) {
    // fall through
  }
  // Find a JSON array anywhere in the text.
  const arrMatch = /\[[\s\S]*?\]/.exec(candidate);
  if (arrMatch) {
    try {
      const obj = JSON.parse(arrMatch[0]);
      if (Array.isArray(obj)) {
        return obj
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter((s) => s.length > 0)
          .slice(0, maxPoints);
      }
    } catch (_err) {
      // fall through
    }
  }
  // Last-resort: split into short lines.
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-•·]\s*/, "").trim())
    .filter((l) => l.length >= 4 && l.length < 200);
  return lines.slice(0, maxPoints);
}

function parseExpandedResponse(name: string, raw: string): ExpandedKnowledge {
  let candidate = raw;
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fence && fence[1]) candidate = fence[1].trim();
  const objMatch = /\{[\s\S]*\}/.exec(candidate);
  if (objMatch) candidate = objMatch[0];

  let parsed: Record<string, unknown> = {};
  try {
    const obj = JSON.parse(candidate);
    if (obj && typeof obj === "object") parsed = obj as Record<string, unknown>;
  } catch (_err) {
    // Treat the raw text as the markdown body when JSON parsing fails.
    const body = raw.trim();
    return { subject: "", translation: "", pos: "", markdown: body ? `# ${name}\n\n${body}` : "" };
  }

  const subject = typeof parsed["subject"] === "string" ? (parsed["subject"] as string).trim() : "";
  const translation = typeof parsed["translation"] === "string" ? (parsed["translation"] as string).trim() : "";
  const pos = typeof parsed["pos"] === "string" ? (parsed["pos"] as string).trim() : "";
  const definition = typeof parsed["definition"] === "string" ? (parsed["definition"] as string).trim() : "";
  const points = Array.isArray(parsed["points"])
    ? (parsed["points"] as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  const example = typeof parsed["example"] === "string" ? (parsed["example"] as string).trim() : "";
  const contrast = typeof parsed["contrast"] === "string" ? (parsed["contrast"] as string).trim() : "";
  const refs = typeof parsed["refs"] === "string" ? (parsed["refs"] as string).trim() : "";

  const markdown = renderExpandedMarkdown({ subject, translation, pos, definition, points, example, contrast, refs });

  return {
    subject,
    translation,
    pos,
    markdown: markdown || `# ${name}\n\n${raw.trim()}`,
  };
}