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

/**
 * Two records are considered duplicates of each other (same logical session)
 * if their completedAt is within `windowMs` OR their startedAt is within
 * `startWindowMs`. The `completedAt` window catches closely-spaced writes
 * (concurrent calls, hot-reload races); the `startedAt` window catches
 * phantom records created minutes apart by repeated hot reloads — they all
 * share the original session's startedAt but their completedAt drifts.
 *
 * The default startWindow is 120_000 ms (2 min): legitimate same-signature
 * sessions are at least 25 min apart (work + auto break), so any two records
 * whose startedAt is within 2 min are clearly the same session even if their
 * completedAt drifted arbitrarily. The 5 s completedAt window catches
 * high-frequency duplicates (e.g. concurrent addSession).
 */
export function areDuplicateSessions(
  a: PomSession,
  b: PomSession,
  windowMs = 5000,
  startWindowMs = 120_000,
): boolean {
  if (a.type !== b.type || a.duration !== b.duration) return false;
  if (Math.abs((a.completedAt ?? 0) - (b.completedAt ?? 0)) < windowMs) return true;
  if (Math.abs((a.startedAt ?? 0) - (b.startedAt ?? 0)) < startWindowMs) return true;
  return false;
}

/**
 * Pure helper — exports for unit testing.
 * Bucket records by (type, duration), then within each bucket walk sorted
 * by completedAt and grow a cluster as long as the next record is a duplicate
 * of ANY record already in the cluster. Within a cluster of size > 1, keep
 * the earliest record (by completedAt) and flag every later record for
 * deletion. This handles transitive duplicates: when 4 phantoms share a
 * startedAt with 30s gaps, rec1↔rec2, rec2↔rec3, rec3↔rec4 chains them
 * into one cluster even when rec1↔rec4 alone exceeds the window.
 *
 * O(n²) per bucket in the worst case, but typical IDB records number in
 * the hundreds and bucket sizes are tiny, so this is fine in practice.
 */
export function findDuplicateIds(records: PomSession[], windowMs = 5000): Set<number> {
  const toDelete = new Set<number>();
  const byKey = new Map<string, PomSession[]>();
  for (const rec of records) {
    const key = `${rec.type}|${rec.duration}`;
    const list = byKey.get(key);
    if (list) list.push(rec);
    else byKey.set(key, [rec]);
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    list.sort(
      (a, b) =>
        (a.completedAt ?? 0) - (b.completedAt ?? 0) || (a.id ?? 0) - (b.id ?? 0),
    );
    // Build maximal clusters greedily: a record joins the current cluster iff
    // it's a duplicate of at least one member of that cluster (transitively).
    const clusters: PomSession[][] = [];
    for (const rec of list) {
      const last = clusters[clusters.length - 1];
      if (last && last.some((m) => areDuplicateSessions(m, rec, windowMs))) {
        last.push(rec);
      } else {
        clusters.push([rec]);
      }
    }
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      // cluster[0] is the earliest (after sort); it survives.
      for (let i = 1; i < cluster.length; i++) {
        const dup = cluster[i];
        if (dup?.id != null) toDelete.add(dup.id);
      }
    }
  }
  return toDelete;
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
    // Atomic check-and-insert. The previous implementation read in one
    // transaction and wrote in another, leaving a window where two
    // concurrent addSession() calls (e.g. two Worktable panes, or a
    // finish()-mid-await + a hot-reload re-entry) could both pass the dup
    // guard and both insert. IndexedDB serializes readwrite transactions
    // per store, so doing the index lookup and the add inside the same tx
    // closes that window.
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite");
      const store = tx.objectStore("sessions");
      const idx = store.index("completedAt");
      const range = IDBKeyRange.bound(rec.completedAt - 5000, rec.completedAt + 5000);
      let isDup = false;
      const cursorReq = idx.openCursor(range);
      cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const s = cursor.value;
          if (
            s.type === rec.type &&
            s.duration === rec.duration &&
            Math.abs((s.completedAt ?? 0) - rec.completedAt) < 5000
          ) {
            isDup = true;
            return; // skip remaining cursors; tx completes empty
          }
          cursor.continue();
        } else if (!isDup) {
          store.add(rec);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
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
        // Use the bucket-based cluster finder. Unlike the previous
        // adjacent-only scan, this catches interleaved duplicates like
        // [A-dup, B-different, A-dup] where A's two copies are not adjacent.
        const toDelete = findDuplicateIds(all);
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
