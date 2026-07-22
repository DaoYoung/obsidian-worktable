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

export function freeAnswerPrompt(title: string, text: string, question: string): { system: string; user: string } {
  const trimmedQuestion = (question || "").trim();
  if (!trimmedQuestion) {
    throw new Error("question must be non-empty");
  }
  let snippet = text.trim();
  if (snippet.length > 6000) snippet = snippet.slice(0, 6000) + "…(已截断)";
  const system =
    "你是一个学习助手。基于用户提供的文章内容回答用户的问题。" +
    "如果问题与文章无关,直接说明文章中未涉及;" +
    "如果文章里有相关信息,引用并解释,不要编造。" +
    "回答用简洁中文,可使用 Markdown,但不要用代码块包裹整段答案。";
  const user =
    `文章标题:${title || "(无)"}\n\n` +
    `文章正文:\n${snippet || "(无正文)"}\n\n` +
    `用户问题:${trimmedQuestion}\n\n` +
    `请基于文章内容回答上面的问题:`;
  return { system, user };
}

export function knowledgeExpandPrompt(name: string, context: string): { system: string; user: string } {
  const snippet = context.trim().slice(0, 4000);
  // Foreign-vocabulary detection: short input with no Chinese but Latin letters
  // → treat as foreign-language learning and focus on the Chinese translation.
  const trimmedName = (name || "").trim();
  const hasCjk = /[一-鿿]/.test(trimmedName);
  const hasLatin = /[A-Za-zÀ-ɏ]/.test(trimmedName);
  const isEnglishWord = !hasCjk && hasLatin && trimmedName.length <= 40;
  if (isEnglishWord) {
    // English-vocabulary learning: the user typed an English word and wants
    // to learn its Chinese meaning. The subject hint alone isn't enough — for
    // words that double as technical terms (e.g. "spawn" → Python
    // multiprocessing) the model still drifts into code examples unless the
    // whole prompt is unambiguous about vocabulary-only output.
    const system =
      "你是一个英文单词学习助手,负责把用户输入的英文单词整理成中文词汇卡片。" +
      "请严格只返回 JSON 对象,不要任何其他文字、注释、Markdown 代码块。" +
      "重要:用户输入的是英文单词,目的是学习它的中文含义,不是查任何技术文档。" +
      "如果这个词恰好也是某个编程/技术/API 中的术语(例如 'spawn' 在 Python " +
      "multiprocessing、Unreal Engine、游戏引擎中等),完全忽略那些技术含义," +
      "只把它当作一个普通英语单词来解释。";
    const user =
      `英文单词:${trimmedName}\n\n` +
      (snippet ? `额外参考上下文:\n${snippet}\n\n` : "") +
      "请用 JSON 返回这个英文单词的学习卡片(只解释作为英文单词的含义,不要写任何代码、不要举编程/技术示例):\n" +
      '  "subject": "英文词汇"\n' +
      '  "translation": 1-3 句中文释义(必填,例如「产卵;大量产生;引发」这种常规英文词汇含义)\n' +
      '  "pos": 词性(必填,n./v./adj./adv./prep./conj./pron./num./art./aux./interj.)\n' +
      '  "definition": 1-2 句中文解释,告诉用户这个单词在英文里通常怎么用(不要写代码、不要解释技术用法)\n' +
      '  "points": 3-5 条关键要点,每条都是中文,围绕单词本身的含义、常见搭配、近义词等\n' +
      '  "example": 留空字符串 "" —— 英文单词场景下不需要示例字段\n' +
      '  "contrast": 与意思相近的英文单词的区别(可选,可以空字符串)\n' +
      '  "refs": 参考资料(可选,可以空字符串)\n\n' +
      '{"subject":"英文词汇","translation":"...","pos":"...","definition":"...","points":["...","..."],"example":"","contrast":"...","refs":"..."}\n';
    return { system, user };
  }
  const subjectHint =
    '"subject": 一个简洁中文学科标签,如 数学 / 物理 / 化学 / 生物 / 历史 / 地理 / 政治 / 语文 / 经济 / 哲学 / 心理学 / 计算机 / 其他';
  const system =
    "你是一个知识整理助手。请严格只返回 JSON 对象,不要任何其他文字、注释、Markdown 代码块。" +
    "内容准确、简洁、有结构,不要编造不存在的引用。";
  const user =
    `知识点名称:${trimmedName}\n\n` +
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