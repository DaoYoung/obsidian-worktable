import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianWorktablePlugin from "./main";

export interface WorktableSettings {
  knowledgeFile: string;
  newsFolder: string;
  serviceBaseUrl: string;
  openOnStartup: boolean;
  enableFallbackProxies: boolean;
  serviceToken: string;
}

export const DEFAULT_SETTINGS: WorktableSettings = {
  knowledgeFile: "plans/知识点.md",
  newsFolder: "news",
  serviceBaseUrl: "http://127.0.0.1:8765",
  openOnStartup: true,
  enableFallbackProxies: true,
  serviceToken: "",
};

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

    new Setting(containerEl)
      .setName("Service base URL")
      .setDesc("Base URL for the local Cloakfetch service (used for AI questions / extract / expand).")
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
  }
}
