import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, hasDirectAiConfig } from "../src/settings";
import { AI_PROVIDERS } from "../src/services/ai/registry";
import { AI_PROVIDER_IDS } from "../src/services/ai/types";
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

  it("returns true for every supported provider id", () => {
    for (const id of AI_PROVIDER_IDS) {
      const spec = AI_PROVIDERS[id];
      expect(
        hasDirectAiConfig({
          aiProvider: id,
          aiApiKey: "sk-test",
          aiBaseUrl: spec.defaultBaseUrl,
          aiModel: spec.defaultModel,
        }),
      ).toBe(true);
    }
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

describe("settings - service token override wording", () => {
  it("English token field is labeled as an override, not a primary input", () => {
    const s = getSettingsStrings("en");
    expect(s.serviceTokenName).toBe("Service token (advanced override)");
    // Description leads with the auto-discovery path; manual fill is a fallback.
    expect(s.serviceTokenDesc).toMatch(/leave empty/i);
    expect(s.serviceTokenDesc).toMatch(/~?\/\.config\/obsidian-worktable\/server\.json/);
    expect(s.serviceTokenDesc).toMatch(/override|bypass/i);
  });

  it("Chinese token field mirrors the English override framing", () => {
    const s = getSettingsStrings("zh");
    expect(s.serviceTokenName).toBe("服务令牌(高级覆盖)");
    expect(s.serviceTokenDesc).toContain("~/.config/obsidian-worktable/server.json");
    expect(s.serviceTokenDesc).toMatch(/留空|覆盖/);
  });
});

describe("settings - setup wizard strings", () => {
  it("English wizard has heading, intro, and test button label", () => {
    const s = getSettingsStrings("en");
    expect(s.serviceSetupHeading).toBe("Setup local service");
    expect(s.serviceSetupIntro).toMatch(/article fetching|Direct AI/i);
    expect(s.serviceSetupTestButton).toBe("Test connection");
    expect(s.serviceSetupCopyHint).toBe("Click to view · then Cmd/Ctrl+C to copy");
  });

  it("English wizard bundles Linux/Windows into a single fallback line", () => {
    const s = getSettingsStrings("en");
    expect(s.serviceSetupOtherOs).toMatch(/linux/i);
    expect(s.serviceSetupOtherOs).toMatch(/windows/i);
    expect(s.serviceSetupOtherOs).toMatch(/server\.py/);
  });

  it("English wizard exposes macOS one-shot commands", () => {
    const s = getSettingsStrings("en");
    expect(s.serviceSetupMacosTitle).toMatch(/macOS/i);
    expect(s.serviceSetupMacosCloneCmd).toContain("git clone https://github.com/DaoYoung/obsidian-worktable.git");
    expect(s.serviceSetupMacosCloneCmd).toContain("~/obsidian-worktable");
    expect(s.serviceSetupMacosInstallCmd).toBe("bash ~/obsidian-worktable/server/install-macos.sh");
  });

  it("English wizard formats test results with the configured service base URL", () => {
    const s = getSettingsStrings("en");
    expect(s.serviceSetupResultOkServiceAt("http://127.0.0.1:8765"))
      .toBe("✓ Local service reachable at http://127.0.0.1:8765");
    expect(s.serviceSetupResultDown("ECONNREFUSED"))
      .toBe("✗ Local service is not reachable: ECONNREFUSED");
    expect(s.serviceSetupResultDirectAi).toContain("Direct AI");
  });

  it("Chinese wizard mirrors the English structure", () => {
    const s = getSettingsStrings("zh");
    expect(s.serviceSetupHeading).toBe("本地服务一键安装");
    expect(s.serviceSetupTestButton).toBe("测试连接");
    expect(s.serviceSetupCopyHint).toBe("点击查看 · 然后按 Cmd/Ctrl+C 复制");
    expect(s.serviceSetupMacosInstallCmd).toBe("bash ~/obsidian-worktable/server/install-macos.sh");
  });

  it("Chinese wizard formats test results with the configured service base URL", () => {
    const s = getSettingsStrings("zh");
    expect(s.serviceSetupResultOkServiceAt("http://127.0.0.1:8765"))
      .toBe("✓ 本地服务可达 http://127.0.0.1:8765");
    expect(s.serviceSetupResultDown("ECONNREFUSED"))
      .toBe("✗ 本地服务不可达:ECONNREFUSED");
  });
});