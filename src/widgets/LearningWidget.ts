import { MarkdownRenderer } from "obsidian";
import { CloakfetchClient, type ExpandedKnowledge } from "../services/CloakfetchClient";
import { KnowledgeService } from "../services/KnowledgeService";
import { createHomeDb, type LearningRecord } from "../storage/homeDb";
import type { WidgetContext } from "../types";

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
  questionIndex: number;
  userAnswer: string;
  correct: boolean | null;
  keyPoints: string[];
  selectedPoints: Set<number>;
}

interface LearningSettings {
  knowledgePath?: unknown;
  enablePublicFetchFallbacks?: unknown;
}

const KNOWLEDGE_CACHE_KEY = "home-knowledge-cache-v1";
const FLOWER_KEY = "home-learning-flowers";

export function mountLearningWidget(containerEl: HTMLElement, context: WidgetContext): void {
  const { app, component, dashboardEl } = context;
  const settings = context.settings as LearningSettings;
  const knowledgePath = typeof settings.knowledgePath === "string" && settings.knowledgePath.trim()
    ? settings.knowledgePath.trim()
    : "plans/知识点.md";
  const client = new CloakfetchClient();
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

  const fetchSection = section(root, "① 输入网址 → 抓取内容");
  const fetchRow = fetchSection.createDiv({ cls: "learn-row" });
  const urlInput = fetchRow.createEl("input", { type: "url", placeholder: "https://example.com/article" });
  const fetchButton = button(fetchRow, "📥 抓取");
  const diagnoseButton = button(fetchRow, "🔍 诊断", "secondary");
  const diagnostics = fetchSection.createEl("pre", { cls: "learn-diagnostics" });
  diagnostics.hidden = true;

  const articleSection = section(root, "② 原文与 AI 出题/重点");
  articleSection.hidden = true;
  const articleRow = articleSection.createDiv({ cls: "learn-row" });
  const generateButton = button(articleRow, "🤖 AI 出题（最多 3 道）", "secondary");
  const extractButton = button(articleRow, "🎯 AI 提取重点", "secondary");
  const previousButton = button(articleRow, "◀", "secondary compact");
  const questionPosition = articleRow.createSpan({ cls: "learn-question-position", text: "—/—" });
  const nextButton = button(articleRow, "▶", "secondary compact");
  const articleContext = articleSection.createDiv({ cls: "learn-context" });
  const keyPointList = articleSection.createDiv({ cls: "kp-list" });
  keyPointList.hidden = true;
  const keyPointActions = articleSection.createDiv({ cls: "kp-actions" });
  keyPointActions.hidden = true;
  const appendPointsButton = button(keyPointActions, "📥 补充选中项", "success");
  const selectAllButton = button(keyPointActions, "全选", "secondary");
  const selectNoneButton = button(keyPointActions, "全不选", "secondary");
  const keyPointStatus = keyPointActions.createSpan({ cls: "kp-status" });

  const questionSection = section(root, "③ 题目");
  questionSection.hidden = true;
  const questionBadge = questionSection.createSpan({ cls: "learn-question-badge" });
  const questionText = questionSection.createDiv({ cls: "learn-q-text" });
  const answerArea = questionSection.createDiv();
  const questionActions = questionSection.createDiv({ cls: "learn-row" });
  const submitButton = button(questionActions, "📝 提交答案", "success");
  const manualButton = button(questionActions, "✍️ 自己出题", "secondary");

  const resultSection = section(root, "④ 评判与归档");
  resultSection.hidden = true;
  const feedback = resultSection.createDiv({ cls: "learn-feedback" });
  const explanation = resultSection.createDiv({ cls: "learn-explanation" });
  explanation.hidden = true;
  const resultActions = resultSection.createDiv({ cls: "learn-row" });
  const archiveButton = button(resultActions, "📦 归档本次学习", "success");
  const newRoundButton = button(resultActions, "🔄 新一轮", "secondary");

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
  listen(generateButton, "click", () => {
    void generateQuestions();
  });
  listen(extractButton, "click", () => {
    void extractKeyPoints();
  });
  listen(previousButton, "click", () => changeQuestion(-1));
  listen(nextButton, "click", () => changeQuestion(1));
  listen(submitButton, "click", submitAnswer);
  listen(manualButton, "click", createManualQuestion);
  listen(appendPointsButton, "click", () => {
    void appendSelectedPoints();
  });
  listen(selectAllButton, "click", () => selectPoints(true));
  listen(selectNoneButton, "click", () => selectPoints(false));
  listen(archiveButton, "click", () => {
    void archiveLearning();
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
      const html = await fetchArticle(client, url, settings.enablePublicFetchFallbacks === true);
      const article = htmlToArticle(html);
      if (article.text.length < 50) throw new Error("正文太短或无法提取");
      if (disposed) return;
      state.url = url;
      state.title = article.title || url;
      state.article = article.text;
      articleContext.setText(`${article.text.slice(0, 600)}${article.text.length > 600 ? "…" : ""}`);
      articleSection.hidden = false;
      questionSection.hidden = true;
      resultSection.hidden = true;
      setStatus(`已抓取 · ${article.text.length} 字`, "ok");
    } catch (error) {
      showError(error, "抓取失败");
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

  async function generateQuestions(): Promise<void> {
    if (!state.article) {
      setStatus("请先抓取文章", "err");
      return;
    }
    generateButton.disabled = true;
    setStatus("AI 出题中…");
    try {
      const generated = await client.generateQuestions(state.title, state.article, 3);
      const questions = normalizeQuestions(generated).slice(0, 3);
      if (!questions.length) throw new Error("AI 未生成任何题目");
      if (disposed) return;
      state.questions = questions;
      state.questionIndex = 0;
      state.userAnswer = "";
      state.correct = null;
      questionSection.hidden = false;
      resultSection.hidden = true;
      renderQuestion();
      setStatus(`已生成 ${questions.length} 道题`, "ok");
    } catch (error) {
      showError(error, "出题失败");
    } finally {
      generateButton.disabled = false;
    }
  }

  function renderQuestion(): void {
    const question = state.questions[state.questionIndex];
    if (!question) {
      questionSection.hidden = true;
      return;
    }
    const labels: Record<QuestionType, string> = {
      mc: "单选",
      cloze: "填空",
      tf: "判断",
      short: "简答",
    };
    questionBadge.setText(labels[question.type]);
    questionText.setText(question.text);
    questionPosition.setText(`${state.questionIndex + 1}/${state.questions.length}`);
    previousButton.disabled = state.questionIndex === 0;
    nextButton.disabled = state.questionIndex >= state.questions.length - 1;
    answerArea.empty();
    state.userAnswer = "";
    state.correct = null;

    if (question.type === "mc" || question.type === "tf") {
      const options = question.type === "tf" ? ["对", "错"] : question.options ?? [];
      const optionList = answerArea.createDiv({ cls: "learn-options" });
      options.forEach((option, index) => {
        const optionEl = optionList.createEl("button", {
          cls: "learn-option",
          text: question.type === "mc" ? `${String.fromCharCode(65 + index)}. ${option}` : option,
        });
        listen(optionEl, "click", () => {
          if (state.correct !== null) return;
          optionList.querySelectorAll(".learn-option").forEach((element) => element.removeClass("selected"));
          optionEl.addClass("selected");
          state.userAnswer = option;
        });
      });
      return;
    }

    answerArea.createEl("textarea", {
      cls: "learn-answer",
      placeholder: question.type === "short" ? "请输入 1–5 个关键词…" : "请填入空白处的关键词…",
    });
  }

  function changeQuestion(direction: number): void {
    const next = state.questionIndex + direction;
    if (next < 0 || next >= state.questions.length) return;
    state.questionIndex = next;
    resultSection.hidden = true;
    renderQuestion();
  }

  function createManualQuestion(): void {
    const text = window.prompt("输入题目（留空取消）：")?.trim();
    if (!text) return;
    const answer = window.prompt("输入参考答案：")?.trim();
    if (!answer) return;
    state.questions.push({ type: "cloze", text, answer, explanation: "用户自定义题目" });
    state.questionIndex = state.questions.length - 1;
    questionSection.hidden = false;
    resultSection.hidden = true;
    renderQuestion();
    setStatus("已添加自定义题目", "ok");
  }

  function submitAnswer(): void {
    const question = state.questions[state.questionIndex];
    if (!question) return;
    if (question.type === "cloze" || question.type === "short") {
      state.userAnswer = answerArea.querySelector<HTMLTextAreaElement>("textarea")?.value.trim() ?? "";
    }
    if (!state.userAnswer) {
      setStatus("请先作答", "err");
      return;
    }
    const result = evaluate(question, state.userAnswer, state.article);
    state.correct = result.correct;
    feedback.className = `learn-feedback ${result.correct ? "ok" : "err"}`;
    feedback.setText(`${result.correct ? "✓" : "✗"} ${result.message}`);
    explanation.hidden = !question.explanation;
    explanation.setText(question.explanation ? `💡 ${question.explanation}` : "");
    resultSection.hidden = false;
    archiveButton.disabled = false;
    archiveButton.setText("📦 归档本次学习");
    markOptions(question);
    setStatus(result.correct ? "答对 +1 🌸" : "再接再厉", result.correct ? "ok" : "err");
    if (result.correct) incrementFlowers();
  }

  function markOptions(question: Question): void {
    answerArea.querySelectorAll<HTMLButtonElement>(".learn-option").forEach((optionEl) => {
      const label = optionEl.textContent?.replace(/^[A-Z]\.\s*/, "") ?? "";
      if (normalizeTruth(label) === normalizeTruth(question.answer)) optionEl.addClass("correct");
      else if (optionEl.hasClass("selected")) optionEl.addClass("wrong");
      optionEl.disabled = true;
    });
  }

  function incrementFlowers(): void {
    const total = Number.parseInt(localStorage.getItem(FLOWER_KEY) ?? "0", 10) + 1;
    localStorage.setItem(FLOWER_KEY, String(total));
    dashboardEl.dispatchEvent(new CustomEvent("home-flowers-changed", { bubbles: true, detail: { total } }));
  }

  async function archiveLearning(): Promise<void> {
    const question = state.questions[state.questionIndex];
    if (!question || state.correct === null) {
      setStatus("请先作答", "err");
      return;
    }
    archiveButton.disabled = true;
    archiveButton.setText("归档中…");
    const record: LearningRecord = {
      title: state.title,
      url: state.url,
      question: question.text,
      questionType: question.type,
      correct: state.correct,
      userAnswer: state.userAnswer,
      correctAnswer: question.answer,
      createdAt: Date.now(),
    };
    try {
      await db.addLearningRecord(record);
      if (disposed) return;
      archiveButton.setText("✓ 已归档");
      setStatus("已归档", "ok");
      dashboardEl.dispatchEvent(new CustomEvent("home-learning-archived", { bubbles: true, detail: record }));
    } catch (error) {
      archiveButton.disabled = false;
      archiveButton.setText("📦 归档本次学习");
      showError(error, "归档失败");
    }
  }

  function resetRound(): void {
    state = emptyState();
    urlInput.value = "";
    articleSection.hidden = true;
    questionSection.hidden = true;
    resultSection.hidden = true;
    keyPointList.hidden = true;
    keyPointList.empty();
    keyPointActions.hidden = true;
    diagnostics.hidden = true;
    questionPosition.setText("—/—");
    setStatus("空闲");
  }

  async function extractKeyPoints(): Promise<void> {
    if (!state.article) {
      setStatus("请先抓取文章", "err");
      return;
    }
    extractButton.disabled = true;
    setStatus("AI 提取重点中…");
    try {
      const points = (await client.extractKeyPoints(state.title, state.article, 8))
        .filter((point): point is string => typeof point === "string" && point.trim().length > 0);
      if (!points.length) throw new Error("未提取到任何重点");
      if (disposed) return;
      state.keyPoints = points;
      state.selectedPoints = new Set(points.map((_, index) => index));
      renderKeyPoints();
      setStatus(`已提取 ${points.length} 个重点`, "ok");
    } catch (error) {
      showError(error, "提取失败");
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
    } catch (error) {
      preview.hidden = true;
      previewSubject.hidden = true;
      conceptStatus.className = "kp-status err";
      conceptStatus.setText(`整理失败：${errorMessage(error)}`);
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
    questionIndex: 0,
    userAnswer: "",
    correct: null,
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

async function fetchArticle(client: CloakfetchClient, url: string, allowPublicFallbacks: boolean): Promise<string> {
  try {
    const res = await client.fetchUrl(url);
    if (res && typeof res === "object" && "html" in res && typeof (res as { html?: unknown }).html === "string") {
      return (res as { html: string }).html;
    }
    throw new Error("Fetch returned no HTML");
  } catch (localError) {
    if (!allowPublicFallbacks) throw localError;
  }

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
      if (contentType.includes("application/json")) {
        const payload = await response.json() as { contents?: unknown; data?: unknown };
        const html = typeof payload.contents === "string" ? payload.contents : payload.data;
        if (typeof html === "string" && html.length >= 50) return html;
      } else {
        const html = await response.text();
        if (html.length >= 50) return html;
      }
      throw new Error("返回内容为空");
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
