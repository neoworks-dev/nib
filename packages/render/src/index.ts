/**
 * The markup a markdown document carries that a browser will not draw on its
 * own: mermaid diagrams and TeX. One package, because the two are wanted in the
 * same three places — the chat's messages, the note editor and the board.
 *
 * Both are browser-only. Nothing here is imported from a test or from the server.
 */

export {
  documentMermaidTheme,
  MermaidError,
  type MermaidDiagram,
  type MermaidTheme,
  renderedMermaid,
  renderMermaid,
} from "./mermaid";
export { mathSpans, renderMath, type MathSpan } from "./math";
