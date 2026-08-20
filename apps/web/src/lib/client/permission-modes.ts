/** Harness mode ids are protocol values; these are the words the UI shows for the ones we know. */
const labels: Record<string, string> = {
	default: 'Ask before changes',
	acceptEdits: 'Auto-accept edits',
	plan: 'Plan only',
	bypassPermissions: 'Bypass permissions',
};

export function permissionModeLabel(mode: string): string {
	return labels[mode] ?? mode;
}
