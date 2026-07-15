/**
 * Unit tests for the pure dedup-cluster helper used by both
 * `addSession` (inline dedup) and `deduplicateSessions` (mount-time sweep).
 *
 * Pinned behavior:
 * - Records with same (type, duration) whose consecutive completedAt gaps
 *   are within `windowMs` form one cluster; only the earliest survives.
 * - Records > `windowMs` apart with the same signature are NOT merged
 *   (different real sessions, even if back-to-back).
 * - Different signatures (different type or duration) never merge, even
 *   at the same millisecond.
 * - Records without an id are silently skipped (they cannot be deleted).
 */

import { describe, it, expect } from "vitest";
import { findDuplicateIds, type PomSession } from "../src/storage/pomodoroDb";

function rec(id: number, type: string, duration: number, completedAt: number): PomSession {
  return {
    id,
    type,
    duration,
    startedAt: completedAt - duration,
    completedAt,
    date: new Date(completedAt).toISOString().slice(0, 10),
  };
}

describe("findDuplicateIds", () => {
  it("returns empty set when records list is empty", () => {
    expect(findDuplicateIds([]).size).toBe(0);
  });

  it("returns empty set when no two records share the same type+duration", () => {
    const records = [
      rec(1, "work", 1500, 1000),
      rec(2, "short", 300, 2000),
      rec(3, "long", 900, 3000),
    ];
    expect(findDuplicateIds(records).size).toBe(0);
  });

  it("keeps a single record and drops the rest of a 100ms cluster", () => {
    const records = [
      rec(1, "work", 1500, 1000),
      rec(2, "work", 1500, 1050),
      rec(3, "work", 1500, 1100),
    ];
    const out = findDuplicateIds(records);
    expect(out.has(2)).toBe(true);
    expect(out.has(3)).toBe(true);
    expect(out.has(1)).toBe(false);
  });

  it("treats gaps larger than the window as separate clusters", () => {
    // Two real back-to-back 25-min work sessions (~1500000ms apart)
    // plus a phantom 2s after the first — must keep both real sessions
    // and drop only the phantom.
    const records = [
      rec(1, "work", 1500, 1_000_000),
      rec(2, "work", 1500, 1_002_000),    // phantom, 2s after rec 1
      rec(3, "work", 1500, 1_510_000),    // real session 25 min later
    ];
    const out = findDuplicateIds(records);
    expect(out.has(2)).toBe(true);
    expect(out.has(1)).toBe(false);
    expect(out.has(3)).toBe(false);
  });

  it("catches interleaved duplicates that the old adjacent-only scan would miss", () => {
    // [A, B-different, A-dup-of-A] — rec 1 and rec 3 share signature but
    // are not adjacent after sort, so the previous linear-scan dedup
    // would have missed them. We expect rec 3 deleted.
    const records = [
      rec(1, "work", 1500, 1000),
      rec(2, "short", 300, 1500),    // breaks adjacency in linear scan
      rec(3, "work", 1500, 1500),    // same completedAt as the short, but the
                                      // short lives in a different bucket so it
                                      // doesn't suppress this work-dup
    ];
    const out = findDuplicateIds(records);
    expect(out.has(3)).toBe(true);
    expect(out.has(1)).toBe(false);
    expect(out.has(2)).toBe(false);
  });

  it("never merges records with different durations", () => {
    // Different durations land in different buckets regardless of timing.
    const records = [
      rec(1, "work", 1500, 1000),
      rec(2, "work", 60,   1050),
    ];
    expect(findDuplicateIds(records).size).toBe(0);
  });

  it("never merges records with different types", () => {
    const records = [
      rec(1, "work",  1500, 1000),
      rec(2, "short", 1500, 1000),
    ];
    expect(findDuplicateIds(records).size).toBe(0);
  });

  it("silently skips records without an id (cannot be deleted)", () => {
    const records: PomSession[] = [
      { id: 1, type: "work", duration: 1500, startedAt: 0, completedAt: 1000, date: "1970-01-01" },
      { id: undefined, type: "work", duration: 1500, startedAt: 0, completedAt: 1050, date: "1970-01-01" },
      { id: 3, type: "work", duration: 1500, startedAt: 0, completedAt: 1100, date: "1970-01-01" },
    ];
    const out = findDuplicateIds(records);
    // id-less record cannot be added to Set<number>; rec 3 should still be flagged.
    expect(out.has(3)).toBe(true);
    expect(out.size).toBe(1);
  });

  it("respects a custom window", () => {
    const records = [
      rec(1, "work", 1500, 1000),
      rec(2, "work", 1500, 4000),    // 3s later
    ];
    expect(findDuplicateIds(records, 2000).size).toBe(0);
    expect(findDuplicateIds(records, 5000).has(2)).toBe(true);
  });

  it("reproduces the user's 'same time, multiple records' pattern", () => {
    // Simulate the symptom from the screenshot: 5 phantom work records
    // spaced ~200ms apart — every record but the earliest must be removed.
    const t0 = Date.now();
    const records = [
      rec(10, "work", 1500, t0),
      rec(11, "work", 1500, t0 + 200),
      rec(12, "work", 1500, t0 + 400),
      rec(13, "work", 1500, t0 + 600),
      rec(14, "work", 1500, t0 + 800),
    ];
    const out = findDuplicateIds(records);
    expect(out.has(10)).toBe(false); // anchor survives
    for (const id of [11, 12, 13, 14]) {
      expect(out.has(id)).toBe(true);
    }
  });
});
