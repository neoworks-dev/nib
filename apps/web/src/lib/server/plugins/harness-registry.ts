import type { Plugin } from '@nib-ui/kernel';
import type { HarnessDescriptor } from '@nib-ui/protocol';
import type { HarnessAdapter, HarnessRegistry } from '../services';

class AdapterRegistry implements HarnessRegistry {
	private readonly adapters = new Map<string, HarnessAdapter>();

	register(adapter: HarnessAdapter) {
		if (this.adapters.has(adapter.id)) throw new Error(`harness "${adapter.id}" is already registered`);
		this.adapters.set(adapter.id, adapter);
		return () => {
			this.adapters.delete(adapter.id);
		};
	}

	get(id: string): HarnessAdapter | undefined {
		return this.adapters.get(id);
	}

	list(): HarnessDescriptor[] {
		return [...this.adapters.values()].map(({ id, displayName, capabilities }) => ({
			id,
			displayName,
			capabilities,
		}));
	}
}

export const harnessRegistryPlugin: Plugin = {
	name: 'harness-registry',
	apply(ctx) {
		ctx.provide('harnesses', new AdapterRegistry());
	},
};
