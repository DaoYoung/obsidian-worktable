import type { App } from "obsidian";

export type KnowledgeCategory = "word" | "math" | "misc";

export interface ParsedWord {
  name: string;
  pos: string;
  def: string;
}

export interface ReorganizeResult {
  text: string;
  fallback: KnowledgeCategory | null;
}

export const POS_SECTION: Record<string, string> = {
  "n.": "### 1.1 名词（n.）",
  "v.": "### 1.2 动词（v.）",
  "adj.": "### 1.3 形容词（adj.）",
  "adv.": "### 1.4 其他",
  "prep.": "### 1.4 其他",
  "conj.": "### 1.4 其他",
  "pron.": "### 1.4 其他",
  "num.": "### 1.4 其他",
  "art.": "### 1.4 其他",
  "aux.": "### 1.4 其他",
  "interj.": "### 1.4 其他",
  "misc": "### 1.4 其他",
};

const POS_PATTERN = /\b([A-Za-z][A-Za-z'\-]{0,30})\s*[\(（]\s*(n\.|v\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|art\.|aux\.|interj\.)\s*[\)）]/;
const DEFINITION_PATTERN = /(?:释义|##\s*是什么|关键要点)[:：]?\s*\n+\s*([^\n#*`>|-]+)/;
const FIRST_LINE_PATTERN = /^([^\n#*`>|-]+)/m;
const MATH_LATEX_PATTERN = /\$\$?[\s\S]+?\$\$?|\\(dfrac|sqrt|frac|pm|neq|geq|leq|Delta|varphi|sum|int|to|infty)/;
const MATH_UNICODE_PATTERN = /[∂∑∫∏√±×÷≠≈≤≥∞→←⇒]/;
const H2_SECTION_PATTERN = /^##\s.+/m;
const H2_SPLIT_PATTERN = /(?=^##\s)/m;
const H3_SPLIT_PATTERN = /(?=^###\s)/m;
const H2_WORDS_PATTERN = /^##\s*一、英文词汇/m;
const H2_MATH_PATTERN = /^##\s*二、数学知识点/m;
const H2_MISC_PATTERN = /^##\s*四、随手记/m;
const H2_UPDATE_PATTERN = /^##\s*三、更新记录/m;

const TABLE_LINE_PATTERN = /^\s*\|/;

export function inferCategory(name: string, markdown: string): KnowledgeCategory {
  const trimmed = (name || "").trim();
  if (/^[A-Za-z][A-Za-z'\-]{0,30}$/.test(trimmed) && !/[一-龥\s]/.test(trimmed)) {
    return "word";
  }
  if (MATH_LATEX_PATTERN.test(markdown) || MATH_UNICODE_PATTERN.test(markdown)) {
    return "math";
  }
  return "misc";
}

export function parseWordFromMd(name: string, md: string): ParsedWord | null {
  const text = md || "";
  const match = text.match(POS_PATTERN);
  if (match) {
    const word = (match[1] || "").trim();
    const pos = (match[2] || "").trim();
    let def = "";
    const labeled = text.match(DEFINITION_PATTERN);
    if (labeled && labeled[1]) {
      def = labeled[1].trim();
    } else {
      const tail = text
        .slice((match.index ?? 0) + match[0].length)
        .replace(/^[\s)）:：]+/, "")
        .split(/\r?\n/)[0]
        ?.trim();
      if (tail) def = tail;
    }
    return { name: word, pos, def };
  }
  if (/^[A-Za-z][A-Za-z'\-]{0,30}$/.test(name)) {
    let def = "";
    const labeled = text.match(DEFINITION_PATTERN);
    if (labeled && labeled[1]) {
      def = labeled[1].trim();
    } else {
      const fl = text.match(FIRST_LINE_PATTERN);
      if (fl && fl[1]) def = fl[1].trim();
    }
    return { name: name.trim(), pos: "n.", def };
  }
  return null;
}

export interface KnowledgeSection {
  text: string;
}

export interface KnowledgeSplit {
  pre: string;
  sections: KnowledgeSection[];
}

export function splitSections(input: string): KnowledgeSplit {
  if (!input) {
    return { pre: "", sections: [] };
  }
  const firstMatch = H2_SECTION_PATTERN.exec(input);
  const firstIndex = firstMatch ? firstMatch.index : -1;
  const pre = firstIndex >= 0 ? input.slice(0, firstIndex) : input;
  const rest = firstIndex >= 0 ? input.slice(firstIndex) : "";
  const parts = rest ? rest.split(H2_SPLIT_PATTERN) : [];
  const sections = parts
    .filter((s) => /^##\s/.test(s))
    .map((s) => ({ text: s.replace(/\n+$/, "") }));
  return { pre, sections };
}

function findSection(sections: KnowledgeSection[], pattern: RegExp): number {
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (section && pattern.test(section.text)) return i;
  }
  return -1;
}

function findSubsection(sections: KnowledgeSection[], targetTitle: string): number {
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section) continue;
    const firstLine = section.text.split("\n")[0] || "";
    if (firstLine.trim() === targetTitle) return i;
  }
  return -1;
}

function appendTableRow(section: KnowledgeSection, row: string): KnowledgeSection {
  const lines = section.text.split("\n");
  let lastTableLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (TABLE_LINE_PATTERN.test(lines[i] || "")) {
      lastTableLine = i;
      break;
    }
  }
  if (lastTableLine < 0) {
    lines.push("| 单词 | 释义 |", "|:----:|------|", row);
  } else {
    lines.splice(lastTableLine + 1, 0, row);
  }
  return { text: lines.join("\n") };
}

function buildWordRow(word: ParsedWord): string {
  return `| ${word.name} | ${word.def.replace(/\|/g, "\\|")} |`;
}

function updateLogRow(date: string, time: string, name: string, category: KnowledgeCategory): string {
  const label = { word: "英文词汇", math: "数学知识点", misc: "随手记" }[category];
  return `| ${date} ${time} | 新增 **${name}** · ${label} |`;
}

function appendUpdateLog(sections: KnowledgeSection[], row: string): void {
  const idx = findSection(sections, H2_UPDATE_PATTERN);
  if (idx < 0) return;
  const section = sections[idx];
  if (!section) return;
  sections[idx] = appendTableRow(section, row);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sectionTargetName(text: string, category: KnowledgeCategory, name: string): string {
  if (category === "word") {
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] || "";
      if (line.includes(name) && TABLE_LINE_PATTERN.test(line)) {
        for (let j = i - 1; j >= 0; j--) {
          const prev = lines[j] || "";
          if (/^###\s/.test(prev)) return prev.replace(/^###\s*/, "").trim();
        }
        break;
      }
    }
    return "英文词汇";
  }
  if (category === "math") {
    const m = text.match(new RegExp(`^###\\s+(\\d+\\.\\d+\\s+${escapeRegex(name)})`, "m"));
    return m && m[1] ? m[1] : "数学知识点";
  }
  return "随手记";
}

export function reorganizeKpFile(
  text: string,
  category: KnowledgeCategory,
  name: string,
  content: string
): ReorganizeResult {
  const { pre, sections } = splitSections(text || "");
  const stamp = new Date().toISOString().slice(0, 10);
  const stampTime = new Date().toTimeString().slice(0, 5);
  const finalSections = sections.map((s) => ({ text: s.text }));

  if (category === "word") {
    const parsed = parseWordFromMd(name, content);
    if (!parsed) {
      const miscResult = reorganizeKpFile(text, "misc", name, content);
      return { text: miscResult.text, fallback: "misc" };
    }
    const wordSecIdx = findSection(finalSections, H2_WORDS_PATTERN);
    if (wordSecIdx < 0) {
      const miscResult = reorganizeKpFile(text, "misc", name, content);
      return { text: miscResult.text, fallback: "misc" };
    }
    const targetTitle = POS_SECTION[parsed.pos] ?? POS_SECTION.misc ?? "### 1.4 其他";
    const wordSection = finalSections[wordSecIdx];
    if (!wordSection) {
      const miscResult = reorganizeKpFile(text, "misc", name, content);
      return { text: miscResult.text, fallback: "misc" };
    }
    const h3Match = H3_SPLIT_PATTERN.exec(wordSection.text);
    const h3Index = h3Match ? h3Match.index : -1;
    const prefix = h3Index >= 0 ? wordSection.text.slice(0, h3Index) : wordSection.text;
    const subText = h3Index >= 0 ? wordSection.text.slice(h3Index) : "";
    const subs = subText ? subText.split(H3_SPLIT_PATTERN) : [];
    const filteredSubs = subs
      .filter((s) => /^###\s/.test(s))
      .map((s) => ({ text: s.replace(/\n+$/, "") }));
    const targetIdx = findSubsection(filteredSubs, targetTitle);
    const newRow = buildWordRow(parsed);
    let newSubs: KnowledgeSection[];
    if (targetIdx < 0) {
      newSubs = [
        ...filteredSubs,
        { text: `${targetTitle}\n\n| 单词 | 释义 |\n|:----:|------|\n${newRow}` },
      ];
    } else {
      const target = filteredSubs[targetIdx];
      if (target) {
        const updated = appendTableRow(target, newRow);
        newSubs = filteredSubs.map((s, i) => (i === targetIdx ? updated : s));
      } else {
        newSubs = filteredSubs;
      }
    }
    finalSections[wordSecIdx] = { text: prefix + newSubs.map((s) => s.text).join("\n\n") };
  } else if (category === "math") {
    const mathSecIdx = findSection(finalSections, H2_MATH_PATTERN);
    if (mathSecIdx < 0) {
      const miscResult = reorganizeKpFile(text, "misc", name, content);
      return { text: miscResult.text, fallback: "misc" };
    }
    const mathSection = finalSections[mathSecIdx];
    if (!mathSection) {
      const miscResult = reorganizeKpFile(text, "misc", name, content);
      return { text: miscResult.text, fallback: "misc" };
    }
    const numRe = /^###\s*(\d+)\.(\d+)\s+/gm;
    let maxN = 0;
    let mm: RegExpExecArray | null;
    while ((mm = numRe.exec(mathSection.text)) !== null) {
      const first = mm[1];
      if (first) maxN = Math.max(maxN, parseInt(first, 10));
    }
    const newN = maxN + 1;
    const body = (content || "").trim();
    const block = `### ${newN}.1 ${name}\n\n${body}\n`;
    finalSections[mathSecIdx] = { text: mathSection.text + "\n\n" + block };
  } else {
    const stampDate = new Date().toISOString().slice(0, 10);
    const block = `### ${stampDate} ${name}\n\n${(content || "").trim()}\n`;
    const miscIdx = findSection(finalSections, H2_MISC_PATTERN);
    if (miscIdx < 0) {
      const newMiscSection: KnowledgeSection = {
        text: `## 四、随手记\n\n> 本节收录通用笔记,按录入时间倒序排列(最新在上)。\n\n${block}`,
      };
      const updateIdx = findSection(finalSections, H2_UPDATE_PATTERN);
      if (updateIdx < 0) {
        finalSections.push(newMiscSection);
      } else {
        finalSections.splice(updateIdx, 0, newMiscSection);
      }
    } else {
      const miscSection = finalSections[miscIdx];
      if (miscSection) {
        const lines = miscSection.text.split("\n");
        let insertAt = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] || "";
          if (/^##\s/.test(line)) insertAt = i + 1;
          else if (/^>/.test(line) || line.trim() === "") insertAt = i + 1;
          else break;
        }
        lines.splice(insertAt, 0, block);
        finalSections[miscIdx] = { text: lines.join("\n") };
      }
    }
  }

  const finalCategory: KnowledgeCategory = category;
  appendUpdateLog(
    finalSections,
    updateLogRow(stamp, stampTime, name, finalCategory)
  );
  const joined = pre + finalSections.map((s) => s.text).join("\n\n");
  return { text: joined + (joined.length && !joined.endsWith("\n") ? "\n" : ""), fallback: null };
}

export interface ParsedKnowledge {
  words: Array<{ id: string; name: string; pos: string; def: string }>;
  maths: Array<{ id: string; title: string; def: string }>;
}

const WORD_TABLE_ROW = /^\|\s*([A-Za-z][A-Za-z\s'-]*?)\s*\|\s*([^|\n]+?)\s*(?:\|.*)?$/gm;
const H2_WORDS_CAPTURE = /##\s*一、英文词汇([\s\S]*?)(?=\n##\s|\s*$)/;
const H2_MATH_CAPTURE = /##\s*二、数学知识点([\s\S]*?)(?=\n##\s|\s*$)/;
const MATH_CHUNK_SPLIT = /\n###\s+/;

export function parseKnowledgeMd(text: string): ParsedKnowledge {
  const out: ParsedKnowledge = { words: [], maths: [] };
  if (!text) return out;
  const wordSec = text.match(H2_WORDS_CAPTURE);
  if (wordSec && wordSec[1]) {
    const rows = wordSec[1].matchAll(WORD_TABLE_ROW);
    for (const r of rows) {
      const name = (r[1] || "").trim();
      const def = (r[2] || "").trim();
      if (!name || name.toLowerCase() === "单词") continue;
      out.words.push({ id: "", name, pos: "n.", def });
    }
  }
  const mathSec = text.match(H2_MATH_CAPTURE);
  if (mathSec && mathSec[1]) {
    const chunks = mathSec[1].split(MATH_CHUNK_SPLIT).slice(1);
    for (const chunk of chunks) {
      const nl = chunk.search(/\n/);
      const title = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
      const def = (nl < 0 ? "" : chunk.slice(nl + 1)).trim();
      if (!title) continue;
      out.maths.push({ id: "", title, def });
    }
  }
  out.words = out.words.map((w, i) => ({ ...w, id: `w${String(i + 1).padStart(2, "0")}` }));
  out.maths = out.maths.map((m, i) => ({ ...m, id: `m${String(i + 1).padStart(2, "0")}` }));
  return out;
}

export interface KnowledgeVaultService {
  read(file: string): Promise<string | null>;
  append(file: string, content: string): Promise<void>;
  readAndAppend(file: string, prepare: (existing: string) => { text: string; category: KnowledgeCategory }): Promise<{ category: KnowledgeCategory; totalLen: number; where: string }>;
  ensureFolder(file: string): Promise<void>;
}

export function createKnowledgeVaultService(app: App): KnowledgeVaultService {
  const adapter = app.vault.adapter;

  function parentFor(filePath: string): string | null {
    const idx = filePath.lastIndexOf("/");
    if (idx <= 0) return null;
    return filePath.slice(0, idx);
  }

  return {
    async read(file) {
      try {
        if (await adapter.exists(file)) {
          return await adapter.read(file);
        }
      } catch (_err) {
        // fall through and return null
      }
      return null;
    },
    async append(file, content) {
      const existing = (await this.read(file)) ?? "";
      await adapter.write(file, existing + content);
    },
    async readAndAppend(file, prepare) {
      const existing = (await this.read(file)) ?? "";
      const { text, category } = prepare(existing);
      await adapter.write(file, text);
      const where = sectionTargetName(text, category, "");
      return { category, totalLen: text.length, where };
    },
    async ensureFolder(file) {
      const parent = parentFor(file);
      if (!parent) return;
      try {
        if (!(await adapter.exists(parent))) {
          await adapter.mkdir(parent);
        }
      } catch (_err) {
        // ignore — adapter may not support mkdir in all environments
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Class-based facade (used by the learning / review widgets).
// Keeps the pure helpers above and the vault I/O behind a stable shape.
// ─────────────────────────────────────────────────────────────────────────────

export interface WordKnowledge {
  id: string;
  name: string;
  pos: string;
  def: string;
}

export interface MathKnowledge {
  id: string;
  title: string;
  def: string;
}

export interface KnowledgeData {
  words: WordKnowledge[];
  maths: MathKnowledge[];
}

export interface AppendResult {
  category: KnowledgeCategory;
  where: string;
  totalLen: number;
}

export class KnowledgeService {
  private readonly app: App;
  private readonly path: string;
  private readonly vault: KnowledgeVaultService;
  private cached: { ts: number; text: string } | null = null;
  private static CACHE_TTL = 60_000;

  constructor(app: App, knowledgePath: string) {
    this.app = app;
    this.path = (knowledgePath || "plans/知识点.md").trim() || "plans/知识点.md";
    this.vault = createKnowledgeVaultService(app);
  }

  get filePath(): string {
    return this.path;
  }

  inferCategory(name: string, markdown: string): KnowledgeCategory {
    return inferCategory(name, markdown);
  }

  async readFile(): Promise<string> {
    if (this.cached && Date.now() - this.cached.ts < KnowledgeService.CACHE_TTL) {
      return this.cached.text;
    }
    const text = (await this.vault.read(this.path)) ?? "";
    this.cached = { ts: Date.now(), text };
    return text;
  }

  async load(force = false): Promise<KnowledgeData> {
    if (force) this.cached = null;
    const text = await this.readFile();
    return parseKnowledgeMd(text);
  }

  async append(category: KnowledgeCategory, name: string, content: string): Promise<AppendResult> {
    const existing = await this.readFile();
    const { text, fallback } = reorganizeKpFile(existing, category, name, content);
    const finalCategory: KnowledgeCategory = (fallback ?? category) as KnowledgeCategory;
    await this.vault.ensureFolder(this.path);
    await this.app.vault.adapter.write(this.path, text);
    this.cached = { ts: Date.now(), text };
    const where = sectionTargetName(text, finalCategory, name);
    return { category: finalCategory, where, totalLen: text.length };
  }
}
