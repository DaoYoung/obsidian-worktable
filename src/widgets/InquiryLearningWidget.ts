import { CloakfetchClient } from "../services/CloakfetchClient";
import { KnowledgeService } from "../services/KnowledgeService";
import { createHomeDb, type LearningRecord } from "../storage/homeDb";
import { type WorktableSettings } from "../settings";
import type { WidgetContext } from "../types";
import { parsePastedArticle } from "./parsePastedArticle";
import { MarkdownRenderer } from "obsidian";

type QuestionType = "mc" | "cloze" | "tf" | "short";

interface Question {
  type: QuestionType;
  text: string;
  answer: string;
  options?: string[];
  explanation?: string;
}

interface InquiryState {
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

interface InquirySettings {
  knowledgeFile?: unknown;
  enableFallbackProxies?: unknown;
}

const KNOWLEDGE_CACHE_KEY = "home-knowledge-cache-v1";
const REVIEW_SOURCES_CACHE_KEY = "home-review-sources-v2";
const FLOWER_KEY = "home-learning-flowers";

export function mountInquiryLearningWidget(containerEl: HTMLElement, context: WidgetContext): void {
  const { app, component, dashboardEl } = context;
  const settings = context.settings as InquirySettings & Partial<WorktableSettings>;
  const knowledgePath = typeof settings.knowledgeFile === "string" && settings.knowledgeFile.trim()
    ? settings.knowledgeFile.trim()
    : "plans/知识点.md";
  const client = new CloakfetchClient(context.settings as WorktableSettings);
  const knowledge = new KnowledgeService(app, knowledgePath);
  const db = createHomeDb();
  let state = emptyState();
  let disposed = false;

  const root = containerEl.createDiv({ cls: "home-learn" });
  const heading = root.createEl("h3");
  const statusEl = heading.createSpan({ cls: "learn-status", text: "空闲" });

  // 顶部 2:1 布局：左 ① 输入文章，右 小红花（WorktableView 挂载到 slot）
  const topRow = root.createDiv({ cls: "learn-top-row" });
  const inputCol = topRow.createDiv({ cls: "learn-top-input" });
  const flowersSlot = topRow.createDiv({
    cls: "learn-top-flowers",
    attr: { "data-flowers-slot": "" },
  });

  const fetchSection = section(inputCol, "① 输入文章内容");
  const fetchRow = fetchSection.createDiv({ cls: "learn-row" });
  const urlInput = fetchRow.createEl("input", { type: "url", placeholder: "https://example.com/article（可选 — 需要本地服务）" });
  const fetchButton = button(fetchRow, "📥 抓取");
  const archiveTopButton = button(fetchRow, "📦 归档本次学习", "success compact");
  archiveTopButton.hidden = true;
  const newRoundButton = button(fetchRow, "🗑️ 重置清空", "secondary");
  newRoundButton.hidden = true;
  const archivedNotice = fetchSection.createDiv({ cls: "learn-archived-notice" });
  archivedNotice.hidden = true;

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

  // ② + ③: 重点摘录 (左) 与 题目训练 (右) 拆为左右两列。
  //    渐进式呈现：① 输入 → 出现左右两列 → 点提取重点才出补充到知识库
  //    → 点 AI 出题才出提交答案 → 点提交答案后才显示归档反馈。
  const learnSplit = root.createDiv({ cls: "learn-split" });
  learnSplit.hidden = true;

  // 左列：重点摘录
  const leftCol = learnSplit.createDiv({ cls: "learn-col learn-col-left" });
  leftCol.createDiv({ cls: "learn-col-h", text: "② 重点摘录" });
  const extractRow = leftCol.createDiv({ cls: "learn-row" });
  const extractButton = button(extractRow, "🎯 AI 提取重点", "secondary");
  const leftScroll = leftCol.createDiv({ cls: "learn-col-scroll" });
  const keyPointList = leftScroll.createDiv({ cls: "kp-list" });
  const keyPointActions = leftScroll.createDiv({ cls: "kp-actions" });
  keyPointActions.hidden = true;
  const appendPointsButton = button(keyPointActions, "📥 补充到知识库", "success");
  const selectAllButton = button(keyPointActions, "全选", "secondary");
  const selectNoneButton = button(keyPointActions, "全不选", "secondary");
  const keyPointStatus = keyPointActions.createSpan({ cls: "kp-status" });

  // 右列：题目训练（提交按交互逐步出现）
  const rightCol = learnSplit.createDiv({ cls: "learn-col learn-col-right" });
  rightCol.createDiv({ cls: "learn-col-h", text: "③ 题目训练" });
  const generateRow = rightCol.createDiv({ cls: "learn-row" });
  const generateButton = button(generateRow, "🤖 AI 出题", "secondary");
  const rightScroll = rightCol.createDiv({ cls: "learn-col-scroll" });
  const questionList = rightScroll.createDiv({ cls: "learn-question-list" });
  const submitAllButton = button(rightScroll, "📝 提交答案", "success compact");
  submitAllButton.classList.add("learn-submit-all");
  submitAllButton.hidden = true;
  const archiveSummary = rightScroll.createSpan({ cls: "learn-archive-summary" });

  // ④ 自由问答：放在 AI 出题板块下方新一行,初次隐藏,文章加载后与 learnSplit 同步显示
  const freeAskSection = root.createDiv({ cls: "learn-faq" });
  freeAskSection.hidden = true;
  freeAskSection.createDiv({ cls: "learn-section-h", text: "④ 自由问答" });
  const freeAskHint = freeAskSection.createDiv({ cls: "learn-faq-hint", text: "输入关于本文的任何问题，AI 会基于文章内容回答。" });
  const freeAskTextarea = freeAskSection.createEl("textarea", {
    cls: "learn-faq-input",
    attr: { placeholder: "例如：本文的核心论点是什么？", rows: "3" },
  });
  const freeAskRow = freeAskSection.createDiv({ cls: "learn-row" });
  const freeAskButton = button(freeAskRow, "💬 AI 回答", "secondary");
  const freeAskClearButton = button(freeAskRow, "清空", "secondary compact");
  const freeAskAnswerBox = freeAskSection.createDiv({ cls: "learn-faq-answer", attr: { "aria-live": "polite" } });

  // Status banner at the very bottom of the inquiry module.
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
    archivedNotice.createSpan({ text: `ℹ️ 本文已归档过（${count} 次），再次归档会保留独立记录` });
  };

  const hideArchivedNotice = (): void => {
    archivedNotice.hidden = true;
    archivedNotice.empty();
  };

  const openKnowledge = (): void => {
    void app.workspace.openLinkText(knowledgePath.replace(/\.md$/i, ""), "/", true);
  };

  const setInputSectionLoaded = (loaded: boolean): void => {
    urlInput.hidden = loaded;
    fetchButton.hidden = loaded;
    archiveTopButton.hidden = !loaded;
    newRoundButton.hidden = !loaded;
    pasteButton.hidden = loaded;
    pasteClearButton.hidden = loaded;
    pasteSummary.setText(loaded ? "正文" : "📋 粘贴正文（无需本地服务 · 点击展开）");
  };

  listen(fetchButton, "click", () => {
    void runFetch();
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
  listen(archiveTopButton, "click", () => {
    void archiveLearning();
  });
  listen(submitAllButton, "click", () => {
    submitAllAnswers();
  });
  listen(freeAskButton, "click", () => {
    void runFreeAsk();
  });
  listen(freeAskClearButton, "click", () => {
    freeAskTextarea.value = "";
    freeAskAnswerBox.empty();
    freeAskTextarea.focus();
  });
  listen(newRoundButton, "click", resetRound);

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
      pasteTextarea.value = article.text;
      pasteDetails.open = true;
      learnSplit.hidden = false;
      freeAskSection.hidden = false;
      questionList.empty();
      state.lastAnswers = [];
      state.lastCorrect = [];
      setInputSectionLoaded(true);
      hideArchivedNotice();
      try {
        const archivedCount = await db.countLearningRecordsByTopic(url);
        if (disposed) return;
        if (archivedCount > 0) showArchivedNotice(archivedCount);
      } catch (_) {
        // Best-effort; failure here is non-fatal.
      }
      setStatus(`已抓取 · ${article.text.length} 字`, "ok");
    } catch (error) {
      showError(error, "抓取失败");
      setStatus("抓取失败时,直接粘贴正文到下方文本框,无需任何本地服务。", "err");
    } finally {
      fetchButton.disabled = false;
    }
  }

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
      pasteButton.hidden = true;
      pasteClearButton.hidden = true;
      pasteSummary.setText("正文");
      learnSplit.hidden = false;
      freeAskSection.hidden = false;
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
    submitAllButton.hidden = false;
    submitAllButton.disabled = false;
    submitAllButton.setText("📝 提交全部答案");
    archiveTopButton.setText("📦 归档本次学习");
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
    const correctCount = state.lastCorrect.reduce(
      (sum, value) => sum + (value === true ? 1 : 0),
      0,
    );
    const topic = deriveArchiveTopic(state.url, state.title, state.article);
    archiveTopButton.setText("归档中…");
    try {
      const record: LearningRecord = {
        title: state.title,
        url: state.url,
        topic,
        totalCount: answered.length,
        correctCount,
        createdAt: Date.now(),
      };
      await db.addLearningRecord(record);
      if (disposed) return;
      dashboardEl.dispatchEvent(
        new CustomEvent("home-learning-archived", { bubbles: true, detail: record }),
      );
      archiveTopButton.setText("✓ 已归档本次学习");
      setStatus(`已归档 · ${correctCount}/${answered.length}`, "ok");
      showDone(`✅ 已归档本次学习（${correctCount}/${answered.length} 题）`);
    } catch (error) {
      archiveTopButton.setText("📦 归档本次学习");
      showError(error, "归档失败");
      showDone(`❌ 归档失败：${errorMessage(error)}`, "err");
    }
  }

  function resetRound(): void {
    state = emptyState();
    urlInput.value = "";
    pasteTextarea.value = "";
    pasteDetails.open = false;
    learnSplit.hidden = true;
    freeAskSection.hidden = true;
    freeAskTextarea.value = "";
    freeAskAnswerBox.empty();
    freeAskButton.disabled = false;
    freeAskButton.setText("💬 AI 回答");
    questionList.empty();
    submitAllButton.hidden = true;
    submitAllButton.disabled = true;
    submitAllButton.setText("📝 提交全部答案");
    archiveTopButton.setText("📦 归档本次学习");
    archiveSummary.setText("");
    keyPointList.empty();
    keyPointActions.hidden = true;
    hideArchivedNotice();
    hideLoading();
    setInputSectionLoaded(false);
    setStatus("空闲");
  }

  async function runFreeAsk(): Promise<void> {
    if (!state.article) {
      setStatus("请先抓取文章", "err");
      return;
    }
    const question = freeAskTextarea.value.trim();
    if (!question) {
      setStatus("请先输入问题", "err");
      freeAskTextarea.focus();
      return;
    }
    freeAskButton.disabled = true;
    freeAskButton.setText("回答中…");
    setStatus("AI 回答中…");
    showLoading("💬 AI 正在基于文章回答你的问题，请稍候…");
    freeAskAnswerBox.empty();
    freeAskAnswerBox.createDiv({ cls: "learn-faq-answer-pending", text: "正在生成回答…" });
    try {
      const answer = await client.askQuestion(state.title, state.article, question);
      if (disposed) return;
      freeAskAnswerBox.empty();
      if (!answer.trim()) {
        freeAskAnswerBox.createDiv({ cls: "learn-faq-answer-empty", text: "AI 没有返回内容，请换个问题试试。" });
        setStatus("AI 未返回回答", "err");
        showDone("❌ AI 没有返回回答", "err");
        return;
      }
      const body = freeAskAnswerBox.createDiv({ cls: "learn-faq-answer-body" });
      await MarkdownRenderer.render(app, answer, body, "", component);
      setStatus("已生成回答", "ok");
      showDone("✅ 已基于文章回答问题");
    } catch (error) {
      freeAskAnswerBox.empty();
      freeAskAnswerBox.createDiv({
        cls: "learn-faq-answer-empty",
        text: `回答失败：${errorMessage(error)}`,
      });
      showError(error, "AI 回答失败");
      showDone(`❌ 回答失败：${errorMessage(error)}`, "err");
    } finally {
      freeAskButton.disabled = false;
      freeAskButton.setText("💬 AI 回答");
    }
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
      localStorage.removeItem(REVIEW_SOURCES_CACHE_KEY);
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

  function showError(error: unknown, prefix: string): void {
    if (!disposed) setStatus(`${prefix}：${errorMessage(error)}`, "err");
  }
}

function emptyState(): InquiryState {
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

/**
 * Pick the per-article primary key for archive lookup.
 * URL 抓取的文章 → URL 作主键(同一 URL 多次归档可重复识别);
 * 粘贴文本(无 URL) → 标题或正文前 30 字,保证可重复识别同一篇。
 */
function deriveArchiveTopic(url: string, title: string, article: string): string {
  const trimmedUrl = (url || "").trim();
  if (trimmedUrl && trimmedUrl !== "(粘贴)") return trimmedUrl;
  const trimmedTitle = (title || "").trim();
  if (trimmedTitle) return trimmedTitle;
  return (article || "").trim().slice(0, 30);
}

function section(parent: HTMLElement, title: string): HTMLDivElement {
  const element = parent.createDiv({ cls: "learn-section" });
  element.createDiv({ cls: "learn-section-h", text: title });
  return element;
}

function button(parent: HTMLElement, text: string, className = ""): HTMLButtonElement {
  return parent.createEl("button", { text, cls: className });
}

function pickQuestionCount(textLength: number): number {
  if (textLength < 500) return 1;
  if (textLength < 1500) return 2;
  if (textLength < 3000) return 3;
  if (textLength < 5000) return 4;
  return 5;
}

async function fetchArticle(
  client: CloakfetchClient,
  url: string,
  allowPublicFallbacks: boolean,
): Promise<{ title: string; text: string; html: string }> {
  try {
    const res = await client.fetchUrl(url);
    if (res && typeof res === "object" && res.ok) {
      const html = typeof res.html === "string" ? res.html : "";
      const serverTitle = typeof res.title === "string" ? res.title : "";
      if (typeof res.markdown === "string" && res.markdown.trim().length >= 50) {
        return { title: serverTitle, text: res.markdown.trim().slice(0, 6_000), html };
      }
      if (html.length >= 50) {
        const article = htmlToArticle(html);
        return { title: serverTitle || article.title, text: article.text, html };
      }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}