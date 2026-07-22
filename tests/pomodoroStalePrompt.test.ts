/**
 * Pure-function tests for `shouldShowStalePrompt` — the trigger rule for
 * the "yesterday's leftover timer" banner shown on first open each day.
 *
 * The banner lives in `src/widgets/PomodoroWidget.ts` and is surfaced when
 * (a) there's a leftover `pausedRemain`, AND
 * (b) we haven't prompted today, AND
 * (c) the user hasn't picked a remembered preference yet.
 */

import { describe, expect, it } from "vitest";
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