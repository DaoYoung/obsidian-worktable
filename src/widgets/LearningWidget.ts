import { MarkdownRenderer } from "obsidian";
import { CloakfetchClient, type ExpandedKnowledge } from "../services/CloakfetchClient";
import { KnowledgeService } from "../services/KnowledgeService";
import { createHomeDb, type LearningRecord } from "../storage/homeDb";
import { type WorktableSettings } from "../settings";
import type { WidgetContext } from "../types";
import { parsePastedArticle } from "./parsePastedArticle";

type QuestionType = "mc" | "cloze" | "tf" | "short";

interface Question {
  type: QuestionType;
  text: string;
  answer: string;
  options?: string[];
  explanation?: string;
}

interface LearningState {
  url: string;
  title: string;
  article: string;
  questions: Question[];
  /** Per-question user answers, parallel to `questions` (null = not yet answered). */
  lastAnswers: (string | null)[];
  /** Per-question correctness flag, parallel to `questions` (null = not yet answered). */
  lastCorrect: (boolean | null)[];
  keyPoints: string[];
  selectedPoints: Set<number>;
}

interface LearningSettings {
  knowledgeFile?: unknown;
  enableFallbackProxies?: unknown;
}

const KNOWLEDGE_CACHE_KEY = "home-knowledge-cache-v1";
const FLOWER_KEY = "home-learning-flowers";

export function mountLearningWidget(containerEl: HTMLElement, context: WidgetContext): void {
  const { app, component, dashboardEl } = context;
  const settings = context.settings as LearningSettings & Partial<WorktableSettings>;
  const knowledgePath = typeof settings.knowledgeFile === "string" && settings.knowledgeFile.trim()
    ? settings.knowledgeFile.trim()
    : "plans/知识点.md";
  const client = new CloakfetchClient(context.settings as WorktableSettings);
  const knowledge = new KnowledgeService(app, knowledgePath);
  const db = createHomeDb();
  let state = emptyState();
  let pendingEntry: ExpandedKnowledge | null = null;
  let pendingName = "";
  let disposed = false;

  const root = containerEl.createDiv({ cls: "home-learn" });
  const heading = root.createEl("h3");
  heading.createSpan({ text: "🌱 学习模块" });
  const statusEl = heading.createSpan({ cls: "learn-status", text: "空闲" });

  const fetchSection = section(root, "① 输入文章内容");
  const fetchRow = fetchSection.createDiv({ cls: "learn-row" });
  const urlInput = fetchRow.createEl("input", { type: "url", placeholder: "https://example.com/article（可选 — 需要本地服务）" });
  const fetchButton = button(fetchRow, "📥 抓取");
  const diagnoseButton = button(fetchRow, "🔍 诊断", "secondary");
  const newRoundButton = button(fetchRow, "🗑️ 重置清空", "secondary");
  const archivedNotice = fetchSection.createDiv({ cls: "learn-archived-notice" });
  archivedNotice.hidden = true;
  const diagnostics = fetchSection.createEl("pre", { cls: "learn-diagnostics" });
  diagnostics.hidden = true;

  // Paste-text path is the zero-install fallback (no Cloakfetch service
  // required). Default to collapsed so the URL input stays the primary
  // affordance; users who want the paste path can expand the toggle.
  const pasteDetails = fetchSection.createEl("details", { cls: "learn-paste-details" });
  const pasteSummary = pasteDetails.createEl("summary", {
    cls: "learn-paste-summary",
    text: "📋 粘贴正文（无需本地服务 · 点击展开）",
  });
  const pasteTextarea = pasteDetails.createEl("textarea", {
    cls: "learn-paste-textarea",
    attr: { placeholder: "复制文章正文粘贴到这里，无需任何本地服务即可让 AI 处理", rows: "6" },
  });
  const pasteRow = pasteDetails.createDiv({ cls: "learn-row" });
  const pasteButton = button(pasteRow, "📋 处理粘贴文本", "secondary");
  const pasteClearButton = button(pasteRow, "清空", "secondary compact");

  const articleSection = section(root, "② 原文与 AI 出题/重点");
  articleSection.hidden = true;
  const articleRow = articleSection.createDiv({ cls: "learn-row" });
  const generateButton = button(articleRow, "🤖 AI 出题", "secondary");
  const extractButton = button(articleRow, "🎯 AI 提取重点", "secondary");
  const articleContext = articleSection.createDiv({ cls: "learn-context" });
  const keyPointList = articleSection.createDiv({ cls: "kp-list" });
  keyPointList.hidden = true;
  const keyPointActions = articleSection.createDiv({ cls: "kp-actions" });
  keyPointActions.hidden = true;
  const appendPointsButton = button(keyPointActions, "📥 补充到知识库", "success");
  const selectAllButton = button(keyPointActions, "全选", "secondary");
  const selectNoneButton = button(keyPointActions, "全不选", "secondary");
  const keyPointStatus = keyPointActions.createSpan({ cls: "kp-status" });

  const questionSection = section(root, "③ 题目");
  questionSection.hidden = true;
  const questionList = questionSection.createDiv({ cls: "learn-question-list" });
  const submitAllButton = button(questionSection, "📝 提交答案", "success compact");
  submitAllButton.classList.add("learn-submit-all");
  const archiveRow = questionSection.createDiv({ cls: "learn-row learn-archive-row" });
  const archiveButton = button(archiveRow, "📦 归档本次学习", "success compact");
  const archiveSummary = archiveRow.createSpan({ cls: "learn-archive-summary" });

  const conceptSection = section(root, "⑤ 录入新知识点（无需抓取）");
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

  // Status banner at the very bottom of the learning module. Hidden by
  // default; only shown during active AI operations or briefly after
  // success/error. Uses a class-only show/hide (not the `hidden`
  // attribute) so CSS `display: flex` doesn't override it.
  const loadingBanner = root.createDiv({ cls: "home-learn-loading", attr: { "aria-hidden": "true" } });

  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    event: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    target.addEventListener(event, handler as EventListener);
    component.register(() => target.removeEventListener(event, handler as EventListener));
  };

  const setStatus = (text: string, kind = ""): void => {
    statusEl.setText(text);
    statusEl.className = `learn-status${kind ? ` ${kind}` : ""}`;
  };

  const showLoading = (message: string): void => {
    loadingBanner.className = "home-learn-loading show loading";
    loadingBanner.empty();
    loadingBanner.createSpan({ cls: "home-learn-spinner" });
    loadingBanner.createSpan({ text: message });
  };

  const hideLoading = (): void => {
    loadingBanner.className = "home-learn-loading";
    loadingBanner.setAttribute("aria-hidden", "true");
    loadingBanner.empty();
  };

  const showDone = (message: string, kind: "ok" | "err" = "ok"): void => {
    loadingBanner.className = `home-learn-loading show ${kind}`;
    loadingBanner.empty();
    loadingBanner.createSpan({ text: message });
    window.setTimeout(() => {
      if (!disposed) hideLoading();
    }, 3000);
  };

  const showArchivedNotice = (count: number): void => {
    archivedNotice.hidden = false;
    archivedNotice.empty();
    archivedNotice.createSpan({ text: `ℹ️ 本文已归档（${count} 道题），可继续使用 AI 出题等学习功能` });
  };

  const hideArchivedNotice = (): void => {
    archivedNotice.hidden = true;
    archivedNotice.empty();
  };

  const openKnowledge = (): void => {
    void app.workspace.openLinkText(knowledgePath.replace(/\.md$/i, ""), "/", true);
  };

  listen(knowledgeLink, "click", (event) => {
    event.preventDefault();
    openKnowledge();
  });

  listen(fetchButton, "click", () => {
    void runFetch();
  });
  listen(diagnoseButton, "click", () => {
    void runDiagnostics();
  });
  listen(pasteButton, "click", () => {
    void runPaste();
  });
  listen(pasteClearButton, "click", () => {
    pasteTextarea.value = "";
    pasteTextarea.focus();
  });
  listen(generateButton, "click", () => {
    void generateQuestions();
  });
  listen(extractButton, "click", () => {
    void extractKeyPoints();
  });
  listen(appendPointsButton, "click", () => {
    void appendSelectedPoints();
  });
  listen(selectAllButton, "click", () => selectPoints(true));
  listen(selectNoneButton, "click", () => selectPoints(false));
  listen(archiveButton, "click", () => {
    void archiveLearning();
  });
  listen(submitAllButton, "click", () => {
    submitAllAnswers();
  });
  listen(newRoundButton, "click", resetRound);
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

  async function runFetch(): Promise<void> {
    const url = urlInput.value.trim();
    if (!url) {
      setStatus("请输入 URL", "err");
      return;
    }
    fetchButton.disabled = true;
    setStatus("抓取中…");
    try {
      const article = await fetchArticle(client, url, settings.enableFallbackProxies === true);
      if (article.text.length < 50) throw new Error("正文太短或无法提取");
      if (disposed) return;
      state.url = url;
      state.title = article.title || url;
      state.article = article.text;
      articleContext.setText(`${article.text.slice(0, 600)}${article.text.length > 600 ? "…" : ""}`);
      articleSection.hidden = false;
      questionSection.hidden = true;
      questionList.empty();
      // Reset previous submission state when fetching a new article.
      state.lastAnswers = [];
      state.lastCorrect = [];
      hideArchivedNotice();
      // Check whether this URL was already archived — inform the user so
      // they don't redo work that's already been recorded.
      try {
        const archivedCount = await db.countLearningRecordsByUrl(url);
        if (disposed) return;
        if (archivedCount > 0) showArchivedNotice(archivedCount);
      } catch (_) {
        // Best-effort; failure here is non-fatal.
      }
      setStatus(`已抓取 · ${article.text.length} 字`, "ok");
    } catch (error) {
      showError(error, "抓取失败");
      // Surface a hint that paste-text is the zero-install alternative.
      diagnostics.hidden = false;
      diagnostics.setText(
        `${diagnostics.textContent ?? ""}\n\n提示:抓取失败时,直接粘贴正文到下方文本框,无需任何本地服务。`.trim(),
      );
    } finally {
      fetchButton.disabled = false;
    }
  }

  async function runDiagnostics(): Promise<void> {
    diagnostics.hidden = false;
    diagnostics.setText("诊断中…");
    diagnoseButton.disabled = true;
    try {
      const result = await client.diagnose(urlInput.value.trim() || undefined);
      if (!disposed) diagnostics.setText(formatDiagnostic(result));
    } catch (error) {
      if (!disposed) diagnostics.setText(`诊断失败：${errorMessage(error)}`);
    } finally {
      diagnoseButton.disabled = false;
    }
  }

  /**
   * Skip Cloakfetch entirely: take whatever the user pasted, normalize whitespace,
   * optionally lift a title from the first non-empty line, and feed the body
   * straight to the AI handlers. This makes the Learning widget fully usable
   * on machines without the local service (including Obsidian Mobile).
   */
  async function runPaste(): Promise<void> {
    const raw = pasteTextarea.value;
    if (!raw.trim()) {
      setStatus("粘贴框为空", "err");
      pasteTextarea.focus();
      return;
    }
    pasteButton.disabled = true;
    pasteClearButton.disabled = true;
    try {
      const { title, text } = parsePastedArticle(raw);
      if (text.length < 50) throw new Error("正文太短（至少 50 字）");
      if (disposed) return;
      state.url = "(粘贴)";
      state.title = title || "粘贴的文章";
      state.article = text;
      articleContext.setText(`${text.slice(0, 600)}${text.length > 600 ? "…" : ""}`);
      articleSection.hidden = false;
      questionSection.hidden = true;
      questionList.empty();
      setStatus(`已就绪 · ${text.length} 字`, "ok");
    } catch (error) {
      showError(error, "处理失败");
    } finally {
      pasteButton.disabled = false;
      pasteClearButton.disabled = false;
    }
  }

  async function generateQuestions(): Promise<void> {
    if (!state.article) {
      setStatus("请先抓取文章", "err");
      return;
    }
    const count = pickQuestionCount(state.article.length);
    generateButton.disabled = true;
    setStatus("AI 出题中…");
    showLoading(`🤖 AI 正在根据文章生成 ${count} 道题目，请稍候…`);
    try {
      const generated = await client.generateQuestions(state.title, state.article, count);
      const questions = normalizeQuestions(generated).slice(0, count);
      if (!questions.length) throw new Error("AI 未生成任何题目");
      if (disposed) return;
      state.questions = questions;
      state.lastAnswers = questions.map(() => null);
      state.lastCorrect = questions.map(() => null);
      questionSection.hidden = false;
      archiveSummary.setText("");
      renderAllQuestions();
      setStatus(`已生成 ${questions.length} 道题`, "ok");
      showDone(`✅ 已生成 ${questions.length} 道题目`);
    } catch (error) {
      showError(error, "出题失败");
      showDone(`❌ 出题失败：${errorMessage(error)}`, "err");
    } finally {
      generateButton.disabled = false;
    }
  }

  const typeLabels: Record<QuestionType, string> = {
    mc: "单选",
    cloze: "填空",
    tf: "判断",
    short: "简答",
  };

  function renderAllQuestions(): void {
    questionList.empty();
    state.questions.forEach((question, index) => {
      const card = questionList.createDiv({ cls: "learn-question-card", attr: { "data-index": String(index) } });
      const head = card.createDiv({ cls: "learn-question-head" });
      head.createSpan({ cls: "learn-question-badge", text: typeLabels[question.type] });
      head.createSpan({ cls: "learn-question-index", text: `第 ${index + 1}/${state.questions.length} 题` });
      card.createDiv({ cls: "learn-q-text", text: question.text });
      const answerArea = card.createDiv({ cls: "learn-answer-area" });

      if (question.type === "mc" || question.type === "tf") {
        const options = question.type === "tf" ? ["对", "错"] : question.options ?? [];
        const optionList = answerArea.createDiv({ cls: "learn-options" });
        options.forEach((option, optionIndex) => {
          const optionEl = optionList.createEl("button", {
            cls: "learn-option",
            text: question.type === "mc" ? `${String.fromCharCode(65 + optionIndex)}. ${option}` : option,
          });
          listen(optionEl, "click", () => {
            if (state.lastCorrect[index] !== null) return;
            optionList.querySelectorAll(".learn-option").forEach((element) => element.removeClass("selected"));
            optionEl.addClass("selected");
          });
        });
      } else {
        answerArea.createEl("textarea", {
          cls: "learn-answer",
          placeholder: question.type === "short" ? "请输入 1–5 个关键词…" : "请填入空白处的关键词…",
        });
      }

      const feedback = card.createDiv({ cls: "learn-feedback" });
      feedback.hidden = true;
      const explanation = card.createDiv({ cls: "learn-explanation" });
      explanation.hidden = true;
    });
    submitAllButton.disabled = false;
    submitAllButton.setText("📝 提交全部答案");
    archiveButton.disabled = true;
    archiveButton.setText("📦 归档本次学习");
    updateArchiveSummary();
  }

  function readCardAnswer(index: number, question: Question): string {
    const card = questionList.children[index] as HTMLElement | undefined;
    if (!card) return "";
    if (question.type === "mc" || question.type === "tf") {
      const selected = card.querySelector<HTMLElement>(".learn-option.selected");
      if (!selected) return "";
      return (selected.textContent ?? "").replace(/^[A-Z]\.\s*/, "").trim();
    }
    const ta = card.querySelector<HTMLTextAreaElement>("textarea.learn-answer");
    return (ta?.value ?? "").trim();
  }

  function submitAllAnswers(): void {
    if (!state.questions.length) return;
    // Read each answer and report any missing ones up-front.
    const answers: string[] = [];
    const missing: number[] = [];
    state.questions.forEach((q, i) => {
      const v = readCardAnswer(i, q);
      answers.push(v);
      if (!v) missing.push(i);
    });
    if (missing.length) {
      const firstMissing = questionList.children[missing[0]!] as HTMLElement | undefined;
      firstMissing?.scrollIntoView({ block: "center", behavior: "smooth" });
      setStatus(`还有 ${missing.length} 道题未作答`, "err");
      return;
    }
    let correctCount = 0;
    state.questions.forEach((question, index) => {
      const userAnswer = answers[index] ?? "";
      const result = evaluate(question, userAnswer, state.article);
      state.lastAnswers[index] = userAnswer;
      state.lastCorrect[index] = result.correct;
      if (result.correct) correctCount += 1;
      const card = questionList.children[index] as HTMLElement | undefined;
      if (!card) return;
      const feedback = card.querySelector<HTMLElement>(".learn-feedback");
      if (feedback) {
        feedback.hidden = false;
        feedback.className = `learn-feedback ${result.correct ? "ok" : "err"}`;
        feedback.setText(`${result.correct ? "✓" : "✗"} ${result.message}`);
      }
      const explanation = card.querySelector<HTMLElement>(".learn-explanation");
      if (explanation) {
        explanation.hidden = !question.explanation;
        explanation.setText(question.explanation ? `💡 ${question.explanation}` : "");
      }
      // Mark correct/incorrect on the option list; lock inputs.
      const optionList = card.querySelector(".learn-options");
      if (optionList) {
        optionList.querySelectorAll<HTMLButtonElement>(".learn-option").forEach((optionEl) => {
          const label = optionEl.textContent?.replace(/^[A-Z]\.\s*/, "") ?? "";
          if (normalizeTruth(label) === normalizeTruth(question.answer)) optionEl.addClass("correct");
          else if (optionEl.hasClass("selected")) optionEl.addClass("wrong");
          optionEl.disabled = true;
        });
      }
      const ta = card.querySelector<HTMLTextAreaElement>("textarea.learn-answer");
      if (ta) ta.disabled = true;
      if (result.correct) incrementFlowers();
    });
    submitAllButton.disabled = true;
    submitAllButton.setText(`✓ 已提交 · 答对 ${correctCount}/${state.questions.length}`);
    archiveButton.disabled = false;
    setStatus(`已提交 · 答对 ${correctCount}/${state.questions.length}`, correctCount === state.questions.length ? "ok" : "");
    updateArchiveSummary();
  }

  function updateArchiveSummary(): void {
    const answered = state.lastCorrect.filter((value) => value !== null).length;
    const correct = state.lastCorrect.filter((value) => value === true).length;
    if (answered === 0 && !state.questions.length) {
      archiveSummary.setText("");
      return;
    }
    if (answered === 0) {
      archiveSummary.setText(`共 ${state.questions.length} 道题 · 全部待作答`);
      return;
    }
    archiveSummary.setText(`已答 ${answered}/${state.questions.length} · 答对 ${correct}`);
  }

  function incrementFlowers(): void {
    const total = Number.parseInt(localStorage.getItem(FLOWER_KEY) ?? "0", 10) + 1;
    localStorage.setItem(FLOWER_KEY, String(total));
    dashboardEl.dispatchEvent(new CustomEvent("home-flowers-changed", { bubbles: true, detail: { total } }));
  }

  async function archiveLearning(): Promise<void> {
    const answered = state.questions
      .map((question, index) => ({ question, index }))
      .filter(({ index }) => state.lastCorrect[index] !== null);
    if (!answered.length) {
      setStatus("请先提交答案", "err");
      return;
    }
    archiveButton.disabled = true;
    archiveButton.setText("归档中…");
    try {
      for (const { question, index } of answered) {
        const record: LearningRecord = {
          title: state.title,
          url: state.url,
          question: question.text,
          questionType: question.type,
          correct: state.lastCorrect[index] === true,
          userAnswer: state.lastAnswers[index] ?? "",
          correctAnswer: question.answer,
          createdAt: Date.now(),
        };
        await db.addLearningRecord(record);
        if (disposed) return;
        dashboardEl.dispatchEvent(new CustomEvent("home-learning-archived", { bubbles: true, detail: record }));
      }
      archiveButton.setText(`✓ 已归档 ${answered.length} 题`);
      setStatus(`已归档 ${answered.length} 题`, "ok");
      showDone(`✅ 已归档 ${answered.length} 道题（无论对错都会保存）`);
    } catch (error) {
      archiveButton.disabled = false;
      archiveButton.setText("📦 归档本次学习");
      showError(error, "归档失败");
      showDone(`❌ 归档失败：${errorMessage(error)}`, "err");
    }
  }

  function resetRound(): void {
    state = emptyState();
    urlInput.value = "";
    articleSection.hidden = true;
    questionSection.hidden = true;
    questionList.empty();
    submitAllButton.disabled = false;
    submitAllButton.setText("📝 提交全部答案");
    archiveButton.disabled = true;
    archiveButton.setText("📦 归档本次学习");
    archiveSummary.setText("");
    keyPointList.hidden = true;
    keyPointList.empty();
    keyPointActions.hidden = true;
    diagnostics.hidden = true;
    hideArchivedNotice();
    hideLoading();
    setStatus("空闲");
  }

  async function extractKeyPoints(): Promise<void> {
    if (!state.article) {
      setStatus("请先抓取文章", "err");
      return;
    }
    extractButton.disabled = true;
    setStatus("AI 提取重点中…");
    showLoading("🎯 AI 正在提取文章重点，请稍候…");
    try {
      const points = (await client.extractKeyPoints(state.title, state.article, 8))
        .filter((point): point is string => typeof point === "string" && point.trim().length > 0);
      if (!points.length) throw new Error("未提取到任何重点");
      if (disposed) return;
      state.keyPoints = points;
      state.selectedPoints = new Set(points.map((_, index) => index));
      renderKeyPoints();
      setStatus(`已提取 ${points.length} 个重点`, "ok");
      showDone(`✅ 已提取 ${points.length} 个重点`);
    } catch (error) {
      showError(error, "提取失败");
      showDone(`❌ 提取失败：${errorMessage(error)}`, "err");
    } finally {
      extractButton.disabled = false;
    }
  }

  function renderKeyPoints(): void {
    keyPointList.empty();
    keyPointList.hidden = false;
    keyPointActions.hidden = false;
    state.keyPoints.forEach((point, index) => {
      const label = keyPointList.createEl("label", { cls: "kp-item" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = state.selectedPoints.has(index);
      label.createSpan({ text: point });
      listen(checkbox, "change", () => {
        if (checkbox.checked) state.selectedPoints.add(index);
        else state.selectedPoints.delete(index);
        updatePointStatus();
      });
    });
    updatePointStatus();
  }

  function selectPoints(selected: boolean): void {
    state.selectedPoints = selected
      ? new Set(state.keyPoints.map((_, index) => index))
      : new Set<number>();
    keyPointList.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((checkbox) => {
      checkbox.checked = selected;
    });
    updatePointStatus();
  }

  function updatePointStatus(): void {
    keyPointStatus.setText(`已选 ${state.selectedPoints.size}/${state.keyPoints.length}`);
  }

  async function appendSelectedPoints(): Promise<void> {
    const points = [...state.selectedPoints]
      .sort((left, right) => left - right)
      .map((index) => state.keyPoints[index])
      .filter((point): point is string => Boolean(point));
    if (!points.length) {
      keyPointStatus.setText("没有选中任何重点");
      keyPointStatus.className = "kp-status err";
      return;
    }
    appendPointsButton.disabled = true;
    keyPointStatus.setText("写入中…");
    try {
      const name = `📌 ${state.title || state.url || "文章重点"} · 重点摘录`;
      const source = state.url ? `**来源：** [${state.url}](${state.url})\n\n` : "";
      await knowledge.append("misc", name, `${source}${points.map((point) => `- ${point}`).join("\n")}\n`);
      localStorage.removeItem(KNOWLEDGE_CACHE_KEY);
      if (disposed) return;
      keyPointStatus.className = "kp-status ok";
      keyPointStatus.empty();
      keyPointStatus.appendText(`已追加 ${points.length} 项 → `);
      const link = keyPointStatus.createEl("a", { text: knowledgePath, href: "#" });
      listen(link, "click", (event) => {
        event.preventDefault();
        openKnowledge();
      });
      setStatus("重点已写入随手记", "ok");
    } catch (error) {
      keyPointStatus.className = "kp-status err";
      keyPointStatus.setText(`写入失败：${errorMessage(error)}`);
    } finally {
      appendPointsButton.disabled = false;
    }
  }

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
      setStatus(`已生成预览 · 待确认：${name}`);
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
      setStatus(`知识点已写入 ${subjectLabel || "随手记"}`, "ok");
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

  function showError(error: unknown, prefix: string): void {
    if (!disposed) setStatus(`${prefix}：${errorMessage(error)}`, "err");
  }
}

function emptyState(): LearningState {
  return {
    url: "",
    title: "",
    article: "",
    questions: [],
    lastAnswers: [],
    lastCorrect: [],
    keyPoints: [],
    selectedPoints: new Set<number>(),
  };
}

function section(parent: HTMLElement, title: string): HTMLDivElement {
  const element = parent.createDiv({ cls: "learn-section" });
  element.createDiv({ cls: "learn-section-h", text: title });
  return element;
}

function button(parent: HTMLElement, text: string, className = ""): HTMLButtonElement {
  return parent.createEl("button", { text, cls: className });
}

/**
 * Content-aware question count (1–5): short articles get a single question,
 * long articles get up to five. Keeps the quiz proportional to how much there
 * is to test.
 */
function pickQuestionCount(textLength: number): number {
  if (textLength < 500) return 1;
  if (textLength < 1500) return 2;
  if (textLength < 3000) return 3;
  if (textLength < 5000) return 4;
  return 5;
}

/**
 * Fetch the article body for a given URL.
 *
 * Order of attempts:
 *   1. Local Cloakfetch service (`/fetch`). When present, prefers the
 *      server-extracted Markdown so the AI prompt stays clean.
 *   2. Public CORS proxies (`api.allorigins.win`, `corsproxy.io`) when the
 *      user has `enableFallbackProxies` set.
 *
 * Returns the cleaned article text + title. The raw HTML is also returned
 * so callers can keep it on `state.article` for diagnostics or fallback.
 */
async function fetchArticle(
  client: CloakfetchClient,
  url: string,
  allowPublicFallbacks: boolean,
): Promise<{ title: string; text: string; html: string }> {
  // 1) Local service
  try {
    const res = await client.fetchUrl(url);
    if (res && typeof res === "object" && res.ok) {
      const html = typeof res.html === "string" ? res.html : "";
      const serverTitle = typeof res.title === "string" ? res.title : "";
      // Prefer server-extracted markdown when present (Cloakfetch v0.2.4+).
      if (typeof res.markdown === "string" && res.markdown.trim().length >= 50) {
        return { title: serverTitle, text: res.markdown.trim().slice(0, 6_000), html };
      }
      // Fallback: client-side HTML→text extraction.
      if (html.length >= 50) {
        const article = htmlToArticle(html);
        return { title: serverTitle || article.title, text: article.text, html };
      }
    }
    throw new Error("Fetch returned no HTML");
  } catch (localError) {
    if (!allowPublicFallbacks) throw localError;
  }

  // 2) Public CORS proxies — return raw HTML; client extracts text.
  const attempts = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(attempt, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      let html = "";
      if (contentType.includes("application/json")) {
        const payload = await response.json() as { contents?: unknown; data?: unknown };
        const candidate = typeof payload.contents === "string" ? payload.contents : payload.data;
        if (typeof candidate === "string") html = candidate;
      } else {
        html = await response.text();
      }
      if (html.length < 50) throw new Error("返回内容为空");
      const article = htmlToArticle(html);
      return { title: article.title, text: article.text, html };
    } catch (error) {
      errors.push(errorMessage(error));
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw new Error(`所有抓取方式均失败：${errors.join(" | ")}`);
}

function htmlToArticle(html: string): { title: string; text: string } {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  documentNode.querySelectorAll("script, style, noscript, svg, iframe, header, footer, nav, aside").forEach((node) => node.remove());
  const title = (documentNode.querySelector("title")?.textContent
    ?? documentNode.querySelector("h1")?.textContent
    ?? "").trim().slice(0, 200);
  const main = documentNode.querySelector("article, main, .article, .post, .content, #content") ?? documentNode.body;
  const text = (main?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 6_000);
  return { title, text };
}

/** Normalize a pasted article body. Lifts a probable title from the first
 * non-empty line if it's short enough (<= 120 chars and doesn't end with
 * sentence punctuation), then collapses whitespace and trims. */
function normalizeQuestions(value: unknown): Question[] {
  const candidates = Array.isArray(value) ? value : [];
  return candidates.flatMap((candidate): Question[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const data = candidate as Record<string, unknown>;
    const type = data.type;
    const text = data.text;
    const answer = data.answer;
    if (!isQuestionType(type) || typeof text !== "string" || typeof answer !== "string") return [];
    const options = Array.isArray(data.options)
      ? data.options.filter((option): option is string => typeof option === "string")
      : undefined;
    if (type === "mc" && (!options || options.length < 2)) return [];
    return [{
      type,
      text,
      answer,
      options,
      explanation: typeof data.explanation === "string" ? data.explanation : undefined,
    }];
  });
}

function isQuestionType(value: unknown): value is QuestionType {
  return value === "mc" || value === "cloze" || value === "tf" || value === "short";
}

function evaluate(question: Question, userAnswer: string, article: string): { correct: boolean; message: string } {
  if (question.type === "mc") {
    const correct = userAnswer === question.answer;
    return { correct, message: correct ? "答对了！" : `正确答案：${question.answer}` };
  }
  if (question.type === "tf") {
    const correct = normalizeTruth(userAnswer) === normalizeTruth(question.answer);
    return { correct, message: correct ? "判断正确！" : `正确答案：${question.answer}` };
  }

  const user = userAnswer.trim().toLowerCase();
  const expected = question.answer.trim().toLowerCase();
  if (user === expected) return { correct: true, message: "完全正确！" };
  const tokens = user.split(/[\s,，.。;；、]+/).filter((token) => token.length >= 2);
  const lowerArticle = article.toLowerCase();
  const hits = tokens.filter((token) => lowerArticle.includes(token)).length;
  const ratio = tokens.length ? hits / tokens.length : 0;
  return ratio >= 0.5
    ? { correct: true, message: `基本正确（关键词命中率 ${Math.round(ratio * 100)}%）` }
    : { correct: false, message: `参考答案：${question.answer}` };
}

function normalizeTruth(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (["对", "true", "t", "√", "yes", "y", "1"].includes(normalized)) return "对";
  if (["错", "false", "f", "×", "x", "no", "n", "0"].includes(normalized)) return "错";
  return normalized;
}

function formatDiagnostic(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
