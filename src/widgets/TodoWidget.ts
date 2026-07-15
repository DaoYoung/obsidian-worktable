import type { WidgetContext } from "../types";
import type { HomeDb } from "../storage/homeDb";

function escapeHtml(s: string): string {
  return String(s).replace(/[<>"'&]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "&": "&amp;" }[c] ?? c)
  );
}

export function mountTodoWidget(containerEl: HTMLElement, context: WidgetContext, homeDb?: HomeDb): void {
  const { component } = context;

  const db = homeDb ?? null;
  type Todo = {
    id: number;
    text: string;
    status: "todo" | "done";
    priority: string;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
  };
  let todos: Todo[] = [];
  let showDone = true;

  const wrap = document.createElement("div");
  wrap.className = "worktable home-todo";
  containerEl.appendChild(wrap);

  // ── Input form ────────────────────────────────────────────────────────────
  const form = document.createElement("form");
  form.className = "home-todo-input";
  form.id = "todo-form";
  wrap.appendChild(form);

  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.id = "todo-text";
  textInput.placeholder = "输入任务 · 回车添加…";
  textInput.maxLength = 200;
  textInput.autocomplete = "off";
  form.appendChild(textInput);

  const prioSelect = document.createElement("select");
  prioSelect.id = "todo-prio";
  for (const p of ["P3", "P2", "P1", "P0"] as const) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if (p === "P2") opt.selected = true;
    prioSelect.appendChild(opt);
  }
  form.appendChild(prioSelect);

  const addBtn = document.createElement("button");
  addBtn.type = "submit";
  addBtn.textContent = "＋ 添加";
  form.appendChild(addBtn);

  // ── List container ────────────────────────────────────────────────────────
  const root2 = document.createElement("div");
  root2.id = "todo-root2";
  wrap.appendChild(root2);

  // ── Render ────────────────────────────────────────────────────────────────
  function renderList(): void {
    const sorted = [...todos].sort((a, b) => {
      if (a.status !== b.status) return a.status === "done" ? 1 : -1;
      if (a.priority !== b.priority) return a.priority.localeCompare(b.priority);
      return b.createdAt - a.createdAt;
    });
    const active = sorted.filter((t) => t.status !== "done");
    const done = sorted.filter((t) => t.status === "done");

    function renderItem(t: (typeof todos)[number]): string {
      const isDone = t.status === "done";
      return `<div class="home-todo-item${isDone ? " done" : ""}" data-id="${t.id}">
        <button class="home-todo-check${isDone ? " checked" : ""}" data-id="${t.id}" data-toggle="1" title="${isDone ? "恢复" : "完成"}">${isDone ? "☑" : "☐"}</button>
        <span class="home-todo-prio-pill ${escapeHtml(t.priority)}">${escapeHtml(t.priority)}</span>
        <span class="home-todo-text" data-id="${t.id}">${escapeHtml(t.text)}</span>
        <span class="home-todo-actions">
          <button class="edit" data-id="${t.id}" title="编辑">✏️</button>
          <button class="del" data-id="${t.id}" title="删除">🗑</button>
        </span>
      </div>`;
    }

    root2.innerHTML = `
      <div class="home-todo-section">
        <div class="home-todo-section-h">
          <span>📋 进行中 · <span class="ct">${active.length}</span></span>
          <span style="color:var(--text-faint,#999);font-size:11px;">按优先级排序</span>
        </div>
        ${active.length === 0 ? '<div class="home-todo-empty">✨ 任务已清空 · 加一个吧</div>' : active.map(renderItem).join("")}
      </div>
      <div class="home-todo-section">
        <div class="home-todo-section-h">
          <span>✅ 已完成 · <span class="ct">${done.length}</span></span>
          <span>
            <button id="todo-toggle-done" title="${showDone ? "隐藏" : "展开"}">${showDone ? "🔽" : "▶"}</button>
            ${done.length > 0 ? '<button id="todo-clear-done" title="清空已完成">🗑</button>' : ""}
          </span>
        </div>
        ${showDone ? (done.length === 0 ? '<div class="home-todo-empty">暂无</div>' : done.map(renderItem).join("")) : ""}
      </div>
    `;

    // Toggle done
    const tgl = root2.querySelector<HTMLElement>("#todo-toggle-done");
    if (tgl) {
      component.registerDomEvent(tgl, "click", () => {
        showDone = !showDone;
        renderList();
      });
    }

    // Clear done
    const clr = root2.querySelector<HTMLElement>("#todo-clear-done");
    if (clr) {
      component.registerDomEvent(clr, "click", async () => {
        if (!window.confirm("清空所有已完成任务？")) return;
        if (db) await db.clearDoneTodos();
        await reload();
      });
    }

    // Toggle complete
    root2.querySelectorAll<HTMLElement>('[data-toggle="1"]').forEach((b) => {
      component.registerDomEvent(b, "click", async () => {
        const id = Number((b as HTMLElement).dataset.id);
        const t = todos.find((x) => x.id === id);
        if (!t) return;
        const newStatus: "done" | "todo" = t.status === "done" ? "todo" : "done";
        if (db) {
          await db.updateTodo(id, {
            status: newStatus,
            completedAt: newStatus === "done" ? Date.now() : null,
          });
        }
        await reload();
      });
    });

    // Delete
    root2.querySelectorAll<HTMLElement>(".del").forEach((b) => {
      component.registerDomEvent(b, "click", async () => {
        if (!window.confirm("删除该任务？")) return;
        if (db) await db.deleteTodo(Number((b as HTMLElement).dataset.id));
        await reload();
      });
    });

    // Edit
    root2.querySelectorAll<HTMLElement>(".edit").forEach((b) => {
      component.registerDomEvent(b, "click", (e) => {
        void startEdit(Number((b as HTMLElement).dataset.id), e as MouseEvent);
      });
    });
  }

  function startEdit(id: number, _ev: MouseEvent): void {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    const textSpan = root2.querySelector(`.home-todo-text[data-id="${id}"]`);
    if (!textSpan) return;
    const old = t.text;
    const input = document.createElement("input");
    input.type = "text";
    input.value = old;
    textSpan.innerHTML = "";
    textSpan.appendChild(input);
    input.focus();
    input.select();

    const finish = async (commit: boolean): Promise<void> => {
      if (commit) {
        const v = input.value.trim();
        if (v && db) await db.updateTodo(id, { text: v });
      }
      await reload();
    };

    component.registerDomEvent(input, "blur", () => {
      void finish(true);
    });
    component.registerDomEvent(input, "keydown", (e) => {
      if (e.key === "Enter") void finish(true);
      if (e.key === "Escape") void finish(false);
    });
  }

  async function reload(): Promise<void> {
    if (db) {
      const recs = await db.getAllTodos();
      todos = recs.map((r) => ({
        id: r.id ?? 0,
        text: r.text,
        status: r.status,
        priority: r.priority,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        completedAt: r.completedAt,
      }));
    }
    renderList();
  }

  // ── Events ────────────────────────────────────────────────────────────────
  component.registerDomEvent(form, "submit", async (e) => {
    e.preventDefault();
    const v = textInput.value.trim();
    if (!v) return;
    const p = prioSelect.value;
    if (db) await db.addTodo(v, p);
    textInput.value = "";
    await reload();
    textInput.focus();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  void reload();
}
