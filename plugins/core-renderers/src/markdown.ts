import { renderMath } from "@nib-ui/render";
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

/**
 * The attribute a mermaid fence leaves its source in. Rendering is asynchronous
 * and needs the DOM, and this is a synchronous string of HTML, so the fence is
 * turned into an empty element carrying what it says and `TextBlock` fills it in.
 */
export const MERMAID_SOURCE_ATTRIBUTE = "data-mermaid";

marked.use({
  renderer: {
    // marked no longer sanitizes, so raw HTML is shown verbatim instead of parsed.
    html({ text }) {
      return escapeHtml(text);
    },
    code({ text, lang }) {
      // `false` is marked's own way of saying "not mine": every other fence is
      // left to the default renderer rather than reimplemented here.
      if (lang?.trim().toLowerCase() !== "mermaid") return false;
      return `<div class="mermaid" ${MERMAID_SOURCE_ATTRIBUTE}="${escapeHtml(text)}"></div>`;
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

/**
 * TeX, which markdown itself knows nothing about. Tokenizers rather than a pass
 * over the finished html: a `$` inside a code span is a dollar sign, and marked
 * is what already knows where the code spans are.
 */
marked.use({
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start: (source: string) => source.indexOf("$$"),
      tokenizer(source: string) {
        const match = /^\$\$([^$]+?)\$\$/.exec(source);
        if (!match) return undefined;
        return { type: "blockMath", raw: match[0], text: match[1] ?? "" };
      },
      renderer: (token) => renderMath(String(token["text"]), true),
    },
    {
      name: "inlineMath",
      level: "inline",
      start: (source: string) => source.indexOf("$"),
      tokenizer(source: string) {
        // Not across a line break, and not on a space at either edge: `$5 and
        // $10` is two prices rather than a formula about "5 and ".
        const match = /^\$([^$\n]+?)\$/.exec(source);
        if (!match) return undefined;
        const text = match[1] ?? "";
        if (text.trim().length !== text.length) return undefined;
        return { type: "inlineMath", raw: match[0], text };
      },
      renderer: (token) => renderMath(String(token["text"]), false),
    },
  ],
});

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false });
}

/**
 * Whether the text ends inside a fenced block. A reply still arriving is parsed
 * as far as it has got, and marked closes an unterminated fence at the end of
 * what it was given — so the last block of a streaming message can be half a
 * diagram that only looks complete.
 */
export function openFence(source: string): boolean {
  return [...source.matchAll(/^[ \t]*(?:```|~~~)/gm)].length % 2 === 1;
}
