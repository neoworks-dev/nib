import type { StatusTone } from '@neoworks-dev/ui';
import type { SessionStatus } from '@nib-ui/protocol';

const tones: Record<SessionStatus, StatusTone> = {
	idle: 'neutral',
	working: 'blue',
	'awaiting-permission': 'amber',
	error: 'red',
	closed: 'neutral',
};

export function statusTone(status: SessionStatus): StatusTone {
	return tones[status] ?? 'neutral';
}
