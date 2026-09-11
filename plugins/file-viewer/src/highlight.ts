import hljs from "highlight.js/lib/common";

/** Extensions the bundled `common` language set actually covers. */
const languageByExtension: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "xml",
  svelte: "xml",
  vue: "xml",
  xml: "xml",
  md: "markdown",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  toml: "ini",
  ini: "ini",
  diff: "diff",
};

export function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return languageByExtension[name.slice(dot + 1)] ?? null;
}

/** One entry per source line, already marked up; the gutter numbers them. */
export function highlightLines(text: string, path: string): string[] {
  const language = languageFor(path);
  const markup = language
    ? hljs.highlight(text, { language, ignoreIllegals: true }).value
    : escape(text);
  return splitMarkup(markup);
}

/**
 * A highlight span may cover several lines, so each line closes its open spans
 * and the next line reopens them; otherwise slicing breaks the markup.
 */
export function splitMarkup(markup: string): string[] {
  const open: string[] = [];
  return markup.split("\n").map((line) => {
    const prefix = open.join("");
    for (const match of line.matchAll(/<span class="[^"]*">|<\/span>/g)) {
      if (match[0] === "</span>") open.pop();
      else open.push(match[0]);
    }
    return `${prefix}${line}${"</span>".repeat(open.length)}`;
  });
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
