import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, WorktableSettings, WorktableSettingTab } from "./settings";
import { setCloakfetchDefaultSettings } from "./services/CloakfetchClient";
import { WORKTABLE_VIEW_TYPE, WorktableView } from "./view/WorktableView";

export default class ObsidianWorktablePlugin extends Plugin {
  settings: WorktableSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    setCloakfetchDefaultSettings(this.settings);
    this.addSettingTab(new WorktableSettingTab(this.app, this));

    this.registerView(
      WORKTABLE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new WorktableView(leaf, this)
    );

    this.addRibbonIcon("book-open", "Open Worktable", () => {
      WorktableView.openForPlugin(this.app, this);
    });

    this.addCommand({
      id: "worktable-open",
      name: "Open Worktable",
      callback: () => {
        WorktableView.openForPlugin(this.app, this);
      },
    });

    this.addCommand({
      id: "worktable-reveal-existing",
      name: "Reveal existing Worktable leaf",
      checkCallback: (checking: boolean) => {
        const existing = this.app.workspace.getLeavesOfType(WORKTABLE_VIEW_TYPE);
        if (existing.length === 0) return false;
        if (!checking) {
          const leaf = existing[0];
          if (leaf) this.app.workspace.revealLeaf(leaf);
        }
        return true;
      },
    });

    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.openOnStartup) return;
      if (this.app.workspace.getLeavesOfType(WORKTABLE_VIEW_TYPE).length > 0) return;
      WorktableView.openForPlugin(this.app, this);
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(WORKTABLE_VIEW_TYPE);
    setCloakfetchDefaultSettings(null);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<WorktableSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    setCloakfetchDefaultSettings(this.settings);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    setCloakfetchDefaultSettings(this.settings);
  }
}
