import type { Disposer } from './types';

export interface EvaluableFork {
	readonly name: string;
	/** Returns true when the activation state changed. */
	evaluate(): boolean;
}

const MAX_FLUSH_PASSES = 100;

/** Shared root state: services, listeners and every live plugin fork. */
export class Kernel {
	readonly services = new Map<string, unknown>();
	readonly forks = new Set<EvaluableFork>();
	private readonly listeners = new Map<string, Set<(...args: never[]) => void>>();
	private flushing = false;

	addListener(event: string, listener: (...args: never[]) => void): Disposer {
		const bucket = this.listeners.get(event) ?? new Set();
		this.listeners.set(event, bucket);
		bucket.add(listener);
		return () => {
			bucket.delete(listener);
			if (bucket.size === 0) this.listeners.delete(event);
		};
	}

	emit(event: string, args: unknown[]): void {
		const bucket = this.listeners.get(event);
		if (!bucket) return;
		for (const listener of [...bucket]) (listener as (...a: unknown[]) => void)(...args);
	}

	/**
	 * Re-evaluates every fork until activation states settle. Activating a plugin
	 * can provide a service that unblocks another fork, so this repeats; the
	 * re-entrancy guard lets `provide()` calls made during activation be folded
	 * into the running pass instead of recursing.
	 */
	flush(): void {
		if (this.flushing) return;
		this.flushing = true;
		try {
			for (let pass = 0; pass < MAX_FLUSH_PASSES; pass += 1) {
				let changed = false;
				for (const fork of [...this.forks]) changed = fork.evaluate() || changed;
				if (!changed) return;
			}
			throw new Error('plugin activation did not settle after 100 passes');
		} finally {
			this.flushing = false;
		}
	}
}
