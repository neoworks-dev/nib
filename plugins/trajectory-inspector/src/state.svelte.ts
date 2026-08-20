import type { SessionsService } from '@nib-ui/ui-contracts';

/**
 * Slot components only receive the session, so the plugin parks the services it
 * resolved at activation here instead of reaching into the app.
 */
class InspectorState {
	open = $state(false);
	filter = $state('');
	sessions = $state<SessionsService | null>(null);

	toggle(open?: boolean): void {
		this.open = open ?? !this.open;
	}
}

export const inspectorState = new InspectorState();
