import {
  CloakfetchError,
  type CloakfetchQuestion,
  type ExpandedKnowledge,
} from "./CloakfetchClient";
import { AiClient } from "./ai/client";
import type { AiProviderId } from "./ai/types";
import {
  knowledgeExpandPrompt,
  keyPointsExtractionPrompt,
  questionGenerationPrompt,
  renderExpandedMarkdown,
} from "./aiPrompts";

export interface DirectAiConfig {
  provider: AiProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * Thin wrapper over `AiClient` that preserves the three prompts the rest of
 * the plugin expects (`generateQuestions` / `extractKeyPoints` /
 * `expandKnowledge`) and the post-processing that turns raw model output
 * into the strongly-typed shapes the UI consumes.
 *
 * The transport — picking the right URL, headers, and body shape for each
 * provider — lives in `src/services/ai/`.
 */
export class DirectAiClient {
  private readonly client: AiClient;

  constructor(config: DirectAiConfig) {
    this.client = new AiClient(config);
  }

  get model(): string {
    return this.client.model;
  }

  get provider(): AiProviderId {
    return this.client.providerId;
  }

  get baseUrl(): string {
    return this.client.provider.defaultBaseUrl;
  }

  async generateQuestions(title: string, text: string, count = 3): Promise<CloakfetchQuestion[]> {
    const { system, user } = questionGenerationPrompt(title, text, count);
    const raw = await this.client.call(system, user, 2048);
    const parsed = parseQuestionsResponse(raw);
    return sanitizeQuestions(parsed, count);
  }

  async extractKeyPoints(title: string, text: string, maxPoints = 8): Promise<string[]> {
    const { system, user } = keyPointsExtractionPrompt(title, text, maxPoints);
    const raw = await this.client.call(system, user, 1024);
    return parseKeyPointsResponse(raw, maxPoints);
  }

  async expandKnowledge(name: string, context = ""): Promise<ExpandedKnowledge> {
    const { system, user } = knowledgeExpandPrompt(name, context);
    const raw = await this.client.call(system, user, 1800);
    return parseExpandedResponse(name, raw);
  }

  async ping(): Promise<boolean> {
    return this.client.ping();
  }
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

function unescapeNewlines(s: string): string {
  // Some providers return JSON where `\n` survives as the two literal
  // characters backslash + n (e.g. inside `example` / `definition`). JSON.parse
  // won't unescape those when the source itself isn't a valid JSON string, and
  // MarkdownRenderer then renders them verbatim. Convert them here so the
  // preview gets real line breaks.
  return s.replace(/\\n/g, "\n");
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
    const body = unescapeNewlines(raw.trim());
    return { subject: "", translation: "", pos: "", markdown: body ? `# ${name}\n\n${body}` : "" };
  }

  const subject = typeof parsed["subject"] === "string" ? unescapeNewlines(parsed["subject"] as string).trim() : "";
  const translation = typeof parsed["translation"] === "string" ? unescapeNewlines(parsed["translation"] as string).trim() : "";
  const pos = typeof parsed["pos"] === "string" ? unescapeNewlines(parsed["pos"] as string).trim() : "";
  const definition = typeof parsed["definition"] === "string" ? unescapeNewlines(parsed["definition"] as string).trim() : "";
  const points = Array.isArray(parsed["points"])
    ? (parsed["points"] as unknown[])
        .filter((p): p is string => typeof p === "string")
        .map((p) => unescapeNewlines(p).trim())
    : [];
  const example = typeof parsed["example"] === "string" ? unescapeNewlines(parsed["example"] as string).trim() : "";
  const contrast = typeof parsed["contrast"] === "string" ? unescapeNewlines(parsed["contrast"] as string).trim() : "";
  const refs = typeof parsed["refs"] === "string" ? unescapeNewlines(parsed["refs"] as string).trim() : "";

  const markdown = renderExpandedMarkdown({ subject, translation, pos, definition, points, example, contrast, refs });

  return {
    subject,
    translation,
    pos,
    markdown: markdown || `# ${name}\n\n${unescapeNewlines(raw.trim())}`,
  };
}
