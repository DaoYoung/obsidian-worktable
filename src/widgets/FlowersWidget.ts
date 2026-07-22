import type { WidgetContext } from "../types";
import type { HomeDb, LearningRecord } from "../storage/homeDb";
import { clearChildren, el } from "../utils/dom";

const FLOWERS_KEY = "home-learning-flowers";

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");
  return `${m}-${dd} ${h}:${mn}`;
}

export function mountFlowersWidget(containerEl: HTMLElement, context: WidgetContext, homeDb?: HomeDb): void {
  const { component, dashboardEl } = context;

  const db = homeDb ?? null;
  let archivesExpanded = false;

  const wrap = document.createElement("div");
  wrap.className = "worktable home-flowers";
  containerEl.appendChild(wrap);

  // Header
  const headDiv = document.createElement("div");
  headDiv.className = "flowers-head";
  wrap.appendChild(headDiv);

  const flowerCountDiv = document.createElement("div");
  flowerCountDiv.className = "flower-count";
  headDiv.appendChild(flowerCountDiv);

  const flowerIcon = document.createElement("span");
  flowerIcon.className = "icon bloom";
  flowerIcon.id = "flower-icon";
  flowerIcon.textContent = "🌸";
  flowerCountDiv.appendChild(flowerIcon);

  const flowerCount = document.createElement("span");
  flowerCount.id = "flower-count";
  flowerCount.textContent = "0";
  flowerCountDiv.appendChild(flowerCount);

  const flowerLabel = document.createElement("div");
  flowerLabel.className = "flower-label";
  flowerLabel.textContent = "累计小红花";
  headDiv.appendChild(flowerLabel);

  const flowerMeta = document.createElement("div");
  flowerMeta.className = "flower-meta";
  flowerMeta.textContent = "答对 +1 · 答错 +0 · 归档后可永久追溯";
  headDiv.appendChild(flowerMeta);

  // Archives header
  const archivesHeader = document.createElement("div");
  archivesHeader.className = "flowers-archive-head";
  wrap.appendChild(archivesHeader);

  const archivesTitle = document.createElement("span");
  archivesTitle.className = "flowers-archive-title";
  archivesTitle.textContent = "📚 最近归档";
  archivesHeader.appendChild(archivesTitle);

  const btnClear = document.createElement("button");
  btnClear.id = "btn-clear-flowers";
  btnClear.className = "flowers-clear-btn";
  btnClear.textContent = "🗑 重置";
  archivesHeader.appendChild(btnClear);

  // Archives list
  const archivesList = document.createElement("div");
  archivesList.className = "archives-list";
  archivesList.id = "archives-list";
  wrap.appendChild(archivesList);

  // ── Render helpers ───────────────────────────────────────────────────────
  function renderFlowers(): void {
    const total = parseInt(localStorage.getItem(FLOWERS_KEY) || "0");
    flowerCount.textContent = String(total);
    flowerIcon.classList.remove("bloom");
    void flowerIcon.offsetWidth;
    flowerIcon.classList.add("bloom");
  }

  function renderArchives(records: LearningRecord[]): void {
    clearChildren(archivesList);

    if (!records || records.length === 0) {
      archivesList.appendChild(
        el("div", {
          className: "archive-empty",
          children: [
            "📭 还没有归档的学习记录",
            el("br"),
            el("small", { text: "完成一次学习后会自动出现在这里" }),
          ],
        })
      );
      return;
    }

    const total = records.length;
    const showAll = archivesExpanded || total <= 1;
    const recent = showAll ? records : records.slice(0, 1);

    recent.forEach((r, idx) => {
      const correctCount = typeof r.correctCount === "number" ? r.correctCount : 0;
      const totalCount = typeof r.totalCount === "number" ? r.totalCount : 0;
      const date = fmtTime(r.createdAt || 0);
      const topicLabel = (r.topic || r.title || r.url || "").trim();
      const titleLabel = (r.title || "").trim() || topicLabel;
      const detailUrl = r.url ? r.url : "";
      const realIdx = records.indexOf(r);

      const archiveItem = el("div", {
        className: "archive-item",
        attrs: { "data-idx": String(realIdx) },
        children: [
          el("div", {
            className: "archive-head",
            children: [
              el("span", {
                className: "archive-title",
                text: titleLabel,
                attrs: { title: titleLabel },
              }),
              el("span", {
                className: "archive-badge ok",
                text: `${correctCount}/${totalCount} 题`,
              }),
            ],
          }),
          el("div", {
            className: "archive-q",
            text: topicLabel && topicLabel !== titleLabel ? `主题: ${topicLabel}` : "",
          }),
          el("div", {
            className: "archive-foot",
            children: [
              el("span", { text: date }),
              el("span", { text: "📦 文章归档" }),
            ],
          }),
          el("div", {
            className: "archive-detail",
            children: [
              el("b", { text: "标题:" }),
              " ",
              titleLabel,
              el("br"),
              el("b", { text: "主题:" }),
              " ",
              topicLabel || "(无)",
              el("br"),
              el("b", { text: "归档结果:" }),
              " ",
              `答对 ${correctCount} / 共 ${totalCount} 题`,
              el("br"),
              el("b", { text: "来源:" }),
              " ",
              detailUrl
                ? el("a", {
                    attrs: { href: detailUrl, target: "_blank", rel: "noopener" },
                    text: detailUrl,
                  })
                : "(粘贴文本)",
            ],
          }),
        ],
      });

      component.registerDomEvent(archiveItem, "click", () => {
        archiveItem.classList.toggle("open");
      });
      archivesList.appendChild(archiveItem);
      void idx;
    });

    if (!showAll && total > 1) {
      const expandBtn = el("button", {
        attrs: { id: "archives-expand-btn", type: "button" },
        text: `📂 展开更多 (还有 ${total - 1} 条)`,
      });
      component.registerDomEvent(expandBtn, "click", (e) => {
        e.stopPropagation();
        archivesExpanded = true;
        void refresh();
      });
      archivesList.appendChild(expandBtn);
    } else if (showAll && total > 1) {
      const collapseBtn = el("button", {
        attrs: { id: "archives-collapse-btn", type: "button" },
        text: "🔼 只看最近 1 条",
      });
      component.registerDomEvent(collapseBtn, "click", (e) => {
        e.stopPropagation();
        archivesExpanded = false;
        void refresh();
      });
      archivesList.appendChild(collapseBtn);
    }
  }

  async function refresh(): Promise<void> {
    renderFlowers();
    try {
      if (db) {
        const recs = await db.getAllLearningRecords();
        renderArchives(recs);
      }
    } catch (e) {
      clearChildren(archivesList);
      archivesList.appendChild(
        el("div", {
          className: "archive-empty",
          text: `⚠ 加载失败: ${e instanceof Error ? e.message : String(e)}`,
        })
      );
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────
  component.registerDomEvent(btnClear, "click", () => {
    if (!window.confirm("重置小红花计数和清空归档记录?此操作不可撤销")) return;
    localStorage.setItem(FLOWERS_KEY, "0");
    if (db) {
      void db.clearLearningRecords().then(() => refresh());
    } else {
      refresh();
    }
  });

  // Listen for cross-widget events via dashboardEl
  const onFlowersChanged = (): void => { void refresh(); };
  const onLearningArchived = (): void => { void refresh(); };
  dashboardEl.addEventListener("worktable:flowers-changed", onFlowersChanged as EventListener);
  dashboardEl.addEventListener("worktable:learning-archived", onLearningArchived as EventListener);
  component.register(() => {
    dashboardEl.removeEventListener("worktable:flowers-changed", onFlowersChanged as EventListener);
    dashboardEl.removeEventListener("worktable:learning-archived", onLearningArchived as EventListener);
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  void refresh();
}
