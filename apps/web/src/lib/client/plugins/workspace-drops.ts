import type { Plugin } from '@nib-ui/kernel';
import { canvasState, workstreamAt } from '@nib-ui/plugin-canvas';
import { placeWorkspaceModel } from '@nib-ui/plugin-canvas-3d';
import { MODEL_DEFAULT_SIZE } from '@nib-ui/plugin-canvas-3d/model';
import { placeWorkspaceMedia } from '@nib-ui/plugin-canvas-media';
import { composerDrafts } from '@nib-ui/plugin-chat';
import type { Point, WorkspaceFileRef } from '@nib-ui/ui-contracts';
import { canvasObjectKindForPath } from '../workspace-files';

/**
 * Files dragged out of the explorer and dropped on the board. They arrive as
 * references rather than as bytes, so this claims them ahead of the handlers
 * that expect a `File` from the desktop.
 *
 * On a card the file is context for that task and is staged into its composer;
 * on the board it becomes the object its type deserves, and a type no renderer
 * draws opens in the editor rather than inventing an object kind for it.
 */
export const workspaceDropsPlugin: Plugin = {
	name: 'workspace-drops',
	inject: ['canvas', 'fileViewer'],
	apply(ctx) {
		const canvas = ctx.require('canvas');
		const fileViewer = ctx.require('fileViewer');

		const place = async (file: WorkspaceFileRef, at: Point): Promise<void> => {
			switch (canvasObjectKindForPath(file.path)) {
				case 'model':
					await placeWorkspaceModel({ sessionId: file.sessionId, path: file.path, at });
					return;
				case 'media':
					await placeWorkspaceMedia({ sessionId: file.sessionId, path: file.path, at });
					return;
				default:
					canvasState.reportError(`nothing on the board draws ${file.path} — opened in the editor instead`);
					await fileViewer.open(file.sessionId, file.path);
			}
		};

		const drop = async (files: WorkspaceFileRef[], at: Point): Promise<boolean> => {
			const card = workstreamAt(canvas.objects, at);
			if (card) {
				const sessionId = card.sessionId;
				if (!sessionId) {
					canvasState.reportError('this workstream has no task yet — launch it before attaching files');
					return true;
				}
				// Staged, never sent: what goes to the agent stays the user's decision.
				for (const file of files) composerDrafts.stage(sessionId, file.path);
				canvasState.open(card.id);
				return true;
			}

			// Dropped files land in a row rather than stacked on one point.
			let x = at.x;
			for (const file of files) {
				await place(file, { x, y: at.y }).catch((cause: unknown) => {
					canvasState.reportError(`could not read ${file.path}: ${cause instanceof Error ? cause.message : String(cause)}`);
				});
				x += MODEL_DEFAULT_SIZE + 16;
			}
			return true;
		};

		ctx.effect(() =>
			canvas.registerDropHandler({
				order: 1,
				handle: (payload, at) => {
					const files = payload.workspaceFiles ?? [];
					return files.length > 0 ? drop(files, at) : false;
				},
			}),
		);
	},
};
