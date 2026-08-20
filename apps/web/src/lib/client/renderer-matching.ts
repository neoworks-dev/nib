import type { BlockView } from '@nib-ui/protocol';
import type { PermissionRendererRegistration, RendererRegistration } from '@nib-ui/ui-contracts';

/** Exact `(kind, toolName)` beats a `kind`-only registration; ties go to the higher priority. */
export function matchBlockRenderer(
	registrations: RendererRegistration[],
	block: BlockView,
): RendererRegistration | undefined {
	const matching = registrations.filter((entry) => entry.kind === block.kind);
	const exact = highestPriority(matching.filter((entry) => entry.toolName && entry.toolName === block.toolName));
	return exact ?? highestPriority(matching.filter((entry) => !entry.toolName));
}

export function matchPermissionRenderer(
	registrations: PermissionRendererRegistration[],
	toolName: string,
): PermissionRendererRegistration | undefined {
	return highestPriority(registrations.filter((entry) => entry.toolName === toolName));
}

function highestPriority<T extends { priority?: number }>(entries: T[]): T | undefined {
	return entries.reduce<T | undefined>(
		(best, entry) => ((entry.priority ?? 0) > (best?.priority ?? -Infinity) ? entry : best),
		undefined,
	);
}
