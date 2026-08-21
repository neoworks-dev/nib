import type { DropEdge } from './tiles';

/** Alt+drag moves a pane; this is the drag that is in flight, if any. */
class PaneDragState {
	paneId = $state<string | null>(null);
	targetPaneId = $state<string | null>(null);
	edge = $state<DropEdge | null>(null);

	start(paneId: string): void {
		this.paneId = paneId;
		this.targetPaneId = null;
		this.edge = null;
	}

	over(targetPaneId: string, edge: DropEdge): void {
		if (!this.paneId) return;
		this.targetPaneId = targetPaneId;
		this.edge = edge;
	}

	clear(): void {
		this.paneId = null;
		this.targetPaneId = null;
		this.edge = null;
	}
}

export const paneDrag = new PaneDragState();
