import { getContext, setContext } from 'svelte';
import type { Context } from '@nib-ui/kernel';

/**
 * Symbol.for keeps the key stable even if the package is instantiated twice by
 * the bundler, which would otherwise hand a plugin a second, empty context.
 */
const contextKey = Symbol.for('@nib-ui/ui-contracts:kernel-context');

/** Called once by the shell, before anything that resolves services renders. */
export function provideKernelContext(context: Context): void {
	setContext(contextKey, context);
}

/** Service accessor for any component below the shell, app-owned or contributed by a plugin. */
export function kernelContext(): Context {
	const context = getContext<Context | undefined>(contextKey);
	if (!context) throw new Error('no kernel context: the shell must call provideKernelContext() first');
	return context;
}
