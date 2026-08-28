import type { Disposer } from '@nib-ui/kernel';
import type { SessionsService, SlotRegistry } from '@nib-ui/ui-contracts';
import {
	defaultSettings,
	loadSettings,
	resolveTheme,
	saveSettings,
	type SettingsService,
	type UserSettings,
} from './settings';

/**
 * The pane and the contributed sections are rendered by registries that pass no
 * services as props, so the plugin hands them over here.
 */
class SettingsState implements SettingsService {
	current = $state<UserSettings>({ ...defaultSettings });
	slots = $state<SlotRegistry | null>(null);
	sessions = $state<SessionsService | null>(null);
	private systemPrefersDark = $state(false);

	get resolvedTheme(): 'dark' | 'light' {
		return resolveTheme(this.current.theme, this.systemPrefersDark);
	}

	load(): void {
		this.current = loadSettings();
	}

	update(patch: Partial<UserSettings>): void {
		this.current = { ...this.current, ...patch };
		saveSettings(this.current);
	}

	reset(): void {
		this.current = { ...defaultSettings };
		saveSettings(this.current);
	}

	/** Mirrors the resolved theme onto the root element and tracks the OS preference. */
	watchTheme(): Disposer {
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		this.systemPrefersDark = media.matches;
		const onChange = (event: MediaQueryListEvent) => {
			this.systemPrefersDark = event.matches;
		};
		media.addEventListener('change', onChange);

		const stopEffect = $effect.root(() => {
			$effect(() => {
				document.documentElement.dataset.theme = this.resolvedTheme;
			});
		});

		return () => {
			media.removeEventListener('change', onChange);
			stopEffect();
		};
	}

	detach(): void {
		this.slots = null;
		this.sessions = null;
	}
}

export const settingsState = new SettingsState();
