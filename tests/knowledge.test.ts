import { describe, expect, it } from "vitest";
import {
  inferCategory,
  normalizePos,
  normalizeSubject,
  parseWordFromJson,
  parseWordFromMd,
  parseKnowledgeMd,
  POS_SECTION,
  reorganizeKpFile,
  reorganizeKpFileWithOptions,
  sectionTargetName,
  splitSections,
} from "../src/services/KnowledgeService";

describe("KnowledgeService - inferCategory", () => {
  it("detects English words", () => {
    expect(inferCategory("ephemeral", "anything")).toBe("word");
  });

  it("detects math by latex", () => {
    expect(inferCategory("极限", "$\\dfrac{a}{b}$")).toBe("math");
  });

  it("detects math by unicode", () => {
    expect(inferCategory("微积分", "∫ f(x) dx = F(x)")).toBe("math");
  });

  it("falls back to misc", () => {
    expect(inferCategory("蒙特卡洛方法", "随机抽样估计值")).toBe("misc");
  });
});

describe("KnowledgeService - parseWordFromMd", () => {
  it("parses (n.) form", () => {
    const md = "ephemeral (n.) 短暂的；瞬息的";
    const parsed = parseWordFromMd("ephemeral", md);
    expect(parsed?.name).toBe("ephemeral");
    expect(parsed?.pos).toBe("n.");
    expect(parsed?.def).toContain("短暂");
  });

  it("parses v. form", () => {
    const md = "abandon (v.) 放弃";
    expect(parseWordFromMd("abandon", md)).toEqual({ name: "abandon", pos: "v.", def: "放弃" });
  });

  it("returns null for non-word names", () => {
    expect(parseWordFromMd("随机过程", "随机过程是一种数学...")).toBeNull();
  });

  it("falls back to n. for bare English name", () => {
    const parsed = parseWordFromMd("lumen", "光通量单位");
    expect(parsed?.pos).toBe("n.");
    expect(parsed?.def).toContain("光通量");
  });
});

describe("KnowledgeService - splitSections", () => {
  it("splits by H2 boundaries", () => {
    const text = "# Title\n\npreamble\n\n## A\n\nbody a\n\n## B\n\nbody b\n";
    const { pre, sections } = splitSections(text);
    expect(pre.startsWith("# Title")).toBe(true);
    expect(sections.length).toBe(2);
    expect(sections[0]?.text.startsWith("## A")).toBe(true);
    expect(sections[1]?.text.startsWith("## B")).toBe(true);
  });

  it("returns no sections when only preamble", () => {
    const { pre, sections } = splitSections("hello world");
    expect(pre).toBe("hello world");
    expect(sections.length).toBe(0);
  });
});

describe("KnowledgeService - POS_SECTION", () => {
  it("covers the expected pos list", () => {
    expect(POS_SECTION["n."]).toBe("### 1.1 名词（n.）");
    expect(POS_SECTION["v."]).toBe("### 1.2 动词（v.）");
    expect(POS_SECTION.misc).toBe("### 1.4 其他");
  });
});

describe("KnowledgeService - reorganizeKpFile - word", () => {
  const seed = [
    "# Knowledge",
    "",
    "## 一、英文词汇",
    "",
    "> 收录日常英文词汇",
    "",
    "### 1.1 名词（n.）",
    "",
    "| 单词 | 释义 |",
    "|:----:|------|",
    "| alpha | 第一 |",
    "",
    "## 二、数学知识点",
    "",
    "### 1.1 极限",
    "",
    "极限描述趋近行为。",
    "",
    "## 三、更新记录",
    "",
    "| 日期 | 内容 |",
    "|:----:|------|",
    "",
  ].join("\n");

  it("appends a word to existing subsection", () => {
    const { text, fallback } = reorganizeKpFile(seed, "word", "beta", "beta (n.) 第二");
    expect(fallback).toBeNull();
    expect(text).toContain("| alpha | 第一 |");
    expect(text).toContain("| beta | 第二 |");
  });

  it("creates a new subsection when target is missing", () => {
    const { text } = reorganizeKpFile(seed, "word", "run", "run (v.) 跑");
    expect(text).toContain("### 1.2 动词（v.）");
    expect(text).toContain("| run | 跑 |");
  });

  it("falls back to misc when parseWordFromMd fails", () => {
    const { text, fallback } = reorganizeKpFile(seed, "word", "随机过程", "这是一段中文，没有词性标注");
    expect(fallback).toBe("misc");
    expect(text).toContain("## 四、随手记");
  });
});

describe("KnowledgeService - reorganizeKpFile - math", () => {
  const seed = [
    "# Knowledge",
    "",
    "## 二、数学知识点",
    "",
    "### 1.1 极限",
    "",
    "极限描述趋近行为。",
    "",
    "## 三、更新记录",
    "",
  ].join("\n");

  it("appends a math entry with new number", () => {
    const { text } = reorganizeKpFile(seed, "math", "导数", "导数是变化率");
    expect(text).toContain("### 2.1 导数");
    expect(text).toContain("变化率");
  });

  it("falls back to misc when math section missing", () => {
    const { fallback } = reorganizeKpFile("# Knowledge\n", "math", "导数", "变化率");
    expect(fallback).toBe("misc");
  });
});

describe("KnowledgeService - reorganizeKpFile - misc", () => {
  it("creates a new misc section before update log", () => {
    const text = ["# K", "", "## 三、更新记录", "", "| 日期 | 内容 |", "|:----:|------|"].join("\n");
    const { text: out } = reorganizeKpFile(text, "misc", "番茄", "使用番茄工作法");
    expect(out.indexOf("## 四、随手记")).toBeLessThan(out.indexOf("## 三、更新记录"));
    expect(out).toContain("番茄");
  });
});

describe("KnowledgeService - sectionTargetName", () => {
  it("returns 英文词汇 for new word", () => {
    expect(sectionTargetName("any text", "word", "beta")).toBe("英文词汇");
  });
  it("returns 数学知识点 for math category", () => {
    expect(sectionTargetName("any text", "math", "导数")).toBe("数学知识点");
  });
  it("returns 随手记 for misc", () => {
    expect(sectionTargetName("any text", "misc", "番茄")).toBe("随手记");
  });
});

describe("KnowledgeService - parseKnowledgeMd", () => {
  it("extracts words and math entries", () => {
    const md = [
      "# Knowledge",
      "",
      "## 一、英文词汇",
      "",
      "| 单词 | 释义 |",
      "|:----:|------|",
      "| alpha | 第一 |",
      "| beta | 第二 |",
      "",
      "## 二、数学知识点",
      "",
      "### 1.1 极限",
      "",
      "极限描述趋近行为。",
      "",
    ].join("\n");
    const out = parseKnowledgeMd(md);
    expect(out.words.length).toBe(2);
    expect(out.words[0]?.name).toBe("alpha");
    expect(out.maths.length).toBe(1);
    expect(out.maths[0]?.title).toBe("1.1 极限");
    expect(out.maths[0]?.id).toBe("m01");
  });

  it("returns empty arrays on empty input", () => {
    expect(parseKnowledgeMd("").words.length).toBe(0);
    expect(parseKnowledgeMd("").maths.length).toBe(0);
  });
});

describe("KnowledgeService - normalizeSubject / normalizePos", () => {
  it("maps free-form subject strings to canonical labels", () => {
    expect(normalizeSubject("物理")).toBe("物理");
    expect(normalizeSubject("英 词汇")).toBe("英文词汇");
    expect(normalizeSubject("数学知识")).toBe("数学");
    expect(normalizeSubject("nonsense", "其他")).toBe("其他");
    expect(normalizeSubject("")).toBe("其他");
  });

  it("normalizes part-of-speech tokens", () => {
    expect(normalizePos("noun")).toBe("n.");
    expect(normalizePos("v")).toBe("v.");
    expect(normalizePos("adj.")).toBe("adj.");
    expect(normalizePos("副词")).toBe("adv.");
    expect(normalizePos("")).toBe("");
  });
});

describe("KnowledgeService - parseWordFromJson", () => {
  it("parses translation + pos from /ai/expand payload", () => {
    const payload = JSON.stringify({
      subject: "英文词汇",
      translation: "短暂的；瞬息的",
      pos: "adj.",
      definition: "持续时间很短",
    });
    const parsed = parseWordFromJson("ephemeral", payload);
    expect(parsed?.name).toBe("ephemeral");
    expect(parsed?.pos).toBe("adj.");
    expect(parsed?.def).toContain("短暂");
  });

  it("handles code-fenced JSON output", () => {
    const payload = "```json\n" + JSON.stringify({ translation: "放弃", pos: "v." }) + "\n```";
    const parsed = parseWordFromJson("abandon", payload);
    expect(parsed?.def).toBe("放弃");
    expect(parsed?.pos).toBe("v.");
  });

  it("falls back to definition when translation missing", () => {
    const payload = JSON.stringify({ definition: "光通量单位" });
    const parsed = parseWordFromJson("lumen", payload);
    expect(parsed?.def).toBe("光通量单位");
    expect(parsed?.pos).toBe("n.");
  });

  it("returns null when content has neither translation nor definition", () => {
    const payload = JSON.stringify({ unrelated: true });
    expect(parseWordFromJson("ephemeral", payload)).toBeNull();
  });
});

describe("KnowledgeService - reorganizeKpFile - subject (dynamic sections)", () => {
  const seed = [
    "# Knowledge",
    "",
    "## 一、英文词汇",
    "",
    "### 1.1 名词（n.）",
    "",
    "| 单词 | 释义 |",
    "|:----:|------|",
    "",
    "## 二、数学知识点",
    "",
    "### 1.1 极限",
    "",
    "极限描述趋近行为。",
    "",
    "## 三、更新记录",
    "",
    "| 日期 | 内容 |",
    "|:----:|------|",
    "",
  ].join("\n");

  it("creates a new subject section before the update log", () => {
    const { text, fallback } = reorganizeKpFileWithOptions(seed, {
      category: "subject",
      name: "牛顿第一定律",
      content: "任何物体都要保持匀速直线运动或静止状态。",
      subject: "物理",
    });
    expect(fallback).toBeNull();
    expect(text).toContain("## 物理");
    expect(text).toContain("### 1.1 牛顿第一定律");
    // Update log must remain the last section.
    expect(text.indexOf("## 三、更新记录")).toBeGreaterThan(text.indexOf("## 物理"));
    // 物理 must appear before the update log.
    expect(text.indexOf("## 物理")).toBeLessThan(text.indexOf("## 三、更新记录"));
  });

  it("appends additional entries to an existing subject section", () => {
    const first = reorganizeKpFileWithOptions(seed, {
      category: "subject",
      name: "牛顿第一定律",
      content: "保持匀速直线运动或静止状态。",
      subject: "物理",
    }).text;
    const second = reorganizeKpFileWithOptions(first, {
      category: "subject",
      name: "牛顿第二定律",
      content: "F = ma。",
      subject: "物理",
    }).text;
    expect(second).toContain("### 1.1 牛顿第一定律");
    expect(second).toContain("### 2.1 牛顿第二定律");
    // Only one physics section heading.
    expect((second.match(/^## 物理$/gm) ?? []).length).toBe(1);
  });

  it("creates a dynamic section for arbitrary AI-returned subjects", () => {
    const { text, fallback } = reorganizeKpFileWithOptions(seed, {
      category: "subject",
      name: "杂项",
      content: "随便记",
      subject: "Mystery Discipline 9999",
    });
    // Subject names are now dynamic — arbitrary labels create their own
    // `## <subject>` heading rather than falling back to 随手记.
    expect(fallback).toBeNull();
    expect(text).toContain("## Mystery Discipline 9999");
    expect(text).toContain("### 1.1 杂项");
    expect(text.indexOf("## Mystery Discipline 9999")).toBeLessThan(
      text.indexOf("## 三、更新记录")
    );
  });
});

describe("KnowledgeService - word entry uses explicit translation/pos", () => {
  it("inserts a word row from explicit translation even when content is markdown-only", () => {
    const seed = [
      "# K",
      "",
      "## 一、英文词汇",
      "",
      "### 1.4 其他",
      "",
      "| 单词 | 释义 |",
      "|:----:|------|",
      "",
      "## 三、更新记录",
      "",
      "| 日期 | 内容 |",
      "|:----:|------|",
    ].join("\n");
    const { text, fallback } = reorganizeKpFileWithOptions(seed, {
      category: "word",
      name: "ephemeral",
      content: "## 是什么\n持续时间很短",
      translation: "短暂的；瞬息的",
      pos: "adj.",
    });
    expect(fallback).toBeNull();
    expect(text).toContain("| ephemeral | 短暂的；瞬息的 |");
    // The adj. subsection is missing, so it should be created.
    expect(text).toContain("### 1.3 形容词（adj.）");
  });

  it("extracts translation from JSON content when explicit field is absent", () => {
    const seed = [
      "# K",
      "",
      "## 一、英文词汇",
      "",
      "### 1.4 其他",
      "",
      "| 单词 | 释义 |",
      "|:----:|------|",
      "",
    ].join("\n");
    const json = JSON.stringify({ subject: "英文词汇", translation: "放弃", pos: "v." });
    const { text, fallback } = reorganizeKpFileWithOptions(seed, {
      category: "word",
      name: "abandon",
      content: json,
    });
    expect(fallback).toBeNull();
    expect(text).toContain("| abandon | 放弃 |");
    expect(text).toContain("### 1.2 动词（v.）");
  });
});

describe("KnowledgeService - parseKnowledgeMd - subject sections", () => {
  it("extracts subject knowledge entries into a separate pool", () => {
    const md = [
      "# Knowledge",
      "",
      "## 一、英文词汇",
      "",
      "### 1.1 名词（n.）",
      "",
      "| 单词 | 释义 |",
      "|:----:|------|",
      "| alpha | 第一 |",
      "",
      "## 二、数学知识点",
      "",
      "### 1.1 极限",
      "",
      "极限描述趋近行为。",
      "",
      "## 物理",
      "",
      "> 本节收录物理相关知识",
      "",
      "### 1.1 牛顿第一定律",
      "",
      "保持匀速直线运动。",
      "",
      "### 2.1 牛顿第二定律",
      "",
      "F = ma。",
      "",
      "## 化学",
      "",
      "### 1.1 水的分子式",
      "",
      "H₂O。",
      "",
      "## 三、更新记录",
      "",
      "| 日期 | 内容 |",
      "|:----:|------|",
      "",
    ].join("\n");
    const out = parseKnowledgeMd(md);
    expect(out.words.length).toBe(1);
    expect(out.maths.length).toBe(1);
    expect(out.subjects.length).toBe(3);
    const physics = out.subjects.filter((s) => s.subject === "物理");
    const chemistry = out.subjects.filter((s) => s.subject === "化学");
    expect(physics.length).toBe(2);
    expect(chemistry.length).toBe(1);
    expect(physics[0]?.title).toBe("1.1 牛顿第一定律");
    expect(physics[1]?.title).toBe("2.1 牛顿第二定律");
    expect(chemistry[0]?.title).toBe("1.1 水的分子式");
    // IDs are unique and prefixed.
    const ids = new Set(out.subjects.map((s) => s.id));
    expect(ids.size).toBe(out.subjects.length);
    for (const s of out.subjects) expect(s.id.startsWith("s")).toBe(true);
  });
});
