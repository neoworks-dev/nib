import { describe, expect, it } from "bun:test";
import type { CanvasObject } from "@nib-ui/ui-contracts";
import { comfyMenuItems } from "../src/menu";

const actions = { runWorkflowOn: () => {}, openInEditor: () => {} };

/** The ids of the entries a card gets. */
function ids(target: CanvasObject | null): string[] {
  return comfyMenuItems(target, actions).map((item) => item.id);
}

describe("comfyMenuItems", () => {
  it("offers a workflow run on a picture", () => {
    expect(ids({ kind: "visual", id: "a", path: "art/chest.png", video: false })).toEqual([
      "comfyui.runWorkflow",
      "comfyui.separator",
    ]);
  });

  it("opens ComfyUI's own pictures and JSON files in the editor", () => {
    expect(
      ids({ kind: "visual", id: "a", path: "comfyui/variation_00001_.png", video: false }),
    ).toEqual(["comfyui.runWorkflow", "comfyui.openInEditor", "comfyui.separator"]);
    expect(ids({ kind: "file", id: "b", path: "workflows/mine.json", extension: "json" })).toEqual([
      "comfyui.openInEditor",
      "comfyui.separator",
    ]);
  });

  it("offers nothing on a clip, a note or empty board", () => {
    expect(ids({ kind: "visual", id: "a", path: "clip.mp4", video: true })).toEqual([]);
    expect(ids({ kind: "sticky", id: "c", path: "note.md" })).toEqual([]);
    expect(ids(null)).toEqual([]);
  });
});
