import type { CanvasCamera, Point } from '@nib-ui/ui-contracts';

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return 1;
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(x: number, y: number, camera: CanvasCamera): Point {
	return { x: (x - camera.x) / camera.zoom, y: (y - camera.y) / camera.zoom };
}

export function worldToScreen(x: number, y: number, camera: CanvasCamera): Point {
	return { x: x * camera.zoom + camera.x, y: y * camera.zoom + camera.y };
}

/**
 * Zooms around a screen point: whatever was under the pointer stays under it.
 * Returns a new camera rather than mutating, so a reactive store can assign it.
 */
export function zoomAt(x: number, y: number, nextZoom: number, camera: CanvasCamera): CanvasCamera {
	const before = screenToWorld(x, y, camera);
	const zoom = clampZoom(nextZoom);
	return { zoom, x: x - before.x * zoom, y: y - before.y * zoom };
}

/** Fits a world rectangle into a viewport, centred, never zoomed past 1:1. */
export function cameraFitting(
	bounds: { x: number; y: number; width: number; height: number },
	viewportWidth: number,
	viewportHeight: number,
	padding = 64,
): CanvasCamera {
	const width = bounds.width + padding * 2;
	const height = bounds.height + padding * 2;
	if (width <= 0 || height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return { x: 0, y: 0, zoom: 1 };

	const zoom = clampZoom(Math.min(viewportWidth / width, viewportHeight / height, 1));
	return {
		zoom,
		x: (viewportWidth - bounds.width * zoom) / 2 - bounds.x * zoom,
		y: (viewportHeight - bounds.height * zoom) / 2 - bounds.y * zoom,
	};
}
