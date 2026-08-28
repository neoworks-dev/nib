import type { Disposer } from '@nib-ui/kernel';
import type { MessageAttachment } from './events';
import type { Asset, AssetPayload } from './schema';

/** Where an asset can come from. Every route into the project ends up as one of these. */
export type AssetSource =
	| { from: 'file'; bytes: Uint8Array; name?: string; mime: string }
	| { from: 'url'; url: string }
	| { from: 'text'; text: string; html?: string }
	/**
	 * A file a session already has on disk, dragged out of a pane rather than in
	 * from the desktop. Only the reference travels: the provider reads the bytes
	 * server-side, so a large file never crosses the browser at all.
	 */
	| { from: 'workspaceFile'; sessionId: string; path: string };

/** What a pinned asset becomes when it rides along on the next prompt. */
export type PromptPart =
	| { kind: 'text'; text: string }
	| { kind: 'attachment'; attachment: MessageAttachment };

/**
 * One asset kind. A provider is an ordinary component: it registers through a
 * revertible effect, so unloading the plugin that owns a kind drops it from the
 * broker's routing set without perturbing anything that was already placed.
 */
export interface AssetProvider {
	/** Payload types this provider mints. Two providers may not claim one type. */
	types: readonly AssetPayload['type'][];
	/** Ascending; first claim wins. Default 0. */
	order?: number;
	/** Null declines the source, and the broker offers it to the next provider. */
	ingest(source: AssetSource): Promise<AssetPayload | null>;
	/** How the asset enters a prompt. Absent or null keeps it out of one. */
	attach?(asset: Asset): Promise<PromptPart | null>;
}

/**
 * The asset broker. Consumers inject this rather than any one provider, so a
 * provider can be added, replaced or removed at runtime without a consumer's
 * dependency changing identity.
 */
export interface AssetRegistry {
	register(provider: AssetProvider): Disposer;
	/** Payload types some active provider claims right now. */
	readonly types: readonly AssetPayload['type'][];
	/** Offers the source to each provider in `order`; null when none claims it. */
	ingest(source: AssetSource): Promise<AssetPayload | null>;
	/** Routes to the provider that owns the asset's payload type. */
	attach(asset: Asset): Promise<PromptPart | null>;
}
