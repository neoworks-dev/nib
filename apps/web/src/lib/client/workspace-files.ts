import { modelFormatForName } from '@nib-ui/plugin-canvas-3d/model';
import { mediaTypeForName } from '@nib-ui/plugin-canvas-media/media';

/** Board object a workspace file becomes; null when no renderer claims the type. */
export type CanvasObjectKindName = 'model' | 'media';

/**
 * Which object a file dropped on the board deserves. The two renderer packages
 * already decide this for a file from the desktop; a workspace path has no bytes
 * in hand, so its name is all there is to go on — and the order is theirs, models
 * before media, because a `.glb` carries no useful type of its own.
 *
 * Null is not a gap to fill with an invented kind: a file no renderer draws
 * belongs in the editor.
 */
export function canvasObjectKindForPath(path: string): CanvasObjectKindName | null {
	if (modelFormatForName(path)) return 'model';
	if (mediaTypeForName(path)) return 'media';
	return null;
}
