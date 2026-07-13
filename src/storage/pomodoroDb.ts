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
  total: number;
  todayCount: number;
  totalMin: number;
}

export interface PomDb {
  open(): Promise<IDBDatabase>;
  addSession(rec: Omit<PomSession, "id">): Promise<void>;
  recent(limit: number): Promise<PomSession[]>;
  stats(): Promise<PomStats>;
  getConfig(): Promise<PomConfig>;
  setConfig(key: keyof PomConfig, value: boolean): Promise<void>;
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
        resolve({
          total: all.length,
          todayCount: all.filter((r) => r.date === today).length,
          totalMin: Math.round(all.reduce((a, b) => a + (b.duration || 0), 0) / 60),
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

  return { open, addSession, recent, stats, getConfig, setConfig };
}
