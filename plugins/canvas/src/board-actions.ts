/**
 * The board actions more than one surface offers. The context menu and the
 * selection toolbar are two ways to ask for the same things, so what each one
 * means is written once rather than kept in step by hand.
 */

import type { Point } from "@nib-ui/ui-contracts";
import { canvasState } from "./state.svelte";

/**
 * Deleting files the entry in the recycling bin rather than unlinking it, so the
 * gesture is reversed by ctrl+z and recoverable from the bin afterwards. Nothing
 * is asked first: a reversal is a better guarantee than a confirm box, and the
 * box made deleting one card a two-step gesture. A card's id is its vault path.
 */
export function deleteFromVault(path: string): void {
  void canvasState.vault.deleteEntry(path);
}

/**
 * A paste asked for by the menu rather than by ctrl+v. The keystroke arrives as a
 * `ClipboardEvent` with the data already on it; a menu entry has to go and read
 * the clipboard itself, which is a permission prompt the first time and a refusal
 * in a window that is not focused.
 *
 * The payload is assembled the way the keystroke's is, so both reach the same
 * handlers: text as text, and everything else as a file — which is what makes a
 * pasted picture a file in the vault rather than a blob nobody owns.
 */
export async function pasteFromClipboard(at: Point): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard?.read) {
    canvasState.reportError("This browser will not let the board read the clipboard.");
    return;
  }

  try {
    const files: File[] = [];
    let text: string | undefined;
    let html: string | undefined;
    for (const item of await clipboard.read()) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (type === "text/plain") {
          text = await blob.text();
          continue;
        }
        if (type === "text/html") {
          html = await blob.text();
          continue;
        }
        files.push(new File([blob], clipboardFileName(type), { type }));
      }
    }
    await canvasState.registry.paste({ text, html, files }, at);
  } catch (cause) {
    canvasState.reportError(cause instanceof Error ? cause.message : String(cause));
  }
}

/** The clipboard names nothing it holds, so the type is the only name there is. */
function clipboardFileName(type: string): string {
  const slash = type.indexOf("/");
  const extension = slash === -1 ? type : type.slice(slash + 1);
  return `pasted-${Date.now().toString(36)}.${extension}`;
}

/** The joined card carries its sources as context; its chat is where it is written. */
export function joinSelection(): void {
  const id = canvasState.join(canvasState.registry.selection);
  if (id) canvasState.open(id);
}
