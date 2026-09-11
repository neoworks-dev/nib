const maxTitleLength = 60;

/**
 * A task's first prompt is its name. The slash command that routed it and the
 * directory half of an `@` reference are addressing, not intent, so they come
 * off before the sentence is cut.
 */
export function deriveTaskTitle(text: string): string | null {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  const cleaned = firstLine
    .replace(/^\/\S+\s*/, "")
    .replace(/@(\S+)/g, (_match, path: string) => path.slice(path.lastIndexOf("/") + 1))
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length === 0) return null;
  if (cleaned.length <= maxTitleLength) return cleaned;

  const cut = cleaned.slice(0, maxTitleLength);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = lastSpace > maxTitleLength / 2 ? cut.slice(0, lastSpace) : cut;
  return `${kept.trimEnd()}…`;
}
