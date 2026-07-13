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

  it("returns markdown for successful expand", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, markdown: "# Heading" }));
    const client = new CloakfetchClient(baseSettings);
    const md = await client.expand("SOLID", "context");
    expect(md).toBe("# Heading");
  });
});
