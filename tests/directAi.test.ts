import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloakfetchError, type CloakfetchQuestion } from "../src/services/CloakfetchClient";
import { DirectAiClient } from "../src/services/DirectAiClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DirectAiClient - expandKnowledge", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to {baseUrl}/v1/messages and parses the JSON response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              subject: "物理",
              translation: "",
              pos: "",
              definition: "牛顿第一定律描述惯性。",
              points: ["保持匀速直线运动", "保持静止状态"],
              example: "",
              contrast: "",
              refs: "",
            }),
          },
        ],
      }),
    );
    const client = new DirectAiClient({
      provider: "anthropic",
      apiKey: "sk-test",
      baseUrl: "https://api.anthropic.com",
      model: "claude-x",
    });
    const entry = await client.expandKnowledge("牛顿第一定律", "惯性");
    expect(entry.subject).toBe("物理");
    expect(entry.markdown).toContain("牛顿第一定律");
    expect(entry.markdown).toContain("惯性");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-x");
    expect(body.max_tokens).toBe(1800);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("牛顿第一定律");
  });

  it("strips code fences and finds JSON object in surrounding prose", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: "text", text: "```json\n" + JSON.stringify({ subject: "数学", definition: "极限描述趋近行为" }) + "\n```" }],
      }),
    );
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "k", baseUrl: "https://x", model: "m" });
    const entry = await client.expandKnowledge("极限");
    expect(entry.subject).toBe("数学");
    expect(entry.markdown).toContain("极限");
  });

  it("falls back to raw text when JSON parsing fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: [{ type: "text", text: "这是一段非 JSON 的说明文本" }] }),
    );
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "k", baseUrl: "https://x", model: "m" });
    const entry = await client.expandKnowledge("自由能");
    expect(entry.markdown).toContain("自由能");
    expect(entry.markdown).toContain("非 JSON");
    expect(entry.subject).toBe("");
  });

  it("throws CloakfetchError on non-2xx responses", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "invalid key" } }, 401));
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "bad", baseUrl: "https://x", model: "m" });
    await expect(client.expandKnowledge("foo")).rejects.toMatchObject({
      name: "CloakfetchError",
      status: 401,
    });
  });

  it("throws CloakfetchError when API key is missing", async () => {
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "   ", baseUrl: "https://x", model: "m" });
    await expect(client.expandKnowledge("foo")).rejects.toBeInstanceOf(CloakfetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DirectAiClient - generateQuestions", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a JSON questions payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              questions: [
                {
                  type: "mc",
                  text: "重力方向?",
                  answer: "竖直向下",
                  options: ["竖直向下", "垂直向上", "水平向东", "无固定方向"],
                  explanation: "重力总是指向地心。",
                },
                {
                  type: "tf",
                  text: "光速恒定。",
                  answer: "对",
                  explanation: "",
                },
              ],
            }),
          },
        ],
      }),
    );
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "k", baseUrl: "https://x", model: "m" });
    const qs: CloakfetchQuestion[] = await client.generateQuestions("物理", "重力相关内容", 3);
    expect(qs.length).toBe(2);
    expect(qs[0]?.type).toBe("mc");
    expect(qs[0]?.options?.length).toBe(4);
    expect(qs[0]?.answer).toBe("竖直向下");
    expect(qs[1]?.type).toBe("tf");
    expect(qs[1]?.answer).toBe("对");
  });

  it("translates A/B/C/D answer shorthand into option text", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              questions: [
                {
                  type: "mc",
                  text: "Which is largest?",
                  answer: "B",
                  options: ["Sun", "Jupiter", "Earth", "Moon"],
                  explanation: "",
                },
              ],
            }),
          },
        ],
      }),
    );
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "k", baseUrl: "https://x", model: "m" });
    const qs = await client.generateQuestions("Planets", "size comparison", 1);
    expect(qs[0]?.answer).toBe("Jupiter");
  });

  it("rejects malformed mc items without enough options", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              questions: [
                { type: "mc", text: "x", answer: "y", options: ["only"] },
                { type: "tf", text: "ok", answer: "对" },
              ],
            }),
          },
        ],
      }),
    );
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "k", baseUrl: "https://x", model: "m" });
    const qs = await client.generateQuestions("t", "x", 3);
    expect(qs.length).toBe(1);
    expect(qs[0]?.type).toBe("tf");
  });
});

describe("DirectAiClient - extractKeyPoints", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns up to maxPoints from a JSON array response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          {
            type: "text",
            text: JSON.stringify(["点一：极限描述趋近行为", "点二：ε-δ 语言刻画极限", "点三：极限唯一性"]),
          },
        ],
      }),
    );
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "k", baseUrl: "https://x", model: "m" });
    const pts = await client.extractKeyPoints("极限", "极限是…", 5);
    expect(pts.length).toBe(3);
    expect(pts[0]).toContain("极限");
  });

  it("accepts {keyPoints: [...]} wrapper", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: "text", text: JSON.stringify({ keyPoints: ["alpha", "beta"] }) }],
      }),
    );
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "k", baseUrl: "https://x", model: "m" });
    const pts = await client.extractKeyPoints("t", "x", 5);
    expect(pts).toEqual(["alpha", "beta"]);
  });

  it("falls back to lines when JSON parsing fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: "text", text: "- 第一个要点\n- 第二个要点\n- 第三个要点" }],
      }),
    );
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "k", baseUrl: "https://x", model: "m" });
    const pts = await client.extractKeyPoints("t", "x", 5);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(pts[0]).toContain("第一个要点");
  });
});

describe("DirectAiClient - ping", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [] }, 200));
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "k", baseUrl: "https://x", model: "m" });
    const ok = await client.ping();
    expect(ok).toBe(true);
  });

  it("returns false on 4xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "nope" } }, 401));
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "bad", baseUrl: "https://x", model: "m" });
    expect(await client.ping()).toBe(false);
  });

  it("returns false when API key is empty", async () => {
    const client = new DirectAiClient({ provider: "anthropic", apiKey: "  ", baseUrl: "https://x", model: "m" });
    expect(await client.ping()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DirectAiClient - anthropic-dangerous-direct-browser-access header", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the dangerous header for api.anthropic.com", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
    });
    const client = new DirectAiClient({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
    });
    await client.expandKnowledge("test");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("omits the dangerous header for Anthropic-compatible proxies (MiniMax, DeepSeek, …)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
    });
    const client = new DirectAiClient({
      provider: "minimax",
      apiKey: "sk-cp-test",
      baseUrl: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M3",
    });
    await client.expandKnowledge("test");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
    expect(headers["x-api-key"]).toBe("sk-cp-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("omits the dangerous header for arbitrary custom endpoints", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
    });
    const client = new DirectAiClient({
      provider: "anthropic",
      apiKey: "sk-test",
      baseUrl: "https://my-proxy.example.com/v1",
      model: "m",
    });
    await client.expandKnowledge("test");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
  });

  it("omits the dangerous header in ping() for non-Anthropic hosts", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "",
    });
    const client = new DirectAiClient({
      provider: "minimax",
      apiKey: "sk-cp-test",
      baseUrl: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M3",
    });
    await client.ping();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
  });

  it("sends the dangerous header in ping() for api.anthropic.com", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "",
    });
    const client = new DirectAiClient({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
    });
    await client.ping();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });
});