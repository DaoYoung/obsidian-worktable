import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";

export interface NewsItem {
  path: string;
  name: string;
  mtime: number;
  size: number;
}

export function listNewsFiles(app: App, folder: string): NewsItem[] {
  const target = (folder || "").trim().replace(/^\/+|\/+$/g, "");
  const seen = new Set<string>();
  const items: NewsItem[] = [];

  if (target) {
    const abstract = app.vault.getAbstractFileByPath(target);
    if (abstract instanceof TFolder) {
      for (const child of abstract.children) {
        if (!(child instanceof TFile)) continue;
        if (!child.path.endsWith(".md")) continue;
        seen.add(child.path);
        items.push({
          path: child.path,
          name: child.basename,
          mtime: child.stat.mtime,
          size: child.stat.size,
        });
      }
    }
  }

  const cache = app.metadataCache;
  const files = app.vault.getMarkdownFiles();
  for (const file of files) {
    if (seen.has(file.path)) continue;
    const cacheEntry = cache.getFileCache(file);
    const tags = cacheEntry?.tags;
    const hasNewsTag = Array.isArray(tags) && tags.some((t) => t.tag?.toLowerCase() === "#news");
    if (!hasNewsTag) continue;
    seen.add(file.path);
    items.push({
      path: file.path,
      name: file.basename,
      mtime: file.stat.mtime,
      size: file.stat.size,
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
