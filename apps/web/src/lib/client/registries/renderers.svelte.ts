import type { Component } from 'svelte';
import type { BlockView } from '@nib-ui/protocol';
import type {
	PermissionRendererProps,
	PermissionRendererRegistration,
	RendererProps,
	RendererRegistration,
	RendererRegistry,
} from '@nib-ui/ui-contracts';
import { matchBlockRenderer, matchPermissionRenderer } from '../renderer-matching';

export class ReactiveRendererRegistry implements RendererRegistry {
	private registrations = $state<RendererRegistration[]>([]);
	private permissionRegistrations = $state<PermissionRendererRegistration[]>([]);
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
		return matchBlockRenderer(this.registrations, block)?.component ?? this.fallback;
	}

	registerPermission(registration: PermissionRendererRegistration) {
		this.permissionRegistrations = [...this.permissionRegistrations, registration];
		return () => {
			this.permissionRegistrations = this.permissionRegistrations.filter((entry) => entry !== registration);
		};
	}

	resolvePermission(toolName: string): Component<PermissionRendererProps> | null {
		return matchPermissionRenderer(this.permissionRegistrations, toolName)?.component ?? null;
	}
}
