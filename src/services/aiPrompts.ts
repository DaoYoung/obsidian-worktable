/**
 * Shared AI prompt builders.
 *
 * The prompts here mirror what `server/server.py` sends to the Anthropic API
 * so the local Cloakfetch service and the in-plugin DirectAiClient produce
 * equivalent output. Keep these in sync with the Python implementations when
 * prompts change.
 */

export function questionGenerationPrompt(title: string, text: string, count: number): {
  system: string;
  user: string;
} {
  let snippet = text.trim();
  if (snippet.length > 6000) snippet = snippet.slice(0, 6000) + "…(已截断)";
  const system =
    "你是一个学习助手。根据用户给的文章,生成理解题。" +
    "严格只返回 JSON,不要任何解释、前言、Markdown 代码块标记。" +
    "题目要紧扣文章核心概念,不同题考察不同方面,答案在原文中能找到。";
  const user =
    `文章标题:${title || "(无)"}\n\n` +
    `文章正文:\n${snippet}\n\n` +
    `请生成最多 ${count} 道题。每道题类型四选一:\n` +
    `  - "mc": 单选题,4 个选项,恰好 1 个正确。fields: text, answer, options[4], explanation\n` +
    `  - "cloze": 填空题,用 ___ 表示空白。fields: text, answer, explanation\n` +
    `  - "tf": 判断题,answer 必须是 "对" 或 "错"。fields: text, answer, explanation\n` +
    `  - "short": 简答题,answer 是 1-5 个关键词。fields: text, answer, explanation\n\n` +
    `严格返回以下 JSON 格式,不要任何其他文字:\n` +
    `{"questions":[{"type":"...","text":"...","answer":"...","options":["...","...","...","..."],"explanation":"..."}]}\n`;
  return { system, user };
}

export function keyPointsExtractionPrompt(title: string, text: string, maxPoints: number): {
  system: string;
  user: string;
} {
  let snippet = text.trim();
  if (snippet.length > 8000) snippet = snippet.slice(0, 8000) + "…(已截断)";
  const system =
    "你是一个学习助手。从一篇文章里提炼出最值得记住的知识点。" +
    "严格只返回 JSON 数组,不要任何解释、前言、Markdown 代码块标记。" +
    "每个知识点用 1-2 句简洁中文表达,不同点覆盖不同方面,避免重复。";
  const user =
    `文章标题:${title || "(无)"}\n\n` +
    `文章正文:\n${snippet}\n\n` +
    `请提炼出最多 ${maxPoints} 个核心知识点。\n` +
    `返回 JSON 数组: ["知识点 1", "知识点 2", ...]\n` +
    `不要返回代码块标记,不要解释。`;
  return { system, user };
}

export function knowledgeExpandPrompt(name: string, context: string): { system: string; user: string } {
  const snippet = context.trim().slice(0, 4000);
  const isEnglishWord = /^[A-Za-z][A-Za-z'\-]{0,30}$/.test((name || "").trim());
  const subjectHint = isEnglishWord
    ? '"subject": "英文词汇"（1-3 句中文翻译,放 translation 字段；pos: n./v./adj./adv. 等）'
    : '"subject": 一个简洁中文学科标签,如 数学 / 物理 / 化学 / 生物 / 历史 / 地理 / 政治 / 语文 / 经济 / 哲学 / 心理学 / 计算机 / 其他';
  const system =
    "你是一个知识整理助手。请严格只返回 JSON 对象,不要任何其他文字、注释、Markdown 代码块。" +
    "内容准确、简洁、有结构,不要编造不存在的引用。";
  const user =
    `知识点名称:${name}\n\n` +
    (snippet ? `额外参考上下文:\n${snippet}\n\n` : "") +
    "请用 JSON 返回一个知识点的结构化解释,字段如下:\n" +
    `  ${subjectHint}\n` +
    '  "definition": 1-3 句中文定义\n' +
    '  "translation": 中文翻译或释义（英文单词必填,其他学科可空字符串）\n' +
    '  "pos": 词性标注,英文单词必填（n./v./adj./adv./prep./conj./pron./num./art./aux./interj.）,其他学科可空字符串\n' +
    '  "points": 3-5 条关键要点(字符串数组)\n' +
    '  "example": 可运行的 Markdown 代码示例或一段使用场景(可选,可以空字符串)\n' +
    '  "contrast": 与其他易混淆概念的区别(可选,可以空字符串)\n' +
    '  "refs": 参考资料(可选,可以空字符串)\n\n' +
    '{"subject":"...","translation":"...","pos":"...","definition":"...","points":["...","..."],"example":"...","contrast":"...","refs":"..."}\n';
  return { system, user };
}

/** Render the structured JSON fields returned by knowledgeExpandPrompt into Markdown. */
export function renderExpandedMarkdown(fields: {
  subject?: string;
  translation?: string;
  pos?: string;
  definition?: string;
  points?: string[];
  example?: string;
  contrast?: string;
  refs?: string;
}): string {
  const out: string[] = [];
  const subject = (fields.subject ?? "").trim();
  const translation = (fields.translation ?? "").trim();
  const pos = (fields.pos ?? "").trim();
  const definition = (fields.definition ?? "").trim();
  const points = Array.isArray(fields.points) ? fields.points.filter((p) => typeof p === "string" && p.trim()) : [];
  const example = (fields.example ?? "").trim();
  const contrast = (fields.contrast ?? "").trim();
  const refs = (fields.refs ?? "").trim();

  out.push(`# ${subject || "知识条目"}`);
  if (translation) out.push(`**翻译**：${translation}`);
  if (pos) out.push(`**词性**：${pos}`);
  if (definition) {
    out.push("", "## 定义", definition);
  }
  if (points.length > 0) {
    out.push("", "## 关键要点");
    for (const p of points) out.push(`- ${p}`);
  }
  if (example) {
    out.push("", "## 示例", example);
  }
  if (contrast) {
    out.push("", "## 与其他概念的区别", contrast);
  }
  if (refs) {
    out.push("", "## 参考资料", refs);
  }
  return out.join("\n");
}