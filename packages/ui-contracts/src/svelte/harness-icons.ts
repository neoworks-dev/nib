import PlugsConnectedIcon from 'phosphor-svelte/lib/PlugsConnectedIcon';
import type { IconComponent } from '@neoworks-dev/ui';
import ClaudeCodeIcon from './icons/ClaudeCodeIcon.svelte';
import CodexIcon from './icons/CodexIcon.svelte';
import OpenCodeIcon from './icons/OpenCodeIcon.svelte';

/** Descriptors travel over the wire, so they cannot carry components; icons are matched on id here. */
const icons: Record<string, IconComponent> = {
	'claude-code': ClaudeCodeIcon,
	codex: CodexIcon,
	opencode: OpenCodeIcon,
};

export function harnessIcon(harnessId: string): IconComponent {
	return icons[harnessId] ?? PlugsConnectedIcon;
}
