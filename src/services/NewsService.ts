import type { App } from "obsidian";

export interface NewsItem {
  path: string;
  name: string;
  mtime: number;
  size: number;
}

interface AbstractFileLike {
  path?: string;
  basename?: string;
  children?: unknown[];
  mtime?: number;
  size?: number;
  stat?: { mtime?: number; size?: number };
  extension?: string;
}

function isFolderLike(node: unknown): node is { path: string; children: AbstractFileLike[] } {
  if (!node || typeof node !== "object") return false;
  const obj = node as Record<string, unknown>;
  return Array.isArray(obj.children);
}

function isMarkdownFileLike(node: unknown): node is {
  path: string;
  basename?: string;
  mtime?: number;
  size?: number;
  stat?: { mtime?: number; size?: number };
} {
  if (!node || typeof node !== "object") return false;
  const obj = node as Record<string, unknown>;
  if (typeof obj.path !== "string") return false;
  if (typeof obj.basename !== "string" && typeof obj.mtime !== "number" && typeof obj.stat !== "object") {
    return false;
  }
  return true;
}

function readStat(file: AbstractFileLike, fallback: { mtime: number; size: number }): { mtime: number; size: number } {
  const mtime = file.stat?.mtime;
  const size = file.stat?.size;
  return {
    mtime: typeof mtime === "number" ? mtime : (typeof file.mtime === "number" ? file.mtime : fallback.mtime),
    size: typeof size === "number" ? size : (typeof file.size === "number" ? file.size : fallback.size),
  };
}

export interface NewsService {
  getNewsItems(): Promise<NewsItem[]>;
  getTag(name: string): { label: string; cls: string };
}

export function createNewsService(app: App, folder: string): NewsService {
  function getNewsItems(): Promise<NewsItem[]> {
    return Promise.resolve(listNewsFiles(app, folder));
  }

  return {
    getNewsItems,
    getTag: newsTagFor,
  };
}

export function listNewsFiles(app: App, folder: string): NewsItem[] {
  const target = (folder || "").trim().replace(/^\/+|\/+$/g, "");
  const seen = new Set<string>();
  const items: NewsItem[] = [];

  if (target) {
    const abstract = app.vault.getAbstractFileByPath(target) as AbstractFileLike | null;
    if (abstract && isFolderLike(abstract)) {
      for (const child of abstract.children) {
        if (!isMarkdownFileLike(child)) continue;
        if (!child.path.endsWith(".md")) continue;
        seen.add(child.path);
        const raw = typeof child.basename === "string"
          ? child.basename
          : (child.path.split("/").pop() ?? child.path);
        const basename = raw.replace(/\.md$/, "");
        const stat = readStat(child, { mtime: 0, size: 0 });
        items.push({
          path: child.path,
          name: basename,
          mtime: stat.mtime,
          size: stat.size,
        });
      }
    }
  }

  const cache = app.metadataCache;
  const files = app.vault.getMarkdownFiles();
  for (const file of files as unknown as AbstractFileLike[]) {
    if (typeof file.path !== "string") continue;
    if (seen.has(file.path)) continue;
    const cacheEntry = cache.getFileCache(file as unknown as Parameters<typeof cache.getFileCache>[0]);
    const tags = cacheEntry?.tags;
    const hasNewsTag = Array.isArray(tags) && tags.some((t: { tag?: string }) => t.tag?.toLowerCase() === "#news");
    if (!hasNewsTag) continue;
    seen.add(file.path);
    const rawName = typeof file.basename === "string" ? file.basename : (file.path.split("/").pop() ?? file.path);
    const basename = rawName.replace(/\.md$/, "");
    const stat = readStat(file, { mtime: 0, size: 0 });
    items.push({
      path: file.path,
      name: basename,
      mtime: stat.mtime,
      size: stat.size,
    });
  }

  items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

export function newsTagFor(name: string): { label: string; cls: string } {
  if (/(科技|tech|AI|模型|Claude|GPT)/i.test(name)) return { label: "科技", cls: "tech" };
  if (/(国际|world|美国|欧洲|俄乌)/i.test(name)) return { label: "国际", cls: "world" };
  return { label: "新闻", cls: "" };
}
