/**
 * TeX in a markdown document: `$x^2$` in a sentence and `$$…$$` on its own.
 *
 * KaTeX renders synchronously and returns markup, so unlike a diagram there is
 * nothing to wait for: a caller can put the result straight into the string of
 * HTML it is building. Whatever is drawn needs KaTeX's own stylesheet on the
 * page, which each surface imports for itself.
 */

import katex from "katex";

/**
 * Where a piece of TeX sits in a piece of text, and how it is set. Pure, and the
 * one place the delimiters are read: the editor finds its math with this, and
 * the chat's markdown finds its own through the same rules in a marked
 * extension.
 */
export interface MathSpan {
  from: number;
  to: number;
  source: string;
  /** `$$…$$`, which is centred on a line of its own. */
  display: boolean;
}

/**
 * `$$…$$` first, so the opening of a display block is never read as an empty
 * inline one. An inline span may not hold a line break or begin or end on a
 * space — `$5 and $10` is two prices, not a formula.
 */
const MATH = /\$\$([^$]+?)\$\$|\$([^$\n]+?)\$/g;

export function mathSpans(text: string): MathSpan[] {
  const spans: MathSpan[] = [];

  for (let match = MATH.exec(text); match; match = MATH.exec(text)) {
    const [whole, block, inline] = match;
    // `\$` is a dollar sign the author wrote on purpose.
    if (text[match.index - 1] === "\\") continue;

    if (block !== undefined) {
      spans.push({
        from: match.index,
        to: match.index + whole.length,
        source: block,
        display: true,
      });
      continue;
    }
    if (inline === undefined) continue;
    if (inline.trim().length !== inline.length) continue;
    spans.push({
      from: match.index,
      to: match.index + whole.length,
      source: inline,
      display: false,
    });
  }

  MATH.lastIndex = 0;
  return spans;
}

/**
 * The formula as markup. A formula that will not parse is rendered as itself in
 * KaTeX's error colour rather than throwing: the author is mid-edit far more
 * often than wrong, and a thrown error would take the whole document's render
 * down with it.
 */
export function renderMath(source: string, display: boolean): string {
  return katex.renderToString(source, {
    displayMode: display,
    throwOnError: false,
    // Nothing in a document may reach out of it: `\href` and `\includegraphics`
    // are what `trust` turns on, and this markup is not ours.
    trust: false,
    strict: "ignore",
  });
}
