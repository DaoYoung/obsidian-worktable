import { App, moment, PluginSettingTab, Setting } from "obsidian";
import type ObsidianWorktablePlugin from "./main";
import { AI_PROVIDERS } from "./services/ai/registry";
import type { AiProviderId } from "./services/ai/types";
import { getSettingsStrings } from "./settingsStrings";
import { renderServiceSetup } from "./settingsServiceSetup";

export type AiProvider = AiProviderId;

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

    // Direct AI is intentionally surfaced before the local Cloakfetch service
    // section so first-time users see that they can use AI features without
    // running any local server. The Learning widget shows a matching banner
    // that flips between "active" and "inactive" depending on this config.
    containerEl.createEl("h3", { text: t.directAiSection });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t.directAiIntro,
    });

    const activeSpec = AI_PROVIDERS[this.plugin.settings.aiProvider] ?? AI_PROVIDERS.anthropic;

    new Setting(containerEl)
      .setName(t.aiProviderName)
      .setDesc(t.aiProviderDesc)
      .addDropdown((dropdown) => {
        for (const spec of Object.values(AI_PROVIDERS)) {
          dropdown.addOption(spec.id, spec.displayName);
        }
        dropdown
          .setValue(this.plugin.settings.aiProvider)
          .onChange(async (value) => {
            const next = (value as AiProvider) in AI_PROVIDERS ? (value as AiProvider) : "anthropic";
            this.plugin.settings.aiProvider = next;
            // Auto-populate baseUrl and model with the new provider's defaults
            // so a one-click swap is enough for the common case. The user can
            // still override either field afterwards.
            const spec = AI_PROVIDERS[next];
            this.plugin.settings.aiBaseUrl = spec.defaultBaseUrl;
            this.plugin.settings.aiModel = spec.defaultModel;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName(t.aiApiKeyName)
      .setDesc(t.aiApiKeyDesc)
      .addText((text) => {
        text
          .setPlaceholder("sk-...")
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
          .setPlaceholder(activeSpec.defaultBaseUrl)
          .setValue(this.plugin.settings.aiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.aiBaseUrl = value.trim() || activeSpec.defaultBaseUrl;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t.aiModelName)
      .setDesc(t.aiModelDesc)
      .addText((text) =>
        text
          .setPlaceholder(activeSpec.modelPlaceholder)
          .setValue(this.plugin.settings.aiModel)
          .onChange(async (value) => {
            this.plugin.settings.aiModel = value.trim() || activeSpec.defaultModel;
            await this.plugin.saveSettings();
          })
      );

    const aiStatus = containerEl.createDiv({ cls: "worktable-ai-status" });
    aiStatus.setText(
      hasDirectAiConfig(this.plugin.settings)
        ? t.aiStatusActive(this.plugin.settings.aiModel)
        : t.aiStatusInactive,
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
  }
}