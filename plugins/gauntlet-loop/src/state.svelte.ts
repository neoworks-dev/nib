import type { RendererRegistry, SessionsService } from '@nib-ui/ui-contracts';
import type { PaneRole, RelayMode } from './relay';

class GauntletState {
	open = $state(false);
	mode = $state<RelayMode>('off');
	builderId = $state<string | null>(null);
	criticId = $state<string | null>(null);
	/** Last assistant turn already forwarded, per role, so a handoff never repeats. */
	relayed = $state<Record<PaneRole, string | null>>({ builder: null, critic: null });
	sessions = $state<SessionsService | null>(null);
	renderers = $state<RendererRegistry | null>(null);

	sessionId(role: PaneRole): string | null {
		return role === 'builder' ? this.builderId : this.criticId;
	}

	assign(role: PaneRole, sessionId: string | null): void {
		if (role === 'builder') this.builderId = sessionId;
		else this.criticId = sessionId;
		this.relayed = { ...this.relayed, [role]: null };
		if (sessionId) this.sessions?.watch(sessionId);
	}

	toggle(next?: boolean): void {
		this.open = next ?? !this.open;
	}

	reset(): void {
		this.open = false;
		this.mode = 'off';
		this.builderId = null;
		this.criticId = null;
		this.relayed = { builder: null, critic: null };
		this.sessions = null;
		this.renderers = null;
	}
}

export const gauntletState = new GauntletState();
