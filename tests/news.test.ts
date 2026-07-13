import { describe, expect, it } from "vitest";
import { listNewsFiles, newsTagFor } from "../src/services/NewsService";

class FakeFile {
  constructor(public path: string, public mtime: number) {}
}

class FakeFolder {
  constructor(public path: string, public children: unknown[]) {}
}

interface FakeApp {
  vault: {
    getAbstractFileByPath: (path: string) => unknown;
    getMarkdownFiles: () => FakeFile[];
  };
  metadataCache: {
    getFileCache: (file: FakeFile) => { tags?: { tag: string }[] } | null;
  };
}

function makeApp(opts: { folder?: FakeFolder; files?: FakeFile[]; tagsByPath?: Record<string, string[]> }): FakeApp {
  return {
    vault: {
      getAbstractFileByPath: (path: string) => (opts.folder && opts.folder.path === path ? opts.folder : null),
      getMarkdownFiles: () => opts.files ?? [],
    },
    metadataCache: {
      getFileCache: (file: FakeFile) => {
        const tags = opts.tagsByPath?.[file.path];
        if (!tags) return null;
        return { tags: tags.map((t) => ({ tag: t })) };
      },
    },
  };
}

describe("NewsService - listNewsFiles", () => {
  it("returns files from the configured folder sorted by mtime desc", () => {
    const folder = new FakeFolder("news", [
      new FakeFile("news/a.md", 1000),
      new FakeFile("news/b.md", 3000),
      new FakeFile("news/c.md", 2000),
    ]);
    const app = makeApp({ folder: folder as unknown as FakeFolder });
    const items = listNewsFiles(app as never, "news");
    expect(items.map((i) => i.name)).toEqual(["b", "c", "a"]);
  });

  it("falls back to #news tag when folder is missing", () => {
    const files = [
      new FakeFile("notes/x.md", 1000),
      new FakeFile("notes/y.md", 2000),
      new FakeFile("notes/z.md", 3000),
    ];
    const app = makeApp({
      files,
      tagsByPath: {
        "notes/x.md": ["#news"],
        "notes/y.md": ["#other"],
        "notes/z.md": ["#news", "#world"],
      },
    });
    const items = listNewsFiles(app as never, "news");
    expect(items.length).toBe(2);
    expect(items[0]?.path).toBe("notes/z.md");
    expect(items[1]?.path).toBe("notes/x.md");
  });

  it("deduplicates when the same file is in folder and has #news tag", () => {
    const folder = new FakeFolder("news", [new FakeFile("news/dup.md", 1500)]);
    const files = [new FakeFile("news/dup.md", 1500)];
    const app = makeApp({
      folder: folder as unknown as FakeFolder,
      files,
      tagsByPath: { "news/dup.md": ["#news"] },
    });
    const items = listNewsFiles(app as never, "news");
    expect(items.length).toBe(1);
  });

  it("returns empty list when no folder and no tag matches", () => {
    const files = [new FakeFile("notes/a.md", 1)];
    const app = makeApp({ files, tagsByPath: { "notes/a.md": ["#journal"] } });
    expect(listNewsFiles(app as never, "news").length).toBe(0);
  });
});

describe("NewsService - newsTagFor", () => {
  it("returns tech for AI/tech names", () => {
    expect(newsTagFor("Claude 4 release").cls).toBe("tech");
    expect(newsTagFor("Claude 4 release").label).toBe("科技");
  });
  it("returns world for world news", () => {
    expect(newsTagFor("美国大选").cls).toBe("world");
  });
  it("returns default 新闻 otherwise", () => {
    expect(newsTagFor("本地新闻").label).toBe("新闻");
  });
});
