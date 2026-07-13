export const POMODORO_DB_NAME = "pomodoro-db";
export const POMODORO_DB_VERSION = 1;

export type PomodoroMode = "work" | "short" | "long" | "custom";

export interface PomodoroSession {
  id?: number;
  type: PomodoroMode;
  duration: number;
  startedAt: number;
  completedAt: number;
  date: string;
}

export interface PomodoroConfig {
  sound: boolean;
  notify: boolean;
  auto: boolean;
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  sound: true,
  notify: true,
  auto: true,
};

let openPromise: Promise<IDBDatabase> | null = null;

export function openPomodoroDb(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }
    const req = indexedDB.open(POMODORO_DB_NAME, POMODORO_DB_VERSION);
    req.onupgradeneeded = (event) => {
      const target = event.target as IDBOpenDBRequest;
      const db = target.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true });
        store.createIndex("completedAt", "completedAt");
        store.createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config", { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        try {
          db.close();
        } catch (_err) {
          // ignore
        }
        openPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to open pomodoro-db"));
  });
  return openPromise;
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

export async function addPomodoroSession(session: Omit<PomodoroSession, "id">): Promise<number> {
  const db = await openPomodoroDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    const store = tx.objectStore("sessions");
    const req = store.add(session);
    req.onsuccess = () => resolve(Number(req.result));
    req.onerror = () => reject(req.error ?? new Error("Failed to add session"));
    tx.onerror = () => reject(tx.error ?? new Error("Session tx failed"));
  });
}

export async function listRecentPomodoroSessions(limit: number): Promise<PomodoroSession[]> {
  const db = await openPomodoroDb();
  return new Promise<PomodoroSession[]>((resolve, reject) => {
    const out: PomodoroSession[] = [];
    const tx = db.transaction("sessions", "readonly");
    const idx = tx.objectStore("sessions").index("completedAt");
    const req = idx.openCursor(null, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && out.length < limit) {
        out.push(cursor.value as PomodoroSession);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to read sessions"));
  });
}

export interface PomodoroStats {
  total: number;
  todayCount: number;
  totalMin: number;
}

export async function getPomodoroStats(): Promise<PomodoroStats> {
  const db = await openPomodoroDb();
  const all = await reqAsPromise<PomodoroSession[]>(
    db.transaction("sessions", "readonly").objectStore("sessions").getAll()
  );
  const list = all ?? [];
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: list.length,
    todayCount: list.filter((s) => s.date === today).length,
    totalMin: Math.round(list.reduce((acc, s) => acc + (s.duration || 0), 0) / 60),
  };
}

export async function getPomodoroConfig(): Promise<PomodoroConfig> {
  const db = await openPomodoroDb();
  const records = await reqAsPromise<{ key: keyof PomodoroConfig; value: boolean }[]>(
    db.transaction("config", "readonly").objectStore("config").getAll()
  );
  const cfg: PomodoroConfig = { ...DEFAULT_POMODORO_CONFIG };
  for (const r of records ?? []) {
    if (typeof r.value === "boolean" && r.key in cfg) {
      (cfg as Record<keyof PomodoroConfig, boolean>)[r.key] = r.value;
    }
  }
  return cfg;
}

export async function setPomodoroConfig<K extends keyof PomodoroConfig>(
  key: K,
  value: PomodoroConfig[K]
): Promise<void> {
  const db = await openPomodoroDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("config", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Config tx failed"));
    tx.objectStore("config").put({ key, value });
  });
}
