import type { WidgetContext } from "../types";
import type { HomeDb } from "../storage/homeDb";

const FLOWERS_KEY = "home-learning-flowers";

function escapeHtml(s: string): string {
  return String(s == null ? "" : s).replace(/[<>"'&]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "&": "&amp;" }[c] ?? c)
  );
}

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
  flowerIcon.className = "icon";
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
  archivesHeader.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;";
  wrap.appendChild(archivesHeader);

  const archivesTitle = document.createElement("span");
  archivesTitle.style.cssText =
    "font-size:11px;color:var(--text-muted,#666);text-transform:uppercase;letter-spacing:1px;font-weight:600;";
  archivesTitle.textContent = "📚 最近归档";
  archivesHeader.appendChild(archivesTitle);

  const btnClear = document.createElement("button");
  btnClear.id = "btn-clear-flowers";
  btnClear.style.cssText = "background:transparent;border:none;color:var(--text-faint,#999);cursor:pointer;font-size:10px;";
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
    flowerIcon.style.animation = "none";
    void flowerIcon.offsetWidth;
    flowerIcon.style.animation = "";
  }

  function renderArchives(records: Array<{
    id?: number;
    title?: string;
    url?: string;
    question?: string;
    questionType?: string;
    correct?: boolean;
    userAnswer?: string;
    correctAnswer?: string;
    createdAt?: number;
  }>): void {
    if (!records || records.length === 0) {
      archivesList.innerHTML =
        '<div class="archive-empty">📭 还没有归档的学习记录<br><small>完成一次学习后会自动出现在这里</small></div>';
      return;
    }

    const total = records.length;
    const showAll = archivesExpanded || total <= 1;
    const recent = showAll ? records : records.slice(0, 1);

    let itemsHtml = recent
      .map((r) => {
        const ok = r.correct;
        const date = fmtTime(r.createdAt || 0);
        const qPreview =
          (r.question || "").slice(0, 50) + ((r.question || "").length > 50 ? "…" : "");
        return `<div class="archive-item" data-idx="${records.indexOf(r)}">
        <div class="archive-head">
          <span class="archive-title" title="${escapeHtml(r.title || r.url || "")}">${escapeHtml(
          r.title || r.url || ""
        )}</span>
          <span class="archive-badge ${ok ? "ok" : "err"}">${ok ? "✓ 对" : "✗ 错"}</span>
        </div>
        <div class="archive-q">Q: ${escapeHtml(qPreview)}</div>
        <div class="archive-foot">
          <span>${date}</span>
          <span>${r.questionType === "mc" ? "🔘 选择" : "✏️ 问答"}</span>
        </div>
        <div class="archive-detail">
          <b>题目:</b> ${escapeHtml(r.question || "")}<br>
          <b>你的答案:</b> ${escapeHtml(r.userAnswer || "(空)")}<br>
          <b>参考答案:</b> ${escapeHtml(r.correctAnswer || "")}<br>
          <b>来源:</b> <a href="${escapeHtml(r.url || "")}" target="_blank" style="color:#3498db;">${escapeHtml(r.url || "")}</a>
        </div>
      </div>`;
      })
      .join("");

    let toggleHtml = "";
    if (!showAll && total > 1) {
      toggleHtml = `<button id="archives-expand-btn" style="margin-top:6px;padding:5px 10px;background:transparent;border:1px dashed var(--background-modifier-border,#d8d8d8);border-radius:6px;color:var(--text-muted,#666);font-size:11px;cursor:pointer;width:100%;">📂 展开更多 (还有 ${
        total - 1
      } 条)</button>`;
    } else if (showAll && total > 1) {
      toggleHtml = `<button id="archives-collapse-btn" style="margin-top:6px;padding:5px 10px;background:transparent;border:1px dashed var(--background-modifier-border,#d8d8d8);border-radius:6px;color:var(--text-muted,#666);font-size:11px;cursor:pointer;width:100%;">🔼 只看最近 1 条</button>`;
    }

    archivesList.innerHTML = itemsHtml + toggleHtml;

    // Archive item click → expand detail
    archivesList.querySelectorAll<HTMLElement>(".archive-item").forEach((el) => {
      component.registerDomEvent(el, "click", () => {
        el.classList.toggle("open");
      });
    });

    // Expand button
    const expandBtn = archivesList.querySelector<HTMLElement>("#archives-expand-btn");
    if (expandBtn) {
      component.registerDomEvent(expandBtn, "click", (e) => {
        e.stopPropagation();
        archivesExpanded = true;
        void refresh();
      });
    }

    // Collapse button
    const collapseBtn = archivesList.querySelector<HTMLElement>("#archives-collapse-btn");
    if (collapseBtn) {
      component.registerDomEvent(collapseBtn, "click", (e) => {
        e.stopPropagation();
        archivesExpanded = false;
        void refresh();
      });
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
      archivesList.innerHTML = `<div class="archive-empty">⚠ 加载失败: ${escapeHtml(String(e))}</div>`;
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
