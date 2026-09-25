/**
 * What the board's right-click menu offers for ComfyUI: running a workflow on a
 * picture, and opening a workflow file — or a picture ComfyUI made — in the
 * node editor.
 */

import type { CanvasMenuItem, CanvasObject } from "@nib-ui/ui-contracts";
import type { Component } from "svelte";

/**
 * The name ComfyUI's SaveImage gives a picture, which carries its workflow:
 * `prefix_00001_.png`, or `prefix_00001_-1.png` once the vault has renamed it past
 * a file already there. Outputs land beside their references, so the name is
 * what marks them, not a folder.
 */
const OUTPUT_NAME = /_\d{5}_(-\d+)?\.png$/;

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
  const madeByComfy = isPicture(target) && OUTPUT_NAME.test(path);
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
