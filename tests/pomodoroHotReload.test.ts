/**
 * Hot-reload reproduction: pause → simulate plugin reload → verify
 * state.todayDone.count is unchanged.
 *
 * Goal: confirm whether the bug "count increments on every hot reload"
 * actually fires when the saved state is paused.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

class FakeComponent {
  private cleanups: Array<() => void> = [];
  private intervals = new Set<number>();
  register(cleanup: () => void) { this.cleanups.push(cleanup); }
  registerInterval(id: number) { this.intervals.add(id); }
  registerDomEvent(_el: EventTarget, _type: string, _cb: EventListener) {
    // no-op for tests
  }
  unload() {
    for (const fn of this.cleanups) fn();
    for (const id of this.intervals) clearInterval(id);
    this.cleanups = [];
    this.intervals.clear();
  }
}

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

const STORAGE_KEY = "pomo-state-v1";

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

function saveState(state: PomState): void {
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
}

function loadState(): PomState {
  const s = defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      Object.assign(s, parsed);
    }
  }
  const today = new Date().toDateString();
  if (s.todayDone.date !== today) {
    s.todayDone = { date: today, count: 0 };
  }
  if (s.endsAt && s.endsAt < Date.now() - 2000) {
    s.endsAt = null;
    s.running = false;
    s.pausedRemain = null;
  }
  if (s.running && s.endsAt) {
    s.pausedRemain = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
    s.endsAt = null;
    s.running = false;
  }
  return s;
}

// Mirror finish() minus db/dom dependencies. Counts only when running=true
// and remaining<=0. Returns the new state.
function maybeFinish(state: PomState, _finishingFlag: { value: boolean }): {
  finished: boolean;
  wasCountIncremented: boolean;
} {
  if (!state.running) return { finished: false, wasCountIncremented: false };
  const remaining = Math.max(0, Math.round((state.endsAt! - Date.now()) / 1000));
  if (remaining > 0) return { finished: false, wasCountIncremented: false };
  if (_finishingFlag.value) return { finished: false, wasCountIncremented: false };
  _finishingFlag.value = true;
  state.running = false;
  if (state.mode === "work") {
    state.todayDone.count += 1;
    saveState(state);
    return { finished: true, wasCountIncremented: true };
  }
  return { finished: true, wasCountIncremented: false };
}

describe("pomodoro hot-reload: paused state must not increment count", () => {
  beforeEach(() => {
    const storage = fakeStorage();
    // @ts-expect-error - assign to global
    globalThis.localStorage = storage;
    // Reset to a known-paused state in localStorage.
    const s = defaultState();
    s.pausedRemain = 1234;
    s.running = false;
    saveState(s);
  });

  it("loadState on paused state returns running=false, endsAt=null", () => {
    const s = loadState();
    expect(s.running).toBe(false);
    expect(s.endsAt).toBeNull();
    expect(s.pausedRemain).toBe(1234);
    expect(s.todayDone.count).toBe(0);
  });

  it("simulated tick() on paused state never finishes", () => {
    const s = loadState();
    const flag = { value: false };
    const r = maybeFinish(s, flag);
    expect(r.finished).toBe(false);
    expect(r.wasCountIncremented).toBe(false);
    expect(s.todayDone.count).toBe(0);
  });

  it("simulating 5 hot-reload cycles does not increment count", () => {
    for (let i = 0; i < 5; i++) {
      const s = loadState();
      const flag = { value: false };
      // If a stale tick callback runs against the saved state, it would
      // call maybeFinish — but state.running=false, so it must not.
      const r = maybeFinish(s, flag);
      expect(r.wasCountIncremented).toBe(false);
      expect(loadState().todayDone.count).toBe(0);
    }
  });
});

describe("pomodoro hot-reload: running state on reload", () => {
  beforeEach(() => {
    const storage = fakeStorage();
    // @ts-expect-error - assign to global
    globalThis.localStorage = storage;
  });

  it("running with future endsAt → loadState converts to pausedRemain", () => {
    const s = defaultState();
    s.running = true;
    s.endsAt = Date.now() + 60000; // 60s in future
    saveState(s);

    const loaded = loadState();
    expect(loaded.running).toBe(false);
    expect(loaded.endsAt).toBeNull();
    expect(loaded.pausedRemain).toBeGreaterThan(50);
  });

  it("running with PAST endsAt → loadState clears without incrementing", () => {
    const s = defaultState();
    s.running = true;
    s.endsAt = Date.now() - 60000; // expired 60s ago
    saveState(s);

    const loaded = loadState();
    expect(loaded.running).toBe(false);
    expect(loaded.pausedRemain).toBeNull();
    expect(loaded.todayDone.count).toBe(0); // ← BUG: expired timer doesn't get credit
  });
});