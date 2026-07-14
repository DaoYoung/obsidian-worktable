/**
 * Normalize a pasted article body.
 *
 * Lifts a probable title from the first non-empty line if it's short enough
 * (<= 120 chars and doesn't end with sentence punctuation), then collapses
 * whitespace and trims. This makes the Learning widget fully usable without
 * the local Cloakfetch service: users paste any article, the widget detects a
 * likely title, and the rest becomes the body fed to AI handlers.
 */
export function parsePastedArticle(raw: string): { title: string; text: string } {
  const lines = raw.split(/\r?\n/);
  const firstNonEmpty = lines.find((line) => line.trim().length > 0)?.trim() ?? "";
  const looksLikeTitle = firstNonEmpty.length > 0
    && firstNonEmpty.length <= 120
    && !/[。.！!？?]$/.test(firstNonEmpty);
  const title = looksLikeTitle ? firstNonEmpty : "";
  const body = (looksLikeTitle ? lines.slice(lines.indexOf(firstNonEmpty) + 1).join("\n") : raw)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6_000);
  return { title, text: body };
}