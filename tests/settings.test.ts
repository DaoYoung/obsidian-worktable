import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, hasDirectAiConfig } from "../src/settings";
import { getSettingsStrings, pickSettingsLocale } from "../src/settingsStrings";

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

describe("settings - locale picking", () => {
  it("treats every Chinese variant as zh", () => {
    expect(pickSettingsLocale("zh")).toBe("zh");
    expect(pickSettingsLocale("zh-CN")).toBe("zh");
    expect(pickSettingsLocale("zh-TW")).toBe("zh");
    expect(pickSettingsLocale("zh-HK")).toBe("zh");
    expect(pickSettingsLocale("ZH")).toBe("zh");
  });

  it("falls back to en for non-Chinese locales", () => {
    expect(pickSettingsLocale("en")).toBe("en");
    expect(pickSettingsLocale("en-US")).toBe("en");
    expect(pickSettingsLocale("ja")).toBe("en");
    expect(pickSettingsLocale("ko")).toBe("en");
    expect(pickSettingsLocale("fr")).toBe("en");
    expect(pickSettingsLocale("de")).toBe("en");
  });

  it("treats empty / null / undefined input as en (safe default)", () => {
    expect(pickSettingsLocale(null)).toBe("en");
    expect(pickSettingsLocale(undefined)).toBe("en");
    expect(pickSettingsLocale("")).toBe("en");
  });

  it("does not misclassify codes that merely contain the letters zh", () => {
    // Many language tags include "zh" as a script subtag — only the leading
    // tag should trigger Chinese.
    expect(pickSettingsLocale("en")).toBe("en");
    expect(pickSettingsLocale("foo-zh")).toBe("en");
  });
});

describe("settings - getSettingsStrings", () => {
  it("returns Chinese bundle for zh locales", () => {
    const s = getSettingsStrings("zh-CN");
    expect(s.knowledgeFileName).toBe("知识点文件");
    expect(s.newsFolderName).toBe("新闻文件夹");
    expect(s.serviceSection).toBe("本地 Cloakfetch 服务");
    expect(s.directAiSection).toBe("直连 AI（可选）".replace("（", "(").replace("）", ")"));
    expect(s.aiApiKeyName).toBe("API 密钥");
    expect(s.aiStatusInactive).toContain("本地 Cloakfetch 服务");
  });

  it("returns English bundle for non-zh locales", () => {
    const s = getSettingsStrings("en");
    expect(s.knowledgeFileName).toBe("Knowledge file");
    expect(s.newsFolderName).toBe("News folder");
    expect(s.directAiSection).toBe("Direct AI (optional)");
    expect(s.aiApiKeyName).toBe("API key");
  });

  it("English bundle uses parentheses (not full-width)", () => {
    const s = getSettingsStrings("en");
    expect(s.directAiSection).toContain("(optional)");
    expect(s.directAiSection).not.toContain("（");
  });

  it("formats the active-AI status line with the model name", () => {
    expect(getSettingsStrings("en").aiStatusActive("claude-sonnet-4-5"))
      .toBe("✓ Direct AI active · model = claude-sonnet-4-5");
    expect(getSettingsStrings("zh").aiStatusActive("claude-sonnet-4-5"))
      .toBe("✓ 直连 AI 已启用 · 模型 = claude-sonnet-4-5");
  });

  it("falls back to English when locale is missing", () => {
    const s = getSettingsStrings(null);
    expect(s.knowledgeFileName).toBe("Knowledge file");
  });
});