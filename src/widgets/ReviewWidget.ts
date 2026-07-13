import { MarkdownRenderer } from "obsidian";
import { KnowledgeService, type KnowledgeData, type MathKnowledge, type WordKnowledge } from "../services/KnowledgeService";
import type { WidgetContext } from "../types";

interface ReviewSettings {
  knowledgePath?: unknown;
}

interface ReviewSelection {
  word: WordKnowledge;
  math: MathKnowledge;
}

interface CachedKnowledge {
  ts: number;
  path: string;
  data: KnowledgeData;
}

const CACHE_KEY = "home-knowledge-cache-v1";
const HISTORY_KEY = "home-review-history-v1";
const TODAY_KEY = "home-review-today-v1";
const CACHE_TTL = 60 * 60 * 1_000;

export function mountReviewWidget(containerEl: HTMLElement, context: WidgetContext): void {
  const { app, component } = context;
  const settings = context.settings as ReviewSettings;
  const knowledgePath = typeof settings.knowledgePath === "string" && settings.knowledgePath.trim()
    ? settings.knowledgePath.trim()
    : "plans/知识点.md";
  const knowledge = new KnowledgeService(app, knowledgePath);
  let words: WordKnowledge[] = [];
  let maths: MathKnowledge[] = [];
  let disposed = false;

  const root = containerEl.createDiv({ cls: "home-review home-review-solo" });
  const head = root.createDiv({ cls: "home-review-head" });
  const dateLabel = head.createSpan();
  dateLabel.appendText("📅 今日复习 · ");
  dateLabel.createEl("b", { text: formattedDate() });
  const progress = head.createSpan({ text: "—" });
  const grid = root.createDiv({ cls: "home-review-grid" });
  const source = root.createDiv({ cls: "home-review-source" });
  source.createSpan({ cls: "src-label", text: "📂 内容来源：" });
  const sourceLink = source.createEl("a", { href: "#", text: knowledgePath });
  const footer = root.createDiv({ cls: "home-review-foot" });
  footer.createSpan({ text: "抽到重复时允许（历史池耗尽后重置）" });
  const footerActions = footer.createDiv({ cls: "home-review-foot-actions" });
  const reshuffleButton = footerActions.createEl("button", { text: "↻ 换一组" });
  const reloadButton = footerActions.createEl("button", { text: "🔄 重新加载" });

  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    event: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    target.addEventListener(event, handler as EventListener);
    component.register(() => target.removeEventListener(event, handler as EventListener));
  };

  listen(sourceLink, "click", (event) => {
    event.preventDefault();
    openKnowledge();
  });
  listen(reshuffleButton, "click", () => {
    localStorage.removeItem(TODAY_KEY);
    render();
  });
  listen(reloadButton, "click", () => {
    void loadAndRender(true);
  });
  component.register(() => {
    disposed = true;
  });

  void loadAndRender(false);

  function openKnowledge(): void {
    void app.workspace.openLinkText(knowledgePath.replace(/\.md$/i, ""), "/", true);
  }

  async function loadAndRender(force: boolean): Promise<void> {
    reloadButton.disabled = true;
    reloadButton.setText("加载中…");
    if (!words.length && !maths.length) renderMessage("加载复习内容…");
    try {
      const data = await loadKnowledge(force);
      if (disposed) return;
      words = Array.isArray(data.words) ? data.words : [];
      maths = Array.isArray(data.maths) ? data.maths : [];
      render();
    } catch (error) {
      if (!disposed) renderMessage(`加载失败：${errorMessage(error)}`, true);
    } finally {
      reloadButton.disabled = false;
      reloadButton.setText("🔄 重新加载");
    }
  }

  async function loadKnowledge(force: boolean): Promise<KnowledgeData> {
    if (!force) {
      const cached = readJson<CachedKnowledge | null>(CACHE_KEY, null);
      if (cached?.path === knowledgePath && Date.now() - cached.ts < CACHE_TTL) return cached.data;
    }
    const data = await knowledge.load();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), path: knowledgePath, data } satisfies CachedKnowledge));
    return data;
  }

  function render(): void {
    const used = readJson<string[]>(HISTORY_KEY, []);
    const usedWords = new Set(used.filter((id) => id.startsWith("w"))).size;
    const usedMaths = new Set(used.filter((id) => id.startsWith("m"))).size;
    progress.setText(`近期已抽 单词 ${usedWords}/${words.length} · 数学 ${usedMaths}/${maths.length}`);

    if (!words.length || !maths.length) {
      const missing = !words.length && !maths.length
        ? "复习库为空"
        : !words.length
          ? "英文词汇为空"
          : "数学知识点为空";
      renderEmpty(missing);
      return;
    }

    const selection = drawSelection();
    if (!selection) {
      renderEmpty("没有可复习的内容");
      return;
    }
    grid.empty();
    grid.append(createCard(selection.word, "word"), createCard(selection.math, "math"));
  }

  function renderMessage(message: string, error = false): void {
    grid.empty();
    grid.createDiv({ cls: `home-review-empty${error ? " err" : ""}`, text: message });
  }

  function renderEmpty(message: string): void {
    grid.empty();
    const empty = grid.createDiv({ cls: "home-review-empty" });
    empty.createDiv({ text: message });
    const help = empty.createDiv({ cls: "home-review-empty-help" });
    help.appendText("请在 ");
    const link = help.createEl("a", { href: "#", text: knowledgePath });
    help.appendText(" 添加内容后重新加载");
    listen(link, "click", (event) => {
      event.preventDefault();
      openKnowledge();
    });
  }

  function drawSelection(): ReviewSelection | null {
    if (!words.length || !maths.length) return null;
    const date = todayKey();
    const cached = readJson<{ date?: string; wordId?: string; mathId?: string } | null>(TODAY_KEY, null);
    if (cached?.date === date) {
      const word = words.find((item) => item.id === cached.wordId);
      const math = maths.find((item) => item.id === cached.mathId);
      if (word && math) return { word, math };
    }

    const history = readJson<string[]>(HISTORY_KEY, []);
    const word = pick(words, new Set(history.filter((id) => id.startsWith("w")).slice(-10)));
    const math = pick(maths, new Set(history.filter((id) => id.startsWith("m")).slice(-10)));
    if (!word || !math) return null;
    localStorage.setItem(HISTORY_KEY, JSON.stringify([...history, word.id, math.id].slice(-20)));
    localStorage.setItem(TODAY_KEY, JSON.stringify({ date, wordId: word.id, mathId: math.id }));
    return { word, math };
  }

  function createCard(item: WordKnowledge | MathKnowledge, type: "word" | "math"): HTMLDivElement {
    const card = createDiv({ cls: `home-review-card ${type}` });
    card.createDiv({ cls: "home-review-pt", text: type === "word" ? "📖 英文词汇" : "🧮 数学知识点" });
    const title = card.createDiv({ cls: "home-review-title" });
    if (type === "word" && isWord(item)) {
      title.createEl("i", { text: item.name });
      title.createSpan({ cls: "home-review-pos", text: ` ${item.pos}` });
    } else if (isMath(item)) {
      title.setText(item.title);
    }
    card.createDiv({ cls: "home-review-meta", text: `${type === "word" ? "单词" : "数学"} · ID ${item.id}` });
    const body = card.createDiv({ cls: "home-review-body" });
    const revealButton = card.createEl("button", { cls: "home-review-btn", text: "📖 定义解释" });
    let rendered = false;
    listen(revealButton, "click", () => {
      const opening = !card.hasClass("open");
      card.toggleClass("open", opening);
      revealButton.setText(opening ? "🔼 收起" : "📖 定义解释");
      if (opening && !rendered) {
        rendered = true;
        if (type === "math") {
          void MarkdownRenderer.render(app, item.def ?? "", body, knowledgePath, component);
        } else {
          body.setText(item.def ?? "");
        }
      }
    });
    return card;
  }
}

function pick<T extends { id: string }>(items: T[], excluded: Set<string>): T | undefined {
  if (!items.length) return undefined;
  const available = items.filter((item) => !excluded.has(item.id));
  const pool = available.length ? available : items;
  return pool[Math.floor(Math.random() * pool.length)];
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function todayKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formattedDate(): string {
  const date = new Date();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${todayKey()} · 星期${weekdays[date.getDay()]}`;
}

function isWord(item: WordKnowledge | MathKnowledge): item is WordKnowledge {
  return "name" in item;
}

function isMath(item: WordKnowledge | MathKnowledge): item is MathKnowledge {
  return "title" in item;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
