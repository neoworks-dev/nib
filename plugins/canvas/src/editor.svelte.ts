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

export interface OpenEditor {
  /** Vault-relative path, which is also the card's id. */
  path: string;
  /** Where the card was on screen when it was opened. */
  origin: Rect;
  /** The whole file. Null until the read resolves. */
  source: string | null;
  error: string | null;
}

export class EditorStore {
  /** The sheet on screen, or null. Only one is open at a time: it is full-screen. */
  sheet = $state<OpenEditor | null>(null);
  /** True from the moment a close is asked for until the transition has run. */
  closing = $state(false);

  /** Where a card reads its own bytes from; set by the plugin. */
  fileUrl: ((path: string) => string | null) | null = null;

  /**
   * Opens a sheet. The card's text is fetched whole rather than taken from the
   * board object, because a card carries only as much body as it can draw.
   */
  async openSheet(path: string, origin: Rect): Promise<void> {
    this.closing = false;
    this.sheet = { path, origin, source: null, error: null };

    const url = this.fileUrl?.(path) ?? null;
    if (url === null) return;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`could not read ${path}`);
      const source = await response.text();
      // Another sheet was opened while this one was being read.
      if (this.sheet?.path !== path) return;
      this.sheet = { ...this.sheet, source };
    } catch (cause) {
      if (this.sheet?.path !== path) return;
      this.sheet = {
        ...this.sheet,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  /** Starts the shrink back into the card. The overlay clears itself when it lands. */
  requestClose(): void {
    if (this.sheet === null) return;
    this.closing = true;
  }

  /** Called by the overlay once the transition has run. */
  closed(): void {
    this.sheet = null;
    this.closing = false;
  }

  reset(): void {
    this.sheet = null;
    this.closing = false;
    this.fileUrl = null;
  }
}
