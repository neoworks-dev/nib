/**
 * How the editor draws. Two looks over one editor: the sheet is a page — sans,
 * large headings, ~17px prose — and the sticky is the card it sits on — bold
 * sans title line, monospace body, the sizes `CARD_TYPE` gives the Pixi card so
 * the overlay lands on the same pixels.
 *
 * Preview classes come from `live-preview`; their look is shared, and only the
 * base type differs by kind.
 */

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CHECKBOX_GAP, CHECKBOX_SIZE, STICKY_TYPE } from "./sticky-page";
import { STICKY_INK } from "./theme";

export type EditorThemeKind = "sheet" | "sticky";

const SANS = "var(--font-sans, ui-sans-serif, system-ui, sans-serif)";
const MONO = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

const INK = "#000000";
const PROSE = "#262626";
const MUTED = "#525252";
const FAINT = "#a3a3a3";
const HAIRLINE = "#d4d4d4";
const WASH = "#f5f5f5";
const LINK = "#2563eb";

const PREVIEW = {
  "&.cm-focused": { outline: "none" },
  // CodeMirror's own base theme puts `monospace` on the scroller, which would win
  // over the font set on the editor root.
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
  ".cm-content": { padding: "0", caretColor: INK, fontFamily: "inherit" },
  ".cm-line": { padding: "0" },
  ".cm-heading": { color: INK, fontWeight: "600", lineHeight: "1.25" },
  ".cm-heading-1": { fontSize: "32px", fontWeight: "700", letterSpacing: "-0.02em" },
  ".cm-heading-2": { fontSize: "24px" },
  ".cm-heading-3": { fontSize: "19px" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through" },
  ".cm-inline-code": {
    fontFamily: MONO,
    fontSize: "0.9em",
    backgroundColor: WASH,
    borderRadius: "4px",
    padding: "0 4px",
  },
  ".cm-link": { color: LINK, textDecoration: "underline" },
  ".cm-quote": { borderLeft: `3px solid ${HAIRLINE}`, paddingLeft: "12px", color: MUTED },
  ".cm-code-block": { fontFamily: MONO, fontSize: "0.9em", backgroundColor: "#fafafa" },
  ".cm-task-done": { color: FAINT, textDecoration: "line-through" },
  ".cm-task-box": {
    display: "inline-block",
    width: "14px",
    height: "14px",
    marginRight: "8px",
    verticalAlign: "-2px",
    border: `1.5px solid ${FAINT}`,
    borderRadius: "3px",
    cursor: "pointer",
  },
  ".cm-task-box-done": { backgroundColor: INK, borderColor: INK },
  ".cm-bullet": { color: FAINT },
  ".cm-rule": {
    display: "inline-block",
    width: "100%",
    height: "1px",
    verticalAlign: "middle",
    backgroundColor: HAIRLINE,
  },
  ".cm-diagram": { margin: "12px 0", overflowX: "auto" },
  // The diagram carries its own width, so it is told to shrink into the column
  // rather than pushing the page sideways.
  ".cm-diagram svg": { maxWidth: "100%", height: "auto" },
  ".cm-diagram-error": { fontFamily: MONO, fontSize: "0.85em", color: "#b91c1c" },
  // The pipes are monospaced so the columns line up while a table is being
  // typed; every table the caret is not in is the grid below, and the buttons
  // past its edges are how it grows.
  ".cm-table": { fontFamily: MONO, fontSize: "0.9em" },
  ".cm-table-block": { position: "relative", margin: "10px 0", paddingRight: "18px" },
  ".cm-table-grid": { borderCollapse: "collapse", fontSize: "0.95em", width: "100%" },
  ".cm-table-grid th, .cm-table-grid td": {
    border: `1px solid ${HAIRLINE}`,
    padding: "4px 10px",
    verticalAlign: "top",
  },
  ".cm-table-grid th": { fontWeight: "600", color: INK, backgroundColor: WASH },
  ".cm-table-grid th:focus, .cm-table-grid td:focus": {
    outline: `2px solid ${LINK}`,
    outlineOffset: "-2px",
  },
  ".cm-table-add-row, .cm-table-add-column": {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${HAIRLINE}`,
    borderRadius: "4px",
    background: WASH,
    color: MUTED,
    cursor: "pointer",
    // Out of the way until the table is being worked on, which is what Notion
    // does: a grid ringed with buttons reads as a form rather than as a table.
    opacity: "0",
    transition: "opacity 120ms",
  },
  ".cm-table-block:hover .cm-table-add-row, .cm-table-block:hover .cm-table-add-column": {
    opacity: "1",
  },
  ".cm-table-block:focus-within .cm-table-add-row, .cm-table-block:focus-within .cm-table-add-column":
    { opacity: "1" },
  ".cm-table-add-row": { left: "0", right: "18px", bottom: "-16px", height: "14px" },
  ".cm-table-add-column": { top: "0", bottom: "0", right: "0", width: "14px" },
  ".cm-math-display": { display: "block", margin: "10px 0", textAlign: "center" },
};

const SHEET = {
  "&": { fontFamily: SANS, fontSize: "17px", lineHeight: "1.6", color: PROSE },
};

/**
 * The sticky overlay is the card: same family, same sizes, same ink on the same
 * paper. The headings are the card's own scale rather than the sheet's, which is
 * three times the size and would jump as the overlay opened.
 */
const STICKY = {
  "&": {
    height: "100%",
    fontFamily: SANS,
    fontSize: `${STICKY_TYPE.body}px`,
    // The exact line box the card bakes, rather than a ratio that rounds the
    // other way: a note is a dozen lines, and half a pixel each is a whole line
    // of drift between the card and the overlay over it.
    lineHeight: `${Math.round(STICKY_TYPE.body * 1.5)}px`,
    color: STICKY_INK.muted,
  },
  ".cm-heading": { color: STICKY_INK.text, fontWeight: "700" },
  ".cm-heading-1": {
    fontSize: `${STICKY_TYPE.display}px`,
    lineHeight: `${Math.round(STICKY_TYPE.display * 1.22)}px`,
  },
  ".cm-heading-2": {
    fontSize: `${STICKY_TYPE.headline}px`,
    lineHeight: `${Math.round(STICKY_TYPE.headline * 1.3)}px`,
  },
  ".cm-heading-3": {
    fontSize: `${STICKY_TYPE.subheader}px`,
    lineHeight: `${Math.round(STICKY_TYPE.subheader * 1.3)}px`,
    fontWeight: "600",
  },
  ".cm-task-box": {
    display: "inline-block",
    width: `${CHECKBOX_SIZE}px`,
    height: `${CHECKBOX_SIZE}px`,
    marginRight: `${CHECKBOX_GAP}px`,
    verticalAlign: "-1px",
    border: `1.5px solid rgba(16, 17, 20, 0.45)`,
    borderRadius: "3px",
    cursor: "pointer",
  },
  ".cm-task-box-done": { backgroundColor: INK, borderColor: INK },
  ".cm-bullet": { color: STICKY_INK.muted },
  // No chip behind it: the card sets code in the mono face and nothing else, and
  // a shaded box here would be the one thing the two do not share.
  ".cm-inline-code": { fontFamily: MONO },
  ".cm-link": { color: STICKY_INK.link, textDecoration: "underline" },
};

export function editorTheme(kind: EditorThemeKind): Extension {
  return EditorView.theme({ ...PREVIEW, ...(kind === "sheet" ? SHEET : STICKY) });
}
