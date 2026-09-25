import type { PaneEdge } from "@nib-ui/ui-contracts";

/**
 * The title bar drag in progress, shared so the pane under the pointer can draw
 * the hint while another pane's header owns the gesture. Exactly one of the two
 * hints is ever set: a drop onto a pane splits that pane, and a drop anywhere
 * else docks against the edge of the area the pointer is nearest.
 */
export const paneDrag = $state<{
  instanceId: string | null;
  hint: { instanceId: string; edge: PaneEdge } | null;
  edgeHint: PaneEdge | null;
}>({ instanceId: null, hint: null, edgeHint: null });

export function clearPaneDrag(): void {
  paneDrag.instanceId = null;
  paneDrag.hint = null;
  paneDrag.edgeHint = null;
}
