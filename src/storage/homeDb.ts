// Stub - will be provided by integration agent
export interface TodoRecord {
  id?: number;
  text: string;
  status: "todo" | "done";
  priority: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface LearningRecord {
  id?: number;
  title: string;
  url: string;
  question: string;
  questionType: string;
  correct: boolean;
  userAnswer: string;
  correctAnswer: string;
  createdAt: number;
}

export interface ReadArticleRecord {
  id: string;
  readAt: number;
}

export interface HomeDb {
  open(): Promise<IDBDatabase>;
  getAllTodos(): Promise<TodoRecord[]>;
  addTodo(text: string, priority: string): Promise<void>;
  updateTodo(id: number, patch: Partial<TodoRecord>): Promise<void>;
  deleteTodo(id: number): Promise<void>;
  clearDoneTodos(): Promise<void>;
  getAllLearningRecords(): Promise<LearningRecord[]>;
  addLearningRecord(record: Omit<LearningRecord, "id">): Promise<number>;
  clearLearningRecords(): Promise<void>;
  getAllReadArticleIds(): Promise<string[]>;
  markArticleRead(path: string): Promise<void>;
  clearReadArticles(): Promise<void>;
}

export function createHomeDb(): HomeDb {
  const DB_NAME = "home-db";
  const DB_VERSION = 2;

  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("readArticles")) {
          db.createObjectStore("readArticles", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("todos")) {
          const s = db.createObjectStore("todos", { keyPath: "id", autoIncrement: true });
          s.createIndex("status", "status");
          s.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("reviewState")) {
          db.createObjectStore("reviewState", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("learningRecords")) {
          const s = db.createObjectStore("learningRecords", { keyPath: "id", autoIncrement: true });
          s.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllTodos(): Promise<TodoRecord[]> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("todos", "readonly");
      const req = tx.objectStore("todos").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function addTodo(text: string, priority: string): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("todos", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("todos").add({
        text,
        status: "todo",
        priority,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: null,
      });
    });
  }

  async function updateTodo(id: number, patch: Partial<TodoRecord>): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("todos", "readwrite");
      const store = tx.objectStore("todos");
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const obj = getReq.result;
        if (!obj) { resolve(); return; }
        Object.assign(obj, patch, { updatedAt: Date.now() });
        store.put(obj);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteTodo(id: number): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("todos", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("todos").delete(id);
    });
  }

  async function clearDoneTodos(): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("todos", "readwrite");
      const store = tx.objectStore("todos");
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          if (cursor.value.status === "done") cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllLearningRecords(): Promise<LearningRecord[]> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("learningRecords", "readonly");
      const req = tx.objectStore("learningRecords").getAll();
      req.onsuccess = () => {
        const all = (req.result || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function clearLearningRecords(): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("learningRecords", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("learningRecords").clear();
    });
  }

  async function addLearningRecord(record: Omit<LearningRecord, "id">): Promise<number> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("learningRecords", "readwrite");
      const req = tx.objectStore("learningRecords").add(record);
      req.onsuccess = () => resolve(Number(req.result));
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllReadArticleIds(): Promise<string[]> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("readArticles", "readonly");
      const req = tx.objectStore("readArticles").getAllKeys();
      req.onsuccess = () => resolve((req.result || []).map((k) => String(k)));
      req.onerror = () => reject(req.error);
    });
  }

  async function markArticleRead(path: string): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("readArticles", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("readArticles").put({ id: path, readAt: Date.now() });
    });
  }

  async function clearReadArticles(): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("readArticles", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore("readArticles").clear();
    });
  }

  return {
    open,
    getAllTodos,
    addTodo,
    updateTodo,
    deleteTodo,
    clearDoneTodos,
    getAllLearningRecords,
    addLearningRecord,
    clearLearningRecords,
    getAllReadArticleIds,
    markArticleRead,
    clearReadArticles,
  };
}
