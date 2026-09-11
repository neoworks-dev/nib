import type { PaneEdge } from "@nib-ui/ui-contracts";
import type { SnapZone } from "./windows";

/**
 * The title bar drag in progress, shared so the frame under the pointer can draw
 * the hint while another frame's header owns the gesture. Exactly one edge is
 * ever set: which one is decided by the region of the frame the pointer is over.
 *
 * `snap` is the other half of the same gesture — a window dragged against the
 * area's own edge — and the host draws it, because what it previews is a place
 * in the area rather than anything inside a frame.
 */
export const paneDrag = $state<{
  instanceId: string | null;
  hint: { frameId: string; edge: PaneEdge } | null;
  snap: SnapZone | null;
}>({ instanceId: null, hint: null, snap: null });

export function clearPaneDrag(): void {
  paneDrag.instanceId = null;
  paneDrag.hint = null;
  paneDrag.snap = null;
}
