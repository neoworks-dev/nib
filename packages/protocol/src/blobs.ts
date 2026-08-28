/**
 * Bytes, addressed by content. A blob has no identity of its own beyond its
 * hash: the same picture pasted twice is one blob referenced twice, and nothing
 * that references it can be told which reference stored it.
 */
export interface BlobRef {
	/** `<sha256>.<ext>`. The extension follows the sniffed bytes, not a declared type. */
	blobId: string;
	mime: string;
	byteLength: number;
}

export interface BlobBytes {
	bytes: Uint8Array;
	mime: string;
}

export interface PutBlobOptions {
	/**
	 * Keeps a payload no signature claims when it decodes as UTF-8 text. Set where
	 * the user picked the file; a scraper that asked for an image leaves it off so
	 * a page of html is still a refusal.
	 */
	allowText?: boolean;
}

export interface BlobStore {
	put(bytes: Uint8Array, options?: PutBlobOptions): Promise<BlobRef>;
	/** Null when the id is not one this store could have minted, or the bytes are gone. */
	read(blobId: string): Promise<BlobBytes | null>;
	/**
	 * Where the bytes can be fetched. Formatting a url is not I/O, so this is the
	 * one synchronous member: the bytes themselves never travel in the protocol.
	 */
	url(blobId: string): string;
}

/**
 * The host-side store. `path` cannot cross a process boundary — a browser has no
 * filesystem — so it is the one member outside the shared interface, and it is
 * what lets an adapter hand a file to a harness that reads its own disk.
 */
export interface LocalBlobStore extends BlobStore {
	path(blobId: string): Promise<string | null>;
}
