import type { WidgetContext } from "../types";
import type { HomeDb } from "../storage/homeDb";
import type { NewsService } from "../services/NewsService";

function escapeHtml(s: string): string {
  return String(s).replace(/[<>"'&]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "&": "&amp;" }[c] ?? c)
  );
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tagFor(name: string): { label: string; cls: string } {
  if (/(科技|tech|AI|模型|Claude|GPT)/i.test(name)) return { label: "科技", cls: "tech" };
  if (/(国际|world|美国|欧洲|俄乌)/i.test(name)) return { label: "国际", cls: "world" };
  return { label: "新闻", cls: "" };
}

export function mountNewsWidget(
  containerEl: HTMLElement,
  context: WidgetContext,
  homeDb?: HomeDb,
  newsService?: NewsService
): void {
  const { component, app } = context;

  const db = homeDb ?? null;
  const news = newsService ?? null;

  const wrap = document.createElement("div");
  wrap.className = "worktable home-news";
  containerEl.appendChild(wrap);

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "home-news-toolbar";
  wrap.appendChild(toolbar);

  const infoEl = document.createElement("span");
  infoEl.className = "home-news-info";
  infoEl.innerHTML = `📰 未读 <b id="news-stat">0</b> 篇 · 已读 <b id="news-stat-done">0</b> 篇`;
  toolbar.appendChild(infoEl);

  const clearBtn = document.createElement("button");
  clearBtn.id = "news-clear-all";
  clearBtn.textContent = "🗑 清空已读记录";
  toolbar.appendChild(clearBtn);

  // List
  const listEl = document.createElement("div");
  listEl.className = "home-news-list";
  listEl.id = "news-list";
  wrap.appendChild(listEl);

  // ── Render ────────────────────────────────────────────────────────────────
  async function render(): Promise<void> {
    let items: Array<{ path: string; name: string; mtime: number }> = [];
    try {
      if (news) {
        items = await news.getNewsItems();
      }
    } catch (_) {}

    // Sort by mtime desc
    items.sort((a, b) => b.mtime - a.mtime);

    const readIds = new Set<string>();
    if (db) {
      try {
        const ids = await db.getAllReadArticleIds();
        for (const id of ids) readIds.add(id);
      } catch (_) {}
    }

    const unread = items.filter((p) => !readIds.has(p.path));

    const statEl = wrap.querySelector("#news-stat");
    const statDoneEl = wrap.querySelector("#news-stat-done");
    if (statEl) statEl.textContent = String(unread.length);
    if (statDoneEl) statDoneEl.textContent = String(readIds.size);

    if (items.length === 0) {
      listEl.innerHTML = `<div class="home-news-empty">📭 还没有 news/ 笔记<br><small>把新闻文章放在 <code>news/</code> 文件夹,或加 <code>#news</code> 标签</small></div>`;
      return;
    }

    if (unread.length === 0) {
      listEl.innerHTML = `<div class="home-news-empty">✅ 全部已读完（共 <b>${items.length}</b> 篇）<br><small style="color:var(--text-faint,#999);">「清空已读记录」可重置</small></div>`;
      return;
    }

    listEl.innerHTML = unread
      .map((p) => {
        const name = p.name;
        const tag = tagFor(name);
        const date = fmtDate(p.mtime);
        const safePath = escapeHtml(p.path);
        const safeName = escapeHtml(name);
        return `<div class="home-news-item" data-path="${safePath}" data-name="${safeName}">
        <span class="home-news-tag ${escapeHtml(tag.cls)}">${escapeHtml(tag.label)}</span>
        <span class="home-news-title" data-name="${safeName}" title="打开 · 同时标记为已读">${escapeHtml(name.replace(/\.md$/, ""))}</span>
        <span class="home-news-date">${escapeHtml(date)}</span>
        <button class="home-news-mark" data-path="${safePath}" data-name="${safeName}" title="仅标记为已读,不打开">✓ 已读</button>
      </div>`;
      })
      .join("");

    // Click title → open + mark read
    listEl.querySelectorAll<HTMLElement>(".home-news-title").forEach((el) => {
      component.registerDomEvent(el, "click", () => {
        const itemEl = (el as HTMLElement).closest(".home-news-item") as HTMLElement | null;
        const path = itemEl?.dataset.path;
        const name = (el as HTMLElement).dataset.name;

        // Open via workspace
        try {
          if (app && name) {
            // Use openLinkText on the workspace (not the leaf) to open the file
            void app.workspace.openLinkText(name, "/", false);
          }
        } catch (_) {}

        // Async mark read
        if (path && db) {
          void (async () => {
            try {
              await db!.markArticleRead(path);
            } catch (_) {}
            await render();
          })();
        }
      });
    });

    // Mark read button
    listEl.querySelectorAll<HTMLElement>(".home-news-mark").forEach((btn) => {
      component.registerDomEvent(btn, "click", async () => {
        (btn as HTMLButtonElement).disabled = true;
        const path = (btn as HTMLElement).dataset.path;
        if (path && db) {
          try {
            await db.markArticleRead(path);
          } catch (_) {}
        }
        await render();
      });
    });
  }

  // ── Events ────────────────────────────────────────────────────────────────
  component.registerDomEvent(clearBtn, "click", async () => {
    if (!window.confirm("清空已读记录？所有 news 笔记会重新出现在首页")) return;
    if (db) {
      try {
        await db.clearReadArticles();
      } catch (_) {}
    }
    await render();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  void render();
}
