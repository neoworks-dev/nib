<script lang="ts">
	import { Button, Card, ListRow, SectionHeader, Select } from '@neoworks-dev/ui';
	import type { SlotProps } from '@nib-ui/ui-contracts';
	import { themePreferences, type ThemePreference } from './settings';
	import { settingsState } from './state.svelte';

	const { session }: SlotProps = $props();

	const themeLabels: Record<ThemePreference, string> = { system: 'System', dark: 'Dark', light: 'Light' };
	const themeOptions = themePreferences.map((preference) => ({ value: preference, label: themeLabels[preference] }));

	const settings = $derived(settingsState.current);
	const harnesses = $derived(settingsState.sessions?.harnesses ?? []);

	// Permission modes are per harness, so fall back to whatever the open session runs on.
	const modeSource = $derived(
		harnesses.find((harness) => harness.id === settings.defaultHarnessId) ??
			harnesses.find((harness) => harness.id === session?.harnessId) ??
			harnesses[0] ??
			null,
	);
	const permissionModeOptions = $derived(
		(modeSource?.capabilities.permissionModes ?? []).map((mode) => ({ value: mode, label: mode })),
	);

	function toOptionalId(value: string | string[]): string | null {
		if (Array.isArray(value) || value.length === 0) return null;
		return value;
	}

	function chooseTheme(value: string | string[]): void {
		const theme = themePreferences.find((preference) => preference === value);
		if (theme) settingsState.update({ theme });
	}
</script>

<section class="space-y-2">
	<SectionHeader title="Appearance" />
	<Card padding="sm" class="space-y-2">
		<ListRow title="Theme" subtitle="System follows the operating system preference.">
			{#snippet trailing()}
				<div class="w-40">
					<Select value={settings.theme} options={themeOptions} onChange={chooseTheme} />
				</div>
			{/snippet}
		</ListRow>
	</Card>
</section>

<section class="space-y-2">
	<SectionHeader title="Defaults" />
	<Card padding="sm" class="space-y-2">
		<ListRow title="Harness" subtitle="Pre-selected when starting a new session.">
			{#snippet trailing()}
				<div class="w-40">
					<Select
						value={settings.defaultHarnessId ?? ''}
						placeholder="Ask each time"
						options={harnesses.map((harness) => ({ value: harness.id, label: harness.displayName }))}
						onChange={(value) => settingsState.update({ defaultHarnessId: toOptionalId(value) })}
					/>
				</div>
			{/snippet}
		</ListRow>

		<ListRow title="Permission mode" subtitle={modeSource ? `Modes offered by ${modeSource.displayName}.` : 'No harness available.'}>
			{#snippet trailing()}
				<div class="w-40">
					<Select
						value={settings.defaultPermissionMode ?? ''}
						placeholder="Harness default"
						options={permissionModeOptions}
						onChange={(value) => settingsState.update({ defaultPermissionMode: toOptionalId(value) })}
					/>
				</div>
			{/snippet}
		</ListRow>
	</Card>

	<div class="flex items-center gap-3 px-1">
		<Button size="sm" variant="ghost" onclick={() => settingsState.reset()}>Reset to defaults</Button>
		<span class="text-2xs text-faint">Stored in this browser only.</span>
	</div>
</section>
