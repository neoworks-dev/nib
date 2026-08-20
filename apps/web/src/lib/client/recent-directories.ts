const storageKey = 'nib-ui.recent-directories';
const maxEntries = 8;

export function loadRecentDirectories(): string[] {
	try {
		const raw = localStorage.getItem(storageKey);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
	} catch {
		return [];
	}
}

export function rememberDirectory(current: string[], path: string): string[] {
	const next = [path, ...current.filter((entry) => entry !== path)].slice(0, maxEntries);
	try {
		localStorage.setItem(storageKey, JSON.stringify(next));
	} catch {
		// A blocked storage quota must not stop a session from starting.
	}
	return next;
}
