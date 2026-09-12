/**
 * What is being edited, and where on the board it came from.
 *
 * A sheet opens full-screen and a sticky is edited in place, but both are the
 * same thing underneath: a markdown file in the vault, read whole rather than
 * from the clipped preview a card draws, and written back through the vault.
 *
 * The origin rectangle is screen space at the moment the gesture happened. It is
 * what the open and close transitions run between, so the sheet grows out of its
 * own card and shrinks back into it.
 */

import type { Rect } from "@nib-ui/ui-contracts";
import {
  type Block,
  type BlockStyle,
  blockAfter,
  documentToMarkdown,
  parseDocument,
  restyle,
  toggleTask,
} from "./markdown";

/** How long a pause in typing is before the file is written. */
const SAVE_DEBOUNCE_MS = 400;

export interface OpenEditor {
  /** Vault-relative path, which is also the card's id. */
  path: string;
  /** Where the card was on screen when it was opened. */
  origin: Rect;
  /** Whether it fills the pane, or sits on the card it came from. */
  full: boolean;
  /** Frontmatter, kept aside so a save writes it back untouched. */
  frontmatter: string | null;
  /** The body as blocks. Null until the read resolves. */
  blocks: Block[] | null;
  error: string | null;
}

/** Which block the popover is open on, if any. */
export interface OpenPopover {
  index: number;
  /** Where the grip is, in pane coordinates, so the menu can sit beside it. */
  x: number;
  y: number;
}

export class EditorStore {
  /** What is being written into, or null. Only one at a time. */
  open = $state<OpenEditor | null>(null);
  /** True from the moment a close is asked for until the transition has run. */
  closing = $state(false);
  popover = $state<OpenPopover | null>(null);

  /** Where a card reads its own bytes from; set by the plugin. */
  fileUrl: ((path: string) => string | null) | null = null;
  /** Where an edit goes. Set by the plugin: the editor does not know the vault. */
  save: ((path: string, text: string) => Promise<void>) | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** The sheet on screen, for the full-screen overlay. */
  get sheet(): OpenEditor | null {
    return this.open?.full === true ? this.open : null;
  }

  /** The sticky being written into on its own card. */
  get sticky(): OpenEditor | null {
    return this.open?.full === false ? this.open : null;
  }

  /**
   * Opens a note. Its text is fetched whole rather than taken from the board
   * object, because a card carries only as much body as it can draw.
   */
  async openNote(path: string, origin: Rect, full: boolean): Promise<void> {
    await this.flush();
    this.closing = false;
    this.popover = null;
    this.open = { path, origin, full, frontmatter: null, blocks: null, error: null };

    const url = this.fileUrl?.(path) ?? null;
    if (url === null) return;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`could not read ${path}`);
      const parsed = parseDocument(await response.text());
      // Another note was opened while this one was being read.
      if (this.open?.path !== path) return;
      this.open = { ...this.open, frontmatter: parsed.frontmatter, blocks: parsed.blocks };
    } catch (cause) {
      if (this.open?.path !== path) return;
      this.open = {
        ...this.open,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  /** A line was typed into. */
  setText(index: number, text: string): void {
    this.editBlock(index, (block) => ({ ...block, text }));
  }

  /** A row of the block popover was picked. */
  setStyle(index: number, style: BlockStyle): void {
    this.popover = null;
    this.editBlock(index, (block) => restyle(block, style));
  }

  /** A checkbox was pressed, on a card or in the page. */
  toggle(index: number): void {
    this.editBlock(index, toggleTask);
  }

  /**
   * Enter at the end of a line. A list or a task continues, and everything else
   * starts a body line — which is why typing a title then Enter then text gives
   * a task only after the first bullet, and not before it.
   */
  splitAt(index: number): number {
    const open = this.open;
    if (!open?.blocks) return index;

    const block = open.blocks[index];
    if (!block) return index;

    const blocks = [...open.blocks];
    blocks.splice(index + 1, 0, blockAfter(block));
    this.open = { ...open, blocks };
    this.scheduleSave();
    return index + 1;
  }

  /** Backspace at the start of an empty line folds it back into the one above. */
  removeAt(index: number): number {
    const open = this.open;
    if (!open?.blocks || open.blocks.length <= 1 || index === 0) return index;

    const blocks = [...open.blocks];
    blocks.splice(index, 1);
    this.open = { ...open, blocks };
    this.scheduleSave();
    return index - 1;
  }

  openPopover(index: number, x: number, y: number): void {
    this.popover = { index, x, y };
  }

  closePopover(): void {
    this.popover = null;
  }

  /** Starts the shrink back into the card. The overlay clears itself when it lands. */
  requestClose(): void {
    if (this.open === null) return;
    this.closing = true;
  }

  /** Called by the overlay once the transition has run. */
  async closed(): Promise<void> {
    this.open = null;
    this.closing = false;
    this.popover = null;
    await this.flush();
  }

  /** Writes now rather than after the pause. The tests' join point, and close's. */
  async flush(): Promise<void> {
    if (this.saveTimer === null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.pending;
  }

  private pending: Promise<void> = Promise.resolve();

  private editBlock(index: number, edit: (block: Block) => Block): void {
    const open = this.open;
    if (!open?.blocks) return;

    const block = open.blocks[index];
    if (!block) return;

    const blocks = [...open.blocks];
    blocks[index] = edit(block);
    this.open = { ...open, blocks };
    this.scheduleSave();
  }

  /**
   * Every change reaches the file, but not every keystroke reaches the disk: the
   * write is held for a pause so a sentence is one save rather than forty.
   */
  private scheduleSave(): void {
    const open = this.open;
    if (!open?.blocks) return;

    const path = open.path;
    const text = documentToMarkdown({ frontmatter: open.frontmatter, blocks: open.blocks });
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.pending = this.save?.(path, text) ?? Promise.resolve();
    }, SAVE_DEBOUNCE_MS);
  }

  reset(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.open = null;
    this.closing = false;
    this.popover = null;
    this.fileUrl = null;
    this.save = null;
  }
}
