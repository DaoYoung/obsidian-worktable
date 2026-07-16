import type { WidgetContext } from "../types";
import type { PomDb } from "../storage/pomodoroDb";
import { clearChildren, el } from "../utils/dom";

const STORAGE_KEY = "pomo-state-v1";
/** Fetch & render the most recent 20 records; CSS shows ~6 by default with overflow scrolling. */
const RECENT_HISTORY_LIMIT = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * 100; // 628.3185

interface PomState {
  mode: "work" | "short" | "long" | "custom";
  durationMin: number;
  endsAt: number | null;
  pausedRemain: number | null;
  running: boolean;
  cycleIdx: number;
  todayDone: { date: string; count: number };
  config: { sound: boolean; notify: boolean; auto: boolean };
  _currentStart: number | null;
}

const MODE_LABELS: Record<PomState["mode"], string> = {
  work: "🍅 专注工作",
  short: "☕ 短休",
  long: "🌿 长休",
  custom: "⚙ 自定义",
};

const DURATIONS: Record<"work" | "short" | "long", number> = {
  work: 25,
  short: 5,
  long: 15,
};

function defaultState(): PomState {
  return {
    mode: "work",
    durationMin: 25,
    endsAt: null,
    pausedRemain: null,
    running: false,
    cycleIdx: 0,
    todayDone: { date: new Date().toDateString(), count: 0 },
    config: { sound: true, notify: true, auto: true },
    _currentStart: null,
  };
}

function loadState(): PomState {
  const s = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        Object.assign(s, parsed);
      }
    }
  } catch (_) {}
  const today = new Date().toDateString();
  if (s.todayDone.date !== today) {
    s.todayDone = { date: today, count: 0 };
  }
  // If the timer would have finished while the view was closed, clear it.
  if (s.endsAt && s.endsAt < Date.now() - 2000) {
    s.endsAt = null;
    s.running = false;
    s.pausedRemain = null;
  }
  // Never auto-resume a running session on mount — opening/refresh the
  // worktable must not silently start the ticker. Convert the running
  // state to a paused one so the remaining time is preserved and the user
  // can hit 继续 when ready. The on/off state is remembered (mode,
  // duration, remaining time), but the clock does not run until the user
  // asks it to.
  if (s.running) {
    if (s.endsAt) {
      s.pausedRemain = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
    }
    s.endsAt = null;
    s.running = false;
  }
  return s;
}

function saveState(state: PomState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: state.mode,
        durationMin: state.durationMin,
        endsAt: state.endsAt,
        pausedRemain: state.pausedRemain,
        running: state.running,
        cycleIdx: state.cycleIdx,
        todayDone: state.todayDone,
      }),
    );
  } catch (_) {}
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatHours(sec: number): string {
  const hours = (sec || 0) / 3600;
  return `${hours.toFixed(1)}小时`;
}

export function mountPomodoroWidget(containerEl: HTMLElement, context: WidgetContext, pomDb?: PomDb): void {
  const { component, dashboardEl } = context;

  const state = loadState();
  let ticker: number | null = null;
  let db: PomDb | null = pomDb ?? null;
  let dbReady = false;
  let _finishing = false;

  const wrap = document.createElement("div");
  wrap.className = "worktable pomo-widget-instance";
  wrap.setAttribute("data-mode", state.mode);
  containerEl.appendChild(wrap);

  // ── Layout ────────────────────────────────────────────────────────────────
  const row = document.createElement("div");
  row.className = "pomo-row";
  wrap.appendChild(row);

  const left = document.createElement("div");
  left.className = "pomo-left";
  row.appendChild(left);

  const right = document.createElement("div");
  right.className = "pomo-right";
  row.appendChild(right);

  // Ring
  const ringWrap = document.createElement("div");
  ringWrap.className = "pomo-ring-wrap";
  left.appendChild(ringWrap);

  const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgEl.setAttribute("viewBox", "0 0 220 220");
  ringWrap.appendChild(svgEl);

  const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bgCircle.classList.add("pomo-ring-bg");
  bgCircle.setAttribute("cx", "110");
  bgCircle.setAttribute("cy", "110");
  bgCircle.setAttribute("r", "100");
  svgEl.appendChild(bgCircle);

  const fgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  fgCircle.classList.add("pomo-ring-fg");
  fgCircle.setAttribute("cx", "110");
  fgCircle.setAttribute("cy", "110");
  fgCircle.setAttribute("r", "100");
  fgCircle.setAttribute("stroke-dasharray", String(RING_CIRCUMFERENCE));
  fgCircle.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE));
  svgEl.appendChild(fgCircle);

  const ringCenter = document.createElement("div");
  ringCenter.className = "pomo-ring-center";
  ringWrap.appendChild(ringCenter);

  const timeEl = document.createElement("div");
  timeEl.className = "pomo-time";
  timeEl.id = "pomo-time";
  ringCenter.appendChild(timeEl);

  const modeEl = document.createElement("div");
  modeEl.className = "pomo-mode";
  modeEl.id = "pomo-mode";
  ringCenter.appendChild(modeEl);

  const countEl = document.createElement("div");
  countEl.className = "pomo-count";
  countEl.id = "pomo-count";
  ringCenter.appendChild(countEl);

  // Mode buttons
  const modesDiv = document.createElement("div");
  modesDiv.className = "pomo-modes";
  left.appendChild(modesDiv);

  const modeButtons: Array<{ mode: PomState["mode"]; label: string; min?: number }> = [
    { mode: "work", label: "🍅 专注 25", min: 25 },
    { mode: "short", label: "☕ 短休 5", min: 5 },
    { mode: "long", label: "🌿 长休 15", min: 15 },
    { mode: "custom", label: "⚙ 自定义" },
  ];
  for (const btn of modeButtons) {
    const b = document.createElement("button");
    b.className = "pomo-mode-btn";
    b.dataset.mode = btn.mode;
    if (btn.min !== undefined) b.dataset.min = String(btn.min);
    b.textContent = btn.label;
    modesDiv.appendChild(b);
  }

  // Custom input
  const customBox = document.createElement("div");
  customBox.className = "pomo-custom";
  customBox.id = "pomo-custom-box";
  customBox.style.display = state.mode === "custom" ? "flex" : "none";
  left.appendChild(customBox);

  const customSpan = document.createElement("span");
  customSpan.textContent = "自定义";
  customBox.appendChild(customSpan);

  const customInput = document.createElement("input");
  customInput.type = "number";
  customInput.id = "pomo-custom-val";
  customInput.min = "1";
  customInput.max = "180";
  customInput.value = String(state.durationMin);
  customBox.appendChild(customInput);

  const customSpan2 = document.createElement("span");
  customSpan2.textContent = "分钟";
  customBox.appendChild(customSpan2);

  // Controls
  const ctrlDiv = document.createElement("div");
  ctrlDiv.className = "pomo-controls";
  left.appendChild(ctrlDiv);

  const btnStart = document.createElement("button");
  btnStart.className = "pomo-ctrl primary";
  btnStart.id = "pomo-btn-start";
  ctrlDiv.appendChild(btnStart);

  const btnPause = document.createElement("button");
  btnPause.className = "pomo-ctrl";
  btnPause.id = "pomo-btn-pause";
  btnPause.disabled = true;
  btnPause.textContent = "⏸ 暂停";
  ctrlDiv.appendChild(btnPause);

  const btnReset = document.createElement("button");
  btnReset.className = "pomo-ctrl ghost";
  btnReset.id = "pomo-btn-reset";
  btnReset.title = "重置";
  btnReset.textContent = "↺";
  ctrlDiv.appendChild(btnReset);

  const btnSkip = document.createElement("button");
  btnSkip.className = "pomo-ctrl ghost";
  btnSkip.id = "pomo-btn-skip";
  btnSkip.title = "跳过";
  btnSkip.textContent = "⏭";
  ctrlDiv.appendChild(btnSkip);

  // Options
  const optsDiv = document.createElement("div");
  optsDiv.className = "pomo-options";
  left.appendChild(optsDiv);

  const optSound = el("label", {
    children: [
      el("input", { attrs: { type: "checkbox", id: "pomo-opt-sound" } }),
      " 🔔 声音",
    ],
  });
  optsDiv.appendChild(optSound);

  const optNotify = el("label", {
    children: [
      el("input", { attrs: { type: "checkbox", id: "pomo-opt-notify" } }),
      " 📢 通知",
    ],
  });
  optsDiv.appendChild(optNotify);

  const optAuto = el("label", {
    children: [
      el("input", { attrs: { type: "checkbox", id: "pomo-opt-auto" } }),
      " 🔄 自动",
    ],
  });
  optsDiv.appendChild(optAuto);

  // Stats
  const statsDiv = document.createElement("div");
  statsDiv.className = "pomo-stats";
  right.appendChild(statsDiv);

  const statRows: ReadonlyArray<ReadonlyArray<{ id: string; label: string }>> = [
    [
      { id: "pomo-stat-today", label: "今日专注次数" },
      { id: "pomo-stat-today-focus", label: "今日专注时间" },
      { id: "pomo-stat-today-break", label: "今日休息时间" },
    ],
    [
      { id: "pomo-stat-avg-count", label: "日均次数" },
      { id: "pomo-stat-avg-focus", label: "日均专注时间" },
      { id: "pomo-stat-avg-break", label: "日均休息时间" },
    ],
  ];
  statRows.forEach((rowStats, idx) => {
    const rowEl = document.createElement("div");
    rowEl.className = "pomo-stats-row" + (idx === 1 ? " avg" : "");
    for (const stat of rowStats) {
      const statEl = el("div", {
        className: "pomo-stat",
        children: [
          el("div", { className: "pomo-stat-v", attrs: { id: stat.id }, text: "0" }),
          el("div", { className: "pomo-stat-l", text: stat.label }),
        ],
      });
      rowEl.appendChild(statEl);
    }
    statsDiv.appendChild(rowEl);
  });

  // History
  const histDiv = document.createElement("div");
  histDiv.className = "pomo-history";
  right.appendChild(histDiv);

  const histHead = el("h4", {
    children: [
      el("span", { text: "📝 最近记录" }),
      el("button", {
        className: "pomo-link-btn",
        attrs: { id: "pomo-btn-export", type: "button" },
        text: "导出 CSV",
      }),
    ],
  });
  histDiv.appendChild(histHead);

  const listEl = document.createElement("ul");
  listEl.id = "pomo-list";
  histDiv.appendChild(listEl);

  // DB status
  const dbStatus = document.createElement("div");
  dbStatus.className = "pomo-db-status";
  dbStatus.id = "pomo-db-status";
  dbStatus.textContent = "DB · initializing…";
  wrap.appendChild(dbStatus);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function $(id: string): HTMLElement | null {
    return wrap.querySelector("#" + id);
  }

  function setDbStatus(level: "ok" | "err", msg: string): void {
    dbStatus.classList.remove("ok", "err");
    dbStatus.classList.add(level);
    dbStatus.textContent = `DB · ${msg}`;
  }

  function render(): void {
    let remain =
      state.pausedRemain != null
        ? state.pausedRemain
        : state.endsAt
        ? Math.max(0, Math.round((state.endsAt - Date.now()) / 1000))
        : state.durationMin * 60;

    timeEl.textContent = fmt(remain);
    modeEl.textContent = MODE_LABELS[state.mode];
    countEl.textContent = `今日 🍅 ${state.todayDone.count}`;
    wrap.setAttribute("data-mode", state.mode);

    const totalSecs = state.durationMin * 60;
    const ratio = remain / Math.max(1, totalSecs);
    fgCircle.setAttribute(
      "stroke-dashoffset",
      String(RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, ratio))))
    );

    btnStart.disabled = state.running;
    btnPause.disabled = !state.running;
    btnStart.textContent = state.running
      ? "⏱ 运行中"
      : state.pausedRemain != null && state.pausedRemain < totalSecs
      ? "▶ 继续"
      : "▶ 开始";
    btnPause.textContent = state.running ? "⏸ 暂停" : "▶ 继续";

    modesDiv.querySelectorAll(".pomo-mode-btn").forEach((b) => {
      (b as HTMLElement).classList.toggle("active", (b as HTMLElement).dataset.mode === state.mode);
    });

    customBox.style.display = state.mode === "custom" ? "flex" : "none";
    if (state.mode === "custom") customInput.value = String(state.durationMin);
  }

  function beep(pattern: "work" | "short" | "long" | "custom"): void {
    if (!state.config.sound) return;
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const tones =
        pattern === "work"
          ? [
              [880, 0],
              [1100, 0.2],
              [1320, 0.4],
            ]
          : [
              [660, 0],
              [528, 0.2],
              [440, 0.4],
            ];
      for (const [freq, t] of tones) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq as number;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + (t as number));
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (t as number) + 0.35);
        osc.start(ctx.currentTime + (t as number));
        osc.stop(ctx.currentTime + (t as number) + 0.35);
      }
    } catch (_) {}
  }

  function notify(title: string, body: string): void {
    if (!state.config.notify || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body, silent: true });
    } else if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  function tick(): void {
    if (!state.running || _finishing) return;
    if (state.endsAt == null) {
      state.running = false;
      return;
    }
    const remaining = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
    if (remaining <= 0) {
      void finish();
      return;
    }
    render();
    saveState(state);
  }

  function startTicker(): void {
    if (ticker === null) {
      ticker = window.setInterval(tick, 1000);
      component.registerInterval(ticker);
    }
  }

  function stopTicker(): void {
    if (ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  async function start(): Promise<void> {
    if (state.running) return;
    if (state.pausedRemain != null) {
      state.endsAt = Date.now() + state.pausedRemain * 1000;
      state.pausedRemain = null;
    } else {
      state.endsAt = Date.now() + state.durationMin * 60 * 1000;
      state._currentStart = Date.now();
    }
    state.running = true;
    startTicker();
    tick();
    saveState(state);
    render();
  }

  function pause(): void {
    if (!state.running) return;
    state.pausedRemain = Math.max(0, Math.round((state.endsAt! - Date.now()) / 1000));
    state.endsAt = null;
    state.running = false;
    stopTicker();
    saveState(state);
    render();
  }

  function reset(): void {
    stopTicker();
    state.running = false;
    state.endsAt = null;
    state.pausedRemain = null;
    state._currentStart = null;
    btnStart.textContent = "▶ 开始";
    saveState(state);
    render();
  }

  function skip(): void {
    if (state.endsAt && state.running) {
      state.endsAt = Date.now() - 1;
    }
    // When the timer is not actively running, there is nothing to
    // skip — finish() would create a spurious session record.
  }

  async function finish(): Promise<void> {
    if (_finishing) return;
    _finishing = true;
    stopTicker();
    state.running = false;
    const wasRunning = state.endsAt != null;
    const completedAt = Date.now();
    const startedAt = state._currentStart || completedAt - state.durationMin * 60 * 1000;
    const dateKey = new Date(completedAt).toISOString().slice(0, 10);

    if (dbReady && db) {
      try {
        await db.addSession({
          type: state.mode,
          duration: state.durationMin * 60,
          startedAt,
          completedAt,
          date: dateKey,
        });
      } catch (_) {}
    }

    if (state.mode === "work") {
      state.todayDone.count += 1;
      saveState(state);
    }

    beep(state.mode);
    notify(
      state.mode === "work" ? "🎉 专注完成" : "⏰ 休息结束",
      state.mode === "work" ? "休息一下吧 ☕" : "下一轮专注开始"
    );

    let nextMode: PomState["mode"];
    let nextMin: number;

    if (state.config.auto && wasRunning) {
      if (state.mode === "work") {
        nextMode = state.todayDone.count % 4 === 0 ? "long" : "short";
        nextMin = DURATIONS[nextMode];
      } else {
        nextMode = "work";
        nextMin = DURATIONS.work;
      }
      state.mode = nextMode;
      state.durationMin = nextMin;
      state.endsAt = Date.now() + nextMin * 60 * 1000;
      state._currentStart = Date.now();
      state.running = true;
      startTicker();
      tick();
    } else {
      state.endsAt = null;
      state._currentStart = null;
      btnStart.textContent = "▶ 开始";
    }

    render();
    void refreshHistory();
    _finishing = false;
  }

  function switchMode(mode: PomState["mode"], duration: number): void {
    stopTicker();
    state.running = false;
    state.endsAt = null;
    state.pausedRemain = null;
    state._currentStart = null;
    state.mode = mode;
    const fallback = mode === "custom" ? 25 : DURATIONS[mode as "work" | "short" | "long"];
    state.durationMin = duration ?? fallback;
    btnStart.textContent = "▶ 开始";
    saveState(state);
    render();
  }

  async function refreshHistory(): Promise<void> {
    const list = $("pomo-list")!;
    clearChildren(list);

    if (!db || !dbReady) {
      list.appendChild(el("li", { className: "pomo-empty", text: "⚠ DB 不可用" }));
      return;
    }
    try {
      const [recs, st] = await Promise.all([db.recent(RECENT_HISTORY_LIMIT), db.stats()]);
      if (recs.length === 0) {
        list.appendChild(
          el("li", { className: "pomo-empty", text: "暂无记录 · 完成首次番茄后会自动出现 ⬇" })
        );
      } else {
        recs.forEach((r) => {
          const t = new Date(r.completedAt);
          const ts = `${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
          const cn = MODE_LABELS[r.type as PomState["mode"]] ?? r.type;
          list.appendChild(
            el("li", {
              children: [
                el("span", {
                  children: [
                    el("span", { className: `pomo-pill ${r.type}`, text: cn }),
                    `${Math.round((r.duration || 0) / 60)}min`,
                  ],
                }),
                el("span", { text: ts }),
              ],
            })
          );
        });
      }
      ($("pomo-stat-today")!).textContent = String(st.todayCount);
      ($("pomo-stat-today-focus")!).textContent = formatHours(st.todayFocusSec);
      ($("pomo-stat-today-break")!).textContent = formatHours(st.todayBreakSec);
      const days = st.activeDays || 1;
      ($("pomo-stat-avg-count")!).textContent = (st.focusCount / days).toFixed(1);
      ($("pomo-stat-avg-focus")!).textContent = formatHours(st.focusTotalSec / days);
      ($("pomo-stat-avg-break")!).textContent = formatHours(st.breakTotalSec / days);
    } catch (e) {
      clearChildren(list);
      list.appendChild(
        el("li", {
          className: "pomo-empty",
          text: `⚠ 读取失败: ${e instanceof Error ? e.message : String(e)}`,
        })
      );
    }
  }

  async function exportData(): Promise<void> {
    if (!db || !dbReady) return;
    try {
      const recs = await db.recent(5000);
      const header = "date,time,type,duration_min,started,completed\n";
      const body = recs
        .map((r) => {
          const c = new Date(r.completedAt);
          const s = new Date(r.startedAt);
          return [
            r.date,
            `${String(c.getHours()).padStart(2, "0")}:${String(c.getMinutes()).padStart(2, "0")}`,
            r.type,
            Math.round((r.duration || 0) / 60),
            s.toISOString(),
            c.toISOString(),
          ].join(",");
        })
        .join("\n");
      const csv = header + body;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pomodoro-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert("导出失败: " + String(e));
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────
  component.registerDomEvent(modesDiv, "click", (e) => {
    const btn = (e.target as HTMLElement).closest(".pomo-mode-btn") as HTMLElement | null;
    if (!btn) return;
    const mode = btn.dataset.mode as PomState["mode"];
    const min = btn.dataset.min ? parseInt(btn.dataset.min) : undefined;
    if (mode === "custom") {
      const v = parseInt(customInput.value) || 25;
      switchMode(mode, v);
    } else {
      switchMode(mode, min ?? DURATIONS[mode] ?? 25);
    }
  });

  component.registerDomEvent(customInput, "change", () => {
    const v = parseInt(customInput.value);
    if (state.mode === "custom" && v > 0 && v <= 180) {
      state.durationMin = v;
      if (state.running && state.endsAt) {
        state.endsAt = Date.now() + v * 60 * 1000;
      }
      render();
      saveState(state);
    }
  });

  component.registerDomEvent(btnStart, "click", () => {
    void start();
  });

  component.registerDomEvent(btnPause, "click", () => {
    pause();
  });

  component.registerDomEvent(btnReset, "click", () => {
    reset();
  });

  component.registerDomEvent(btnSkip, "click", () => {
    skip();
  });

  component.registerDomEvent(optSound, "change", async (e) => {
    state.config.sound = (e.target as HTMLInputElement).checked;
    saveState(state);
    if (dbReady && db) {
      try {
        await db.setConfig("sound", state.config.sound);
      } catch (_) {}
    }
  });

  component.registerDomEvent(optNotify, "change", async (e) => {
    state.config.notify = (e.target as HTMLInputElement).checked;
    saveState(state);
    if (dbReady && db) {
      try {
        await db.setConfig("notify", state.config.notify);
      } catch (_) {}
    }
  });

  component.registerDomEvent(optAuto, "change", async (e) => {
    state.config.auto = (e.target as HTMLInputElement).checked;
    saveState(state);
    if (dbReady && db) {
      try {
        await db.setConfig("auto", state.config.auto);
      } catch (_) {}
    }
  });

  component.registerDomEvent($("pomo-btn-export")!, "click", () => {
    void exportData();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  render();

  (async () => {
    try {
      if (db) {
        await db.open();
        await db.deduplicateSessions();
        dbReady = true;
        setDbStatus("ok", `${db ? "pomodoro-db" : ""} · ready`);
        try {
          if (db) {
            const cfg = await db.getConfig();
            (["sound", "notify", "auto"] as const).forEach((k) => {
              if (typeof cfg[k] === "boolean") {
                state.config[k] = cfg[k];
                const el = $(`pomo-opt-${k}`) as HTMLInputElement;
                if (el) el.checked = cfg[k];
              }
            });
          }
        } catch (_) {}
        void refreshHistory();
      }
    } catch (e) {
      setDbStatus("err", `${String(e)} · 历史不可用`);
    }

    // Do not auto-restart the ticker on mount — the on/off state is
    // remembered (via loadState → pausedRemain), but ticking waits for an
    // explicit 继续 click.

    if ("Notification" in window && Notification.permission === "default" && state.config.notify) {
      try {
        await Notification.requestPermission();
      } catch (_) {}
    }
  })();

  // Visibility change — tick on resume
  component.registerDomEvent(document, "visibilitychange", () => {
    if (!document.hidden) {
      tick();
      saveState(state);
    }
  });
}
