import { MarkdownRenderer } from "obsidian";
import {
  KnowledgeService,
  type KnowledgeData,
  type MathKnowledge,
  type SubjectKnowledge,
  type WordKnowledge,
} from "../services/KnowledgeService";
import type { WidgetContext } from "../types";

interface ReviewSettings {
  knowledgePath?: unknown;
}

type Discipline = "word" | "math" | "subject";

interface ReviewEntry {
  id: string;
  discipline: Discipline;
  /** Discipline label shown on the card (e.g. "英文词汇", "数学", "物理"). */
  disciplineLabel: string;
  /** Word: name (lowercased); Math/Subject: title. */
  display: string;
  /** Optional POS annotation for English words. */
  pos?: string;
  /** Markdown body to reveal. */
  def: string;
}

interface ReviewSelection {
  a: ReviewEntry;
  b: ReviewEntry;
}

interface CachedKnowledge {
  ts: number;
  path: string;
  data: KnowledgeData;
}

interface StoredReview {
  date?: string;
  /** Slot 1 — discipline key + entry id. */
  aDiscipline?: string;
  aId?: string;
  /** Slot 2 — discipline key + entry id. */
  bDiscipline?: string;
  bId?: string;
}

const CACHE_KEY = "home-knowledge-cache-v1";
const HISTORY_KEY = "home-review-history-v1";
const TODAY_KEY = "home-review-today-v1";
const CACHE_TTL = 60 * 60 * 1_000;
/** How many recent items to remember per discipline when drawing a new pair. */
const RECENT_PER_DISCIPLINE = 10;
/** Total history retained on disk (per-discipline + global). */
const HISTORY_MAX = 60;

export function mountReviewWidget(containerEl: HTMLElement, context: WidgetContext): void {
  const { app, component } = context;
  const settings = context.settings as ReviewSettings;
  const knowledgePath = typeof settings.knowledgePath === "string" && settings.knowledgePath.trim()
    ? settings.knowledgePath.trim()
    : "plans/知识点.md";
  const knowledge = new KnowledgeService(app, knowledgePath);
  let data: KnowledgeData = { words: [], maths: [], subjects: [] };
  let pools: Pool[] = [];
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
    if (!pools.length) renderMessage("加载复习内容…");
    try {
      const fresh = await loadKnowledge(force);
      if (disposed) return;
      data = fresh;
      pools = buildPools(data);
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
    const fresh = await knowledge.load();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), path: knowledgePath, data: fresh } satisfies CachedKnowledge));
    return fresh;
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
    const selection = drawSelection();
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
    const date = todayKey();
    const cached = readJson<StoredReview | null>(TODAY_KEY, null);
    if (cached?.date === date && cached.aId && cached.bId && cached.aDiscipline && cached.bDiscipline) {
      const a = lookup(cached.aDiscipline, cached.aId);
      const b = lookup(cached.bDiscipline, cached.bId);
      if (a && b && a.discipline !== b.discipline) return { a, b };
    }

    const usable = pools.filter((p) => p.entries.length > 0);
    if (usable.length < 2) return null;
    const history = readJson<HistoryRecord[]>(HISTORY_KEY, []);
    const aPool = pickPool(usable, history);
    if (!aPool) return null;
    let bPool = pickPoolDifferentFrom(usable, aPool.key, history);
    // If every other pool is exhausted, allow picking from the same discipline as a fallback.
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
    localStorage.setItem(TODAY_KEY, JSON.stringify({
      date,
      aDiscipline: aPool.key,
      aId: a.id,
      bDiscipline: bPool.key,
      bId: b.id,
    } satisfies StoredReview));
    return { a, b };
  }

  function lookup(disciplineKey: string, id: string): ReviewEntry | null {
    const pool = pools.find((p) => p.key === disciplineKey);
    if (!pool) return null;
    const entry = pool.entries.find((e) => e.id === id);
    return entry ?? null;
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
    card.createDiv({ cls: "home-review-meta", text: `${entry.disciplineLabel} · ID ${entry.id}` });
    const body = card.createDiv({ cls: "home-review-body" });
    const revealButton = card.createEl("button", { cls: "home-review-btn", text: "📖 定义解释" });
    let rendered = false;
    listen(revealButton, "click", () => {
      const opening = !card.hasClass("open");
      card.toggleClass("open", opening);
      revealButton.setText(opening ? "🔼 收起" : "📖 定义解释");
      if (opening && !rendered) {
        rendered = true;
        if (entry.discipline === "word") {
          body.setText(entry.def);
        } else {
          void MarkdownRenderer.render(app, entry.def ?? "", body, knowledgePath, component);
        }
      }
    });
    return card;
  }
}

interface Pool {
  key: string;
  label: string;
  discipline: Discipline;
  entries: ReviewEntry[];
}

interface HistoryRecord {
  key: string;
  id: string;
}

function buildPools(data: KnowledgeData): Pool[] {
  const pools: Pool[] = [];
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
  // Group subject entries by their subject label so each subject becomes its own pool.
  const subjectGroups = new Map<string, SubjectKnowledge[]>();
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

function toEntry(item: WordKnowledge): ReviewEntry;
function toEntry(item: MathKnowledge): ReviewEntry;
function toEntry(item: SubjectKnowledge): ReviewEntry;
function toEntry(item: WordKnowledge | MathKnowledge | SubjectKnowledge): ReviewEntry {
  if ("name" in item) {
    const w = item as WordKnowledge;
    return {
      id: w.id,
      discipline: "word",
      disciplineLabel: "英文词汇",
      display: w.name,
      pos: w.pos,
      def: w.def ?? "",
    };
  }
  if ("subject" in item) {
    const s = item as SubjectKnowledge;
    return {
      id: s.id,
      discipline: "subject",
      disciplineLabel: s.subject,
      display: s.title,
      def: s.def ?? "",
    };
  }
  const m = item as MathKnowledge;
  return {
    id: m.id,
    discipline: "math",
    disciplineLabel: "数学",
    display: m.title,
    def: m.def ?? "",
  };
}

function pickPool(usable: Pool[], history: HistoryRecord[]): Pool | null {
  // Prefer disciplines that haven't been drawn recently; fall back to any usable pool.
  const fresh = usable.filter((p) => !historyFor(history, p.key).size);
  const pool = (fresh.length ? fresh : usable)[Math.floor(Math.random() * (fresh.length ? fresh.length : usable.length))];
  return pool ?? null;
}

function pickPoolDifferentFrom(usable: Pool[], exclude: string | null, history: HistoryRecord[]): Pool | null {
  const candidates = exclude ? usable.filter((p) => p.key !== exclude) : usable;
  if (!candidates.length) return null;
  return pickPool(candidates, history);
}

function pickEntry(pool: Pool, excluded: Set<string>, allEntries: ReviewEntry[]): ReviewEntry | undefined {
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
  const next = history.concat(additions);
  return next.slice(-HISTORY_MAX);
}

function formatProgress(pools: Pool[]): string {
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
export function pickTwoDifferentDisciplines(pools: Pool[], history: HistoryRecord[] = []): { a: ReviewEntry; b: ReviewEntry } | null {
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