import { describe, expect, it } from "vitest";
import { parsePastedArticle } from "../src/widgets/parsePastedArticle";

describe("parsePastedArticle", () => {
  it("lifts a short title from the first non-empty line", () => {
    const raw = "Why Birds Migrate\n\nBirds migrate every year to find food and better weather.";
    const { title, text } = parsePastedArticle(raw);
    expect(title).toBe("Why Birds Migrate");
    expect(text).toBe("Birds migrate every year to find food and better weather.");
    expect(text).not.toContain("Why Birds Migrate");
  });

  it("does not lift a title when the first line ends with sentence punctuation", () => {
    const raw = "This is the first line.\n\nMore body text follows here.";
    const { title, text } = parsePastedArticle(raw);
    expect(title).toBe("");
    expect(text).toBe("This is the first line. More body text follows here.");
  });

  it("does not lift a title when the first line is longer than 120 chars", () => {
    const longLine = "x".repeat(121);
    const raw = `${longLine}\n\nShort body.`;
    const { title, text } = parsePastedArticle(raw);
    expect(title).toBe("");
    expect(text).toContain(longLine);
  });

  it("treats a short single-line input without sentence punctuation as the title", () => {
    // No newline separator, short enough, no terminator — best-effort behavior is to
    // treat the whole input as the title (length-ok, no punctuation). The body stays empty.
    const raw = "Short unpunctuated header";
    const { title, text } = parsePastedArticle(raw);
    expect(title).toBe("Short unpunctuated header");
    expect(text).toBe("");
  });

  it("treats a long single-line input without punctuation as the body, not the title", () => {
    // >120 chars means we can't be sure it's a title — collapse to body.
    const longLine = "x".repeat(200);
    const { title, text } = parsePastedArticle(longLine);
    expect(title).toBe("");
    expect(text.length).toBeGreaterThan(0);
  });

  it("preserves CJK punctuation as a title terminator", () => {
    const raw = "标题后面跟着句号。\n接下来的内容。";
    const { title, text } = parsePastedArticle(raw);
    expect(title).toBe("");
    expect(text).toContain("接下来的内容");
  });

  it("collapses internal whitespace into single spaces", () => {
    const raw = "Title\n\nLine 1\n\n\nLine 2\t\twith\ttabs";
    const { title, text } = parsePastedArticle(raw);
    expect(title).toBe("Title");
    expect(text).toBe("Line 1 Line 2 with tabs");
  });

  it("trims the body to 6,000 chars", () => {
    const raw = "Title\n\n" + "a".repeat(7_000);
    const { text } = parsePastedArticle(raw);
    expect(text.length).toBe(6_000);
  });

  it("returns empty title and text when input is empty", () => {
    const { title, text } = parsePastedArticle("");
    expect(title).toBe("");
    expect(text).toBe("");
  });

  it("returns empty title and trimmed text when input is only whitespace", () => {
    const { title, text } = parsePastedArticle("   \n\n   \t  ");
    expect(title).toBe("");
    expect(text).toBe("");
  });

  it("skips leading blank lines before deciding what counts as the title", () => {
    const raw = "\n\n\nReal Title\n\nBody content here.";
    const { title, text } = parsePastedArticle(raw);
    expect(title).toBe("Real Title");
    expect(text).toBe("Body content here.");
  });
});