export const sheetPaneId = "canvas.sheet";

/**
 * Which note a sheet pane is showing. The vault path is the identity — it is the
 * card's id too — so opening the same note again reaches the pane that has it
 * rather than a second copy of the page.
 *
 * An alias rather than an interface: the registry takes params as a
 * `Record<string, unknown>`, which only a type gets an index signature for.
 */
export type SheetPaneParams = {
  path: string;
};

/** The note's own name — the file's stem — or the pane's when nothing is open yet. */
export function sheetPaneLabel(params: Record<string, unknown> | undefined): string {
  const path = params?.path;
  if (typeof path !== "string" || path.length === 0) return "Note";
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file.replace(/\.md$/i, "");
}
