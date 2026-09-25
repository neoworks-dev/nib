/**
 * What the board's right-click menu offers for ComfyUI: running a workflow on a
 * picture, and opening a workflow file — or a picture ComfyUI made — in the
 * node editor.
 */

import type { CanvasMenuItem, CanvasObject } from "@nib-ui/ui-contracts";
import type { Component } from "svelte";

/** The folder runs write their outputs into, whose pictures carry their workflow. */
const OUTPUT_FOLDER = "comfyui/";

/** What the entries do, and the icons they show, handed in by the plugin. */
export interface MenuActions {
  runWorkflowOn(path: string): void;
  openInEditor(path: string): void;
  runIcon?: Component<{ size?: number }>;
  editorIcon?: Component<{ size?: number }>;
}

/** The vault path of a card, or null for an object that is not a file. */
function cardPath(target: CanvasObject | null): string | null {
  if (!target || typeof target.path !== "string") return null;
  return target.path;
}

/** Whether the card is a still picture. */
function isPicture(target: CanvasObject): boolean {
  return target.kind === "visual" && target.video !== true;
}

/** Whether the card is a JSON file, which may hold a workflow. */
function isJsonFile(target: CanvasObject): boolean {
  return target.kind === "file" && target.extension === "json";
}

/** The ComfyUI entries for a card, ending in a separator so the board's own follow apart. */
export function comfyMenuItems(
  target: CanvasObject | null,
  actions: MenuActions,
): CanvasMenuItem[] {
  const path = cardPath(target);
  if (!target || path === null) return [];
  const items: CanvasMenuItem[] = [];
  if (isPicture(target)) {
    items.push({
      kind: "action",
      id: "comfyui.runWorkflow",
      label: "Run workflow…",
      icon: actions.runIcon,
      run: () => actions.runWorkflowOn(path),
    });
  }
  const madeByComfy = isPicture(target) && path.startsWith(OUTPUT_FOLDER) && path.endsWith(".png");
  if (isJsonFile(target) || madeByComfy) {
    items.push({
      kind: "action",
      id: "comfyui.openInEditor",
      label: "Open in node editor",
      icon: actions.editorIcon,
      run: () => actions.openInEditor(path),
    });
  }
  if (items.length > 0) items.push({ kind: "separator", id: "comfyui.separator" });
  return items;
}
