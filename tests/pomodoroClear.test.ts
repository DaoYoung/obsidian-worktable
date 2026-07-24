import { describe, expect, it } from "vitest";
import type { PomConfig, PomDb, PomSession } from "../src/storage/pomodoroDb";

function memoryPomDb(): PomDb {
  let sessions: PomSession[] = [];
  const config: PomConfig = { sound: true, notify: true, auto: true };
  return {
    open: async () => ({}) as IDBDatabase,
    addSession: async (session) => { sessions.push({ ...session, id: sessions.length + 1 }); },
    recent: async (limit) => sessions.slice(-limit).reverse(),
    stats: async () => ({
      todayCount: 0,
      todayFocusSec: 0,
      todayBreakSec: 0,
      focusCount: 0,
      focusTotalSec: 0,
      breakTotalSec: 0,
      activeDays: 0,
    }),
    getConfig: async () => ({ ...config }),
    setConfig: async (key, value) => { config[key] = value; },
    clearSessions: async () => { sessions = []; },
    deduplicateSessions: async () => {},
  };
}

describe("PomDb.clearSessions", () => {
  it("clears sessions while preserving config", async () => {
    const db = memoryPomDb();
    await db.addSession({
      type: "work",
      duration: 1500,
      startedAt: 1,
      completedAt: 2,
      date: "2026-07-24",
    });
    await db.setConfig("sound", false);

    expect((await db.recent(10)).length).toBe(1);
    await db.clearSessions();

    expect((await db.recent(10)).length).toBe(0);
    expect((await db.getConfig()).sound).toBe(false);
  });

  it("is safe when sessions are already empty", async () => {
    const db = memoryPomDb();
    await expect(db.clearSessions()).resolves.toBeUndefined();
  });
});
