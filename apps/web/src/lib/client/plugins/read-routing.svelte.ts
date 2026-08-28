import { untrack } from 'svelte';
import type { Plugin } from '@nib-ui/kernel';
import { canvasState, chatPaneId, type ChatPaneParams } from '@nib-ui/plugin-canvas';
import {
	modelFormatForContentType,
	modelFormatForName,
	modelViewerState,
	storeWorkspaceAsset,
	MODEL_DEFAULT_ORBIT,
	MODEL_DEFAULT_SIZE,
	type ModelObject,
} from '@nib-ui/plugin-canvas-3d';
import { latestReadPath, routeRead } from '../read-routing';

/**
 * What the agent is reading, shown in whatever is sitting next to the
 * conversation. It watches the projection rather than the transcript's
 * renderers: which panes a chat is attached to is a fact about the layout, and
 * a block renderer knows nothing about that.
 */
export const readRoutingPlugin: Plugin = {
	name: 'read-routing',
	inject: ['panes', 'attachments', 'sessions', 'fileViewer'],
	apply(ctx) {
		const panes = ctx.require('panes');
		const attachments = ctx.require('attachments');
		const fileViewer = ctx.require('fileViewer');
		const sessions = ctx.require('sessions');
		/** Chat pane instance → the path already sent to its neighbours. */
		const routed = new Map<string, string>();

		const stop = $effect.root(() => {
			$effect(() => {
				for (const instance of panes.instances(chatPaneId)) {
					const params = instance.params as ChatPaneParams | undefined;
					const target = canvasState.chatTarget(params, sessions.active);
					const session = target.session;
					const anchored = target.workstream ? canvasState.anchorFor(target.workstream.id) !== null : false;

					const route = routeRead({
						path: session ? latestReadPath(session) : null,
						attached: attachments.siblings(instance.instanceId).map((attachment) => attachment.kind),
						lastRouted: routed.get(instance.instanceId) ?? null,
						// A finished session is history, and a chat parked on an older turn
						// is being read: neither is a request to open anything.
						following: session?.status === 'working' && !anchored,
					});
					if (route.kind === 'none' || !session) continue;

					routed.set(instance.instanceId, route.path);
					untrack(() => {
						if (route.kind === 'editor') void fileViewer.open(session.sessionId, route.path, { activate: false });
						else void showModel(session.sessionId, route.path);
					});
				}
			});
		});

		ctx.effect(() => () => {
			routed.clear();
			stop();
		});
	},
};

/**
 * The bytes go from the workspace into the asset store server-side; the viewer
 * addresses them by id, exactly as it does for a model already on the board.
 */
async function showModel(sessionId: string, path: string): Promise<void> {
	const asset = await storeWorkspaceAsset(sessionId, path).catch(() => null);
	const format = asset && (modelFormatForContentType(asset.contentType) ?? modelFormatForName(asset.path));
	if (!asset || !format) return;

	modelViewerState.show({
		kind: 'model',
		id: `read:${asset.assetId}`,
		x: 0,
		y: 0,
		assetId: asset.assetId,
		format,
		...MODEL_DEFAULT_ORBIT,
		w: MODEL_DEFAULT_SIZE,
		h: MODEL_DEFAULT_SIZE,
		name: asset.path.slice(asset.path.lastIndexOf('/') + 1),
	} satisfies ModelObject);
}
