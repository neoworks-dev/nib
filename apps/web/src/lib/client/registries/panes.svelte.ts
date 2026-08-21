import type { PaneDefinition, PaneRegistry } from '@nib-ui/ui-contracts';
import { containsPane, insertPane, movePane, paneIds, removePane, setRatio, type DropEdge, type TileNode } from '../layout/tiles';

export const chatPaneId = 'chat';

/**
 * Panes and the tiling layout they live in. The tree is the single source of
 * truth for what is on screen: opening a pane inserts a leaf, closing removes it.
 */
export class ReactivePaneRegistry implements PaneRegistry {
	definitions = $state<PaneDefinition[]>([]);
	layout = $state<TileNode | null>(null);
	focusedPaneId = $state<string>(chatPaneId);

	register(definition: PaneDefinition) {
		this.definitions = [...this.definitions, definition];
		return () => {
			this.definitions = this.definitions.filter((entry) => entry !== definition);
			this.close(definition.id);
		};
	}

	list(): PaneDefinition[] {
		return this.definitions;
	}

	definition(paneId: string): PaneDefinition | undefined {
		return this.definitions.find((entry) => entry.id === paneId);
	}

	open(paneId: string): void {
		if (this.isOpen(paneId)) return void (this.focusedPaneId = paneId);
		this.layout = insertPane(this.layout, this.focusedPaneId, 'right', paneId);
		this.focusedPaneId = paneId;
	}

	close(paneId: string): void {
		if (!this.isOpen(paneId)) return;
		this.layout = removePane(this.layout, paneId);
		if (this.focusedPaneId === paneId) this.focusedPaneId = paneIds(this.layout)[0] ?? chatPaneId;
	}

	toggle(paneId: string): void {
		if (this.isOpen(paneId)) this.close(paneId);
		else this.open(paneId);
	}

	isOpen(paneId: string): boolean {
		return containsPane(this.layout, paneId);
	}

	move(paneId: string, targetPaneId: string, edge: DropEdge): void {
		this.layout = movePane(this.layout, paneId, targetPaneId, edge);
		this.focusedPaneId = paneId;
	}

	resize(path: number[], ratio: number): void {
		if (this.layout) this.layout = setRatio(this.layout, path, ratio);
	}
}
