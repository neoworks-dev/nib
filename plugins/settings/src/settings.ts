export const themePreferences = ['system', 'dark', 'light'] as const;

export type ThemePreference = (typeof themePreferences)[number];

export interface UserSettings {
	theme: ThemePreference;
	/** Null means "let the app decide", so a harness that disappears never pins the composer. */
	defaultHarnessId: string | null;
	defaultPermissionMode: string | null;
}

export interface SettingsService {
	readonly current: UserSettings;
	/** The preference resolved against the OS, so `system` reads as `dark` or `light`. */
	readonly resolvedTheme: 'dark' | 'light';
	update(patch: Partial<UserSettings>): void;
	reset(): void;
}

export const settingsStorageKey = 'nib-ui.settings';

export const defaultSettings: UserSettings = {
	theme: 'system',
	defaultHarnessId: null,
	defaultPermissionMode: null,
};

/** Anything unreadable degrades to defaults: preferences must never block startup. */
export function parseSettings(raw: string | null): UserSettings {
	let stored: Record<string, unknown> = {};
	try {
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
	} catch {
		return { ...defaultSettings };
	}

	return {
		theme: themePreferences.find((preference) => preference === stored.theme) ?? defaultSettings.theme,
		defaultHarnessId: typeof stored.defaultHarnessId === 'string' ? stored.defaultHarnessId : null,
		defaultPermissionMode: typeof stored.defaultPermissionMode === 'string' ? stored.defaultPermissionMode : null,
	};
}

export function loadSettings(): UserSettings {
	try {
		return parseSettings(localStorage.getItem(settingsStorageKey));
	} catch {
		return { ...defaultSettings };
	}
}

export function saveSettings(settings: UserSettings): void {
	try {
		localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
	} catch {
		// A blocked storage quota must not lose the change the user just made in memory.
	}
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): 'dark' | 'light' {
	if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
	return preference;
}
