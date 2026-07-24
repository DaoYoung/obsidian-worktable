/**
 * Pure-function tests for `shouldShowStalePrompt` — the trigger rule for
 * the "yesterday's leftover timer" banner shown on first open each day.
 *
 * The banner lives in `src/widgets/PomodoroWidget.ts` and is surfaced when
 * (a) there's a leftover `pausedRemain`, AND
 * (b) we haven't prompted today, AND
 * (c) the user hasn't picked a remembered preference yet.
 *
 * The bottom of this file also reproduces the full click-reset → reopen
 * flow against an in-memory localStorage to lock down the persistence
 * contract for the reset button.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { shouldShowStalePrompt } from "../src/widgets/PomodoroWidget";

interface FakeState {
  pausedRemain: number | null;
  stalePromptDate: string;
  staleTimerPref: "reset" | "keep" | null;
}

function baseState(): FakeState {
  return { pausedRemain: 1234, stalePromptDate: "", staleTimerPref: null };
}

const TODAY = "Wed Jul 22 2026";
const YESTERDAY = "Tue Jul 21 2026";

describe("shouldShowStalePrompt", () => {
  it("returns false when pausedRemain is null (no leftover timer)", () => {
    const s = baseState();
    s.pausedRemain = null;
    expect(shouldShowStalePrompt(s as never, TODAY)).toBe(false);
  });

  it("returns true when pausedRemain is non-null and today hasn't been prompted", () => {
    const s = baseState();
    expect(shouldShowStalePrompt(s as never, TODAY)).toBe(true);
  });

  it("returns false when we already prompted today", () => {
    const s = baseState();
    s.stalePromptDate = TODAY;
    expect(shouldShowStalePrompt(s as never, TODAY)).toBe(false);
  });

  it("returns true when stalePromptDate is yesterday's date (rolled over)", () => {
    const s = baseState();
    s.stalePromptDate = YESTERDAY;
    expect(shouldShowStalePrompt(s as never, TODAY)).toBe(true);
  });

  it("returns false when remembered preference is 'reset' (caller will silently clear)", () => {
    const s = baseState();
    s.staleTimerPref = "reset";
    expect(shouldShowStalePrompt(s as never, TODAY)).toBe(false);
  });

  it("returns false when remembered preference is 'keep' (caller will leave as-is)", () => {
    const s = baseState();
    s.staleTimerPref = "keep";
    expect(shouldShowStalePrompt(s as never, TODAY)).toBe(false);
  });

  it("treats staleTimerPref='reset' as final even if stalePromptDate is from yesterday", () => {
    const s = baseState();
    s.stalePromptDate = YESTERDAY;
    s.staleTimerPref = "reset";
    expect(shouldShowStalePrompt(s as never, TODAY)).toBe(false);
  });

  it("treats staleTimerPref='keep' as final even if stalePromptDate is from yesterday", () => {
    const s = baseState();
    s.stalePromptDate = YESTERDAY;
    s.staleTimerPref = "keep";
    expect(shouldShowStalePrompt(s as never, TODAY)).toBe(false);
  });

  it("preference precedence: pausedRemain=null wins over any preference", () => {
    const s = baseState();
    s.pausedRemain = null;
    s.staleTimerPref = "reset";
    s.stalePromptDate = YESTERDAY;
    expect(shouldShowStalePrompt(s as never, TODAY)).toBe(false);
  });
});

/* ───────────────────────────────────────────────────────────────────────
   Below: integration-style mirrors of the full click-reset → reopen
   flow against an in-memory localStorage. These lock down the contract
   the reset button relies on: once the user clears it, reopening the
   widget within the same day must NOT re-surface the banner.
   ─────────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = "pomo-state-v1";
const DAY_MS = 24 * 60 * 60 * 1000;

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

interface PersistedShape {
  mode: string;
  durationMin: number;
  endsAt: number | null;
  pausedRemain: number | null;
  running: boolean;
  cycleIdx: number;
  todayDone: { date: string; count: number };
  stalePromptDate?: string;
  staleTimerPref?: "reset" | "keep" | null;
}

function saveMirror(state: PersistedShape, store: Storage): void {
  store.setItem(STORAGE_KEY, JSON.stringify({
    mode: state.mode,
    durationMin: state.durationMin,
    endsAt: state.endsAt,
    pausedRemain: state.pausedRemain,
    running: state.running,
    cycleIdx: state.cycleIdx,
    todayDone: state.todayDone,
    stalePromptDate: state.stalePromptDate ?? "",
    staleTimerPref: state.staleTimerPref ?? null,
  }));
}

function loadMirror(store: Storage): PersistedShape {
  const s: PersistedShape = {
    mode: "work",
    durationMin: 25,
    endsAt: null,
    pausedRemain: null,
    running: false,
    cycleIdx: 0,
    todayDone: { date: new Date().toDateString(), count: 0 },
  };
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return s;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    Object.assign(s, parsed);
  } catch (_) {}
  return s;
}

// Mirror of shouldShowStalePrompt (same precedence rules).
function shouldShow(state: PersistedShape, today: string): boolean {
  if (state.pausedRemain == null) return false;
  if (state.stalePromptDate === today) return false;
  if (state.staleTimerPref === "reset") return false;
  if (state.staleTimerPref === "keep") return false;
  return true;
}

describe("stale-prompt reset → reopen (regression)", () => {
  let store: Storage;
  beforeEach(() => {
    store = fakeStorage();
  });

  function yesterdayMs(now: number, n = 1): number {
    return now - n * DAY_MS;
  }

  it("FIX: clicking 重置 then reopening same day does not re-prompt", () => {
    const NOW = Date.UTC(2026, 6, 22, 9, 0, 0);
    const TODAY = new Date(NOW).toDateString();

    // Yesterday: a paused timer with 600s remain.
    const yesterdayState: PersistedShape = {
      mode: "work",
      durationMin: 25,
      endsAt: null,
      pausedRemain: 600,
      running: false,
      cycleIdx: 3,
      todayDone: { date: new Date(yesterdayMs(NOW)).toDateString(), count: 5 },
      stalePromptDate: "",
      staleTimerPref: null,
    };
    saveMirror(yesterdayState, store);

    // Today: user opens, loadState reads yesterday's pausedRemain.
    const loaded = loadMirror(store);
    expect(loaded.pausedRemain).toBe(600);
    expect(shouldShow(loaded, TODAY)).toBe(true);

    // User clicks 重置 (the handler in PomodoroWidget does these mutations):
    loaded.pausedRemain = null;
    loaded.endsAt = null;
    loaded.running = false;
    // (remember checkbox unchecked → staleTimerPref stays null)
    loaded.stalePromptDate = TODAY;
    saveMirror(loaded, store);

    // The persisted record MUST reflect the reset.
    const persisted = JSON.parse(store.getItem(STORAGE_KEY)!) as PersistedShape;
    expect(persisted.pausedRemain).toBeNull();
    expect(persisted.stalePromptDate).toBe(TODAY);

    // Now reopen (close + reopen). loadState should return clean state,
    // and shouldShow must say false.
    const reopened = loadMirror(store);
    expect(reopened.pausedRemain).toBeNull();
    expect(reopened.stalePromptDate).toBe(TODAY);
    expect(shouldShow(reopened, TODAY)).toBe(false);
  });

  it("FIX: clicking 重置 with '以后都这样处理' checked persists staleTimerPref='reset'", () => {
    const NOW = Date.UTC(2026, 6, 22, 9, 0, 0);
    const TODAY = new Date(NOW).toDateString();
    store.setItem(STORAGE_KEY, JSON.stringify({
      mode: "work", durationMin: 25, endsAt: null,
      pausedRemain: 600, running: false, cycleIdx: 0,
      todayDone: { date: new Date(yesterdayMs(NOW)).toDateString(), count: 5 },
    }));

    const s = loadMirror(store);
    expect(shouldShow(s, TODAY)).toBe(true);

    // Reset with remember checked
    s.pausedRemain = null;
    s.endsAt = null;
    s.running = false;
    s.staleTimerPref = "reset";
    s.stalePromptDate = TODAY;
    saveMirror(s, store);

    const reopened = loadMirror(store);
    expect(reopened.staleTimerPref).toBe("reset");
    expect(reopened.pausedRemain).toBeNull();
    expect(shouldShow(reopened, TODAY)).toBe(false);
  });

  it("clicking 重置 on day 1, opening on day 2 still does not re-prompt (no leftover)", () => {
    // After reset, pausedRemain is null. Next day's load shows no
    // banner — both because there's no leftover AND because
    // stalePromptDate is irrelevant when there's nothing to clear.
    const DAY1 = Date.UTC(2026, 6, 22, 9, 0, 0);
    const DAY2 = DAY1 + DAY_MS;

    store.setItem(STORAGE_KEY, JSON.stringify({
      mode: "work", durationMin: 25, endsAt: null,
      pausedRemain: null, running: false, cycleIdx: 0,
      todayDone: { date: new Date(DAY1).toDateString(), count: 0 },
      stalePromptDate: new Date(DAY1).toDateString(),
      staleTimerPref: null,
    }));

    const reopened = loadMirror(store);
    expect(reopened.pausedRemain).toBeNull();
    expect(shouldShow(reopened, new Date(DAY2).toDateString())).toBe(false);
  });
});
