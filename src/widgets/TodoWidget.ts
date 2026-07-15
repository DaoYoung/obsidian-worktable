import type { WidgetContext } from "../types";
import type { HomeDb } from "../storage/homeDb";
import { clearChildren, el } from "../utils/dom";

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
  function renderItem(t: Todo): HTMLElement {
    const isDone = t.status === "done";
    const checkBtn = el("button", {
      className: isDone ? "home-todo-check checked" : "home-todo-check",
      attrs: {
        "data-id": String(t.id),
        "data-toggle": "1",
        title: isDone ? "恢复" : "完成",
      },
      text: isDone ? "☑" : "☐",
    });
    component.registerDomEvent(checkBtn, "click", async () => {
      const newStatus: "done" | "todo" = isDone ? "todo" : "done";
      if (db) {
        await db.updateTodo(t.id, {
          status: newStatus,
          completedAt: newStatus === "done" ? Date.now() : null,
        });
      }
      await reload();
    });

    const editBtn = el("button", {
      className: "edit",
      attrs: { "data-id": String(t.id), title: "编辑" },
      text: "✏️",
    });
    component.registerDomEvent(editBtn, "click", (e) => {
      void startEdit(t.id, e as MouseEvent);
    });

    const delBtn = el("button", {
      className: "del",
      attrs: { "data-id": String(t.id), title: "删除" },
      text: "🗑",
    });
    component.registerDomEvent(delBtn, "click", async () => {
      if (!window.confirm("删除该任务？")) return;
      if (db) await db.deleteTodo(t.id);
      await reload();
    });

    return el("div", {
      className: isDone ? "home-todo-item done" : "home-todo-item",
      attrs: { "data-id": String(t.id) },
      children: [
        checkBtn,
        el("span", {
          className: `home-todo-prio-pill ${t.priority}`,
          text: t.priority,
        }),
        el("span", {
          className: "home-todo-text",
          attrs: { "data-id": String(t.id) },
          text: t.text,
        }),
        el("span", {
          className: "home-todo-actions",
          children: [editBtn, delBtn],
        }),
      ],
    });
  }

  function renderList(): void {
    const sorted = [...todos].sort((a, b) => {
      if (a.status !== b.status) return a.status === "done" ? 1 : -1;
      if (a.priority !== b.priority) return a.priority.localeCompare(b.priority);
      return b.createdAt - a.createdAt;
    });
    const active = sorted.filter((t) => t.status !== "done");
    const done = sorted.filter((t) => t.status === "done");

    clearChildren(root2);

    // Active section
    const activeHeaderActions = el("span", {
      className: "home-todo-section-meta",
      text: "按优先级排序",
    });
    const activeSection = el("div", {
      className: "home-todo-section",
      children: [
        el("div", {
          className: "home-todo-section-h",
          children: [
            el("span", {
              children: ["📋 进行中 · ", el("span", { className: "ct", text: String(active.length) })],
            }),
            activeHeaderActions,
          ],
        }),
        active.length === 0
          ? el("div", { className: "home-todo-empty", text: "✨ 任务已清空 · 加一个吧" })
          : el("div", {
              className: "home-todo-items",
              children: active.map(renderItem),
            }),
      ],
    });
    root2.appendChild(activeSection);

    // Done section
    const toggleBtn = el("button", {
      attrs: { id: "todo-toggle-done", title: showDone ? "隐藏" : "展开" },
      text: showDone ? "🔽" : "▶",
    });
    component.registerDomEvent(toggleBtn, "click", () => {
      showDone = !showDone;
      renderList();
    });

    const doneSectionActions = el("span", { children: [toggleBtn] });
    if (done.length > 0) {
      const clearDoneBtn = el("button", {
        attrs: { id: "todo-clear-done", title: "清空已完成" },
        text: "🗑",
      });
      component.registerDomEvent(clearDoneBtn, "click", async () => {
        if (!window.confirm("清空所有已完成任务？")) return;
        if (db) await db.clearDoneTodos();
        await reload();
      });
      doneSectionActions.appendChild(clearDoneBtn);
    }

    const doneHeader = el("div", {
      className: "home-todo-section-h",
      children: [
        el("span", {
          children: ["✅ 已完成 · ", el("span", { className: "ct", text: String(done.length) })],
        }),
        doneSectionActions,
      ],
    });

    let doneBody: HTMLElement;
    if (!showDone) {
      doneBody = el("div", { className: "home-todo-section", children: [doneHeader] });
    } else if (done.length === 0) {
      doneBody = el("div", {
        className: "home-todo-section",
        children: [doneHeader, el("div", { className: "home-todo-empty", text: "暂无" })],
      });
    } else {
      doneBody = el("div", {
        className: "home-todo-section",
        children: [
          doneHeader,
          el("div", { className: "home-todo-items", children: done.map(renderItem) }),
        ],
      });
    }
    root2.appendChild(doneBody);
  }

  function startEdit(id: number, _ev: MouseEvent): void {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    const textSpan = root2.querySelector<HTMLElement>(`.home-todo-text[data-id="${id}"]`);
    if (!textSpan) return;
    const old = t.text;
    const input = document.createElement("input");
    input.type = "text";
    input.value = old;
    clearChildren(textSpan);
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