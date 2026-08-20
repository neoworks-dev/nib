import type { Component } from 'svelte';
import type { BlockView } from '@nib-ui/protocol';
import type { RendererProps, RendererRegistration, RendererRegistry } from '@nib-ui/ui-contracts';

export class ReactiveRendererRegistry implements RendererRegistry {
	private registrations = $state<RendererRegistration[]>([]);
	private fallback = $state<Component<RendererProps> | null>(null);

	register(registration: RendererRegistration) {
		this.registrations = [...this.registrations, registration];
		return () => {
			this.registrations = this.registrations.filter((entry) => entry !== registration);
		};
	}

	setFallback(component: Component<RendererProps>) {
		this.fallback = component;
		return () => {
			if (this.fallback === component) this.fallback = null;
		};
	}

	resolve(block: BlockView): Component<RendererProps> | null {
		const matching = this.registrations.filter((entry) => entry.kind === block.kind);
		const exact = highestPriority(matching.filter((entry) => entry.toolName && entry.toolName === block.toolName));
		const generic = highestPriority(matching.filter((entry) => !entry.toolName));
		return exact?.component ?? generic?.component ?? this.fallback;
	}
}

function highestPriority(entries: RendererRegistration[]): RendererRegistration | undefined {
	return entries.reduce<RendererRegistration | undefined>(
		(best, entry) => ((entry.priority ?? 0) > (best?.priority ?? -Infinity) ? entry : best),
		undefined,
	);
}
