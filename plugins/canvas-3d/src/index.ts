import type { Plugin } from '@nib-ui/kernel';
import CubeIcon from 'phosphor-svelte/lib/CubeIcon';
import { boardTheme, canvasState, TextTextureCache } from '@nib-ui/plugin-canvas';
import type { CanvasRegistry, Point } from '@nib-ui/ui-contracts';
import { storeWorkspaceAsset, uploadModel, type UploadedModel } from './client';
import { modelKind } from './ModelRenderer';
import ModelViewer from './ModelViewer.svelte';
import { modelViewerState } from './viewer.svelte';
import {
	fitModelSize,
	isModelFile,
	modelFormatForContentType,
	modelFormatForName,
	modelMime,
	parseModel,
	MODEL_DEFAULT_ORBIT,
	MODEL_DEFAULT_SIZE,
	type ModelObject,
} from './model';

const viewerPaneId = 'model.viewer';

let counter = 0;

function createId(): string {
	counter += 1;
	return `model:${Date.now().toString(36)}:${counter.toString(36)}`;
}

/**
 * Held so a model an agent turn produced can be placed without a pane or a
 * component in hand. It is the same registry the plugin renders through, and it
 * is only set while the plugin is loaded.
 */
let registry: CanvasRegistry | null = null;

export interface WorkspaceModelPlacement {
	sessionId: string;
	/** Workspace-relative, as the session wrote it. */
	path: string;
	/** World point for the top-left corner. Defaults to the top-left of the view. */
	at?: Point;
	name?: string;
	/** Fitted into the default box; a model has no intrinsic size to fall back on. */
	size?: { width: number; height: number };
}

/**
 * Places a model file that already exists in a session's workspace. The bytes go
 * straight from the workspace into the asset store, so a file too large to hand
 * to the browser twice still lands on the board.
 */
export async function placeWorkspaceModel(placement: WorkspaceModelPlacement): Promise<string | null> {
	const canvas = registry;
	if (!canvas) throw new Error('the canvas-3d plugin is not loaded');

	const asset = await storeWorkspaceAsset(placement.sessionId, placement.path);
	const format = modelFormatForContentType(asset.contentType) ?? modelFormatForName(asset.path);
	if (!format) return null;

	const at = placement.at ?? canvas.screenToWorld(96, 96);
	const size = fitModelSize(
		placement.size?.width ?? MODEL_DEFAULT_SIZE,
		placement.size?.height ?? MODEL_DEFAULT_SIZE,
	);
	const id = createId();
	canvas.addObject({
		kind: 'model',
		id,
		x: Math.round(at.x),
		y: Math.round(at.y),
		assetId: asset.assetId,
		format,
		...MODEL_DEFAULT_ORBIT,
		w: size.width,
		h: size.height,
		name: placement.name ?? asset.path.slice(asset.path.lastIndexOf('/') + 1),
	} satisfies ModelObject);
	return id;
}

export const canvas3dPlugin: Plugin = {
	name: 'canvas-3d',
	inject: ['canvas', 'panes'],
	apply(ctx) {
		const canvas = ctx.require('canvas');
		const panes = ctx.require('panes');
		const textures = new TextTextureCache(32);
		registry = canvas;

		ctx.effect(() => panes.register({ id: viewerPaneId, kind: 'model', title: 'Model', icon: CubeIcon, component: ModelViewer }));
		ctx.effect(() =>
			canvas.registerKind(
				modelKind({
					textures,
					theme: boardTheme,
					// Showing the window is what makes it relevant, the same way opening a
					// file shows the editor.
					open: (object) => {
						modelViewerState.show(object);
						panes.open(viewerPaneId);
					},
				}),
			),
		);

		/** Dropped files land in a row rather than stacked on one point. */
		const place = async (files: File[], at: Point): Promise<boolean> => {
			const models = files.filter(isModelFile);
			if (models.length === 0) return false;

			let x = at.x;
			for (const file of models) {
				// A file the store refuses is the one failure that leaves nothing on the
				// board to look at, so it is said out loud rather than dropped silently.
				let uploaded: UploadedModel | null;
				try {
					uploaded = await uploadModel(file);
				} catch (cause) {
					canvasState.reportError(
						`could not read ${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
					);
					continue;
				}
				if (!uploaded) {
					canvasState.reportError(`${file.name} is not a model the board can read`);
					continue;
				}
				canvas.addObject({
					kind: 'model',
					id: createId(),
					x: Math.round(x),
					y: Math.round(at.y),
					assetId: uploaded.assetId,
					format: uploaded.format,
					...MODEL_DEFAULT_ORBIT,
					w: MODEL_DEFAULT_SIZE,
					h: MODEL_DEFAULT_SIZE,
					name: uploaded.name,
				} satisfies ModelObject);
				x += MODEL_DEFAULT_SIZE + 16;
			}
			return true;
		};

		// Ahead of the media handlers: a `.glb` carries no useful MIME type, so it is
		// claimed by its name and its magic bytes before anything guesses at it.
		ctx.effect(() => canvas.registerPasteHandler({ order: 5, handle: (payload, at) => place(payload.files, at) }));
		ctx.effect(() => canvas.registerDropHandler({ order: 5, handle: (payload, at) => place(payload.files, at) }));

		// A model linked to a task travels with its prompt as a file to open: no
		// harness looks at a `.glb`, but every one of them can read it off disk.
		ctx.effect(() =>
			canvas.registerContextProvider({
				order: 5,
				contextFor: (object) => {
					const model = parseModel(object);
					if (!model) return null;
					const name = model.name ?? model.assetId;
					return {
						label: name,
						attachments: [{ assetId: model.assetId, mime: modelMime(model.format), name }],
					};
				},
			}),
		);
		ctx.effect(() => () => {
			textures.clear();
			modelViewerState.reset();
			registry = null;
		});
	},
};

export { storeWorkspaceAsset, uploadModel, type UploadedModel, type WorkspaceAsset } from './client';
export {
	clampDistance,
	clampPitch,
	fitModelSize,
	isModelFile,
	modelFormatForBytes,
	modelFormatForContentType,
	modelFormatForName,
	orbitAfterDrag,
	orbitAfterWheel,
	orbitCameraPosition,
	parseModel,
	sniffModelFormat,
	MODEL_DEFAULT_ORBIT,
	MODEL_DEFAULT_SIZE,
	MODEL_MIN_SIZE,
	type ModelFormat,
	type ModelObject,
	type ModelOrbit,
} from './model';
export { modelViewerState } from './viewer.svelte';
