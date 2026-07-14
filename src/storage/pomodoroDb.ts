// Stub - will be provided by integration agent
export interface PomSession {
  id?: number;
  type: string;
  duration: number;
  startedAt: number;
  completedAt: number;
  date: string;
}

export interface PomConfig {
  sound: boolean;
  notify: boolean;
  auto: boolean;
}

export interface PomStats {
  todayCount: number;
  todayFocusSec: number;
  todayBreakSec: number;
  focusCount: number;
  focusTotalSec: number;
  breakTotalSec: number;
  activeDays: number;
}

export interface PomDb {
  open(): Promise<IDBDatabase>;
  addSession(rec: Omit<PomSession, "id">): Promise<void>;
  recent(limit: number): Promise<PomSession[]>;
  stats(): Promise<PomStats>;
  getConfig(): Promise<PomConfig>;
  setConfig(key: keyof PomConfig, value: boolean): Promise<void>;
  /** Remove sessions that share the same completedAt + type + duration. Keeps the lowest id. */
  deduplicateSessions(): Promise<void>;
}

const DB_NAME = "pomodoro-db";
const DB_VERSION = 1;

export function createPomDb(): PomDb {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("sessions")) {
          const s = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
          s.createIndex("completedAt", "completedAt");
          s.createIndex("date", "date");
        }
        if (!db.objectStoreNames.contains("config")) {
          db.createObjectStore("config", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function addSession(rec: Omit<PomSession, "id">): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("sessions").add(rec);
    });
  }

  async function recent(limit: number): Promise<PomSession[]> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const out: PomSession[] = [];
      const tx = db.transaction("sessions", "readonly");
      const idx = tx.objectStore("sessions").index("completedAt");
      idx.openCursor(null, "prev").onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && out.length < limit) {
          out.push(cursor.value);
          cursor.continue();
        } else {
          resolve(out);
        }
      };
    });
  }

  async function stats(): Promise<PomStats> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sessions", "readonly");
      const req = tx.objectStore("sessions").getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        const today = new Date().toISOString().slice(0, 10);
        let todayCount = 0;
        let todayFocusSec = 0;
        let todayBreakSec = 0;
        let focusCount = 0;
        let focusTotalSec = 0;
        let breakTotalSec = 0;
        const dates = new Set<string>();
        for (const r of all) {
          if (r.type === "work") {
            focusCount += 1;
            focusTotalSec += r.duration || 0;
            if (r.date === today) {
              todayCount += 1;
              todayFocusSec += r.duration || 0;
            }
          } else if (r.type === "short" || r.type === "long") {
            breakTotalSec += r.duration || 0;
            if (r.date === today) todayBreakSec += r.duration || 0;
          }
          if (r.date) dates.add(r.date);
        }
        resolve({
          todayCount,
          todayFocusSec,
          todayBreakSec,
          focusCount,
          focusTotalSec,
          breakTotalSec,
          activeDays: dates.size,
        });
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getConfig(): Promise<PomConfig> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("config", "readonly");
      const req = tx.objectStore("config").getAll();
      req.onsuccess = () => {
        const cfg: PomConfig = { sound: true, notify: true, auto: true };
        req.result.forEach((r: { key: string; value: boolean }) => {
          if (r.key in cfg) (cfg as unknown as Record<string, boolean>)[r.key] = r.value;
        });
        resolve(cfg);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function setConfig(key: keyof PomConfig, value: boolean): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("config", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("config").put({ key, value });
    });
  }

  async function deduplicateSessions(): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite");
      const store = tx.objectStore("sessions");
      const req = store.getAll();
      req.onsuccess = () => {
        const all: PomSession[] = req.result || [];
        if (all.length < 2) return;
        // Sort by completedAt ascending so a linear scan finds near-duplicates.
        all.sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0) || (a.id ?? 0) - (b.id ?? 0));
        const toDelete = new Set<number>();
        let prev: PomSession | null = null;
        for (const rec of all) {
          if (rec.id == null) continue;
          if (
            prev &&
            prev.type === rec.type &&
            prev.duration === rec.duration &&
            rec.completedAt - prev.completedAt < 5000
          ) {
            // Keep the earlier one, mark the later one for deletion.
            toDelete.add(rec.id);
          } else {
            prev = rec;
          }
        }
        for (const id of toDelete) {
          store.delete(id);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { open, addSession, recent, stats, getConfig, setConfig, deduplicateSessions };
}
