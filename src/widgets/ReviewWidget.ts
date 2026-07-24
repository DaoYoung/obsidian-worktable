import { MarkdownRenderer } from "obsidian";
import {
  loadReviewKnowledgeSources,
  type ReviewKnowledgeData,
  type ReviewMathKnowledge,
  type ReviewSubjectKnowledge,
  type ReviewWordKnowledge,
} from "../services/KnowledgeService";
import { resolveReviewSources, type WorktableSettings } from "../settings";
import type { WidgetContext } from "../types";

type Discipline = "word" | "math" | "subject";

interface ReviewEntry {
  id: string;
  discipline: Discipline;
  disciplineLabel: string;
  display: string;
  pos?: string;
  def: string;
  sourcePath: string;
  sourceName: string;
}

interface ReviewSelection {
  a: ReviewEntry;
  b: ReviewEntry;
}

interface ReviewPool {
  key: string;
  label: string;
  discipline: Discipline;
  entries: ReviewEntry[];
}

interface HistoryRecord {
  key: string;
  id: string;
}

interface StoredSelection {
  date?: string;
  signature?: string;
  aKey?: string;
  aId?: string;
  bKey?: string;
  bId?: string;
}

interface CachedReviewSources {
  ts: number;
  signature: string;
  data: ReviewKnowledgeData;
}

const HISTORY_KEY = "home-review-history-v1";
const TODAY_KEY = "home-review-today-v1";
// v2 invalidates v1 cache entries that predate the adapter.read fix. The
// historical warnings embedded in v1 are not from the current code path
// and should not survive a reload.
const CACHE_KEY = "home-review-sources-v2";
const CACHE_TTL = 60 * 60 * 1_000;
const RECENT_PER_DISCIPLINE = 10;
const HISTORY_MAX = 60;

export function mountReviewWidget(containerEl: HTMLElement, context: WidgetContext): void {
  const { app, component } = context;
  const settings = (context.settings ?? {}) as Partial<WorktableSettings>;
  const resolvedSources = resolveReviewSources({
    knowledgeFile: typeof settings.knowledgeFile === "string" ? settings.knowledgeFile : "",
    reviewSources: Array.isArray(settings.reviewSources) ? settings.reviewSources : [],
  });

  let data: ReviewKnowledgeData | null = null;
  let pools: ReviewPool[] = [];
  let disposed = false;
  let loading = false;

  const root = containerEl.createDiv({ cls: "home-review home-review-solo" });
  const head = root.createDiv({ cls: "home-review-head" });
  const dateLabel = head.createSpan();
  dateLabel.appendText("📅 今日复习 · ");
  dateLabel.createEl("b", { text: formattedDate() });
  const progress = head.createSpan({ text: "—" });
  const source = root.createDiv({ cls: "home-review-source" });
  source.createSpan({ cls: "src-label", text: "📂 内容来源：" });
  const sourceLinks = source.createSpan({ cls: "src-links" });
  const warningsEl = root.createDiv({ cls: "home-review-warnings" });
  warningsEl.hidden = true;
  const grid = root.createDiv({ cls: "home-review-grid" });
  const footer = root.createDiv({ cls: "home-review-foot" });
  footer.createSpan({ text: "每次从两个不同学科各抽 1 条（学科池耗尽后允许重复）" });
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

  async function loadAndRender(force: boolean): Promise<void> {
    if (loading) return;
    loading = true;
    reloadButton.disabled = true;
    reloadButton.setText("加载中…");
    if (!data) renderMessage("加载复习内容…");
    try {
      data = await loadSources(force);
      if (disposed) return;
      pools = buildPools(data);
      renderSourceLinks();
      renderWarnings();
      render();
    } catch (error) {
      if (!disposed) renderMessage(`加载失败：${errorMessage(error)}`, true);
    } finally {
      if (!disposed) {
        reloadButton.disabled = false;
        reloadButton.setText("🔄 重新加载");
      }
      loading = false;
    }
  }

  async function loadSources(force: boolean): Promise<ReviewKnowledgeData> {
    if (!force) {
      const cached = readJson<CachedReviewSources | null>(CACHE_KEY, null);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.data;
      }
    }
    const fresh = await loadReviewKnowledgeSources(app, resolvedSources);
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ts: Date.now(), signature: fresh.signature, data: fresh } satisfies CachedReviewSources),
    );
    return fresh;
  }

  function renderSourceLinks(): void {
    sourceLinks.empty();
    if (!data || data.sourceFiles.length === 0) {
      sourceLinks.createSpan({ text: "未配置来源" });
      return;
    }
    const list = data.sourceFiles.slice(0, 6);
    list.forEach((file, index) => {
      if (index > 0) sourceLinks.createSpan({ text: " · " });
      const name = file.path.split("/").pop() ?? file.path;
      const link = sourceLinks.createEl("a", { href: "#", text: name });
      listen(link, "click", (event) => {
        event.preventDefault();
        void app.workspace.openLinkText(file.path.replace(/\.md$/i, ""), "/", true);
      });
    });
    if (data.sourceFiles.length > list.length) {
      sourceLinks.createSpan({ text: ` 等 ${data.sourceFiles.length} 个` });
    }
  }

  function renderWarnings(): void {
    if (!data) return;
    const list = data.warnings.filter((w) => w.path);
    if (!list.length) {
      warningsEl.hidden = true;
      warningsEl.empty();
      return;
    }
    warningsEl.hidden = false;
    warningsEl.empty();
    warningsEl.createDiv({ cls: "home-review-warnings-h", text: "⚠ 来源提示" });
    const ul = warningsEl.createEl("ul");
    for (const warning of list) {
      ul.createEl("li", { text: `${warning.path}：${warning.message}` });
    }
  }

  function render(): void {
    progress.setText(formatProgress(pools));
    if (pools.length < 2) {
      const only = pools[0];
      renderEmpty(only
        ? `${only.label} 只有 1 个学科，至少需要 2 个学科才能复习`
        : "复习库为空");
      return;
    }
    const selection = data ? drawSelection(data.signature) : null;
    if (!selection) {
      renderEmpty("没有可复习的内容");
      return;
    }
    grid.empty();
    grid.append(createCard(selection.a), createCard(selection.b));
  }

  function renderMessage(message: string, error = false): void {
    grid.empty();
    grid.createDiv({ cls: `home-review-empty${error ? " err" : ""}`, text: message });
  }

  function renderEmpty(message: string): void {
    grid.empty();
    const empty = grid.createDiv({ cls: "home-review-empty" });
    empty.createDiv({ text: message });
    if (data && data.sourceFiles.length > 0) {
      const help = empty.createDiv({ cls: "home-review-empty-help" });
      help.appendText("请在所选来源中添加内容后重新加载");
    }
  }

  function drawSelection(signature: string): ReviewSelection | null {
    const date = todayKey();
    const cached = readJson<StoredSelection | null>(TODAY_KEY, null);
    if (
      cached?.date === date &&
      cached.signature === signature &&
      cached.aKey && cached.aId && cached.bKey && cached.bId
    ) {
      const a = lookup(cached.aKey, cached.aId);
      const b = lookup(cached.bKey, cached.bId);
      if (a && b && a.discipline !== b.discipline) return { a, b };
    }

    const usable = pools.filter((p) => p.entries.length > 0);
    if (usable.length < 2) return null;
    const history = readJson<HistoryRecord[]>(HISTORY_KEY, []);
    const aPool = pickPool(usable, history);
    if (!aPool) return null;
    let bPool = pickPoolDifferentFrom(usable, aPool.key, history);
    if (!bPool) bPool = pickPoolDifferentFrom(pools.filter((p) => p.entries.length > 0), null, history);
    if (!bPool) return null;
    const a = pickEntry(aPool, historyFor(history, aPool.key), aPool.entries);
    const b = pickEntry(bPool, historyFor(history, bPool.key), bPool.entries);
    if (!a || !b) return null;

    const stamped = stampHistory(history, [
      { key: aPool.key, id: a.id },
      { key: bPool.key, id: b.id },
    ]);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(stamped));
    localStorage.setItem(
      TODAY_KEY,
      JSON.stringify({
        date,
        signature,
        aKey: aPool.key,
        aId: a.id,
        bKey: bPool.key,
        bId: b.id,
      } satisfies StoredSelection),
    );
    return { a, b };
  }

  function lookup(poolKey: string, id: string): ReviewEntry | null {
    const pool = pools.find((p) => p.key === poolKey);
    if (!pool) return null;
    return pool.entries.find((e) => e.id === id) ?? null;
  }

  function createCard(entry: ReviewEntry): HTMLDivElement {
    const card = createDiv({ cls: `home-review-card ${entry.discipline}` });
    card.createDiv({ cls: "home-review-pt", text: `🏷️ ${entry.disciplineLabel}` });
    const title = card.createDiv({ cls: "home-review-title" });
    if (entry.discipline === "word") {
      title.createEl("i", { text: entry.display });
      if (entry.pos) title.createSpan({ cls: "home-review-pos", text: ` ${entry.pos}` });
    } else {
      title.setText(entry.display);
    }
    card.createDiv({
      cls: "home-review-meta",
      text: `${entry.disciplineLabel} · ID ${entry.id}`,
    });
    const sourceEl = card.createDiv({ cls: "home-review-source-card" });
    sourceEl.createSpan({ text: "📂 " });
    const link = sourceEl.createEl("a", { href: "#", text: entry.sourceName });
    listen(link, "click", (event) => {
      event.preventDefault();
      void app.workspace.openLinkText(entry.sourcePath.replace(/\.md$/i, ""), "/", true);
    });
    const body = card.createDiv({ cls: "home-review-body" });
    const revealButton = card.createEl("button", { cls: "home-review-btn", text: "📖 定义解释" });
    let rendered = false;
    listen(revealButton, "click", () => {
      const opening = !card.hasClass("open");
      card.toggleClass("open", opening);
      revealButton.setText(opening ? "🔼 收起" : "📖 定义解释");
      if (opening && !rendered) {
        rendered = true;
        void MarkdownRenderer.render(app, entry.def ?? "", body, entry.sourcePath, component);
      }
    });
    return card;
  }
}

function buildPools(data: ReviewKnowledgeData): ReviewPool[] {
  const pools: ReviewPool[] = [];
  if (data.words.length > 0) {
    pools.push({
      key: "word",
      label: "英文词汇",
      discipline: "word",
      entries: data.words.map((w) => toEntry(w)),
    });
  }
  if (data.maths.length > 0) {
    pools.push({
      key: "math",
      label: "数学",
      discipline: "math",
      entries: data.maths.map((m) => toEntry(m)),
    });
  }
  const subjectGroups = new Map<string, ReviewSubjectKnowledge[]>();
  for (const s of data.subjects) {
    const arr = subjectGroups.get(s.subject) ?? [];
    arr.push(s);
    subjectGroups.set(s.subject, arr);
  }
  for (const [subjectLabel, items] of subjectGroups) {
    if (!items.length) continue;
    pools.push({
      key: `subject:${subjectLabel}`,
      label: subjectLabel,
      discipline: "subject",
      entries: items.map((s) => toEntry(s)),
    });
  }
  return pools;
}

function toEntry(item: ReviewWordKnowledge): ReviewEntry;
function toEntry(item: ReviewMathKnowledge): ReviewEntry;
function toEntry(item: ReviewSubjectKnowledge): ReviewEntry;
function toEntry(item: ReviewWordKnowledge | ReviewMathKnowledge | ReviewSubjectKnowledge): ReviewEntry {
  if ("name" in item) {
    return {
      id: item.id,
      discipline: "word",
      disciplineLabel: "英文词汇",
      display: item.name,
      pos: item.pos,
      def: item.def ?? "",
      sourcePath: item.sourcePath,
      sourceName: item.sourceName,
    };
  }
  if ("subject" in item) {
    return {
      id: item.id,
      discipline: "subject",
      disciplineLabel: item.subject,
      display: item.title,
      def: item.def ?? "",
      sourcePath: item.sourcePath,
      sourceName: item.sourceName,
    };
  }
  const m = item as ReviewMathKnowledge;
  return {
    id: m.id,
    discipline: "math",
    disciplineLabel: "数学",
    display: m.title,
    def: m.def ?? "",
    sourcePath: m.sourcePath,
    sourceName: m.sourceName,
  };
}

function pickPool(usable: ReviewPool[], history: HistoryRecord[]): ReviewPool | null {
  const fresh = usable.filter((p) => !historyFor(history, p.key).size);
  const candidates = fresh.length ? fresh : usable;
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

function pickPoolDifferentFrom(usable: ReviewPool[], exclude: string | null, history: HistoryRecord[]): ReviewPool | null {
  const candidates = exclude ? usable.filter((p) => p.key !== exclude) : usable;
  return pickPool(candidates, history);
}

function pickEntry(pool: ReviewPool, excluded: Set<string>, allEntries: ReviewEntry[]): ReviewEntry | undefined {
  const available = allEntries.filter((e) => !excluded.has(e.id));
  const source = available.length ? available : allEntries;
  if (!source.length) return undefined;
  return source[Math.floor(Math.random() * source.length)];
}

function historyFor(history: HistoryRecord[], key: string): Set<string> {
  const set = new Set<string>();
  for (const rec of history) {
    if (rec.key === key) set.add(rec.id);
  }
  return set;
}

function stampHistory(history: HistoryRecord[], additions: HistoryRecord[]): HistoryRecord[] {
  return history.concat(additions).slice(-HISTORY_MAX);
}

function formatProgress(pools: ReviewPool[]): string {
  if (!pools.length) return "—";
  const parts = pools.map((p) => `${p.label} ${p.entries.length}`);
  return `学科 ${pools.length} · ${parts.join(" · ")}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return JSON.parse(value) as T;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Re-export helper so other widgets can use the same per-discipline draw logic
// if they want a similar surface (e.g. study session).
export function pickTwoDifferentDisciplines(pools: ReviewPool[], history: HistoryRecord[] = []): { a: ReviewEntry; b: ReviewEntry } | null {
  const usable = pools.filter((p) => p.entries.length > 0);
  if (usable.length < 2) return null;
  const aPool = pickPool(usable, history);
  if (!aPool) return null;
  const bPool = pickPoolDifferentFrom(usable, aPool.key, history) ?? pickPoolDifferentFrom(pools.filter((p) => p.entries.length > 0), null, history);
  if (!bPool) return null;
  const a = pickEntry(aPool, historyFor(history, aPool.key), aPool.entries);
  const b = pickEntry(bPool, historyFor(history, bPool.key), bPool.entries);
  if (!a || !b) return null;
  return { a, b };
}
