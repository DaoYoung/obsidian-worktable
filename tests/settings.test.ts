import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, hasDirectAiConfig } from "../src/settings";

describe("settings - defaults", () => {
  it("declares the expected AI fields with safe defaults", () => {
    expect(DEFAULT_SETTINGS.aiProvider).toBe("anthropic");
    expect(DEFAULT_SETTINGS.aiApiKey).toBe("");
    expect(DEFAULT_SETTINGS.aiBaseUrl).toBe("https://api.anthropic.com");
    expect(DEFAULT_SETTINGS.aiModel).toBe("claude-sonnet-4-5");
  });
});

describe("settings - hasDirectAiConfig", () => {
  it("returns true when all three AI fields are non-empty", () => {
    expect(hasDirectAiConfig(DEFAULT_SETTINGS)).toBe(false);
    expect(
      hasDirectAiConfig({ ...DEFAULT_SETTINGS, aiApiKey: "sk-test" }),
    ).toBe(true);
  });

  it("returns false when apiKey is missing", () => {
    expect(
      hasDirectAiConfig({
        ...DEFAULT_SETTINGS,
        aiApiKey: "",
      }),
    ).toBe(false);
  });

  it("returns false when apiKey is whitespace only", () => {
    expect(
      hasDirectAiConfig({
        ...DEFAULT_SETTINGS,
        aiApiKey: "   ",
      }),
    ).toBe(false);
  });

  it("returns false when baseUrl is missing", () => {
    expect(
      hasDirectAiConfig({
        ...DEFAULT_SETTINGS,
        aiApiKey: "sk",
        aiBaseUrl: "",
      }),
    ).toBe(false);
  });

  it("returns false when model is missing", () => {
    expect(
      hasDirectAiConfig({
        ...DEFAULT_SETTINGS,
        aiApiKey: "sk",
        aiModel: "",
      }),
    ).toBe(false);
  });

  it("treats whitespace-padded fields as empty", () => {
    expect(
      hasDirectAiConfig({
        aiProvider: "anthropic",
        aiApiKey: "  sk-test  ",
        aiBaseUrl: "  https://api.example.com  ",
        aiModel: "  claude-x  ",
      }),
    ).toBe(true);
  });
});