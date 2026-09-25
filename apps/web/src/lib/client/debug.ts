import type { Context } from "@nib-ui/kernel";
import { canvasState } from "@nib-ui/plugin-canvas";
import type { PaneRegistry } from "@nib-ui/ui-contracts";

/** What `bun run debug` reads the running app through: `probe`, `pane`, `eval`. */
export interface NibDebugHandle {
  context: Context;
  panes: PaneRegistry;
  canvas: typeof canvasState;
}

declare global {
  interface Window {
    __nib_debug?: NibDebugHandle;
  }
}

/**
 * Put the live kernel, pane registry and board state on `window`, where the
 * debug harness's driver reaches them over CDP. Read-only by convention: the
 * harness acts through the UI and the registry's own methods.
 */
export function exposeDebugHandle(context: Context): void {
  window.__nib_debug = { context, panes: context.require("panes"), canvas: canvasState };
}
