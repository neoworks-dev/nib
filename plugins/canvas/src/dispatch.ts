import type { ActivationGesture, CanvasObject, CanvasObjectKind } from '@nib-ui/ui-contracts';

/**
 * Contribution ordering, shared by the paste and drop registries. Handlers run
 * lowest `order` first and the first one to claim the payload wins, so a plugin
 * can put itself in front of the generic handler without knowing about it.
 */
export function byOrder<T extends { order?: number }>(entries: Iterable<T>): T[] {
	return [...entries].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}

export interface Claimable<TPayload, TAt> {
	order?: number;
	handle(payload: TPayload, at: TAt): boolean | Promise<boolean>;
}

export async function dispatch<TPayload, TAt>(
	handlers: Iterable<Claimable<TPayload, TAt>>,
	payload: TPayload,
	at: TAt,
): Promise<boolean> {
	for (const handler of byOrder(handlers)) {
		if (await handler.handle(payload, at)) return true;
	}
	return false;
}

/**
 * Opening a card. A kind that knows how to open its own object takes both
 * gestures but acts only on the double-click, so a single click still just
 * selects it; everything else — an unregistered kind included, since a stored
 * object outlives the plugin that drew it — is left to the board's own handler,
 * which has always answered a plain click.
 */
export function activateObject(
	kind: CanvasObjectKind | undefined,
	object: CanvasObject,
	fallback: ((object: CanvasObject) => void) | null,
	gesture: ActivationGesture,
): void {
	const parsed = kind?.activate ? kind.parse(object) : null;
	if (kind?.activate && parsed) {
		if (gesture === 'doubleClick') kind.activate(parsed);
		return;
	}
	fallback?.(object);
}
