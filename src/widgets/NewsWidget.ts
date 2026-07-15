import type { WidgetContext } from "../types";
import type { HomeDb } from "../storage/homeDb";
import type { NewsService } from "../services/NewsService";
import { clearChildren, el } from "../utils/dom";

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

  const statSpan = el("span", { attrs: { id: "news-stat" }, text: "0" });
  const statDoneSpan = el("span", { attrs: { id: "news-stat-done" }, text: "0" });
  const infoEl = el("span", {
    className: "home-news-info",
    children: [
      "📰 未读 ",
      el("b", { children: [statSpan] }),
      " 篇 · 已读 ",
      el("b", { children: [statDoneSpan] }),
      " 篇",
    ],
  });
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

    statSpan.textContent = String(unread.length);
    statDoneSpan.textContent = String(readIds.size);

    clearChildren(listEl);

    if (items.length === 0) {
      listEl.appendChild(
        el("div", {
          className: "home-news-empty",
          children: [
            "📭 还没有 news/ 笔记",
            el("br"),
            el("small", {
              children: [
                "把新闻文章放在 ",
                el("code", { text: "news/" }),
                " 文件夹,或加 ",
                el("code", { text: "#news" }),
                " 标签",
              ],
            }),
          ],
        })
      );
      return;
    }

    if (unread.length === 0) {
      listEl.appendChild(
        el("div", {
          className: "home-news-empty",
          children: [
            `✅ 全部已读完（共 ${items.length} 篇）`,
            el("br"),
            el("small", { className: "home-news-empty-hint", text: "「清空已读记录」可重置" }),
          ],
        })
      );
      return;
    }

    unread.forEach((p) => {
      const tag = tagFor(p.name);
      const date = fmtDate(p.mtime);
      const titleText = p.name.replace(/\.md$/, "");

      const titleSpan = el("span", {
        className: "home-news-title",
        attrs: { "data-name": p.name, title: "打开 · 同时标记为已读" },
        text: titleText,
      });
      component.registerDomEvent(titleSpan, "click", () => {
        try {
          if (app && p.name) {
            void app.workspace.openLinkText(p.name, "/", false);
          }
        } catch (_) {}
        if (db) {
          void (async () => {
            try {
              await db.markArticleRead(p.path);
            } catch (_) {}
            await render();
          })();
        }
      });

      const markBtn = el("button", {
        className: "home-news-mark",
        attrs: { "data-path": p.path, "data-name": p.name, title: "仅标记为已读,不打开" },
        text: "✓ 已读",
      });
      component.registerDomEvent(markBtn, "click", async () => {
        markBtn.setAttribute("disabled", "true");
        if (db) {
          try {
            await db.markArticleRead(p.path);
          } catch (_) {}
        }
        await render();
      });

      listEl.appendChild(
        el("div", {
          className: "home-news-item",
          attrs: { "data-path": p.path, "data-name": p.name },
          children: [
            el("span", {
              className: tag.cls ? `home-news-tag ${tag.cls}` : "home-news-tag",
              text: tag.label,
            }),
            titleSpan,
            el("span", { className: "home-news-date", text: date }),
            markBtn,
          ],
        })
      );
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