import { fitSize, mediaTypeFor, type MediaType } from './media';

export interface AssetRef {
	assetId: string;
	contentType: string;
	byteLength: number;
}

/** Own route, own client — the same shape `plugins/git-panel` uses. */
export async function uploadAsset(file: Blob): Promise<AssetRef> {
	const response = await fetch('/api/assets', {
		method: 'POST',
		headers: { 'content-type': file.type || 'application/octet-stream' },
		body: file,
	});
	if (!response.ok) throw new Error(await response.text());
	return (await response.json()) as AssetRef;
}

export function assetUrl(assetId: string): string {
	return `/api/assets/${encodeURIComponent(assetId)}`;
}

export interface WorkspaceAsset {
	assetId: string;
	contentType: string;
	byteLength: number;
	/** Workspace-relative, as the server resolved it. */
	path: string;
}

/**
 * Stores a file the session already produced as an asset without moving its bytes
 * through the browser: a model is megabytes of binary the board only needs an id for.
 */
export async function storeWorkspaceAsset(sessionId: string, path: string): Promise<WorkspaceAsset> {
	const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/asset`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ path }),
	});
	if (!response.ok) throw new Error(await response.text());
	return (await response.json()) as WorkspaceAsset;
}

/**
 * The intrinsic size, measured before the upload so the object lands with the
 * right shape instead of popping from a square once its texture loads. The
 * server never decodes the bytes, so this cannot come from there.
 */
export async function measureMedia(file: Blob, mediaType: MediaType): Promise<{ width: number; height: number }> {
	if (mediaType === 'pdf') return { width: 260, height: 92 };

	if (mediaType === 'video') {
		const size = await measureVideo(file);
		return fitSize(size.width, size.height);
	}

	try {
		const bitmap = await createImageBitmap(file);
		const size = fitSize(bitmap.width, bitmap.height);
		bitmap.close();
		return size;
	} catch {
		return fitSize(0, 0);
	}
}

function measureVideo(file: Blob): Promise<{ width: number; height: number }> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement('video');
		const done = (width: number, height: number) => {
			URL.revokeObjectURL(url);
			resolve({ width, height });
		};
		video.onloadedmetadata = () => done(video.videoWidth, video.videoHeight);
		video.onerror = () => done(0, 0);
		video.preload = 'metadata';
		video.src = url;
	});
}

export async function uploadMedia(
	file: File,
): Promise<{ assetId: string; mediaType: MediaType; width: number; height: number; name: string } | null> {
	const declared = mediaTypeFor(file.type);
	if (!declared) return null;

	// Measured before the upload so a rejected file costs nothing but a decode.
	const size = await measureMedia(file, declared);
	const asset = await uploadAsset(file);
	// The server sniffs the bytes, and that verdict wins over the file's own claim.
	const mediaType = mediaTypeFor(asset.contentType);
	if (!mediaType) return null;

	return { assetId: asset.assetId, mediaType, width: size.width, height: size.height, name: file.name };
}
