import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloakfetchClient, CloakfetchError } from "../src/services/CloakfetchClient";
import type { WorktableSettings } from "../src/settings";

const baseSettings: WorktableSettings = {
  knowledgeFile: "plans/知识点.md",
  newsFolder: "news",
  serviceBaseUrl: "http://127.0.0.1:8765",
  openOnStartup: true,
  enableFallbackProxies: true,
  serviceToken: "",
  aiProvider: "anthropic",
  aiApiKey: "",
  aiBaseUrl: "https://api.anthropic.com",
  aiModel: "claude-sonnet-4-5",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CloakfetchClient - health", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok when server reports ok", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, detail: { v: 1 } }));
    const client = new CloakfetchClient(baseSettings);
    const res = await client.health();
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://127.0.0.1:8765/health");
  });

  it("raises CloakfetchError on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "boom" }, 500));
    const client = new CloakfetchClient(baseSettings);
    await expect(client.health()).rejects.toBeInstanceOf(CloakfetchError);
  });
});

describe("CloakfetchClient - questions", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts and returns questions", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, questions: [{ type: "mc", text: "Q", answer: "A" }] })
    );
    const client = new CloakfetchClient(baseSettings);
    const qs = await client.questions("Title", "context", 1);
    expect(qs.length).toBe(1);
    expect(qs[0]?.text).toBe("Q");
  });

  it("throws on ok=false response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "no key" }));
    const client = new CloakfetchClient(baseSettings);
    await expect(client.questions("", "x", 1)).rejects.toThrow(/no key/);
  });
});

describe("CloakfetchClient - token resolution", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses token from settings when provided", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new CloakfetchClient({ ...baseSettings, serviceToken: "secret" });
    await client.health();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Worktable-Token"]).toBe("secret");
  });

  it("prefers provider-supplied token over settings", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new CloakfetchClient(
      { ...baseSettings, serviceToken: "from-settings" },
      { tokenProvider: () => "from-provider" }
    );
    await client.health();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Worktable-Token"]).toBe("from-provider");
  });

  it("omits token header when none is available", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new CloakfetchClient({ ...baseSettings, serviceToken: "" });
    await client.health();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Worktable-Token"]).toBeUndefined();
  });
});

describe("CloakfetchClient - timeout", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps AbortError into CloakfetchError with timeout message", async () => {
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });
    const client = new CloakfetchClient(baseSettings, { defaultTimeoutMs: 5 });
    await expect(client.health()).rejects.toMatchObject({ name: "CloakfetchError" });
  });
});

describe("CloakfetchClient - expand", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns structured entry for successful expand", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      subject: "物理",
      translation: "",
      pos: "",
      markdown: "# Heading",
    }));
    const client = new CloakfetchClient(baseSettings);
    const entry = await client.expand("SOLID", "context");
    expect(entry.subject).toBe("物理");
    expect(entry.markdown).toBe("# Heading");
  });
});

describe("CloakfetchClient - fetch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves server-extracted markdown and title in the fetch response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      title: "Why Birds Migrate",
      html: "<html><body><h1>Why Birds Migrate</h1><p>long article…</p></body></html>",
      markdown: "# Why Birds Migrate\n\nBirds migrate every year…",
    }));
    const client = new CloakfetchClient(baseSettings);
    const res = await client.fetchUrl("https://example.com/birds");
    expect(res.ok).toBe(true);
    expect(res.title).toBe("Why Birds Migrate");
    expect(res.markdown).toContain("# Why Birds Migrate");
    expect(res.html).toContain("<h1>");
  });

  it("accepts a fetch response with no markdown field (older server)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      title: "Old",
      html: "<html></html>",
    }));
    const client = new CloakfetchClient(baseSettings);
    const res = await client.fetchUrl("https://example.com/old");
    expect(res.ok).toBe(true);
    expect(res.title).toBe("Old");
    expect(res.markdown).toBeUndefined();
  });
});

describe("CloakfetchClient - direct AI routing", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes expand to the direct AI client when AI settings point at the official endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              subject: "英文词汇",
              translation: "短暂的；瞬息的",
              pos: "adj.",
              definition: "持续时间很短",
              points: [],
            }),
          },
        ],
      }),
    );
    const client = new CloakfetchClient({
      ...baseSettings,
      aiApiKey: "sk-direct",
      // baseSettings already sets aiBaseUrl to the official Anthropic URL;
      // passing the configured value verbatim keeps the test honest.
      aiModel: "claude-direct",
    });
    const entry = await client.expand("ephemeral", "context");
    expect(entry.subject).toBe("英文词汇");
    expect(entry.translation).toBe("短暂的；瞬息的");
    expect(entry.pos).toBe("adj.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(url).not.toContain("127.0.0.1:8765");
  });

  it("falls back to the local service when AI baseUrl is a third-party proxy (CORS-unsafe)", async () => {
    // Direct browser → api.example.com would be blocked by preflight because
    // the proxy doesn't whitelist `anthropic-version` in
    // Access-Control-Allow-Headers. The client must transparently fall
    // through to the local Cloakfetch service.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        subject: "数学",
        translation: "",
        pos: "",
        markdown: "# Math",
      }),
    );
    const client = new CloakfetchClient({
      ...baseSettings,
      aiApiKey: "sk-direct",
      aiBaseUrl: "https://api.minimaxi.com/anthropic",
      aiModel: "MiniMax-M3",
    });
    const entry = await client.expand("fraction", "");
    expect(entry.subject).toBe("数学");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("127.0.0.1:8765");
    expect(url).toContain("/ai/expand");
  });

  it("routes generateQuestions to direct AI when configured", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              questions: [
                { type: "tf", text: "q", answer: "对", explanation: "" },
              ],
            }),
          },
        ],
      }),
    );
    const client = new CloakfetchClient({
      ...baseSettings,
      aiApiKey: "sk-direct",
    });
    const qs = await client.generateQuestions("Title", "Body", 3);
    expect(qs.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.startsWith("https://api.anthropic.com/")).toBe(true);
  });

  it("falls back to the local service when AI fields are empty", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        subject: "数学",
        translation: "",
        pos: "",
        markdown: "# Math",
      }),
    );
    const client = new CloakfetchClient({ ...baseSettings, aiApiKey: "" });
    const entry = await client.expand("极限");
    expect(entry.subject).toBe("数学");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://127.0.0.1:8765/ai/expand");
  });

  it("falls back when aiModel is empty even if other fields are set", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, subject: "化学", translation: "", pos: "", markdown: "# Chem" }),
    );
    const client = new CloakfetchClient({
      ...baseSettings,
      aiApiKey: "sk",
      aiBaseUrl: "https://api.example.com",
      aiModel: "",
    });
    const entry = await client.expand("水");
    expect(entry.subject).toBe("化学");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://127.0.0.1:8765/ai/expand");
  });

  it("aiHealth reports direct path when configured", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [] }, 200));
    const client = new CloakfetchClient({
      ...baseSettings,
      aiApiKey: "sk-direct",
    });
    const result = await client.aiHealth();
    expect(result.path).toBe("direct");
    expect(result.ok).toBe(true);
  });

  it("aiHealth reports service path when direct AI is not configured", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, detail: { v: 1 } }));
    const client = new CloakfetchClient({ ...baseSettings, aiApiKey: "" });
    const result = await client.aiHealth();
    expect(result.path).toBe("service");
    expect(result.ok).toBe(true);
  });
});
