import { Component, ItemView } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import type ObsidianWorktablePlugin from "../main";
import type { WorktableSettings } from "../settings";
import type { WidgetContext, WidgetDescriptor, WidgetId, WidgetMount } from "../widgets/types";

export const WORKTABLE_VIEW_TYPE = "worktable-view";

interface SectionContainer {
  id: WidgetId;
  title: string;
  widgetEl: HTMLElement;
  errorEl: HTMLElement;
}

function getWidgetDescriptors(): WidgetDescriptor[] {
  // Lazy import to keep this file free of stub requirements: the view still
  // runs even if a particular widget is missing (it surfaces the error).
  const modules: Array<{ id: WidgetId; title: string; loader: () => Promise<WidgetMount> }> = [
    { id: "pomodoro", title: "🍅 番茄钟", loader: () => import("../widgets/pomodoro").then((m) => m.mount) },
    { id: "todo", title: "✅ 任务清单", loader: () => import("../widgets/todo").then((m) => m.mount) },
    { id: "inquiry", title: "🌱 探究性学习", loader: () => import("../widgets/inquiry").then((m) => m.mount) },
    { id: "active-recall", title: "🧠 主动回忆学习", loader: () => import("../widgets/active-recall").then((m) => m.mount) },
    { id: "flowers", title: "🌸 小红花", loader: () => import("../widgets/flowers").then((m) => m.mount) },
    { id: "review", title: "🎓 今日复习", loader: () => import("../widgets/review").then((m) => m.mount) },
    { id: "news", title: "📰 新闻", loader: () => import("../widgets/news").then((m) => m.mount) },
  ];
  return modules.map((m) => ({
    id: m.id,
    title: m.title,
    mount: m.loader,
  }));
}

export class WorktableView extends ItemView {
  private readonly plugin: ObsidianWorktablePlugin;
  private readonly widgetComponent: Component;
  private sections: SectionContainer[] = [];
  private greetingEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianWorktablePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.widgetComponent = new Component();
  }

  getViewType(): string {
    return WORKTABLE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Worktable";
  }

  getIcon(): string {
    return "book-open";
  }

  override async onOpen(): Promise<void> {
    await this.render();
  }

  override async onClose(): Promise<void> {
    this.widgetComponent.unload();
    this.sections = [];
    this.greetingEl = null;
  }

  private async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement | undefined;
    if (!container) return;
    container.empty();
    container.addClass("worktable");

    const root = container.createDiv({ cls: "worktable-root" });
    this.renderHeader(root);
    const grid = root.createDiv({ cls: "worktable-grid" });
    this.sections = this.buildSections(grid);

    const context: WidgetContext = {
      app: this.app,
      component: this.widgetComponent,
      settings: this.plugin.settings,
      dashboardEl: grid,
    };

    const descriptors = getWidgetDescriptors();
    for (const descriptor of descriptors) {
      // flowers 走特殊路径：挂到 inquiry 顶部右侧的 slot（不占 grid cell）
      if (descriptor.id === "flowers") {
        await this.mountFlowersIntoInquirySlot(descriptor, context);
        continue;
      }
      // review 走特殊路径：挂到 active-recall 内部的 slot（不占 grid cell）
      if (descriptor.id === "review") {
        await this.mountReviewIntoActiveRecallSlot(descriptor, context);
        continue;
      }
      const section = this.sections.find((s) => s.id === descriptor.id);
      if (!section) continue;
      await this.mountWidget(descriptor, section, context);
    }
  }

  private async mountFlowersIntoInquirySlot(
    descriptor: WidgetDescriptor,
    context: WidgetContext,
  ): Promise<void> {
    const inquirySection = this.sections.find((s) => s.id === "inquiry");
    const slot = inquirySection?.widgetEl.querySelector<HTMLElement>("[data-flowers-slot]");
    if (!slot) {
      // inquiry widget 还没渲染或没有 slot——跳过，避免占位空白
      return;
    }
    try {
      const mount = await descriptor.mount();
      mount(slot, context);
      inquirySection?.errorEl.hide();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      inquirySection?.errorEl.setText(`⚠ Widget failed: ${message}`);
      inquirySection?.errorEl.show();
    }
  }

  private async mountReviewIntoActiveRecallSlot(
    descriptor: WidgetDescriptor,
    context: WidgetContext,
  ): Promise<void> {
    const recallSection = this.sections.find((s) => s.id === "active-recall");
    const slot = recallSection?.widgetEl.querySelector<HTMLElement>("[data-review-slot]");
    if (!slot) {
      // active-recall widget 还没渲染或没有 slot——跳过，避免占位空白
      return;
    }
    try {
      const mount = await descriptor.mount();
      mount(slot, context);
      recallSection?.errorEl.hide();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recallSection?.errorEl.setText(`⚠ Widget failed: ${message}`);
      recallSection?.errorEl.show();
    }
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "worktable-header" });
    const greet = header.createDiv({ cls: "worktable-greeting" });
    this.greetingEl = greet;
    greet.textContent = this.computeGreeting();
    const subtitle = header.createDiv({ cls: "worktable-subtitle" });
    subtitle.textContent = "Invest · Build · Learn · Live";
  }

  private computeGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 6) return "🌙 夜深了";
    if (hour < 12) return "☀️ 早安";
    if (hour < 18) return "🌤 下午好";
    return "🌆 晚上好";
  }

  private buildSections(grid: HTMLElement): SectionContainer[] {
    // 5 个独立模块,每个模块独占一行;flowers 仍挂到 inquiry 顶部右侧的 slot。
    // 行间距由 .worktable-grid 上的 gap 控制(1 行文字高度)。
    const layouts: Array<{ id: WidgetId; title?: string }> = [
      { id: "pomodoro", title: "🍅 番茄钟" },
      { id: "todo", title: "✅ 任务清单" },
      { id: "inquiry", title: "🌱 探究性学习" },
      { id: "active-recall", title: "🧠 主动回忆学习" },
      { id: "news", title: "📰 新闻" },
    ];

    for (const layout of layouts) {
      const wrapper = grid.createDiv({ cls: `worktable-cell worktable-cell-${layout.id}` });
      if (layout.title) {
        wrapper.createDiv({ cls: "worktable-cell-title", text: layout.title });
      }
      const widgetEl = wrapper.createDiv({ cls: "worktable-cell-body" });
      const errorEl = wrapper.createDiv({ cls: "worktable-cell-error" });
      errorEl.hide();
      this.sections.push({ id: layout.id, title: layout.title ?? "", widgetEl, errorEl });
    }
    return this.sections;
  }

  private async mountWidget(
    descriptor: WidgetDescriptor,
    section: SectionContainer,
    context: WidgetContext
  ): Promise<void> {
    try {
      const mount = await descriptor.mount();
      mount(section.widgetEl, context);
      section.errorEl.hide();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      section.errorEl.setText(`⚠ Widget failed: ${message}`);
      section.errorEl.show();
    }
  }

  static openForPlugin(app: App, plugin: ObsidianWorktablePlugin): void {
    const existing = app.workspace.getLeavesOfType(WORKTABLE_VIEW_TYPE);
    if (existing.length > 0) {
      const leaf = existing[0];
      if (leaf) {
        app.workspace.revealLeaf(leaf);
        return;
      }
    }
    const leaf = app.workspace.getLeaf("tab");
    void leaf.setViewState({ type: WORKTABLE_VIEW_TYPE, active: true });
  }
}

export function getSettingsForWidget(plugin: ObsidianWorktablePlugin): WorktableSettings {
  return plugin.settings;
}
