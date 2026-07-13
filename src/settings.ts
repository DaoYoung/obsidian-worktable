import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianWorktablePlugin from "./main";

export type AiProvider = "anthropic";

export interface WorktableSettings {
  knowledgeFile: string;
  newsFolder: string;
  serviceBaseUrl: string;
  openOnStartup: boolean;
  enableFallbackProxies: boolean;
  serviceToken: string;
  /** Direct AI config. When all three (apiKey, baseUrl, model) are filled,
   * the plugin calls AI directly instead of going through the cloakfetch
   * service. */
  aiProvider: AiProvider;
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
}

export const DEFAULT_SETTINGS: WorktableSettings = {
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

/** True when the plugin has enough direct AI config to bypass the cloakfetch service. */
export function hasDirectAiConfig(settings: Partial<WorktableSettings>): boolean {
  return Boolean(
    (settings.aiApiKey ?? "").trim() &&
      (settings.aiBaseUrl ?? "").trim() &&
      (settings.aiModel ?? "").trim() &&
      (settings.aiProvider ?? "").trim(),
  );
}

export class WorktableSettingTab extends PluginSettingTab {
  private readonly plugin: ObsidianWorktablePlugin;

  constructor(app: App, plugin: ObsidianWorktablePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("obsidian-worktable-settings");

    containerEl.createEl("h2", { text: "Obsidian Worktable" });

    containerEl.createEl("h3", { text: "Vault paths" });

    new Setting(containerEl)
      .setName("Knowledge file")
      .setDesc("Vault-relative path used by the Learning and Review widgets (e.g. plans/知识点.md).")
      .addText((text) =>
        text
          .setPlaceholder("plans/知识点.md")
          .setValue(this.plugin.settings.knowledgeFile)
          .onChange(async (value) => {
            this.plugin.settings.knowledgeFile = value.trim() || DEFAULT_SETTINGS.knowledgeFile;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("News folder")
      .setDesc("Folder used by the News widget. Files outside this folder with the #news tag are also picked up.")
      .addText((text) =>
        text
          .setPlaceholder("news")
          .setValue(this.plugin.settings.newsFolder)
          .onChange(async (value) => {
            this.plugin.settings.newsFolder = value.trim() || DEFAULT_SETTINGS.newsFolder;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Local Cloakfetch service" });

    new Setting(containerEl)
      .setName("Service base URL")
      .setDesc("Base URL for the local Cloakfetch service (used for fetching pages and, when no direct AI key is set, for AI calls).")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:8765")
          .setValue(this.plugin.settings.serviceBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.serviceBaseUrl = value.trim() || DEFAULT_SETTINGS.serviceBaseUrl;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Service token (optional)")
      .setDesc("Optional bearer token sent as X-Worktable-Token. If empty, the plugin tries ~/.config/obsidian-worktable/server.json.")
      .addText((text) => {
        text
          .setPlaceholder("(empty)")
          .setValue(this.plugin.settings.serviceToken)
          .onChange(async (value) => {
            this.plugin.settings.serviceToken = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Open on startup")
      .setDesc("Open the Worktable view automatically when Obsidian starts.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.openOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Enable fallback proxies")
      .setDesc("Allow the Learning widget to fall back to public CORS proxies if the local service is unreachable.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableFallbackProxies)
          .onChange(async (value) => {
            this.plugin.settings.enableFallbackProxies = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Direct AI (optional)" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "When all three fields below are filled, the plugin calls AI directly through the Anthropic Messages API and does not need the local Cloakfetch service for AI features. Leave blank to keep using the local service.",
    });

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("AI provider. Only Anthropic is supported in this release.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("anthropic", "Anthropic (Messages API)")
          .setValue(this.plugin.settings.aiProvider)
          .onChange(async (value) => {
            this.plugin.settings.aiProvider = (value as AiProvider) || "anthropic";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Anthropic API key (sk-ant-...). Stored in the plugin's data.json like any other setting.")
      .addText((text) => {
        text
          .setPlaceholder("sk-ant-...")
          .setValue(this.plugin.settings.aiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.aiApiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.autocomplete = "off";
      });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Anthropic-compatible endpoint. Use https://api.anthropic.com for the official API, or a proxy/MiniMax-compatible URL.")
      .addText((text) =>
        text
          .setPlaceholder("https://api.anthropic.com")
          .setValue(this.plugin.settings.aiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.aiBaseUrl = value.trim() || DEFAULT_SETTINGS.aiBaseUrl;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Model identifier sent in the API request (e.g. claude-sonnet-4-5).")
      .addText((text) =>
        text
          .setPlaceholder("claude-sonnet-4-5")
          .setValue(this.plugin.settings.aiModel)
          .onChange(async (value) => {
            this.plugin.settings.aiModel = value.trim() || DEFAULT_SETTINGS.aiModel;
            await this.plugin.saveSettings();
          })
      );

    const aiStatus = containerEl.createDiv({ cls: "worktable-ai-status" });
    aiStatus.setText(
      hasDirectAiConfig(this.plugin.settings)
        ? `✓ Direct AI active · model = ${this.plugin.settings.aiModel}`
        : "Direct AI not configured — using the local Cloakfetch service for AI calls.",
    );
  }
}