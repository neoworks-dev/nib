// The driver's JSON, as the command that asked for it reads best.

import { parseDriverOutput } from "../drive.ts";
import type { PaneTypeEntry } from "../driver/panes.ts";
import { renderPaneTypes, renderSnapshot } from "../render.ts";
import type { Snapshot } from "../snapshot.ts";

/**
 * `probe` and `pane` answer with a whole snapshot, which reads as a tree;
 * `panes` as a table; `screenshot` as just its path. Everything else answers
 * with a line or two that is already readable as JSON.
 */
export function printable(command: string, output: string): string {
  if (command === "panes")
    return renderPaneTypes(parseDriverOutput<{ types: PaneTypeEntry[] }>(output).types);
  if (command === "screenshot")
    return `screenshot: ${parseDriverOutput<{ shot: string }>(output).shot}`;
  if (command !== "probe" && command !== "pane") return output;

  const snapshot = parseDriverOutput<Snapshot & Record<string, unknown>>(output);
  // An error before the snapshot was taken, such as an unknown pane type, has
  // no layout to draw.
  if (snapshot.board === undefined) return output;

  const lines: string[] = [];
  if (typeof snapshot.opened === "string") lines.push(`opened ${snapshot.opened}`, "");
  if (typeof snapshot.closed === "string") lines.push(`closed ${snapshot.closed}`, "");
  lines.push(renderSnapshot(snapshot));
  if (typeof snapshot.screenshot === "string") lines.push("", `screenshot: ${snapshot.screenshot}`);
  return lines.join("\n");
}
