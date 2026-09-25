// Pane types and opening them, straight through the pane registry.
//
// Not to skip the UI but to stop paying for it: finding the affordance that
// opens a pane costs a dozen actions, and none of them are what the run was
// sent to test. The sidebar and command palette still need exercising — by
// whoever is testing the sidebar and the command palette.

import type { Page } from "playwright-core";
import type { Command } from "./actions.ts";
import { snapshot } from "./probe.ts";
import { MISSING_HANDLE, type NibWindow } from "./window.ts";

export interface PaneTypeEntry {
  id: string;
  kind: string;
  title: string;
  open: string[];
}

/** Every registered pane type, and which instances of it are open. */
export async function paneTypes(page: Page): Promise<unknown> {
  return page.evaluate((missingHandle) => {
    const debug = (window as unknown as NibWindow).__nib_debug;
    if (!debug) return { error: missingHandle };
    const types: PaneTypeEntry[] = debug.panes.definitions.map((definition) => ({
      id: definition.id,
      kind: definition.kind,
      title: definition.title,
      open: debug.panes.openPanes
        .filter((instance) => instance.paneId === definition.id)
        .map((instance) => instance.instanceId),
    }));
    types.sort((left, right) => left.id.localeCompare(right.id));
    return { types };
  }, MISSING_HANDLE);
}

/** Open a pane by type, or close it (`--close`), and return the layout it left. */
export async function pane(page: Page, refsPath: string, command: Command): Promise<unknown> {
  const request = { paneId: String(command.paneId), close: command.close === true };
  const outcome = await page.evaluate(
    ({ paneId, close, missingHandle }) => {
      const debug = (window as unknown as NibWindow).__nib_debug;
      if (!debug) return { error: missingHandle };
      const known = debug.panes.definitions.some((definition) => definition.id === paneId);
      if (!known) {
        return {
          error: `no such pane type: ${paneId}`,
          available: debug.panes.definitions.map((definition) => definition.id).sort(),
        };
      }
      if (close) {
        debug.panes.close(paneId);
        return { closed: paneId };
      }
      return { opened: debug.panes.open(paneId) };
    },
    { ...request, missingHandle: MISSING_HANDLE },
  );
  if ("error" in outcome) return outcome;
  // The pane mounts, then takes focus a frame or more later; wait so the tree
  // printed below is honest about what ended up focused.
  await page.waitForTimeout(500);
  return { ...outcome, ...(await snapshot(page, refsPath)) };
}
