import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "../src/services/ai/registry";
import { AiClient } from "../src/services/ai/client";
import type { AiProviderId } from "../src/services/ai/types";
import { CloakfetchError } from "../src/services/CloakfetchClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Case {
  id: AiProviderId;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Path appended to baseUrl when the request goes out. */
  expectedPath: string;
  /** Header key carrying the API key (case-insensitive match in test). */
  authHeader: "x-api-key" | "authorization" | "x-goog-api-key";
  /** Expected auth header value for key "sk-test" (already formatted). */
  expectedAuthValue: string;
  /** Where the "system" string lives in the JSON body. */
  systemLocation: "top-level" | "messages[0]" | "systemInstruction.parts[0].text";
  /** Token-limit key in the JSON body. */
  tokenKey: "max_tokens" | "maxOutputTokens";
  /** Shape of a successful 2xx response. */
  successBody: Record<string, unknown>;
  /** Expected assistant text pulled out by parseResponse. */
  expectedText: string;
  /** Shape of a non-2xx error body. */
  errorBody: Record<string, unknown>;
  /** Expected error message pulled out by parseError. */
  expectedError: string;
  /** Whether `anthropic-dangerous-direct-browser-access: true` should be sent. */
  sendDangerousHeader: boolean;
}

const CASES: Case[] = [
  {
    id: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
    expectedPath: "/v1/messages",
    authHeader: "x-api-key",
    expectedAuthValue: "sk-test",
    systemLocation: "top-level",
    tokenKey: "max_tokens",
    successBody: { content: [{ type: "text", text: "hello" }] },
    expectedText: "hello",
    errorBody: { error: { message: "bad key" } },
    expectedError: "bad key",
    sendDangerousHeader: true,
  },
  {
    id: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    expectedPath: "/chat/completions",
    authHeader: "authorization",
    expectedAuthValue: "Bearer sk-test",
    systemLocation: "messages[0]",
    tokenKey: "max_tokens",
    successBody: { choices: [{ message: { content: "hi from gpt" } }] },
    expectedText: "hi from gpt",
    errorBody: { error: { message: "invalid api key" } },
    expectedError: "invalid api key",
    sendDangerousHeader: false,
  },
  {
    id: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    expectedPath: "/models/gemini-2.0-flash:generateContent",
    authHeader: "x-goog-api-key",
    expectedAuthValue: "sk-test",
    systemLocation: "systemInstruction.parts[0].text",
    tokenKey: "maxOutputTokens",
    successBody: { candidates: [{ content: { parts: [{ text: "hi from gemini" }] } }] },
    expectedText: "hi from gemini",
    errorBody: { error: { message: "permission denied" } },
    expectedError: "permission denied",
    sendDangerousHeader: false,
  },
  {
    id: "deepseek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    expectedPath: "/chat/completions",
    authHeader: "authorization",
    expectedAuthValue: "Bearer sk-test",
    systemLocation: "messages[0]",
    tokenKey: "max_tokens",
    successBody: { choices: [{ message: { content: "deepseek reply" } }] },
    expectedText: "deepseek reply",
    errorBody: { error: { message: "rate limited" } },
    expectedError: "rate limited",
    sendDangerousHeader: false,
  },
  {
    id: "moonshot",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    expectedPath: "/chat/completions",
    authHeader: "authorization",
    expectedAuthValue: "Bearer sk-test",
    systemLocation: "messages[0]",
    tokenKey: "max_tokens",
    successBody: { choices: [{ message: { content: "kimi says hi" } }] },
    expectedText: "kimi says hi",
    errorBody: { error: { message: "quota exhausted" } },
    expectedError: "quota exhausted",
    sendDangerousHeader: false,
  },
  {
    id: "zhipu",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    expectedPath: "/chat/completions",
    authHeader: "authorization",
    expectedAuthValue: "Bearer sk-test",
    systemLocation: "messages[0]",
    tokenKey: "max_tokens",
    successBody: { choices: [{ message: { content: "glm hi" } }] },
    expectedText: "glm hi",
    errorBody: { error: { message: "auth failed" } },
    expectedError: "auth failed",
    sendDangerousHeader: false,
  },
  {
    id: "bailian",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    expectedPath: "/chat/completions",
    authHeader: "authorization",
    expectedAuthValue: "Bearer sk-test",
    systemLocation: "messages[0]",
    tokenKey: "max_tokens",
    successBody: { choices: [{ message: { content: "qwen hi" } }] },
    expectedText: "qwen hi",
    errorBody: { error: { message: "invalid model" } },
    expectedError: "invalid model",
    sendDangerousHeader: false,
  },
  {
    id: "volcengine",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1-5-pro-32k-250115",
    expectedPath: "/chat/completions",
    authHeader: "authorization",
    expectedAuthValue: "Bearer sk-test",
    systemLocation: "messages[0]",
    tokenKey: "max_tokens",
    successBody: { choices: [{ message: { content: "doubao hi" } }] },
    expectedText: "doubao hi",
    errorBody: { error: { message: "forbidden" } },
    expectedError: "forbidden",
    sendDangerousHeader: false,
  },
  {
    id: "minimax",
    defaultBaseUrl: "https://api.minimaxi.com/anthropic",
    defaultModel: "MiniMax-M3",
    expectedPath: "/v1/messages",
    authHeader: "x-api-key",
    expectedAuthValue: "sk-test",
    systemLocation: "top-level",
    tokenKey: "max_tokens",
    successBody: { content: [{ type: "text", text: "minimax hi" }] },
    expectedText: "minimax hi",
    errorBody: { error: { message: "auth failed" } },
    expectedError: "auth failed",
    sendDangerousHeader: false,
  },
];

describe("AI provider registry", () => {
  it("exposes a spec for every provider id", () => {
    const ids = Object.keys(AI_PROVIDERS).sort();
    expect(ids).toEqual(
      [
        "anthropic",
        "bailian",
        "deepseek",
        "gemini",
        "minimax",
        "moonshot",
        "openai",
        "volcengine",
        "zhipu",
      ].sort(),
    );
  });

  it.each(CASES.map((c) => [c.id, c]))("%s spec matches the registry", (_id, c) => {
    const spec = AI_PROVIDERS[c.id];
    expect(spec.id).toBe(c.id);
    expect(spec.defaultBaseUrl).toBe(c.defaultBaseUrl);
    expect(spec.defaultModel).toBe(c.defaultModel);
    expect(spec.displayName.length).toBeGreaterThan(0);
    expect(spec.modelPlaceholder).toBe(c.defaultModel);
  });
});

describe.each(CASES)("AiClient with $id provider", (c) => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastRequest(): { url: string; init: RequestInit; headers: Record<string, string>; body: Record<string, unknown> } {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    return { url, init, headers, body };
  }

  it("posts to the right URL with the right auth header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(c.successBody));
    const client = new AiClient({
      provider: c.id,
      apiKey: "sk-test",
      baseUrl: c.defaultBaseUrl,
      model: c.defaultModel,
    });
    await client.call("sys", "user", 256);
    const { url, headers } = lastRequest();
    expect(url).toBe(`${c.defaultBaseUrl}${c.expectedPath}`);
    expect(headers["content-type"]).toBe("application/json");
    const actualAuth = headers[c.authHeader] ?? headers[c.authHeader.toUpperCase()];
    expect(actualAuth).toBe(c.expectedAuthValue);
    if (c.sendDangerousHeader) {
      expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    } else {
      expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
    }
  });

  it("shapes the request body the way the provider expects", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(c.successBody));
    const client = new AiClient({
      provider: c.id,
      apiKey: "sk-test",
      baseUrl: c.defaultBaseUrl,
      model: c.defaultModel,
    });
    await client.call("system-msg", "user-msg", 1024);
    const { body } = lastRequest();
    // Gemini encodes the model in the URL path, not the body. The
    // authHeader test above already verifies the right model made it into
    // the request URL.
    if (c.id !== "gemini") {
      expect(body.model).toBe(c.defaultModel);
    }
    if (c.id === "gemini") {
      const gc = body.generationConfig as { maxOutputTokens: number };
      expect(gc.maxOutputTokens).toBe(1024);
    } else {
      expect(body[c.tokenKey]).toBe(1024);
    }
    if (c.systemLocation === "top-level") {
      expect(body.system).toBe("system-msg");
      const msgs = body.messages as Array<{ role: string; content: string }>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toEqual({ role: "user", content: "user-msg" });
    } else if (c.systemLocation === "messages[0]") {
      const msgs = body.messages as Array<{ role: string; content: string }>;
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toEqual({ role: "system", content: "system-msg" });
      expect(msgs[1]).toEqual({ role: "user", content: "user-msg" });
    } else {
      const sys = body.systemInstruction as { parts: Array<{ text: string }> };
      expect(sys.parts[0]?.text).toBe("system-msg");
      const contents = body.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
      expect(contents).toHaveLength(1);
      expect(contents[0]?.role).toBe("user");
      expect(contents[0]?.parts[0]?.text).toBe("user-msg");
    }
  });

  it("returns the assistant text on a 2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(c.successBody));
    const client = new AiClient({
      provider: c.id,
      apiKey: "sk-test",
      baseUrl: c.defaultBaseUrl,
      model: c.defaultModel,
    });
    const out = await client.call("sys", "user", 256);
    expect(out).toBe(c.expectedText);
  });

  it("surfaces the provider's error message on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(c.errorBody, 401));
    const client = new AiClient({
      provider: c.id,
      apiKey: "sk-test",
      baseUrl: c.defaultBaseUrl,
      model: c.defaultModel,
    });
    await expect(client.call("sys", "user", 256)).rejects.toMatchObject({
      name: "CloakfetchError",
      status: 401,
      message: c.expectedError,
    });
  });
});

describe("AiClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trims trailing slashes from baseUrl", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: [{ type: "text", text: "ok" }] }),
    );
    const client = new AiClient({
      provider: "anthropic",
      apiKey: "sk-test",
      baseUrl: "https://api.anthropic.com///",
      model: "claude-sonnet-4-5",
    });
    await client.call("s", "u", 16);
    const url = (fetchMock.mock.calls[0] as [string, RequestInit])[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("encodes the model name in the Gemini path", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );
    const client = new AiClient({
      provider: "gemini",
      apiKey: "sk-test",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "models/gemini-2.0-flash",
    });
    await client.call("s", "u", 16);
    const url = (fetchMock.mock.calls[0] as [string, RequestInit])[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/models%2Fgemini-2.0-flash:generateContent",
    );
  });

  it("throws CloakfetchError when apiKey is empty", async () => {
    const client = new AiClient({
      provider: "openai",
      apiKey: "   ",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
    await expect(client.call("s", "u", 16)).rejects.toBeInstanceOf(CloakfetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ping() returns true on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [{ type: "text", text: "pong" }] }));
    const client = new AiClient({
      provider: "anthropic",
      apiKey: "sk-test",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
    });
    expect(await client.ping()).toBe(true);
  });

  it("ping() returns false on 4xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "nope" } }, 401));
    const client = new AiClient({
      provider: "openai",
      apiKey: "bad",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
    expect(await client.ping()).toBe(false);
  });

  it("ping() returns false when apiKey is empty", async () => {
    const client = new AiClient({
      provider: "openai",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
    expect(await client.ping()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps invalid JSON 2xx responses in CloakfetchError", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("not json at all", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );
    const client = new AiClient({
      provider: "anthropic",
      apiKey: "sk-test",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
    });
    await expect(client.call("s", "u", 16)).rejects.toBeInstanceOf(CloakfetchError);
  });

  it("wraps empty assistant text in CloakfetchError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [] }));
    const client = new AiClient({
      provider: "anthropic",
      apiKey: "sk-test",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
    });
    await expect(client.call("s", "u", 16)).rejects.toMatchObject({
      name: "CloakfetchError",
      message: "AI provider returned no text content",
    });
  });

  it("falls back to HTTP status when error body isn't JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("service down", { status: 503, headers: { "Content-Type": "text/plain" } }),
    );
    const client = new AiClient({
      provider: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
    await expect(client.call("s", "u", 16)).rejects.toMatchObject({
      name: "CloakfetchError",
      status: 503,
      message: "HTTP 503",
    });
  });
});
