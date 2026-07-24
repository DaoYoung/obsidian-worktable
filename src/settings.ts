import { App, moment, PluginSettingTab, Setting } from "obsidian";
import type ObsidianWorktablePlugin from "./main";
import { AI_PROVIDERS } from "./services/ai/registry";
import type { AiProviderId } from "./services/ai/types";
import { getSettingsStrings } from "./settingsStrings";
import { renderServiceSetup } from "./settingsServiceSetup";

export type AiProvider = AiProviderId;

export type ReviewSource =
  | { type: "file"; path: string }
  | { type: "folder"; path: string };

export function normalizeReviewSource(raw: unknown): ReviewSource | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.type !== "file" && value.type !== "folder") return null;
  if (typeof value.path !== "string") return null;
  const path = value.path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return path ? { type: value.type, path } : null;
}

export function resolveReviewSources(
  settings: Pick<WorktableSettings, "knowledgeFile" | "reviewSources">,
): ReviewSource[] {
  const raw = Array.isArray(settings.reviewSources) ? settings.reviewSources : [];
  const seen = new Set<string>();
  const sources: ReviewSource[] = [];
  for (const item of raw) {
    const source = normalizeReviewSource(item);
    if (!source) continue;
    const key = `${source.type}:${source.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  if (sources.length > 0) return sources;
  const fallback = String(settings.knowledgeFile ?? "").trim() || DEFAULT_SETTINGS.knowledgeFile;
  return [{ type: "file", path: fallback.replace(/^\/+/, "") }];
}

export interface WorktableSettings {
  knowledgeFile: string;
  reviewSources: ReviewSource[];
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
  reviewSources: [],
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
    containerEl.addClass("worktable-settings");

    // Resolve labels per render. The settings tab re-renders whenever the
    // user opens it (and after a language change), so we don't need to
    // subscribe to changes. `moment.locale()` is the public Obsidian API for
    // reading the active UI locale.
    const t = getSettingsStrings(moment.locale() ?? null);

    new Setting(containerEl).setName(t.heading).setHeading();

    new Setting(containerEl).setName(t.pathSection).setHeading();

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
      .setName(t.reviewSourcesName)
      .setDesc(t.reviewSourcesDesc)
      .setHeading();

    const reviewSourcesEl = containerEl.createDiv({ cls: "worktable-review-sources" });
    const rawReviewSources = Array.isArray(this.plugin.settings.reviewSources)
      ? this.plugin.settings.reviewSources
      : [];
    const configuredSources = rawReviewSources
      .map((raw, index) => ({ source: normalizeReviewSource(raw), index }))
      .filter(
        (entry): entry is { source: ReviewSource; index: number } => entry.source !== null,
      );

    for (const { source, index } of configuredSources) {
      new Setting(reviewSourcesEl)
        .setName(source.type === "file" ? t.reviewSourceTypeFile : t.reviewSourceTypeFolder)
        .addDropdown((dropdown) =>
          dropdown
            .addOption("file", t.reviewSourceTypeFile)
            .addOption("folder", t.reviewSourceTypeFolder)
            .setValue(source.type)
            .onChange(async (value) => {
              const nextType: ReviewSource["type"] = value === "folder" ? "folder" : "file";
              const current = rawReviewSources[index];
              if (!current) return;
              this.plugin.settings.reviewSources[index] = {
                type: nextType,
                path: typeof current.path === "string" ? current.path : source.path,
              };
              await this.plugin.saveSettings();
              this.display();
            }),
        )
        .addText((text) =>
          text
            .setPlaceholder(source.type === "file" ? "plans/知识点.md" : "plans")
            .setValue(source.path)
            .onChange(async (value) => {
              const current = rawReviewSources[index];
              if (!current) return;
              this.plugin.settings.reviewSources[index] = {
                type: current.type === "folder" ? "folder" : "file",
                path: value.trim(),
              };
              await this.plugin.saveSettings();
            }),
        )
        .addButton((button) =>
          button.setButtonText(t.reviewSourceRemove).onClick(async () => {
            this.plugin.settings.reviewSources.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          }),
        );
    }

    let newSourceType: ReviewSource["type"] = "file";
    let newSourcePath = "";
    new Setting(reviewSourcesEl)
      .setName(t.reviewSourceAdd)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("file", t.reviewSourceTypeFile)
          .addOption("folder", t.reviewSourceTypeFolder)
          .setValue(newSourceType)
          .onChange((value) => {
            newSourceType = value === "folder" ? "folder" : "file";
          }),
      )
      .addText((text) =>
        text
          .setPlaceholder("plans/知识点.md")
          .onChange((value) => {
            newSourcePath = value;
          }),
      )
      .addButton((button) =>
        button.setButtonText(t.reviewSourceAdd).onClick(async () => {
          const source = normalizeReviewSource({ type: newSourceType, path: newSourcePath });
          if (!source) return;
          if (!Array.isArray(this.plugin.settings.reviewSources)) {
            this.plugin.settings.reviewSources = [];
          }
          const duplicate = this.plugin.settings.reviewSources.some((item) => {
            const existing = normalizeReviewSource(item);
            return existing?.type === source.type && existing.path === source.path;
          });
          if (duplicate) return;
          this.plugin.settings.reviewSources.push(source);
          await this.plugin.saveSettings();
          this.display();
        }),
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
    new Setting(containerEl).setName(t.directAiSection).setHeading();
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

    new Setting(containerEl).setName(t.serviceSection).setHeading();

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