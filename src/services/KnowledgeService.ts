import type { App, TFile } from "obsidian";

export type KnowledgeCategory = "word" | "math" | "subject" | "misc";

export const CANONICAL_SUBJECTS = [
  "英文词汇",
  "数学",
  "物理",
  "化学",
  "生物",
  "历史",
  "地理",
  "政治",
  "语文",
  "经济",
  "哲学",
  "心理学",
  "计算机",
  "其他",
] as const;

export type CanonicalSubject = (typeof CANONICAL_SUBJECTS)[number];
/** Subject label — either a canonical name or any user/AI-provided label. */
export type Subject = string;

export interface ParsedWord {
  name: string;
  pos: string;
  def: string;
}

export interface ReorganizeResult {
  text: string;
  fallback: KnowledgeCategory | null;
}

export interface KnowledgeAppendOptions {
  category: KnowledgeCategory;
  name: string;
  content: string;
  /** Subject label when category === "subject" (e.g. "物理"). */
  subject?: string;
  /** Translation for English words; falls back to parsing `content` if absent. */
  translation?: string;
  /** Part of speech for English words; falls back to parsing `content` if absent. */
  pos?: string;
}

export interface AppendResult {
  category: KnowledgeCategory;
  subject: Subject | "随手记";
  where: string;
  totalLen: number;
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
const H2_UPDATE_PATTERN = /^##\s*(?:三|末)、?更新记录/m;
const SUBJECT_HEADING_PATTERN = /^##\s+([^\n]+?)\s*$/;
const JSON_OBJECT_PATTERN = /\{[\s\S]*\}/;
const JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/;

const TABLE_LINE_PATTERN = /^\s*\|/;

/** True when all chars of `needle` appear in `haystack` in order (not necessarily contiguously). */
function charsInOrder(needle: string, haystack: string): boolean {
  if (needle.length < 2) return false;
  let i = 0;
  for (const c of haystack) {
    if (c === needle[i]) i++;
    if (i >= needle.length) return true;
  }
  return false;
}

/** Map a free-form subject label from the AI to a canonical Subject. */
export function normalizeSubject(raw: string | null | undefined, fallback: Subject = "其他"): Subject {
  const cleaned = (raw ?? "").replace(/\s+/g, "");
  if (!cleaned) return fallback;
  for (const c of CANONICAL_SUBJECTS) {
    if (cleaned === c || cleaned === c.replace(/\s+/g, "")) return c;
  }
  for (const c of CANONICAL_SUBJECTS) {
    if (cleaned.includes(c) || c.includes(cleaned)) return c;
    if (charsInOrder(cleaned, c) || charsInOrder(c, cleaned)) return c;
  }
  return fallback;
}

/** Map a free-form POS token to a canonical POS_SECTION key. */
export function normalizePos(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  const aliases: Record<string, string> = {
    n: "n.", noun: "n.", 名词: "n.",
    v: "v.", verb: "v.", 动词: "v.",
    adj: "adj.", adjective: "adj.", 形容词: "adj.",
    adv: "adv.", adverb: "adv.", 副词: "adv.",
    prep: "prep.", 介词: "prep.",
    conj: "conj.", 连词: "conj.",
    pron: "pron.", 代词: "pron.",
    num: "num.", 数词: "num.",
    art: "art.", 冠词: "art.",
    aux: "aux.", 助动词: "aux.",
    interj: "interj.", 感叹词: "interj.",
  };
  if (value && aliases[value]) return aliases[value];
  // Already in canonical shape (n./v./adj./...)?
  if (raw && POS_SECTION[raw.trim()]) return raw.trim();
  return "";
}

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

/** Parse a `word` payload either from JSON (preferred, AI output) or markdown. */
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

/** Try to extract `{translation, pos}` from a JSON payload returned by `/ai/expand`. */
export function parseWordFromJson(name: string, raw: string): ParsedWord | null {
  if (!raw) return null;
  const fence = raw.match(JSON_FENCE_PATTERN);
  const objectMatch = raw.match(JSON_OBJECT_PATTERN);
  const candidate: string = fence && fence[1]
    ? fence[1]
    : (objectMatch && objectMatch[0] ? objectMatch[0] : raw);
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const translation = typeof obj["translation"] === "string" ? obj["translation"].trim() : "";
    const def = typeof obj["definition"] === "string" ? obj["definition"].trim() : "";
    const pos = normalizePos(typeof obj["pos"] === "string" ? (obj["pos"] as string) : "");
    const subjectWord = obj["subject_word"];
    const finalName = typeof subjectWord === "string" && subjectWord.trim()
      ? subjectWord.trim()
      : name.trim();
    if (!/^[A-Za-z][A-Za-z'\-]{0,30}$/.test(finalName)) return null;
    if (!translation && !def) return null;
    return { name: finalName, pos: pos || "n.", def: translation || def };
  } catch (_err) {
    return null;
  }
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

function findSectionByTitle(sections: KnowledgeSection[], exactTitle: string): number {
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section) continue;
    const firstLine = section.text.split("\n")[0] || "";
    if (firstLine.trim() === exactTitle) return i;
  }
  return -1;
}

function findUpdateLogIndex(sections: KnowledgeSection[]): number {
  // Prefer the legacy numbered heading; fall back to last `## 更新记录`.
  const numbered = findSection(sections, H2_UPDATE_PATTERN);
  if (numbered >= 0) return numbered;
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (!section) continue;
    const firstLine = section.text.split("\n")[0] || "";
    if (/^##\s+更新记录/.test(firstLine)) return i;
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

function updateLogRow(date: string, time: string, name: string, subject: string): string {
  return `| ${date} ${time} | 新增 **${name}** · ${subject} |`;
}

function appendUpdateLog(sections: KnowledgeSection[], row: string): void {
  const idx = findUpdateLogIndex(sections);
  if (idx < 0) return;
  const section = sections[idx];
  if (!section) return;
  sections[idx] = appendTableRow(section, row);
}

/**
 * Drop any existing entry whose name matches `name` (case-insensitive, trimmed)
 * across all categories before the new write lands. The update-log section is
 * left intact so the audit history is preserved.
 */
function dedupeNameAcrossSections(sections: KnowledgeSection[], name: string): void {
  const target = name.trim().toLowerCase();
  if (!target) return;
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (!sec) continue;
    const firstLine = sec.text.split("\n")[0] || "";
    const titleMatch = firstLine.match(/^##\s+(.+?)\s*$/);
    const title = (titleMatch?.[1] || "").trim();
    if (H2_WORDS_PATTERN.test(`## ${title}`)) {
      sec.text = removeMatchingWordTableRow(sec.text, target);
    } else if (H2_MATH_PATTERN.test(`## ${title}`)) {
      sec.text = removeMatchingNumberedBlock(sec.text, target, /^\d+\.\d+\s+/);
    } else if (/^更新记录$/.test(title) || /(?:三|末)、更新记录/.test(title)) {
      // Preserve the audit log; the caller adds a fresh row for the new entry.
    } else if (/^(?:三|四)、随手记$/.test(title) || title === "随手记") {
      sec.text = removeMatchingNumberedBlock(sec.text, target, /^\d{4}-\d{2}-\d{2}\s+/);
    } else if (title) {
      // Generic subject section (e.g. ## 物理) — same numbered-block shape as math.
      sec.text = removeMatchingNumberedBlock(sec.text, target, /^\d+\.\d+\s+/);
    }
  }
}

/** Remove `| <name> | ... |` rows from any table inside the words section. */
function removeMatchingWordTableRow(text: string, targetLower: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let removed = false;
  for (const line of lines) {
    const cellMatch = line.match(/^\|\s*([^|]+?)\s*\|/);
    if (cellMatch) {
      const cellName = (cellMatch[1] || "").trim();
      if (cellName && cellName.toLowerCase() === targetLower) {
        removed = true;
        continue;
      }
    }
    out.push(line);
  }
  if (removed) {
    while (out.length > 0 && (out[out.length - 1] ?? "").trim() === "") out.pop();
  }
  return out.join("\n");
}

/** Remove a `### <prefix><name>` block (heading + body) from a math/subject/misc section. */
function removeMatchingNumberedBlock(text: string, targetLower: string, prefixRe: RegExp): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] || "";
    const h = line.match(/^###\s+(.+?)\s*$/);
    let matched = false;
    if (h && h[1] && prefixRe.test(h[1])) {
      const namePart = h[1].replace(prefixRe, "").trim();
      if (namePart.toLowerCase() === targetLower) matched = true;
    }
    if (matched) {
      i++; // skip the heading itself
      while (i < lines.length) {
        const l = lines[i] || "";
        if (/^#{2,3}\s/.test(l)) break;
        i++;
      }
      while (out.length > 0 && (out[out.length - 1] ?? "").trim() === "") out.pop();
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sectionTargetName(text: string, category: KnowledgeCategory, name: string, subject?: string): string {
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
  if (category === "subject") {
    return subject?.trim() || "其他";
  }
  return "随手记";
}

/**
 * Resolve a row payload for the `word` category.
 * Tries in order: explicit `translation`, JSON parse of content, markdown parse.
 */
function resolveWord(name: string, opts: KnowledgeAppendOptions): { row: string; fallback: "misc" | null; sectionTitle: string } {
  if (opts.translation && opts.translation.trim()) {
    const pos = normalizePos(opts.pos) || "n.";
    const parsed: ParsedWord = { name: name.trim(), pos, def: opts.translation.trim() };
    const sectionTitle = POS_SECTION[parsed.pos] ?? POS_SECTION.misc ?? "### 1.4 其他";
    return { row: buildWordRow(parsed), fallback: null, sectionTitle };
  }
  const jsonParsed = parseWordFromJson(name, opts.content || "");
  if (jsonParsed) {
    const sectionTitle = POS_SECTION[jsonParsed.pos] ?? POS_SECTION.misc ?? "### 1.4 其他";
    return { row: buildWordRow(jsonParsed), fallback: null, sectionTitle };
  }
  const mdParsed = parseWordFromMd(name, opts.content || "");
  if (mdParsed) {
    const sectionTitle = POS_SECTION[mdParsed.pos] ?? POS_SECTION.misc ?? "### 1.4 其他";
    return { row: buildWordRow(mdParsed), fallback: null, sectionTitle };
  }
  return { row: "", fallback: "misc", sectionTitle: "" };
}

/** Append a subject knowledge point to the named subject section (creating it if missing). */
function appendSubjectSection(
  sections: KnowledgeSection[],
  subject: Subject,
  name: string,
  content: string
): { sections: KnowledgeSection[]; created: boolean } {
  const title = `## ${subject}`;
  let idx = findSectionByTitle(sections, title);
  let created = false;
  if (idx < 0) {
    const block: KnowledgeSection = {
      text: `${title}\n\n> 本节收录${subject}相关知识,按录入时间倒序排列(最新在上)。\n`,
    };
    const updateIdx = findUpdateLogIndex(sections);
    if (updateIdx < 0) {
      idx = sections.length;
      sections.push(block);
    } else {
      idx = updateIdx;
      sections.splice(idx, 0, block);
    }
    created = true;
  }
  const target = sections[idx];
  if (!target) return { sections, created };
  const numRe = /^###\s*(\d+)\.(\d+)\s+/gm;
  let maxN = 0;
  let mm: RegExpExecArray | null;
  while ((mm = numRe.exec(target.text)) !== null) {
    const first = mm[1];
    if (first) maxN = Math.max(maxN, parseInt(first, 10));
  }
  const newN = maxN + 1;
  const body = (content || "").trim();
  const block = `### ${newN}.1 ${name}\n\n${body}\n`;
  const appended = target.text.replace(/\n+$/, "") + "\n\n" + block;
  const next = sections.slice();
  next[idx] = { text: appended };
  return { sections: next, created };
}

export function reorganizeKpFile(
  text: string,
  category: KnowledgeCategory,
  name: string,
  content: string,
  subject?: string,
  translation?: string,
  pos?: string
): ReorganizeResult {
  const opts: KnowledgeAppendOptions = {
    category,
    name,
    content,
    subject,
    translation,
    pos,
  };
  return reorganizeKpFileWithOptions(text, opts);
}

export function reorganizeKpFileWithOptions(text: string, opts: KnowledgeAppendOptions): ReorganizeResult {
  const { pre, sections } = splitSections(text || "");
  const finalSections = sections.map((s) => ({ text: s.text }));

  dedupeNameAcrossSections(finalSections, opts.name);

  if (opts.category === "word") {
    const wordSecIdx = findSection(finalSections, H2_WORDS_PATTERN);
    if (wordSecIdx < 0) {
      return fallbackMisc(text, opts);
    }
    const resolved = resolveWord(opts.name, opts);
    if (resolved.fallback === "misc") {
      return fallbackMisc(text, opts);
    }
    const wordSection = finalSections[wordSecIdx];
    if (!wordSection) return fallbackMisc(text, opts);
    const h3Match = H3_SPLIT_PATTERN.exec(wordSection.text);
    const h3Index = h3Match ? h3Match.index : -1;
    const prefix = h3Index >= 0 ? wordSection.text.slice(0, h3Index) : wordSection.text;
    const subText = h3Index >= 0 ? wordSection.text.slice(h3Index) : "";
    const subs = subText ? subText.split(H3_SPLIT_PATTERN) : [];
    const filteredSubs = subs
      .filter((s) => /^###\s/.test(s))
      .map((s) => ({ text: s.replace(/\n+$/, "") }));
    const targetIdx = findSubsection(filteredSubs, resolved.sectionTitle);
    let newSubs: KnowledgeSection[];
    if (targetIdx < 0) {
      newSubs = [
        ...filteredSubs,
        { text: `${resolved.sectionTitle}\n\n| 单词 | 释义 |\n|:----:|------|\n${resolved.row}` },
      ];
    } else {
      const target = filteredSubs[targetIdx];
      if (target) {
        const updated = appendTableRow(target, resolved.row);
        newSubs = filteredSubs.map((s, i) => (i === targetIdx ? updated : s));
      } else {
        newSubs = filteredSubs;
      }
    }
    finalSections[wordSecIdx] = { text: prefix + newSubs.map((s) => s.text).join("\n\n") };
  } else if (opts.category === "math") {
    const mathSecIdx = findSection(finalSections, H2_MATH_PATTERN);
    if (mathSecIdx < 0) {
      return fallbackMisc(text, opts);
    }
    const mathSection = finalSections[mathSecIdx];
    if (!mathSection) return fallbackMisc(text, opts);
    const numRe = /^###\s*(\d+)\.(\d+)\s+/gm;
    let maxN = 0;
    let mm: RegExpExecArray | null;
    while ((mm = numRe.exec(mathSection.text)) !== null) {
      const first = mm[1];
      if (first) maxN = Math.max(maxN, parseInt(first, 10));
    }
    const newN = maxN + 1;
    const body = (opts.content || "").trim();
    const block = `### ${newN}.1 ${opts.name}\n\n${body}\n`;
    finalSections[mathSecIdx] = { text: mathSection.text + "\n\n" + block };
  } else if (opts.category === "subject") {
    // Preserve AI-returned labels verbatim when they don't map to a canonical
    // subject. Only fall back to "其他" when the input is empty/missing.
    const rawSubject = (opts.subject ?? "").trim();
    const normalized = normalizeSubject(rawSubject, "");
    const subjectLabel = normalized || rawSubject || "其他";
    const result = appendSubjectSection(finalSections, subjectLabel, opts.name, opts.content);
    // Mutate finalSections in place (appendSubjectSection returns a new array, so replace it).
    finalSections.length = 0;
    finalSections.push(...result.sections);
  } else {
    const miscResult = appendMisc(finalSections, pre, opts);
    finalSections.length = 0;
    finalSections.push(...miscResult.sections);
  }

  const finalSubject = opts.category === "subject"
    ? (() => {
        const raw = (opts.subject ?? "").trim();
        const normalized = normalizeSubject(raw, "");
        return normalized || raw || "其他";
      })()
    : opts.category === "word"
      ? "英文词汇"
      : opts.category === "math"
        ? "数学"
        : "随手记";
  appendUpdateLog(
    finalSections,
    updateLogRow(
      new Date().toISOString().slice(0, 10),
      new Date().toTimeString().slice(0, 5),
      opts.name,
      finalSubject
    )
  );
  const joined = pre + finalSections.map((s) => s.text).join("\n\n");
  return { text: joined + (joined.length && !joined.endsWith("\n") ? "\n" : ""), fallback: null };
}

function fallbackMisc(text: string, opts: KnowledgeAppendOptions): ReorganizeResult {
  const fallbackOpts: KnowledgeAppendOptions = { ...opts, category: "misc", subject: undefined };
  const { pre, sections } = splitSections(text || "");
  const finalSections = sections.map((s) => ({ text: s.text }));
  // Match the dedup that reorganizeKpFileWithOptions applies on the parent path.
  dedupeNameAcrossSections(finalSections, opts.name);
  const result = appendMisc(finalSections, pre, fallbackOpts);
  appendUpdateLog(
    result.sections,
    updateLogRow(
      new Date().toISOString().slice(0, 10),
      new Date().toTimeString().slice(0, 5),
      opts.name,
      "随手记"
    )
  );
  const joined = result.pre + result.sections.map((s) => s.text).join("\n\n");
  return { text: joined + (joined.length && !joined.endsWith("\n") ? "\n" : ""), fallback: "misc" };
}

function appendMisc(sections: KnowledgeSection[], pre: string, opts: KnowledgeAppendOptions): { pre: string; sections: KnowledgeSection[] } {
  const stampDate = new Date().toISOString().slice(0, 10);
  const block = `### ${stampDate} ${opts.name}\n\n${(opts.content || "").trim()}\n`;
  const miscIdx = findSection(sections, H2_MISC_PATTERN);
  let nextSections = sections.slice();
  if (miscIdx < 0) {
    const newMiscSection: KnowledgeSection = {
      text: `## 四、随手记\n\n> 本节收录通用笔记,按录入时间倒序排列(最新在上)。\n\n${block}`,
    };
    const updateIdx = findUpdateLogIndex(nextSections);
    if (updateIdx < 0) {
      nextSections.push(newMiscSection);
    } else {
      nextSections.splice(updateIdx, 0, newMiscSection);
    }
  } else {
    const miscSection = nextSections[miscIdx];
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
      nextSections[miscIdx] = { text: lines.join("\n") };
    }
  }
  return { pre, sections: nextSections };
}

export interface ParsedWordEntry {
  id: string;
  name: string;
  pos: string;
  def: string;
}

export interface ParsedMathEntry {
  id: string;
  title: string;
  def: string;
}

export interface ParsedSubjectEntry {
  id: string;
  subject: Subject;
  title: string;
  def: string;
}

export interface ParsedKnowledge {
  words: ParsedWordEntry[];
  maths: ParsedMathEntry[];
  subjects: ParsedSubjectEntry[];
}

const WORD_TABLE_ROW = /^\|\s*([A-Za-z][A-Za-z\s'-]*?)\s*\|\s*([^|\n]+?)\s*(?:\|.*)?$/gm;
const H2_WORDS_CAPTURE = /##\s*一、英文词汇([\s\S]*?)(?=\n##\s|\s*$)/;
const H2_MATH_CAPTURE = /##\s*二、数学知识点([\s\S]*?)(?=\n##\s|\s*$)/;
const MATH_CHUNK_SPLIT = /\n###\s+/;
const SUBJECT_HEADING_RE = /^##\s+([^\n#][^\n]*?)\s*$/m;
const SUBJECT_BODY_SPLIT_RE = /\n###\s+/;

/**
 * Parse the knowledge file into per-discipline pools.
 * Subjects are detected from `## <subject>` headings that aren't 英文词汇/数学/随手记/更新记录.
 */
export function parseKnowledgeMd(text: string): ParsedKnowledge {
  const out: ParsedKnowledge = { words: [], maths: [], subjects: [] };
  if (!text) return out;

  const { sections } = splitSections(text);
  for (const section of sections) {
    const headingMatch = section.text.match(SUBJECT_HEADING_RE);
    if (!headingMatch) continue;
    const heading = (headingMatch[1] ?? "").trim();
    if (H2_WORDS_PATTERN.test(`## ${heading}`)) {
      out.words = parseWordsFromSection(section.text);
    } else if (H2_MATH_PATTERN.test(`## ${heading}`)) {
      out.maths = parseMathsFromSection(section.text);
    } else if (/^(?:三|四)、随手记$/.test(heading) || heading === "随手记") {
      // Notes are intentionally skipped from review pools.
    } else if (/^更新记录$/.test(heading) || /(?:三|末)、更新记录/.test(heading)) {
      // Skip the audit log.
    } else {
      const subject = normalizeSubject(heading, "其他");
      out.subjects.push(...parseSubjectsFromSection(section.text, subject));
    }
  }

  out.words = out.words.map((w, i) => ({ ...w, id: `w${String(i + 1).padStart(2, "0")}` }));
  out.maths = out.maths.map((m, i) => ({ ...m, id: `m${String(i + 1).padStart(2, "0")}` }));
  out.subjects = out.subjects.map((s, i) => ({ ...s, id: `s${String(i + 1).padStart(2, "0")}` }));
  return out;
}

function parseWordsFromSection(text: string): ParsedWordEntry[] {
  const out: ParsedWordEntry[] = [];
  const rows = text.matchAll(WORD_TABLE_ROW);
  for (const r of rows) {
    const name = (r[1] || "").trim();
    const def = (r[2] || "").trim();
    if (!name || name.toLowerCase() === "单词") continue;
    out.push({ id: "", name, pos: "n.", def });
  }
  return out;
}

function parseMathsFromSection(text: string): ParsedMathEntry[] {
  const out: ParsedMathEntry[] = [];
  const chunks = text.split(MATH_CHUNK_SPLIT).slice(1);
  for (const chunk of chunks) {
    const nl = chunk.search(/\n/);
    const title = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    const def = (nl < 0 ? "" : chunk.slice(nl + 1)).trim();
    if (!title) continue;
    out.push({ id: "", title, def });
  }
  return out;
}

function parseSubjectsFromSection(text: string, subject: Subject): ParsedSubjectEntry[] {
  const out: ParsedSubjectEntry[] = [];
  const chunks = text.split(SUBJECT_BODY_SPLIT_RE);
  for (const chunk of chunks) {
    const trimmed = chunk.replace(/\n+$/, "");
    if (!trimmed) continue;
    // First H3 is the entry title; remainder is the body.
    const nl = trimmed.search(/\n/);
    const title = (nl < 0 ? trimmed : trimmed.slice(0, nl)).replace(/^###\s*/, "").trim();
    const def = (nl < 0 ? "" : trimmed.slice(nl + 1)).trim();
    if (!title) continue;
    // Skip the section preamble (H2 heading itself) and blockquote notes.
    if (/^##\s/.test(title)) continue;
    if (/^>/.test(title)) continue;
    out.push({ id: "", subject, title, def });
  }
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

export interface SubjectKnowledge {
  id: string;
  subject: Subject;
  title: string;
  def: string;
}

export interface KnowledgeData {
  words: WordKnowledge[];
  maths: MathKnowledge[];
  subjects: SubjectKnowledge[];
}

export interface KnowledgeReviewSource {
  type: "file" | "folder";
  path: string;
}

export interface ReviewSourceFile {
  path: string;
  mtime: number;
  size: number;
}

export interface ReviewSourceWarning {
  path: string;
  message: string;
}

export interface ReviewEntrySource {
  sourcePath: string;
  sourceName: string;
}

export type ReviewWordKnowledge = WordKnowledge & ReviewEntrySource;
export type ReviewMathKnowledge = MathKnowledge & ReviewEntrySource;
export type ReviewSubjectKnowledge = SubjectKnowledge & ReviewEntrySource;

export interface ReviewKnowledgeData extends KnowledgeData {
  words: ReviewWordKnowledge[];
  maths: ReviewMathKnowledge[];
  subjects: ReviewSubjectKnowledge[];
  sourceFiles: ReviewSourceFile[];
  warnings: ReviewSourceWarning[];
  signature: string;
}

export interface ReviewSourceDiscovery {
  files: ReviewSourceFile[];
  warnings: ReviewSourceWarning[];
  signature: string;
}

interface ReviewVaultFile {
  path: string;
  basename?: string;
  extension?: string;
  mtime?: number;
  size?: number;
  stat?: { mtime?: number; size?: number };
}

interface ReviewVaultFolder {
  path: string;
  children: unknown[];
}

function reviewObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isReviewFolder(value: unknown): value is ReviewVaultFolder {
  const obj = reviewObject(value);
  return typeof obj?.path === "string" && Array.isArray(obj.children);
}

function toReviewMarkdownFile(value: unknown): ReviewVaultFile | null {
  const obj = reviewObject(value);
  if (!obj || typeof obj.path !== "string" || Array.isArray(obj.children)) return null;
  const path = obj.path;
  const extension = typeof obj.extension === "string"
    ? obj.extension
    : (path.split(".").pop() ?? "");
  if (extension.toLowerCase() !== "md") return null;
  return {
    path,
    basename: typeof obj.basename === "string" ? obj.basename : undefined,
    extension: typeof obj.extension === "string" ? obj.extension : undefined,
    mtime: typeof obj.mtime === "number" ? obj.mtime : undefined,
    size: typeof obj.size === "number" ? obj.size : undefined,
    stat: obj.stat && typeof obj.stat === "object"
      ? {
          mtime: typeof (obj.stat as Record<string, unknown>).mtime === "number"
            ? (obj.stat as Record<string, unknown>).mtime as number
            : undefined,
          size: typeof (obj.stat as Record<string, unknown>).size === "number"
            ? (obj.stat as Record<string, unknown>).size as number
            : undefined,
        }
      : undefined,
  };
}

function reviewFileStats(file: ReviewVaultFile): ReviewSourceFile {
  return {
    path: file.path,
    mtime: typeof file.stat?.mtime === "number"
      ? file.stat.mtime
      : (file.mtime ?? 0),
    size: typeof file.stat?.size === "number"
      ? file.stat.size
      : (file.size ?? 0),
  };
}

function reviewSourceName(path: string): string {
  return path.split("/").pop() ?? path;
}

function normalizeKnowledgeReviewSource(raw: unknown): KnowledgeReviewSource | null {
  const obj = reviewObject(raw);
  if (obj?.type !== "file" && obj?.type !== "folder") return null;
  if (typeof obj.path !== "string") return null;
  const path = obj.path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return path ? { type: obj.type, path } : null;
}

function reviewEntryId(sourcePath: string, localId: string): string {
  return `${sourcePath}#${localId}`;
}

/** Discover Markdown files for configured file and folder sources. */
export function discoverReviewSourceFiles(
  app: App,
  sources: readonly KnowledgeReviewSource[],
): ReviewSourceDiscovery {
  const warnings: ReviewSourceWarning[] = [];
  const normalizedSources: KnowledgeReviewSource[] = [];
  const seenSources = new Set<string>();
  for (const raw of Array.isArray(sources) ? sources : []) {
    const source = normalizeKnowledgeReviewSource(raw);
    if (!source) {
      warnings.push({ path: "", message: "复习来源配置无效" });
      continue;
    }
    const key = `${source.type}:${source.path}`;
    if (seenSources.has(key)) continue;
    seenSources.add(key);
    normalizedSources.push(source);
  }

  const vault = app.vault as unknown as {
    getAbstractFileByPath?: (path: string) => unknown;
  };
  const getAbstractFileByPath = vault.getAbstractFileByPath;
  if (typeof getAbstractFileByPath !== "function") {
    for (const source of normalizedSources) {
      warnings.push({ path: source.path, message: "Vault 不支持读取来源" });
    }
    return { files: [], warnings, signature: sourceSignature(normalizedSources, []) };
  }

  const filesByPath = new Map<string, ReviewSourceFile>();
  const addFile = (value: unknown): number => {
    const file = toReviewMarkdownFile(value);
    if (!file) return 0;
    if (!filesByPath.has(file.path)) filesByPath.set(file.path, reviewFileStats(file));
    return 1;
  };
  const walk = (value: unknown): number => {
    const fileCount = addFile(value);
    if (fileCount > 0) return fileCount;
    if (!isReviewFolder(value)) return 0;
    let count = 0;
    for (const child of value.children) count += walk(child);
    return count;
  };

  for (const source of normalizedSources) {
    const node = getAbstractFileByPath.call(vault, source.path);
    if (!node) {
      warnings.push({ path: source.path, message: "来源不存在" });
      continue;
    }
    if (source.type === "file") {
      if (addFile(node) === 0) {
        warnings.push({ path: source.path, message: "来源不是 Markdown 文件" });
      }
      continue;
    }
    if (!isReviewFolder(node)) {
      warnings.push({ path: source.path, message: "来源不是目录" });
      continue;
    }
    if (walk(node) === 0) {
      warnings.push({ path: source.path, message: "目录中没有 Markdown 文件" });
    }
  }

  const files = [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    warnings,
    signature: sourceSignature(normalizedSources, files),
  };
}

function sourceSignature(
  sources: readonly KnowledgeReviewSource[],
  files: readonly ReviewSourceFile[],
): string {
  const sourcePart = sources.map((source) => `${source.type}:${source.path}`).join("|");
  const filePart = files.map((file) => `${file.path}:${file.mtime}:${file.size}`).join("|");
  return `${sourcePart}||${filePart}`;
}

async function readReviewVaultFile(app: App, file: ReviewSourceFile): Promise<string> {
  const vault = app.vault as unknown as {
    adapter?: { read?: (path: string) => Promise<string> };
  };
  if (typeof vault.adapter?.read === "function") {
    return vault.adapter.read(file.path);
  }
  // Some Obsidian test environments inject a stub vault without adapter.
  // Fall back to calling vault.read with a real TFile looked up by path.
  const tfile = (app.vault as unknown as {
    getAbstractFileByPath?: (path: string) => TFile | null;
  }).getAbstractFileByPath?.(file.path);
  if (!tfile) {
    throw new Error("Vault read API unavailable");
  }
  return (app.vault as unknown as { read: (file: TFile) => Promise<string> }).read(tfile);
}

/** Read and aggregate all configured Markdown sources for the Review widget. */
export async function loadReviewKnowledgeSources(
  app: App,
  sources: readonly KnowledgeReviewSource[],
): Promise<ReviewKnowledgeData> {
  const discovery = discoverReviewSourceFiles(app, sources);
  const result: ReviewKnowledgeData = {
    words: [],
    maths: [],
    subjects: [],
    sourceFiles: discovery.files,
    warnings: [...discovery.warnings],
    signature: discovery.signature,
  };

  for (const file of discovery.files) {
    try {
      const parsed = parseKnowledgeMd(await readReviewVaultFile(app, file));
      const sourceName = reviewSourceName(file.path);
      result.words.push(
        ...parsed.words.map((entry) => ({
          ...entry,
          id: reviewEntryId(file.path, entry.id),
          sourcePath: file.path,
          sourceName,
        })),
      );
      result.maths.push(
        ...parsed.maths.map((entry) => ({
          ...entry,
          id: reviewEntryId(file.path, entry.id),
          sourcePath: file.path,
          sourceName,
        })),
      );
      result.subjects.push(
        ...parsed.subjects.map((entry) => ({
          ...entry,
          id: reviewEntryId(file.path, entry.id),
          sourcePath: file.path,
          sourceName,
        })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.warnings.push({ path: file.path, message: `读取失败: ${message}` });
    }
  }
  return result;
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

  async loadReviewKnowledgeSources(
    sources: readonly KnowledgeReviewSource[],
  ): Promise<ReviewKnowledgeData> {
    return loadReviewKnowledgeSources(this.app, sources);
  }

  /** Legacy 3-arg append kept for backward compatibility. */
  async append(category: KnowledgeCategory, name: string, content: string): Promise<AppendResult> {
    return this.appendWithOptions({ category, name, content });
  }

  async appendWithOptions(opts: KnowledgeAppendOptions): Promise<AppendResult> {
    const existing = await this.readFile();
    const { text, fallback } = reorganizeKpFileWithOptions(existing, opts);
    const finalCategory: KnowledgeCategory = (fallback ?? opts.category) as KnowledgeCategory;
    await this.vault.ensureFolder(this.path);
    await this.app.vault.adapter.write(this.path, text);
    this.cached = { ts: Date.now(), text };
    const rawSubject = (opts.subject ?? "").trim();
    const normalizedSubject = normalizeSubject(rawSubject, "");
    const finalSubjectLabel: Subject = normalizedSubject || rawSubject || "其他";
    const subject: Subject | "随手记" =
      finalCategory === "word"
        ? "英文词汇"
        : finalCategory === "math"
          ? "数学"
          : finalCategory === "subject"
            ? finalSubjectLabel
            : "随手记";
    const where = sectionTargetName(text, finalCategory, opts.name, subject);
    return { category: finalCategory, subject, where, totalLen: text.length };
  }
}

// Keep the export name in sync with how the package is referenced elsewhere.
export type { SubjectKnowledge as SubjectKnowledgeEntry };