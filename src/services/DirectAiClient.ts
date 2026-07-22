import {
  CloakfetchError,
  type CloakfetchQuestion,
  type ExpandedKnowledge,
} from "./CloakfetchClient";
import { AiClient } from "./ai/client";
import type { AiProviderId } from "./ai/types";
import {
  freeAnswerPrompt,
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

  async answerQuestion(title: string, text: string, question: string): Promise<string> {
    const { system, user } = freeAnswerPrompt(title, text, question);
    return this.client.call(system, user, 1024);
  }

  async expandKnowledge(name: string, context = ""): Promise<ExpandedKnowledge> {
    const { system, user } = knowledgeExpandPrompt(name, context);
    const raw = await this.client.call(system, user, 1800);
    // Mirror the is_english_word heuristic from the prompt builder so the
    // parser knows to drop any code the model slips into the example /
    // contrast fields despite the prompt's "no code" rule.
    const trimmed = (name || "").trim();
    const hasCjk = /[一-鿿]/.test(trimmed);
    const hasLatin = /[A-Za-zÀ-ɏ]/.test(trimmed);
    const isEnglishWord = !hasCjk && hasLatin && trimmed.length <= 40;
    return parseExpandedResponse(name, raw, isEnglishWord);
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

// Heuristic markers that strongly suggest a string is source code rather
// than prose. The active-recall prompt forbids code samples for English
// vocabulary, but we drop the field client-side as a safety net in case the
// model still slips some in.
const CODE_MARKERS = [
  "```",
  "function ", "function(",
  "const ", "let ", "var ",
  "import ", "from ", "require(",
  "def ", "class ",
  "console.", "System.out",
  "<script", "#!/",
];

function looksLikeCode(s: string): boolean {
  if (!s) return false;
  return CODE_MARKERS.some((m) => s.includes(m));
}

function parseExpandedResponse(name: string, raw: string, isEnglishWord = false): ExpandedKnowledge {
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
    // The model occasionally emits a malformed escape (e.g. an extra `\"`
    // inside a points entry) which breaks JSON.parse for the whole payload.
    // Fall back to per-field regex extraction so the user still gets a
    // usable Markdown card; if even that yields nothing, render the raw
    // response inside a fenced code block so it's visibly broken rather
    // than mistakable for prose.
    const extracted = extractExpandedFieldsLenient(candidate);
    if (extracted) {
      parsed = extracted;
    } else {
      const body = unescapeNewlines(raw.trim());
      const wrapped = body
        ? `# ${name}\n\n> AI 返回的格式无法解析，已按原文展示，请点击「重新生成」重试。\n\n\`\`\`\n${body}\n\`\`\``
        : "";
      return { subject: "", translation: "", pos: "", markdown: wrapped };
    }
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
  let example = typeof parsed["example"] === "string" ? unescapeNewlines(parsed["example"] as string).trim() : "";
  let contrast = typeof parsed["contrast"] === "string" ? unescapeNewlines(parsed["contrast"] as string).trim() : "";
  const refs = typeof parsed["refs"] === "string" ? unescapeNewlines(parsed["refs"] as string).trim() : "";

  // English-vocabulary learning: drop any code the model slipped in despite
  // the prompt's "no code" rule. Treat contrast the same way since it tends
  // to drift into technical comparisons for technical-sounding words.
  if (isEnglishWord) {
    if (looksLikeCode(example)) example = "";
    if (looksLikeCode(contrast)) contrast = "";
  } else if (looksLikeCode(example)) {
    // For non-English subjects we keep the example (code is the legitimate
    // use case), but still drop it if it's flagged as code by mistake.
    example = "";
  }

  const markdown = renderExpandedMarkdown({ subject, translation, pos, definition, points, example, contrast, refs });

  return {
    subject,
    translation,
    pos,
    markdown: markdown || `# ${name}\n\n${unescapeNewlines(raw.trim())}`,
  };
}

interface ExtractedFields {
  subject?: string;
  translation?: string;
  pos?: string;
  definition?: string;
  points?: string[];
  example?: string;
  contrast?: string;
  refs?: string;
}

const EXPANDED_STRING_FIELDS = [
  "subject",
  "translation",
  "pos",
  "definition",
  "example",
  "contrast",
  "refs",
] as const;

// When the full payload fails JSON.parse (e.g. a single extra `\"` inside
// one points entry breaks the whole document), recover what we can by
// pulling each known field out via regex. Returns null when nothing usable
// was found so the caller can drop to a code-fence fallback.
function extractExpandedFieldsLenient(raw: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  let found = false;
  for (const field of EXPANDED_STRING_FIELDS) {
    const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "s");
    const m = re.exec(raw);
    if (m && typeof m[1] === "string") {
      const v = unescapeLenient(m[1]).trim();
      if (v) {
        out[field] = v;
        found = true;
      }
    }
  }
  const arrMatch = /"points"\s*:\s*\[([\s\S]*?)\]/.exec(raw);
  if (arrMatch && typeof arrMatch[1] === "string") {
    const items = splitTopLevelCommas(arrMatch[1]);
    const points: string[] = [];
    for (const item of items) {
      const unquoted = stripOuterJsonQuotes(item.trim());
      if (unquoted === null) continue;
      const v = unescapeLenient(unquoted).trim();
      if (v) points.push(v);
    }
    if (points.length > 0) {
      out.points = points;
      found = true;
    }
  }
  return found ? out : null;
}

// Walk the contents of a JSON array, splitting on commas that aren't
// inside a quoted string. Honours `\"` as an in-string escape so a stray
// escaped quote doesn't prematurely split an entry. Each returned item
// keeps its surrounding quotes so `stripOuterJsonQuotes` can unwrap them
// uniformly with the regex-extracted string fields.
function splitTopLevelCommas(s: string): string[] {
  const items: string[] = [];
  let buf = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      buf += ch;
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      buf += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      buf += ch;
      continue;
    }
    if (ch === "," && !inString) {
      items.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) items.push(buf);
  return items;
}

function stripOuterJsonQuotes(s: string): string | null {
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return null;
  return s.slice(1, -1);
}

// Apply common JSON-style escapes to a string that didn't go through
// JSON.parse. Walks one backslash + one char per pass so double-backslash
// sequences collapse correctly.
function unescapeLenient(s: string): string {
  return s.replace(/\\(.)/g, (_, ch: string) => {
    switch (ch) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "/":
        return "/";
      case "b":
        return "\b";
      case "f":
        return "\f";
      default:
        return ch;
    }
  });
}
