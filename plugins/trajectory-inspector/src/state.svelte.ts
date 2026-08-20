import type { SessionsService } from '@nib-ui/ui-contracts';
import type { EventCategory } from './filter';

/**
 * Slot components only receive the session, so the plugin parks the services it
 * resolved at activation here instead of reaching into the app.
 */
class InspectorState {
	open = $state(false);
	query = $state('');
	categories = $state<EventCategory[]>([]);
	selectedEventId = $state<string | null>(null);
	sessions = $state<SessionsService | null>(null);

	toggle(open?: boolean): void {
		this.open = open ?? !this.open;
	}

	toggleCategory(category: EventCategory): void {
		this.categories = this.categories.includes(category)
			? this.categories.filter((entry) => entry !== category)
			: [...this.categories, category];
	}

	reset(): void {
		this.open = false;
		this.query = '';
		this.categories = [];
		this.selectedEventId = null;
	}
}

export const inspectorState = new InspectorState();
