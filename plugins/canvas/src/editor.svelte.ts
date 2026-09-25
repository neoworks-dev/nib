/**
 * What is being edited, by the file it is.
 *
 * A sheet is written in a docked pane and a sticky on its own card, but both are
 * the same thing underneath: a markdown file in the vault, read whole rather than
 * from the clipped preview a card draws, and written back through the vault.
 *
 * Several sheets can be open at once — a pane each — so a note is addressed by
 * its path rather than by being "the" open one. The sticky is the exception: it
 * is laid over the card it belongs to, and there is one of those at a time.
 */

import type { Point } from "@nib-ui/ui-contracts";
import type { Size } from "@nib-ui/vault";
import { splitFrontmatter } from "./markdown";

/** How long a pause in typing is before the file is written. */
const SAVE_DEBOUNCE_MS = 400;

export interface OpenEditor {
  /** Vault-relative path, which is also the card's id. */
  path: string;
  /** Frontmatter, kept aside so a save writes it back untouched. */
  frontmatter: string | null;
  /** The body, as the text it is on disk. Null until the read resolves. */
  text: string | null;
  error: string | null;
}

/**
 * The sticky being written into, and where its card is.
 *
 * The card is described in world units and placed by its centre, because the
 * overlay is drawn at the note's own size and then scaled by the camera: type
 * set in screen pixels would only match the card at zoom 1, and the two would
 * drift apart the moment the board was zoomed.
 */
export interface OpenSticky {
  path: string;
  /** The card's middle, in pane coordinates. */
  centre: Point;
  /** The card in world units. */
  size: Size;
  zoom: number;
  /** How far the card is turned on the table, in radians. */
  tilt: number;
}

export class EditorStore {
  /** Every note open for writing, by path. */
  notes = $state<Record<string, OpenEditor>>({});
  sticky = $state<OpenSticky | null>(null);

  /** Where a card reads its own bytes from; set by the plugin. */
  fileUrl: ((path: string) => string | null) | null = null;
  /** Where an edit goes. Set by the plugin: the editor does not know the vault. */
  save: ((path: string, text: string) => Promise<void>) | null = null;

  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending: Promise<void> = Promise.resolve();

  note(path: string): OpenEditor | null {
    return this.notes[path] ?? null;
  }

  stickyNote(): OpenEditor | null {
    const path = this.sticky?.path;
    return path === undefined ? null : this.note(path);
  }

  /**
   * Opens a note for writing. Its text is fetched whole rather than taken from the
   * board object, because a card carries only as much body as it can draw. A note
   * that is already open is left as it is: its unsaved edits are the newer copy.
   */
  async open(path: string): Promise<void> {
    if (this.notes[path]) return;
    this.notes = { ...this.notes, [path]: { path, frontmatter: null, text: null, error: null } };

    const url = this.fileUrl?.(path) ?? null;
    if (url === null) return;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`could not read ${path}`);
      const { frontmatter, body } = splitFrontmatter(await response.text());
      this.patch(path, { frontmatter, text: body });
    } catch (cause) {
      this.patch(path, { error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  /** Opens a note on the card it is drawn as, rather than in a pane of its own. */
  async openSticky(path: string, placement: Omit<OpenSticky, "path">): Promise<void> {
    await this.closeSticky();
    this.sticky = { path, ...placement };
    await this.open(path);
  }

  /** Writes what is unsaved and drops the note: the pane showing it has gone. */
  async close(path: string): Promise<void> {
    await this.flush(path);
    this.notes = Object.fromEntries(Object.entries(this.notes).filter(([key]) => key !== path));
    if (this.sticky?.path === path) this.sticky = null;
  }

  /**
   * Drops a note without writing it. For a file that is no longer in the vault:
   * `close` flushes what is unsaved, which for a deleted note would write it back
   * and undo the delete from the editor that was showing it.
   */
  discard(path: string): void {
    const timer = this.timers.get(path);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(path);
    this.notes = Object.fromEntries(Object.entries(this.notes).filter(([key]) => key !== path));
    if (this.sticky?.path === path) this.sticky = null;
  }

  async closeSticky(): Promise<void> {
    const path = this.sticky?.path;
    this.sticky = null;
    if (path !== undefined) await this.close(path);
  }

  /** The editor's text changed. The whole body comes each time; the editor owns the edit. */
  setText(path: string, text: string): void {
    const note = this.notes[path];
    if (!note || note.text === null || note.text === text) return;
    this.patch(path, { text });
    this.scheduleSave(path);
  }

  /** Writes now rather than after the pause. The tests' join point, and close's. */
  async flush(path?: string): Promise<void> {
    const paths = path === undefined ? [...this.timers.keys()] : [path];
    let wrote = false;
    for (const key of paths) {
      const timer = this.timers.get(key);
      if (timer === undefined) continue;
      clearTimeout(timer);
      this.timers.delete(key);
      this.write(key);
      wrote = true;
    }
    if (wrote) await this.pending;
  }

  private patch(path: string, fields: Partial<OpenEditor>): void {
    const note = this.notes[path];
    // The note was closed while its read was in flight; there is nothing to fill.
    if (!note) return;
    this.notes = { ...this.notes, [path]: { ...note, ...fields } };
  }

  /**
   * Every change reaches the file, but not every keystroke reaches the disk: the
   * write is held for a pause so a sentence is one save rather than forty.
   */
  private scheduleSave(path: string): void {
    const timer = this.timers.get(path);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path);
        this.write(path);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  private write(path: string): void {
    const note = this.notes[path];
    const save = this.save;
    if (!note || note.text === null || !save) return;
    const text = note.frontmatter === null ? note.text : `${note.frontmatter}\n${note.text}`;
    // Chained rather than replaced: two notes saving at once are two writes, and
    // a flush that awaited only the last of them would return before the first.
    this.pending = this.pending.then(() => save(path, text));
  }

  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.notes = {};
    this.sticky = null;
    this.fileUrl = null;
    this.save = null;
  }
}
