export const HOME_DB_NAME = "home-db";
export const HOME_DB_VERSION = 2;

export const HOME_STORES = ["readArticles", "todos", "reviewState", "learningRecords"] as const;
export type HomeStoreName = (typeof HOME_STORES)[number];

export interface ReadArticleRecord {
  id: string;
  readAt: number;
}

export type TodoStatus = "todo" | "done";

export interface TodoRecord {
  id?: number;
  text: string;
  status: TodoStatus;
  priority: "P0" | "P1" | "P2" | "P3";
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface ReviewStateRecord {
  key: string;
  value: unknown;
}

export interface LearningRecord {
  id?: number;
  url: string;
  title: string;
  questionType: string;
  question: string;
  correctAnswer: string;
  userAnswer: string;
  correct: boolean;
  createdAt: number;
  dateKey: string;
}

export interface HomeDb {
  raw: IDBDatabase;
  close: () => void;
}

let openPromise: Promise<IDBDatabase> | null = null;

function ensureStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains("readArticles")) {
    db.createObjectStore("readArticles", { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains("todos")) {
    const store = db.createObjectStore("todos", { keyPath: "id", autoIncrement: true });
    store.createIndex("status", "status");
    store.createIndex("createdAt", "createdAt");
  }
  if (!db.objectStoreNames.contains("reviewState")) {
    db.createObjectStore("reviewState", { keyPath: "key" });
  }
  if (!db.objectStoreNames.contains("learningRecords")) {
    const store = db.createObjectStore("learningRecords", { keyPath: "id", autoIncrement: true });
    store.createIndex("createdAt", "createdAt");
  }
}

export function openHomeDb(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }
    const req = indexedDB.open(HOME_DB_NAME, HOME_DB_VERSION);
    req.onupgradeneeded = (event) => {
      const target = event.target as IDBOpenDBRequest;
      ensureStores(target.result);
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
    req.onerror = () => reject(req.error ?? new Error("Failed to open home-db"));
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
  return openPromise;
}

export function resetHomeDbCache(): void {
  openPromise = null;
}

function runTx<T>(
  db: IDBDatabase,
  store: HomeStoreName,
  mode: IDBTransactionMode,
  fn: (objectStore: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const objectStore = tx.objectStore(store);
    let settled = false;
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(request.result);
    };
    tx.onerror = () => {
      if (settled) return;
      settled = true;
      reject(tx.error ?? new Error("IDB transaction failed"));
    };
    const request = fn(objectStore);
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("IDB request failed"));
    };
  });
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB request failed"));
  });
}

export async function getAllReadArticleIds(): Promise<string[]> {
  const db = await openHomeDb();
  const tx = db.transaction("readArticles", "readonly");
  const keys = await reqAsPromise<IDBValidKey[]>(tx.objectStore("readArticles").getAllKeys());
  return (keys ?? []).map((k) => String(k));
}

export async function markArticleRead(path: string): Promise<void> {
  const db = await openHomeDb();
  await runTx(db, "readArticles", "readwrite", (store) =>
    store.put({ id: path, readAt: Date.now() } satisfies ReadArticleRecord)
  );
}

export async function clearReadArticles(): Promise<void> {
  const db = await openHomeDb();
  await runTx(db, "readArticles", "readwrite", (store) => store.clear());
}

export async function listTodos(): Promise<TodoRecord[]> {
  const db = await openHomeDb();
  const records = await reqAsPromise<TodoRecord[]>(
    db.transaction("todos", "readonly").objectStore("todos").getAll()
  );
  return records ?? [];
}

export async function addTodo(record: Omit<TodoRecord, "id" | "createdAt" | "updatedAt" | "completedAt">): Promise<number> {
  const db = await openHomeDb();
  const now = Date.now();
  const full: TodoRecord = {
    text: record.text,
    status: record.status,
    priority: record.priority,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction("todos", "readwrite");
    const req = tx.objectStore("todos").add(full);
    req.onsuccess = () => resolve(Number(req.result));
    req.onerror = () => reject(req.error ?? new Error("Failed to add todo"));
    tx.onerror = () => reject(tx.error ?? new Error("Todo tx failed"));
  });
}

export async function updateTodo(id: number, patch: Partial<Omit<TodoRecord, "id">>): Promise<void> {
  const db = await openHomeDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    const get = store.get(id);
    get.onsuccess = () => {
      const current = get.result as TodoRecord | undefined;
      if (!current) {
        resolve();
        return;
      }
      const next: TodoRecord = { ...current, ...patch, updatedAt: Date.now() };
      store.put(next);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to update todo"));
  });
}

export async function deleteTodo(id: number): Promise<void> {
  const db = await openHomeDb();
  await runTx(db, "todos", "readwrite", (store) => store.delete(id));
}

export async function clearCompletedTodos(): Promise<void> {
  const db = await openHomeDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("todos", "readwrite");
    const store = tx.objectStore("todos");
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const value = cursor.value as TodoRecord;
        if (value.status === "done") cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear completed todos"));
  });
}

export async function getReviewState<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openHomeDb();
  const record = await runTx<ReviewStateRecord | undefined>(db, "reviewState", "readonly", (store) => store.get(key));
  return (record?.value as T | undefined) ?? undefined;
}

export async function setReviewState(key: string, value: unknown): Promise<void> {
  const db = await openHomeDb();
  await runTx(db, "reviewState", "readwrite", (store) =>
    store.put({ key, value } satisfies ReviewStateRecord)
  );
}

export async function listLearningRecords(): Promise<LearningRecord[]> {
  const db = await openHomeDb();
  const records = await runTx<LearningRecord[]>(db, "learningRecords", "readonly", (store) =>
    store.index("createdAt").getAll()
  );
  return (records ?? []).slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function addLearningRecord(record: Omit<LearningRecord, "id">): Promise<number> {
  const db = await openHomeDb();
  return runTx<IDBValidKey>(db, "learningRecords", "readwrite", (store) => store.add(record)).then((id) => Number(id));
}

export async function clearLearningRecords(): Promise<void> {
  const db = await openHomeDb();
  await runTx(db, "learningRecords", "readwrite", (store) => store.clear());
}
