/**
 * Live preview for the markdown editor: the file is edited as the text it is,
 * and the text is drawn as what it means. A heading is large, `**bold**` is
 * bold, a task has a box that can be ticked. The syntax that makes a line what
 * it is stays in the document and is hidden on every line the caret is not on,
 * so moving into a line shows the markdown and leaving it shows the page.
 *
 * `previews` is pure over an `EditorState` and is what the tests cover; the
 * field below only turns its answer into decorations.
 */

import { ensureSyntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Line, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  documentMermaidTheme,
  mathSpans,
  renderMath,
  renderMermaid,
  renderedMermaid,
} from "@nib-ui/render";
import { type ColumnAlign, type MarkdownTable, parseTable, tableMarkdown } from "./table";

export type Preview =
  | { kind: "line"; from: number; className: string }
  | { kind: "mark"; from: number; to: number; className: string }
  | { kind: "hide"; from: number; to: number }
  | { kind: "bullet"; from: number; to: number }
  | { kind: "task"; from: number; to: number; checked: boolean }
  | { kind: "rule"; from: number; to: number }
  /** A ```mermaid fence, drawn as the diagram it describes. */
  | { kind: "diagram"; from: number; to: number; source: string }
  /** A pipe table, drawn as a grid. */
  | { kind: "table"; from: number; to: number; source: string }
  /** `$x^2$` or `$$…$$`, drawn as the formula it sets. */
  | {
      kind: "math";
      from: number;
      to: number;
      source: string;
      display: boolean;
      /** It has its lines to itself, so it replaces them rather than sitting in one. */
      block: boolean;
    };

/** How long the parser may run to catch up before a draw; a note is well under it. */
const PARSE_BUDGET_MS = 20;

/** Nodes whose text is taken as written, so no formula is looked for inside them. */
const LITERAL_NODES = new Set(["InlineCode", "FencedCode", "CodeBlock", "Table"]);

const INLINE: Record<string, { className: string; marks: string[] }> = {
  Emphasis: { className: "cm-em", marks: ["EmphasisMark"] },
  StrongEmphasis: { className: "cm-strong", marks: ["EmphasisMark"] },
  Strikethrough: { className: "cm-strike", marks: ["StrikethroughMark"] },
  InlineCode: { className: "cm-inline-code", marks: ["CodeMark"] },
};

/** Every line a selection touches; the syntax on these lines is shown. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) lines.add(line);
  }
  return lines;
}

export function previews(state: EditorState): Preview[] {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS);
  if (!tree) return [];

  const active = activeLines(state);
  const out: Preview[] = [];
  // A block node's range can end on the newline that closes it, which belongs to
  // the block's own last line and not to the one after.
  const lastLine = (from: number, to: number): Line =>
    state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to);
  const isActive = (from: number, to: number): boolean => {
    const first = state.doc.lineAt(from).number;
    const last = lastLine(from, to).number;
    for (let line = first; line <= last; line += 1) if (active.has(line)) return true;
    return false;
  };
  const hide = (node: SyntaxNode | null, trailingSpace = false): void => {
    if (!node) return;
    const to =
      trailingSpace && state.doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
    out.push({ kind: "hide", from: node.from, to });
  };
  const hideChildren = (parent: SyntaxNode, names: readonly string[]): void => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (names.includes(child.name)) hide(child);
    }
  };
  /**
   * Where a `$` is a dollar sign whatever else it looks like: inside code, and
   * inside a table, whose cells are rewritten from the grid rather than read as
   * prose.
   */
  const literal: { from: number; to: number }[] = [];

  tree.iterate({
    enter(cursor) {
      const { name, from, to } = cursor;
      if (LITERAL_NODES.has(name)) literal.push({ from, to });
      const heading = /^ATXHeading(\d)$/.exec(name);
      if (heading) {
        out.push({
          kind: "line",
          from: state.doc.lineAt(from).from,
          className: `cm-heading cm-heading-${heading[1]}`,
        });
        if (!isActive(from, to)) hide(cursor.node.getChild("HeaderMark"), true);
        return;
      }

      const inline = INLINE[name];
      if (inline) {
        out.push({ kind: "mark", from, to, className: inline.className });
        if (!isActive(from, to)) hideChildren(cursor.node, inline.marks);
        return;
      }

      if (name === "Link") {
        out.push({ kind: "mark", from, to, className: "cm-link" });
        // Only a `[label](url)` has something left to show once its syntax is
        // hidden; an autolink is nothing but its url.
        if (!isActive(from, to) && state.doc.sliceString(from, from + 1) === "[")
          hideChildren(cursor.node, ["LinkMark", "URL"]);
        return;
      }

      if (name === "ListItem") {
        const mark = cursor.node.getChild("ListMark");
        if (!mark) return;
        const task = cursor.node.getChild("Task");
        const marker = task?.getChild("TaskMarker") ?? null;
        if (task && marker) {
          const checked = /x/i.test(state.doc.sliceString(marker.from, marker.to));
          const line = state.doc.lineAt(from);
          out.push({
            kind: "line",
            from: line.from,
            className: checked ? "cm-task cm-task-done" : "cm-task",
          });
          // The bullet before a task is part of the box, so the two hide as one.
          if (isActive(from, to)) {
            out.push({ kind: "task", from: marker.from, to: marker.to, checked });
          } else {
            out.push({ kind: "hide", from: mark.from, to: marker.from });
            out.push({ kind: "task", from: marker.from, to: marker.to, checked });
          }
          return;
        }
        const isBullet = /^[-*+]$/.test(state.doc.sliceString(mark.from, mark.to));
        if (isBullet && !isActive(mark.from, mark.to))
          out.push({ kind: "bullet", from: mark.from, to: mark.to });
        return;
      }

      if (name === "HorizontalRule") {
        if (!isActive(from, to)) out.push({ kind: "rule", from, to });
        return;
      }

      if (name === "Blockquote") {
        const first = state.doc.lineAt(from).number;
        const last = lastLine(from, to).number;
        for (let number = first; number <= last; number += 1)
          out.push({ kind: "line", from: state.doc.line(number).from, className: "cm-quote" });
        if (!isActive(from, to)) hideChildren(cursor.node, ["QuoteMark"]);
        return;
      }

      if (name === "Table") {
        const first = state.doc.lineAt(from);
        const last = lastLine(from, to);
        // The caret is in the lines themselves, which only happens while the
        // table is being typed: the row that turns three lines into a table
        // would otherwise become a grid under the author's hands and take the
        // caret with it. Clicking a cell of a drawn grid does not put the caret
        // here — the widget keeps those events — so a table only goes back to
        // its pipes for the person writing one.
        if (isActive(from, to)) {
          for (let number = first.number; number <= last.number; number += 1)
            out.push({ kind: "line", from: state.doc.line(number).from, className: "cm-table" });
          return;
        }
        out.push({
          kind: "table",
          from: first.from,
          to: last.to,
          source: state.doc.sliceString(first.from, last.to),
        });
        return;
      }

      if (name === "FencedCode") {
        const first = state.doc.lineAt(from);
        const last = lastLine(from, to);
        const info = cursor.node.getChild("CodeInfo");
        const language = info && state.doc.sliceString(info.from, info.to).trim().toLowerCase();
        const code = cursor.node.getChild("CodeText");
        // A diagram is what the fence means, so it is drawn instead of shaded —
        // but only once the fence is closed, since half a diagram is an error
        // message where the author is still typing.
        const closed = /^[ \t]*(?:```|~~~)[ \t]*$/.test(last.text);
        if (language === "mermaid" && code && closed && !isActive(from, to)) {
          out.push({
            kind: "diagram",
            from: first.from,
            to: last.to,
            source: state.doc.sliceString(code.from, code.to),
          });
          return;
        }

        for (let number = first.number; number <= last.number; number += 1)
          out.push({ kind: "line", from: state.doc.line(number).from, className: "cm-code-block" });
        // The fences are whole lines of their own, so both go when the block is
        // left, and what remains is the code on its shaded lines.
        if (!isActive(from, to) && first.number !== last.number) {
          out.push({ kind: "hide", from: first.from, to: first.to });
          out.push({ kind: "hide", from: last.from, to: last.to });
        }
      }
    },
  });

  // Math is found in the text rather than in the tree: the markdown parser knows
  // nothing about `$`, and everywhere a dollar sign means a dollar sign is
  // already marked out above.
  const text = state.doc.toString();
  for (const span of mathSpans(text)) {
    if (literal.some((range) => span.from < range.to && span.to > range.from)) continue;
    if (isActive(span.from, span.to)) continue;

    const opening = state.doc.lineAt(span.from);
    const closing = state.doc.lineAt(span.to);
    out.push({
      kind: "math",
      from: span.from,
      to: span.to,
      source: span.source,
      display: span.display,
      block: span.display && opening.from === span.from && closing.to === span.to,
    });
  }

  return out;
}

class TaskWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
  ) {
    super();
  }

  override eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.from === this.from;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("span");
    box.className = this.checked ? "cm-task-box cm-task-box-done" : "cm-task-box";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    // The marker is `[ ]` or `[x]`, and the tick is the character between.
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        changes: { from: this.from + 1, to: this.from + 2, insert: this.checked ? " " : "x" },
      });
    });
    return box;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const dot = document.createElement("span");
    dot.className = "cm-bullet";
    dot.textContent = "•";
    return dot;
  }
}

class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-rule";
    return rule;
  }
}

/**
 * The diagram a mermaid fence describes. Rendering is asynchronous and the
 * widget is not, so the element is put on the page empty and filled in when the
 * render lands; a diagram already drawn is filled in before it is ever shown,
 * because the cache answers in the same tick.
 */
class DiagramWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  override eq(other: DiagramWidget): boolean {
    return other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const block = document.createElement("div");
    block.className = "cm-diagram";
    const theme = documentMermaidTheme();

    const drawn = renderedMermaid(this.source, theme);
    if (drawn) {
      block.innerHTML = drawn.svg;
      return block;
    }

    void renderMermaid(this.source, theme).then(
      (diagram) => {
        block.innerHTML = diagram.svg;
      },
      (error: unknown) => {
        // The source is still in the document — the widget only covers it — so
        // clicking into the block is how the author gets back to what broke.
        block.classList.add("cm-diagram-error");
        block.textContent = error instanceof Error ? error.message : String(error);
      },
    );
    return block;
  }

  /** The diagram is drawn from the document, so a click belongs to CodeMirror. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * A formula, set by KaTeX. Synchronous, unlike the diagram above it: KaTeX is
 * typesetting rather than layout, so the markup is ready before the widget is on
 * the page.
 */
class MathWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly display: boolean,
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return other.source === this.source && other.display === this.display;
  }

  override toDOM(): HTMLElement {
    const formula = document.createElement(this.display ? "div" : "span");
    formula.className = this.display ? "cm-math cm-math-display" : "cm-math";
    formula.innerHTML = renderMath(this.source, this.display);
    return formula;
  }

  /** Nothing in it answers a pointer, so a click belongs to the document. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Which cell to put the caret in once the document has been rewritten. Editing a
 * cell replaces the table's lines, which builds the widget again from scratch —
 * so adding a row and carrying on typing only works if the new grid knows where
 * the author was. Keyed by where the table starts, which a rewrite in place does
 * not move.
 */
let pendingCell: { from: number; row: number; column: number } | null = null;

/**
 * A pipe table, drawn as the grid it is and edited in it. The cells are the only
 * editable islands in the document — the markdown under them is rewritten when
 * the author leaves the table, rather than on every keystroke, because rewriting
 * it builds this widget again and would take the caret with it.
 */
class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
  ) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source && other.from === this.from;
  }

  override toDOM(view: EditorView): HTMLElement {
    const block = document.createElement("div");
    block.className = "cm-table-block";

    const parsed = parseTable(this.source);
    if (!parsed) {
      // Only reachable if the editor's own parser and this one disagree about
      // what a table is, and then the source is the honest thing to show.
      block.textContent = this.source;
      return block;
    }

    const table = document.createElement("table");
    table.className = "cm-table-grid";
    block.append(table);

    const head = table.createTHead().insertRow();
    parsed.header.forEach((name, column) => {
      head.append(this.cell(document.createElement("th"), name, parsed.align[column]));
    });

    const body = table.createTBody();
    for (const row of parsed.rows) {
      const line = body.insertRow();
      row.forEach((text, column) => {
        this.cell(line.insertCell(), text, parsed.align[column]);
      });
    }

    block.append(
      this.button("cm-table-add-row", "Add row", () => this.addRow(view, table)),
      this.button("cm-table-add-column", "Add column", () => this.addColumn(view, table)),
    );

    // The author has left the table: what is in the cells becomes what is in the
    // file. `focusout` rather than each keystroke, so the caret survives typing.
    block.addEventListener("focusout", (event) => {
      if (block.contains(event.relatedTarget as Node | null)) return;
      this.commit(view, table, null);
    });
    block.addEventListener("keydown", (event) => this.onKeydown(event, view, table));

    this.restoreCaret(table);
    return block;
  }

  private cell(
    cell: HTMLTableCellElement,
    text: string,
    align: ColumnAlign | undefined,
  ): HTMLTableCellElement {
    cell.textContent = text;
    cell.contentEditable = "true";
    cell.spellcheck = false;
    if (align !== undefined) cell.style.textAlign = align;
    return cell;
  }

  private button(className: string, label: string, press: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = "+";
    button.title = label;
    button.setAttribute("aria-label", label);
    // On mousedown, because the press would otherwise take focus out of the cell
    // first and commit what is in it twice.
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      press();
    });
    return button;
  }

  /**
   * Tab walks the grid and Enter opens the next row, which is what a table in
   * any editor does. Escape leaves it: the caret goes back to the document, past
   * the table, so there is a way out that is not the mouse.
   */
  private onKeydown(event: KeyboardEvent, view: EditorView, table: HTMLTableElement): void {
    const cells = [...table.querySelectorAll<HTMLTableCellElement>("th, td")];
    const at = cells.indexOf(document.activeElement as HTMLTableCellElement);
    if (at === -1) return;

    if (event.key === "Escape") {
      event.preventDefault();
      this.commit(view, table, null);
      view.focus();
      return;
    }

    if (event.key === "Tab") {
      const next = cells[at + (event.shiftKey ? -1 : 1)];
      event.preventDefault();
      if (next) {
        next.focus();
        return;
      }
      // Past the last cell: a new row, which is how a table is filled in.
      if (!event.shiftKey) this.addRow(view, table);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.addRow(view, table);
    }
  }

  private addRow(view: EditorView, table: HTMLTableElement): void {
    const width = table.tHead?.rows[0]?.cells.length ?? 0;
    const rows = table.tBodies[0]?.rows.length ?? 0;
    const grid = this.gridOf(table);
    grid.rows.push(Array.from({ length: width }, () => ""));
    this.commit(view, table, { row: rows + 1, column: 0 }, grid);
  }

  private addColumn(view: EditorView, table: HTMLTableElement): void {
    const grid = this.gridOf(table);
    grid.header.push("");
    grid.align.push("left");
    for (const row of grid.rows) row.push("");
    this.commit(view, table, { row: 0, column: grid.header.length - 1 }, grid);
  }

  /** What is in the cells right now, which is what the file is about to say. */
  private gridOf(table: HTMLTableElement): MarkdownTable {
    const parsed = parseTable(this.source);
    const header = [...(table.tHead?.rows[0]?.cells ?? [])].map((cell) => cell.textContent ?? "");
    const rows = [...(table.tBodies[0]?.rows ?? [])].map((row) =>
      [...row.cells].map((cell) => cell.textContent ?? ""),
    );
    const align = header.map((_name, column) => parsed?.align[column] ?? "left");
    return { header, align, rows };
  }

  /**
   * Writes the grid back over the lines it came from. The range is the table's
   * own: a rewrite in place leaves everything around it where it was, so nothing
   * else in the document has to be remapped.
   */
  private commit(
    view: EditorView,
    table: HTMLTableElement,
    caret: { row: number; column: number } | null,
    grid: MarkdownTable = this.gridOf(table),
  ): void {
    const markdown = tableMarkdown(grid);
    pendingCell = caret === null ? null : { from: this.from, ...caret };
    if (markdown === this.source) {
      // Nothing was typed, so there is no transaction to hang the caret move on.
      if (caret !== null) this.restoreCaret(table);
      return;
    }
    view.dispatch({
      changes: { from: this.from, to: this.from + this.source.length, insert: markdown },
    });
  }

  /** Puts the caret back where the rewrite that built this widget left it. */
  private restoreCaret(table: HTMLTableElement): void {
    const target = pendingCell;
    if (!target || target.from !== this.from) return;
    pendingCell = null;

    const row = target.row === 0 ? table.tHead?.rows[0] : table.tBodies[0]?.rows[target.row - 1];
    const cell = row?.cells[target.column];
    if (!cell) return;
    // After the widget is on the page: a cell cannot take focus before it is.
    requestAnimationFrame(() => cell.focus());
  }

  /** Everything inside the grid is the widget's, including the typing. */
  override ignoreEvent(): boolean {
    return true;
  }
}

function decorate(state: EditorState): DecorationSet {
  const ranges = previews(state).map((preview) => {
    switch (preview.kind) {
      case "line":
        return Decoration.line({ class: preview.className }).range(preview.from);
      case "mark":
        return Decoration.mark({ class: preview.className }).range(preview.from, preview.to);
      case "hide":
        return Decoration.replace({}).range(preview.from, preview.to);
      case "bullet":
        return Decoration.replace({ widget: new BulletWidget() }).range(preview.from, preview.to);
      case "task":
        return Decoration.replace({ widget: new TaskWidget(preview.checked, preview.from) }).range(
          preview.from,
          preview.to,
        );
      case "rule":
        return Decoration.replace({ widget: new RuleWidget() }).range(preview.from, preview.to);
      // Both cover whole lines, so they replace as blocks: a widget inline in a
      // line would be laid out as one very tall character.
      case "diagram":
        return Decoration.replace({
          widget: new DiagramWidget(preview.source),
          block: true,
        }).range(preview.from, preview.to);
      case "table":
        return Decoration.replace({
          widget: new TableWidget(preview.source, preview.from),
          block: true,
        }).range(preview.from, preview.to);
      case "math":
        return Decoration.replace({
          widget: new MathWidget(preview.source, preview.display),
          block: preview.block,
        }).range(preview.from, preview.to);
    }
  });
  return Decoration.set(ranges, true);
}

/**
 * A field rather than a view plugin, recomputed on every transaction: the
 * decorations depend on the selection as much as on the text, and a note is
 * small enough that walking its tree per keystroke costs nothing visible.
 */
export function livePreview(): Extension {
  return StateField.define<DecorationSet>({
    create: decorate,
    update: (_decorations, transaction) => decorate(transaction.state),
    provide: (field) => EditorView.decorations.from(field),
  });
}
