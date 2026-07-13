import { App, moment, PluginSettingTab, Setting } from "obsidian";
import type ObsidianWorktablePlugin from "./main";
import { getSettingsStrings } from "./settingsStrings";
import { renderServiceSetup } from "./settingsServiceSetup";

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

    // Resolve labels per render. The settings tab re-renders whenever the
    // user opens it (and after a language change), so we don't need to
    // subscribe to changes. `moment.locale()` is the public Obsidian API for
    // reading the active UI locale.
    const t = getSettingsStrings(moment.locale() ?? null);

    containerEl.createEl("h2", { text: t.heading });

    containerEl.createEl("h3", { text: t.pathSection });

    new Setting(containerEl)
      .setName(t.knowledgeFileName)
      .setDesc(t.knowledgeFileDesc)
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
      .setName(t.newsFolderName)
      .setDesc(t.newsFolderDesc)
      .addText((text) =>
        text
          .setPlaceholder("news")
          .setValue(this.plugin.settings.newsFolder)
          .onChange(async (value) => {
            this.plugin.settings.newsFolder = value.trim() || DEFAULT_SETTINGS.newsFolder;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: t.serviceSection });

    new Setting(containerEl)
      .setName(t.serviceBaseUrlName)
      .setDesc(t.serviceBaseUrlDesc)
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
      .setName(t.serviceTokenName)
      .setDesc(t.serviceTokenDesc)
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
      .setName(t.openOnStartupName)
      .setDesc(t.openOnStartupDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.openOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.fallbackProxiesName)
      .setDesc(t.fallbackProxiesDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableFallbackProxies)
          .onChange(async (value) => {
            this.plugin.settings.enableFallbackProxies = value;
            await this.plugin.saveSettings();
          })
      );

    renderServiceSetup(containerEl, this.plugin, t);

    containerEl.createEl("h3", { text: t.directAiSection });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t.directAiIntro,
    });

    new Setting(containerEl)
      .setName(t.aiProviderName)
      .setDesc(t.aiProviderDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("anthropic", t.aiProviderOption)
          .setValue(this.plugin.settings.aiProvider)
          .onChange(async (value) => {
            this.plugin.settings.aiProvider = (value as AiProvider) || "anthropic";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.aiApiKeyName)
      .setDesc(t.aiApiKeyDesc)
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
      .setName(t.aiBaseUrlName)
      .setDesc(t.aiBaseUrlDesc)
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
      .setName(t.aiModelName)
      .setDesc(t.aiModelDesc)
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
        ? t.aiStatusActive(this.plugin.settings.aiModel)
        : t.aiStatusInactive,
    );
  }
}
