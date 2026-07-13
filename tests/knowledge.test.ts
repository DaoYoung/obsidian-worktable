import { describe, expect, it } from "vitest";
import {
  inferCategory,
  parseWordFromMd,
  parseKnowledgeMd,
  POS_SECTION,
  reorganizeKpFile,
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
