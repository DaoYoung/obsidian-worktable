import { DirectAiClient } from "./DirectAiClient";
import { hasDirectAiConfig, type WorktableSettings } from "../settings";
import { DEFAULT_SETTINGS } from "../settings";
import { getProviderSpec } from "./ai/registry";

export interface CloakfetchQuestion {
  type: "mc" | "cloze" | "tf" | "short";
  text: string;
  answer: string;
  options?: string[];
  explanation?: string;
}

export interface CloakfetchQuestionsResponse {
  ok: boolean;
  questions?: CloakfetchQuestion[];
  error?: string;
}

export interface CloakfetchExtractResponse {
  ok: boolean;
  keyPoints?: string[];
  error?: string;
}

export interface CloakfetchExpandResponse {
  ok: boolean;
  /** Canonical subject label returned by the AI (e.g. "英文词汇" / "数学" / "物理"). */
  subject?: string;
  /** Translation or short definition for English words. */
  translation?: string;
  /** Part-of-speech label for English words (n./v./adj./adv./...). */
  pos?: string;
  /** Structured Markdown body, ready for Obsidian preview. */
  markdown?: string;
  error?: string;
}

export interface ExpandedKnowledge {
  subject: string;
  translation: string;
  pos: string;
  markdown: string;
}

export interface CloakfetchFetchResponse {
  ok: boolean;
  /** Page title as reported by the browser (server-side via page.title()). */
  title?: string;
  html?: string;
  /** Cleaned Markdown extracted server-side via trafilatura. Prefer this over
   * `html` for AI prompts — it's already stripped of nav/ads/scripts. May be
   * empty if the server doesn't have trafilatura or extraction failed. */
  markdown?: string;
  error?: string;
}

export interface CloakfetchHealthResponse {
  ok: boolean;
  detail?: Record<string, unknown>;
  error?: string;
}

export class CloakfetchError extends Error {
  public readonly status: number;
  public readonly body: string;
  public readonly endpoint: string;

  constructor(message: string, opts: { status: number; body: string; endpoint: string }) {
    super(message);
    this.name = "CloakfetchError";
    this.status = opts.status;
    this.body = opts.body;
    this.endpoint = opts.endpoint;
  }
}

export interface CloakfetchClientOptions {
  baseUrl?: string;
  token?: string;
  defaultTimeoutMs?: number;
  tokenProvider?: () => string | undefined;
}

const DEFAULT_TIMEOUT_MS = 15_000;

interface CachedToken {
  value: string;
  loadedAt: number;
}

let defaultSettings: WorktableSettings | null = null;

export function setCloakfetchDefaultSettings(settings: WorktableSettings | null): void {
  defaultSettings = settings;
}

function makeFallbackSettings(): WorktableSettings {
  return { ...DEFAULT_SETTINGS };
}

function resolveServerConfigPaths(): string[] {
  // Build paths from $HOME so we never hardcode machine-specific prefixes.
  const home =
    (typeof process !== "undefined" && process.env && process.env.HOME) || "";
  const systemEtc = "/etc/obsidian-worktable/server.json";
  if (!home) return [systemEtc];
  return [`${home}/.config/obsidian-worktable/server.json`, systemEtc];
}

export class CloakfetchClient {
  private readonly settings: WorktableSettings;
  private readonly options: CloakfetchClientOptions;
  private cachedToken: CachedToken | null = null;

  constructor(settings?: WorktableSettings | null, options: CloakfetchClientOptions = {}) {
    this.settings = settings ?? defaultSettings ?? makeFallbackSettings();
    this.options = options;
  }

  private get baseUrl(): string {
    return (this.options.baseUrl ?? this.settings.serviceBaseUrl ?? "").replace(/\/+$/, "");
  }

  private get directAi(): DirectAiClient | null {
    if (!hasDirectAiConfig(this.settings)) return null;
    // Direct browser → AI provider calls work ONLY when:
    //  1. The provider's spec declares `browserSafe: true` (e.g. official
    //     Anthropic / OpenAI / Gemini endpoints ship permissive CORS).
    //  2. The configured baseUrl still points at the provider's official
    //     default endpoint — overriding the URL means routing through a
    //     third-party proxy, which usually rejects `anthropic-version` /
    //     `anthropic-dangerous-direct-browser-access` in preflight.
    //
    // When either check fails, return null so the caller falls through to
    // the local Cloakfetch service (`/ai/*` endpoints), which proxies the
    // call server-side and avoids CORS entirely — same approach used in
    // `server/server.py`.
    const providerId = this.settings.aiProvider;
    const spec = getProviderSpec(providerId);
    if (!spec || spec.browserSafe !== true) return null;
    const settingsBaseUrl = this.settings.aiBaseUrl.trim().replace(/\/+$/, "");
    const defaultBaseUrl = spec.defaultBaseUrl.replace(/\/+$/, "");
    if (settingsBaseUrl && settingsBaseUrl !== defaultBaseUrl) return null;
    return new DirectAiClient({
      provider: this.settings.aiProvider,
      apiKey: this.settings.aiApiKey.trim(),
      baseUrl: this.settings.aiBaseUrl.trim(),
      model: this.settings.aiModel.trim(),
    });
  }

  async health(): Promise<CloakfetchHealthResponse> {
    return this.requestJson<CloakfetchHealthResponse>("/health", { method: "GET" });
  }

  /**
   * Ping whichever AI backend is currently active.
   * Returns a structured result describing which path was taken.
   */
  async aiHealth(): Promise<{ ok: boolean; path: "direct" | "service" | "none"; detail?: string }> {
    const direct = this.directAi;
    if (direct) {
      const ok = await direct.ping();
      return { ok, path: "direct", detail: ok ? `model = ${direct.model}` : "Direct AI request failed" };
    }
    try {
      const res = await this.health();
      return { ok: !!res.ok, path: "service", detail: res.detail ? JSON.stringify(res.detail) : "" };
    } catch (err) {
      return { ok: false, path: "service", detail: (err as Error).message };
    }
  }

  async fetch(url: string, timeoutMs?: number): Promise<CloakfetchFetchResponse> {
    return this.fetchUrl(url, timeoutMs);
  }

  async fetchUrl(url: string, timeoutMs?: number): Promise<CloakfetchFetchResponse> {
    const search = new URLSearchParams({ url }).toString();
    return this.requestJson<CloakfetchFetchResponse>(`/fetch?${search}`, {
      method: "GET",
      timeoutMs,
    });
  }

  async questions(title: string, text: string, count = 3, timeoutMs?: number): Promise<CloakfetchQuestion[]> {
    return this.generateQuestions(title, text, count, timeoutMs);
  }

  async generateQuestions(title: string, text: string, count = 3, timeoutMs?: number): Promise<CloakfetchQuestion[]> {
    const direct = this.directAi;
    if (direct) return direct.generateQuestions(title, text, count);
    const res = await this.requestJson<CloakfetchQuestionsResponse>("/ai/questions", {
      method: "POST",
      body: { title, text, count },
      timeoutMs,
    });
    if (!res.ok) {
      throw new CloakfetchError(res.error || "AI question generation failed", {
        status: 0,
        body: JSON.stringify(res),
        endpoint: "/ai/questions",
      });
    }
    return res.questions ?? [];
  }

  async extract(title: string, text: string, maxPoints = 8, timeoutMs?: number): Promise<string[]> {
    return this.extractKeyPoints(title, text, maxPoints, timeoutMs);
  }

  async extractKeyPoints(title: string, text: string, maxPoints = 8, timeoutMs?: number): Promise<string[]> {
    const direct = this.directAi;
    if (direct) return direct.extractKeyPoints(title, text, maxPoints);
    const res = await this.requestJson<CloakfetchExtractResponse>("/ai/extract", {
      method: "POST",
      body: { title, text, maxPoints },
      timeoutMs,
    });
    if (!res.ok) {
      throw new CloakfetchError(res.error || "AI extract failed", {
        status: 0,
        body: JSON.stringify(res),
        endpoint: "/ai/extract",
      });
    }
    return res.keyPoints ?? [];
  }

  async expand(name: string, context = "", timeoutMs?: number): Promise<ExpandedKnowledge> {
    return this.expandKnowledge(name, context, timeoutMs);
  }

  async expandKnowledge(name: string, context = "", timeoutMs?: number): Promise<ExpandedKnowledge> {
    const direct = this.directAi;
    if (direct) return direct.expandKnowledge(name, context);
    const res = await this.requestJson<CloakfetchExpandResponse>("/ai/expand", {
      method: "POST",
      body: { name, context },
      timeoutMs,
    });
    if (!res.ok) {
      throw new CloakfetchError(res.error || "AI expand failed", {
        status: 0,
        body: JSON.stringify(res),
        endpoint: "/ai/expand",
      });
    }
    return {
      subject: res.subject ?? "",
      translation: res.translation ?? "",
      pos: res.pos ?? "",
      markdown: res.markdown ?? "",
    };
  }

  async diagnose(url?: string): Promise<Record<string, unknown> | string> {
    try {
      const health = await this.health();
      if (url) {
        try {
          await this.fetchUrl(url, 5_000);
          return { health: health as unknown as Record<string, unknown>, sampleFetch: "ok" };
        } catch (err) {
          return { health: health as unknown as Record<string, unknown>, sampleFetch: `error: ${(err as Error).message}` };
        }
      }
      return health as unknown as Record<string, unknown>;
    } catch (err) {
      return `diagnose failed: ${(err as Error).message}`;
    }
  }

  private async resolveToken(): Promise<string> {
    if (this.options.tokenProvider) {
      const provided = this.options.tokenProvider();
      if (provided) return provided;
    }
    if (this.options.token) return this.options.token;
    if (this.settings.serviceToken) return this.settings.serviceToken;
    if (this.cachedToken && Date.now() - this.cachedToken.loadedAt < 60_000) {
      return this.cachedToken.value;
    }
    const fromDisk = await readTokenFromDisk();
    this.cachedToken = { value: fromDisk, loadedAt: Date.now() };
    return fromDisk;
  }

  private async requestJson<T>(
    path: string,
    init: { method: string; body?: unknown; timeoutMs?: number }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = init.timeoutMs ?? this.options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeout);
    const token = await this.resolveToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["X-Worktable-Token"] = token;
    try {
      const res = await fetch(url, {
        method: init.method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch (_err) {
          parsed = { ok: false, error: text.slice(0, 300) };
        }
      } else {
        parsed = { ok: false, error: "Empty response body" };
      }
      if (!res.ok) {
        const message =
          (parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as { error?: string }).error === "string"
            ? (parsed as { error?: string }).error
            : null) ?? `HTTP ${res.status}`;
        throw new CloakfetchError(message, { status: res.status, body: text.slice(0, 1000), endpoint: path });
      }
      return parsed as T;
    } catch (err) {
      if (err instanceof CloakfetchError) throw err;
      if ((err as { name?: string })?.name === "AbortError") {
        throw new CloakfetchError(`Request to ${path} timed out after ${timeout}ms`, {
          status: 0,
          body: "",
          endpoint: path,
        });
      }
      throw new CloakfetchError(`Request to ${path} failed: ${(err as Error).message ?? String(err)}`, {
        status: 0,
        body: "",
        endpoint: path,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readTokenFromDisk(): Promise<string> {
  if (typeof require === "undefined") return "";
  try {
    // Lazy require so this module is safe to import in non-Node environments.
    // Obsidian's plugin runtime is desktop-only and always has node modules.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    for (const p of resolveServerConfigPaths()) {
      try {
        if (!fs.existsSync(p)) continue;
        const raw = fs.readFileSync(p, "utf-8");
        const obj = JSON.parse(raw) as { token?: unknown };
        if (obj && typeof obj.token === "string") return obj.token;
      } catch (_err) {
        // Try next path
      }
    }
  } catch (_err) {
    // require unavailable
  }
  return "";
}