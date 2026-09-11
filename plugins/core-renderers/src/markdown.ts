import { Marked } from "marked";

const escapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => escapes[character]!);
}

/** Model output is untrusted, so only navigable schemes survive as real links. */
function safeUrl(href: string): string | null {
  return /^(?:https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(href.trim()) ? href.trim() : null;
}

const marked = new Marked({ gfm: true, breaks: true });

marked.use({
  renderer: {
    // marked no longer sanitizes, so raw HTML is shown verbatim instead of parsed.
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      if (!url) return label;
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(url)}"${titleAttribute} target="_blank" rel="noreferrer noopener">${label}</a>`;
    },
    image({ href, title, text }) {
      const url = safeUrl(href);
      if (!url) return escapeHtml(text);
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${titleAttribute} />`;
    },
  },
});

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false });
}
