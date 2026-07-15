import { MarkdownRenderer } from "obsidian";
import { CloakfetchClient, type ExpandedKnowledge } from "../services/CloakfetchClient";
import { KnowledgeService } from "../services/KnowledgeService";
import { type WorktableSettings } from "../settings";
import type { WidgetContext } from "../types";

interface ActiveRecallSettings {
  knowledgeFile?: unknown;
}

const KNOWLEDGE_CACHE_KEY = "home-knowledge-cache-v1";

export function mountActiveRecallWidget(containerEl: HTMLElement, context: WidgetContext): void {
  const { app, component } = context;
  const settings = context.settings as ActiveRecallSettings & Partial<WorktableSettings>;
  const knowledgePath = typeof settings.knowledgeFile === "string" && settings.knowledgeFile.trim()
    ? settings.knowledgeFile.trim()
    : "plans/知识点.md";
  const client = new CloakfetchClient(context.settings as WorktableSettings);
  const knowledge = new KnowledgeService(app, knowledgePath);
  let pendingEntry: ExpandedKnowledge | null = null;
  let pendingName = "";
  let disposed = false;

  const root = containerEl.createDiv({ cls: "home-recall" });

  const conceptSection = section(root, "录入新知识点（无需抓取文章）");
  const conceptDescription = conceptSection.createDiv({ cls: "learn-description" });
  conceptDescription.appendText("输入概念，AI 会先整理为 Markdown 供预览，确认后再写入 ");
  const knowledgeLink = conceptDescription.createEl("a", { text: knowledgePath, href: "#" });
  const conceptRow = conceptSection.createDiv({ cls: "learn-row learn-concept-row" });
  const conceptName = conceptRow.createEl("input", { type: "text", placeholder: "知识点名称…" });
  const conceptContext = conceptRow.createEl("input", { type: "text", placeholder: "可选：补充上下文" });
  const organizeButton = button(conceptRow, "🚀 AI 整理", "success");
  const conceptStatus = conceptSection.createDiv({ cls: "kp-status" });
  const preview = conceptSection.createDiv({ cls: "kp-preview" });
  preview.hidden = true;
  preview.createDiv({ cls: "kp-preview-h", text: "📋 AI 整理预览 · 确认无误后再写入" });
  const previewSubject = preview.createDiv({ cls: "kp-preview-subject" });
  previewSubject.hidden = true;
  const previewBody = preview.createDiv({ cls: "kp-preview-body" });
  const previewActions = preview.createDiv({ cls: "kp-preview-actions" });
  const confirmButton = button(previewActions, "✅ 确认写入", "success");
  const regenerateButton = button(previewActions, "🔄 重新生成", "secondary");
  const cancelButton = button(previewActions, "❌ 取消", "secondary");

  // Status banner (mirrors InquiryLearningWidget's loading banner)
  const loadingBanner = root.createDiv({ cls: "home-recall-loading", attr: { "aria-hidden": "true" } });

  // 闪卡复习 slot —— WorktableView 在挂载完本组件后会把 review widget 挂到这里
  const reviewSlot = root.createDiv({
    cls: "home-recall-review-slot",
    attr: { "data-review-slot": "" },
  });

  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    event: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    target.addEventListener(event, handler as EventListener);
    component.register(() => target.removeEventListener(event, handler as EventListener));
  };

  const showLoading = (message: string): void => {
    loadingBanner.className = "home-recall-loading show loading";
    loadingBanner.empty();
    loadingBanner.createSpan({ cls: "home-recall-spinner" });
    loadingBanner.createSpan({ text: message });
  };

  const hideLoading = (): void => {
    loadingBanner.className = "home-recall-loading";
    loadingBanner.setAttribute("aria-hidden", "true");
    loadingBanner.empty();
  };

  const showDone = (message: string, kind: "ok" | "err" = "ok"): void => {
    loadingBanner.className = `home-recall-loading show ${kind}`;
    loadingBanner.empty();
    loadingBanner.createSpan({ text: message });
    window.setTimeout(() => {
      if (!disposed) hideLoading();
    }, 3000);
  };

  const openKnowledge = (): void => {
    void app.workspace.openLinkText(knowledgePath.replace(/\.md$/i, ""), "/", true);
  };

  listen(knowledgeLink, "click", (event) => {
    event.preventDefault();
    openKnowledge();
  });
  listen(organizeButton, "click", () => {
    void organizeConcept(false);
  });
  listen(regenerateButton, "click", () => {
    void organizeConcept(true);
  });
  listen(confirmButton, "click", () => {
    void confirmConceptWrite();
  });
  listen(cancelButton, "click", cancelConcept);

  component.register(() => {
    disposed = true;
  });

  async function organizeConcept(regenerate: boolean): Promise<void> {
    const name = conceptName.value.trim() || pendingName;
    if (!name) {
      conceptStatus.className = "kp-status err";
      conceptStatus.setText("请输入知识点名称");
      return;
    }
    setPreviewButtonsDisabled(true);
    organizeButton.disabled = true;
    conceptStatus.className = "kp-status";
    conceptStatus.setText(regenerate ? "重新生成中…" : "AI 整理中…");
    showLoading(regenerate ? "🔄 AI 正在重新整理知识点…" : `🚀 AI 正在整理「${name}」…`);
    try {
      const entry = await client.expandKnowledge(name, conceptContext.value.trim());
      if (!entry.markdown.trim()) throw new Error("AI 返回为空");
      if (disposed) return;
      pendingEntry = entry;
      pendingName = name;
      previewBody.empty();
      await MarkdownRenderer.render(app, entry.markdown, previewBody, knowledgePath, component);
      showPreviewSubject(entry);
      preview.hidden = false;
      conceptStatus.setText("请预览后确认写入");
      showDone("✅ 已生成预览，请确认后写入");
    } catch (error) {
      preview.hidden = true;
      previewSubject.hidden = true;
      conceptStatus.className = "kp-status err";
      conceptStatus.setText(`整理失败：${errorMessage(error)}`);
      showDone(`❌ 整理失败：${errorMessage(error)}`, "err");
    } finally {
      organizeButton.disabled = false;
      setPreviewButtonsDisabled(false);
    }
  }

  function showPreviewSubject(entry: ExpandedKnowledge): void {
    const subjectLabel = (entry.subject || "").trim();
    if (!subjectLabel) {
      previewSubject.hidden = true;
      previewSubject.empty();
      return;
    }
    previewSubject.hidden = false;
    previewSubject.empty();
    const tag = previewSubject.createSpan({ cls: "kp-preview-tag", text: subjectLabel });
    if (subjectLabel === "英文词汇") tag.addClass("kp-preview-tag-word");
    else if (subjectLabel === "数学") tag.addClass("kp-preview-tag-math");
    else tag.addClass("kp-preview-tag-subject");
    if (subjectLabel === "英文词汇") {
      const translation = (entry.translation || "").trim();
      if (translation) {
        previewSubject.createSpan({ text: " · " });
        previewSubject.createSpan({
          cls: "kp-preview-translation",
          text: `翻译：${translation}`,
        });
      }
      const pos = (entry.pos || "").trim();
      if (pos) {
        previewSubject.createSpan({ text: " · " });
        previewSubject.createSpan({ cls: "kp-preview-pos", text: `词性：${pos}` });
      }
    }
  }

  async function confirmConceptWrite(): Promise<void> {
    if (!pendingEntry || !pendingName) {
      conceptStatus.className = "kp-status err";
      conceptStatus.setText("没有可写入的预览");
      return;
    }
    const entry = pendingEntry;
    const name = pendingName;
    setPreviewButtonsDisabled(true);
    conceptStatus.setText("写入中…");
    try {
      const subjectLabel = (entry.subject || "").trim();
      const isEnglishWord = subjectLabel === "英文词汇"
        || knowledge.inferCategory(name, entry.markdown) === "word";
      if (isEnglishWord) {
        await knowledge.appendWithOptions({
          category: "word",
          name,
          content: entry.markdown,
          translation: entry.translation,
          pos: entry.pos,
        });
      } else if (subjectLabel === "数学" || knowledge.inferCategory(name, entry.markdown) === "math") {
        await knowledge.append("math", name, entry.markdown);
      } else if (subjectLabel && subjectLabel !== "随手记" && subjectLabel !== "其他") {
        await knowledge.appendWithOptions({
          category: "subject",
          name,
          content: entry.markdown,
          subject: subjectLabel,
        });
      } else {
        await knowledge.append("misc", name, entry.markdown);
      }
      localStorage.removeItem(KNOWLEDGE_CACHE_KEY);
      if (disposed) return;
      conceptStatus.className = "kp-status ok";
      conceptStatus.empty();
      conceptStatus.appendText(`已写入 ${subjectLabel || "随手记"} · `);
      const link = conceptStatus.createEl("a", { text: knowledgePath, href: "#" });
      listen(link, "click", (event) => {
        event.preventDefault();
        openKnowledge();
      });
      pendingEntry = null;
      pendingName = "";
      conceptName.value = "";
      conceptContext.value = "";
      preview.hidden = true;
      previewSubject.hidden = true;
      previewBody.empty();
    } catch (error) {
      conceptStatus.className = "kp-status err";
      conceptStatus.setText(`写入失败：${errorMessage(error)}`);
    } finally {
      setPreviewButtonsDisabled(false);
    }
  }

  function cancelConcept(): void {
    pendingEntry = null;
    pendingName = "";
    preview.hidden = true;
    previewSubject.hidden = true;
    previewBody.empty();
    conceptStatus.className = "kp-status";
    conceptStatus.setText("已取消（未写入）");
  }

  function setPreviewButtonsDisabled(disabled: boolean): void {
    confirmButton.disabled = disabled;
    regenerateButton.disabled = disabled;
    cancelButton.disabled = disabled;
  }
}

function section(parent: HTMLElement, title: string): HTMLDivElement {
  const element = parent.createDiv({ cls: "learn-section" });
  element.createDiv({ cls: "learn-section-h", text: title });
  return element;
}

function button(parent: HTMLElement, text: string, className = ""): HTMLButtonElement {
  return parent.createEl("button", { text, cls: className });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}