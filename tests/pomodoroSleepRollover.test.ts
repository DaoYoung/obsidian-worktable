/**
 * Mirror tests for the Pomodoro widget's sleep/wake detection and
 * day-rollover refresh.
 *
 * Background: when a laptop sleeps or the OS suspends, setInterval can
 * pause while wall-clock Date.now() advances. The next tick after wake
 * then sees `endsAt` already in the past and would call finish(),
 * recording a phantom "专注" session for time the user was asleep.
 *
 * The widget-side fix tracks `lastTickAt` per tick and pauses (does NOT
 * finish) whenever Date.now() jumps ≫ the tick interval. On the UI side,
 * `checkDayRollover()` resets todayDone when the calendar day changes
 * while the view is alive, so the widget reflects today without a remount.
 *
 * These mirrors reproduce the closure-internal logic so we can lock the
 * contract without spinning up a DOM (matching the convention used by
 * `pomodoroOrphanTicker.test.ts` and `pomodoroHotReload.test.ts`).
 */

import { describe, it, expect, afterEach, vi } from "vitest";

const SLEEP_DETECTION_MS = 5_000;

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
  stalePromptDate: string;
  staleTimerPref: "reset" | "keep" | null;
}

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
    stalePromptDate: "",
    staleTimerPref: null,
  };
}

interface TickEnv {
  state: PomState;
  lastTickAt: number | null;
  _finishing: boolean;
}

interface TickResult {
  ranPause: boolean;
  ranFinish: boolean;
  ranDayRollover: boolean;
}

/**
 * Mirror of PomodoroWidget.tick() — keeps the gate order identical:
 *   1. running+finishing gate
 *   2. orphan-DOM guard
 *   3. sleep/wake detection → pause
 *   4. day rollover
 *   5. endsAt-null safety
 *   6. expiry check → finish()
 */
function tick(env: TickEnv, now: number): TickResult {
  const result: TickResult = { ranPause: false, ranFinish: false, ranDayRollover: false };
  const { state } = env;
  if (!state.running || env._finishing) return result;
  // (orphan-DOM guard omitted — handled by the DOM `wrap.isConnected` check)
  const nowMs = now;
  if (env.lastTickAt != null && nowMs - env.lastTickAt >= SLEEP_DETECTION_MS) {
    env.lastTickAt = nowMs;
    // pause() logic — copy (state, endsAt) → (pausedRemain, null) and stop ticking.
    state.pausedRemain = Math.max(0, Math.round((state.endsAt! - nowMs) / 1000));
    state.endsAt = null;
    state.running = false;
    result.ranPause = true;
    return result;
  }
  env.lastTickAt = nowMs;
  const today = new Date(nowMs).toDateString();
  if (state.todayDone.date !== today) {
    state.todayDone = { date: today, count: 0 };
    state.stalePromptDate = "";
    result.ranDayRollover = true;
  }
  if (state.endsAt == null) {
    state.running = false;
    return result;
  }
  const remaining = Math.max(0, Math.round((state.endsAt - nowMs) / 1000));
  if (remaining <= 0) {
    result.ranFinish = true;
    return result;
  }
  return result;
}

// Mirror of PomodoroWidget.checkDayRollover(), excluding DOM/refresh side
// effects (only the pure state mutation matters for the contract).
function checkDayRollover(state: PomState, today: string): boolean {
  if (state.todayDone.date === today) return false;
  state.todayDone = { date: today, count: 0 };
  state.stalePromptDate = "";
  return true;
}

describe("pomodoro tick: sleep / suspend detection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normal 1s gap → does NOT pause, does NOT finish", () => {
    const env: TickEnv = {
      state: defaultState(),
      lastTickAt: 1_000_000,
      _finishing: false,
    };
    env.state.running = true;
    env.state.endsAt = 1_005_000; // 5s in future

    const r = tick(env, 1_001_000);
    expect(r.ranPause).toBe(false);
    expect(r.ranFinish).toBe(false);
    expect(env.state.running).toBe(true);
  });

  it("sub-5s gap (slight event-loop lag) → does NOT pause", () => {
    const env: TickEnv = {
      state: defaultState(),
      lastTickAt: 1_000_000,
      _finishing: false,
    };
    env.state.running = true;
    env.state.endsAt = 1_030_000;

    const r = tick(env, 1_004_500); // 4.5s later
    expect(r.ranPause).toBe(false);
    expect(r.ranFinish).toBe(false);
    expect(env.state.running).toBe(true);
  });

  it("first tick (lastTickAt=null) → does NOT false-positive, seeds lastTickAt", () => {
    const env: TickEnv = {
      state: defaultState(),
      lastTickAt: null,
      _finishing: false,
    };
    env.state.running = true;
    env.state.endsAt = 1_030_000;

    const r = tick(env, 1_000_000);
    expect(r.ranPause).toBe(false);
    expect(r.ranFinish).toBe(false);
    expect(env.lastTickAt).toBe(1_000_000);
  });

  it("6s gap (laptop sleep) with endsAt still in future → pauses, preserves remaining", () => {
    const env: TickEnv = {
      state: defaultState(),
      lastTickAt: 1_000_000,
      _finishing: false,
    };
    env.state.running = true;
    env.state.endsAt = 1_030_000; // 30s in future at tick time

    const r = tick(env, 1_006_000);
    expect(r.ranPause).toBe(true);
    expect(r.ranFinish).toBe(false);
    expect(env.state.running).toBe(false);
    expect(env.state.endsAt).toBeNull();
    // remaining at 1_006_000: (30_000 - 6_000) / 1000 = 24s preserved
    expect(env.state.pausedRemain).toBe(24);
  });

  it("huge gap (1h+) with endsAt in past → pauses, does NOT finish (no phantom session)", () => {
    // KEY: prior bug — wake after long sleep called finish() with remaining=0,
    // recording a phantom "专注" session for time the user was asleep.
    const env: TickEnv = {
      state: defaultState(),
      lastTickAt: 1_000_000,
      _finishing: false,
    };
    env.state.running = true;
    env.state.endsAt = 1_005_000; // 5s remaining at lastTickAt time

    const r = tick(env, 1_000_000 + 3_600_000); // 1h later
    expect(r.ranPause).toBe(true);
    expect(r.ranFinish).toBe(false); // ← phantom-session guard
    expect(env.state.running).toBe(false);
    // remaining has expired during sleep; pausedRemain is 0.
    expect(env.state.pausedRemain).toBe(0);
  });

  it("paused timer (state.running=false) → tick() exits immediately at gate", () => {
    const env: TickEnv = {
      state: defaultState(),
      lastTickAt: null,
      _finishing: false,
    };
    // running stays false
    env.state.endsAt = 1_000_000 - 10_000; // already expired (irrelevant)

    const r = tick(env, 1_000_000);
    expect(r.ranPause).toBe(false);
    expect(r.ranFinish).toBe(false);
    expect(r.ranDayRollover).toBe(false);
  });

  it("_finishing gate → tick() exits immediately even with stale endsAt", () => {
    const env: TickEnv = {
      state: defaultState(),
      lastTickAt: 1_000_000,
      _finishing: true,
    };
    env.state.running = true;
    env.state.endsAt = 1_000_000 - 60_000; // expired long ago

    const r = tick(env, 1_000_000);
    expect(r.ranPause).toBe(false);
    expect(r.ranFinish).toBe(false); // gate blocked us
  });
});

describe("pomodoro tick: day rollover while running", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normal tick within same day → count untouched", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0));
    const today = new Date().toDateString();

    const env: TickEnv = {
      state: { ...defaultState(), todayDone: { date: today, count: 5 } },
      lastTickAt: 1_000_000,
      _finishing: false,
    };
    env.state.running = true;
    env.state.endsAt = Date.now() + 30_000;
    env.lastTickAt = Date.now() - 1_000;

    const r = tick(env, Date.now() + 1_000);
    expect(r.ranDayRollover).toBe(false);
    expect(env.state.todayDone.count).toBe(5);
  });

  it("tick at midnight after yesterday's count → resets count to 0, clears stalePromptDate", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 0, 0, 5));
    const today = new Date().toDateString();
    const yesterday = new Date(2026, 6, 23).toDateString();

    const env: TickEnv = {
      state: {
        ...defaultState(),
        todayDone: { date: yesterday, count: 8 },
        stalePromptDate: yesterday,
      },
      lastTickAt: Date.now() - 1_000, // 1s tick → below sleep threshold
      _finishing: false,
    };
    env.state.running = true;
    env.state.endsAt = Date.now() + 30_000;

    const r = tick(env, Date.now());
    expect(r.ranDayRollover).toBe(true);
    expect(env.state.todayDone.date).toBe(today);
    expect(env.state.todayDone.count).toBe(0);
    expect(env.state.stalePromptDate).toBe("");
  });

  it("day rollover still gates expiry: if endsAt is also past, pause (sleep path) wins first", () => {
    // Both transitions happen on the same tick — sleep detection runs
    // BEFORE the day rollover check, so a long sleep + day change
    // pauses instead of finishing a phantom session. Count reset still
    // happens on the next tick after the user clicks 继续.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 0, 0, 5));
    const yesterday = new Date(2026, 6, 23).toDateString();

    const env: TickEnv = {
      state: { ...defaultState(), todayDone: { date: yesterday, count: 8 } },
      lastTickAt: Date.now() - 15_000, // 15s gap → triggers sleep detection
      _finishing: false,
    };
    env.state.running = true;
    // endsAt expired — wall clock jumped 15s while the system slept.
    env.state.endsAt = Date.now() - 5_000;

    const r = tick(env, Date.now());
    expect(r.ranPause).toBe(true);
    expect(r.ranFinish).toBe(false); // phantom-session guard
    expect(r.ranDayRollover).toBe(false); // pause() returned before rollover check
  });
});

describe("pomodoro checkDayRollover: pure state", () => {
  it("returns false when todayDone.date already matches today", () => {
    const today = new Date().toDateString();
    const state: PomState = {
      ...defaultState(),
      todayDone: { date: today, count: 7 },
    };
    expect(checkDayRollover(state, today)).toBe(false);
    expect(state.todayDone.count).toBe(7);
  });

  it("returns true when date differs → resets count + clears stalePromptDate", () => {
    const state: PomState = {
      ...defaultState(),
      todayDone: { date: "Yesterday", count: 7 },
      stalePromptDate: "Yesterday",
      pausedRemain: 600,
    };
    const TODAY = "Today";
    expect(checkDayRollover(state, TODAY)).toBe(true);
    expect(state.todayDone).toEqual({ date: "Today", count: 0 });
    expect(state.stalePromptDate).toBe("");
  });

  it("preserves pausedRemain — the banner-showing logic outside this fn will pick it up", () => {
    // checkDayRollover is intentionally pure: it does NOT show the banner.
    // The widget-side callsite decides whether to surface the stale
    // banner based on state.pausedRemain after the function returns.
    const state: PomState = {
      ...defaultState(),
      todayDone: { date: "Yesterday", count: 3 },
      pausedRemain: 1234,
      stalePromptDate: "Yesterday",
    };
    checkDayRollover(state, "Today");
    expect(state.pausedRemain).toBe(1234); // untouched
  });
});
