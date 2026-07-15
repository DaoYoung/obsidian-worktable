/**
 * Simulate the visibility handler firing against the loaded state.
 * Tests whether the code path can produce a spurious
 * `state.todayDone.count += 1` when localStorage contains an invalid
 * (running=true, endsAt=null) combination.
 */

import { describe, it, expect, beforeEach } from "vitest";

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

const STORAGE_KEY = "pomo-state-v1";

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

function loadStateFromStorage(): PomState {
  const s = defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") Object.assign(s, parsed);
    } catch (_) {}
  }
  const today = new Date().toDateString();
  if (s.todayDone.date !== today) s.todayDone = { date: today, count: 0 };
  if (s.endsAt && s.endsAt < Date.now() - 2000) {
    s.endsAt = null;
    s.running = false;
    s.pausedRemain = null;
  }
  // Fixed: always normalize running on mount, even if endsAt is null.
  if (s.running) {
    if (s.endsAt) {
      s.pausedRemain = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
    }
    s.endsAt = null;
    s.running = false;
  }
  return s;
}

function tick(state: PomState, _finishing: { value: boolean }): { finished: boolean; normalized: boolean } {
  if (!state.running || _finishing.value) return { finished: false, normalized: false };
  // Fixed: defensive guard — running with null endsAt is invalid state,
  // normalize it instead of treating remaining as 0 (which would fire finish()).
  if (state.endsAt == null) {
    state.running = false;
    return { finished: false, normalized: true };
  }
  const remaining = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
  if (remaining <= 0) return { finished: true, normalized: false };
  return { finished: false, normalized: false };
}

function finish(state: PomState): { countIncremented: boolean } {
  state.running = false;
  if (state.mode === "work") {
    state.todayDone.count += 1;
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
    return { countIncremented: true };
  }
  return { countIncremented: false };
}

describe("visibility handler fires after hot reload — fixed state case", () => {
  beforeEach(() => {
    const s = fakeStorage();
    // @ts-expect-error - assign to global
    globalThis.localStorage = s;
  });

  it("FIX: invalid (running=true, endsAt=null) in localStorage is normalized by loadState", () => {
    const s = defaultState();
    s.running = true;
    s.endsAt = null;
    s.mode = "work";
    s.todayDone.count = 5;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: s.mode, durationMin: s.durationMin, endsAt: s.endsAt,
      pausedRemain: s.pausedRemain, running: s.running, cycleIdx: 0,
      todayDone: s.todayDone,
    }));

    const loaded = loadStateFromStorage();
    // loadState normalizes invalid combination: running=false, endsAt=null.
    expect(loaded.running).toBe(false);
    expect(loaded.endsAt).toBeNull();
    expect(loaded.todayDone.count).toBe(5); // untouched
  });

  it("FIX: tick() on running-with-null-endsAt normalizes instead of finishing", () => {
    const state = defaultState();
    state.running = true;
    state.endsAt = null;
    state.mode = "work";
    state.todayDone.count = 5;

    const r = tick(state, { value: false });
    expect(r.finished).toBe(false);
    expect(r.normalized).toBe(true);
    expect(state.running).toBe(false);
    expect(state.todayDone.count).toBe(5); // not incremented
  });

  it("FIX: hot-reload loop with invalid state never increments count", () => {
    // Seed corrupted state.
    const s = defaultState();
    s.running = true;
    s.endsAt = null;
    s.mode = "work";
    s.todayDone.count = 5;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: s.mode, durationMin: s.durationMin, endsAt: s.endsAt,
      pausedRemain: s.pausedRemain, running: s.running, cycleIdx: 0,
      todayDone: s.todayDone,
    }));

    for (let i = 0; i < 5; i++) {
      // Reload from storage each iteration — loadState keeps cleaning up.
      const next = loadStateFromStorage();
      // Even if some other code re-introduces the corruption,
      // tick() normalizes instead of finishing.
      next.running = true;
      next.endsAt = null;
      const flag = { value: false };
      const r = tick(next, flag);
      if (r.finished) finish(next); // would only happen on real expiry
    }
    // Count must remain at 5 across 5 reload cycles.
    expect(loadStateFromStorage().todayDone.count).toBe(5);
  });
});
