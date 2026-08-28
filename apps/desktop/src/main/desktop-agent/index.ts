/**
 * The main-process half of the desktop agent: one supervisor, one set of IPC handlers, and
 * a fan-out of sidecar events to every open window.
 *
 * Capture bytes stop here. The sidecar reports a path, this process reads it and posts it
 * to the asset store, and the renderer is handed an id — so a screenshot of the whole
 * desktop never sits in a browser heap.
 */
import { BrowserWindow, ipcMain } from 'electron';
import {
	describeCapabilities,
	type ApplicationIdentity,
	type CaptureRequest,
	type CaptureResult,
	type DesktopCapabilities,
	type DetectedRegion,
	type OverlaySpec,
	type SidecarState,
} from '@nib-ui/ui-contracts/desktop-agent';
import { uploadCapture, type AppRequest } from './assets';
import { spawnSidecarProcess } from './child';
import { desktopAgentChannels } from './channels';
import { parseCapturePayload, parseDetectedRegions, parseIdentity } from './protocol';
import { resolveSidecar } from './resolve';
import { SidecarSupervisor } from './supervisor';

/** How many accessible nodes the sidecar may walk before giving up on a deep tree. */
const MAX_ACCESSIBLE_NODES = 500;

/**
 * A portal dialog is a person deciding, so the capture request outlives the default reply
 * window by a wide margin. The sidecar gives up on its own after two minutes.
 */
const CAPTURE_TIMEOUT_MS = 150_000;

function broadcast(channel: string, payload: unknown): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send(channel, payload);
	}
}

export function registerDesktopAgent(request: AppRequest): () => void {
	const supervisor = new SidecarSupervisor({
		resolve: () => resolveSidecar(process.env),
		spawn: spawnSidecarProcess,
		onState: (state: SidecarState) => broadcast(desktopAgentChannels.sidecarStateEvent, state),
		onEvent: (event) => {
			if (event.type === 'pointer') broadcast(desktopAgentChannels.pointerEvent, event.sample);
			if (event.type === 'focus') broadcast(desktopAgentChannels.focusEvent, event.application);
		},
		onLog: (level, message) => console.log(`[nib-overlay:${level}] ${message}`),
	});

	function report(): DesktopCapabilities {
		return describeCapabilities({
			bridge: true,
			sidecarResolved: supervisor.resolved,
			...(supervisor.capabilities ? { sidecar: supervisor.capabilities } : {}),
		});
	}

	const handlers: Record<string, (...args: never[]) => unknown> = {
		[desktopAgentChannels.capabilities]: (): DesktopCapabilities => report(),

		[desktopAgentChannels.start]: async (): Promise<DesktopCapabilities> => {
			await supervisor.start();
			return report();
		},

		[desktopAgentChannels.stop]: (): Promise<void> => supervisor.stop(),

		[desktopAgentChannels.capture]: async (
			_event: Electron.IpcMainInvokeEvent,
			captureRequest: CaptureRequest,
		): Promise<CaptureResult | null> => {
			const reply = await supervisor.send({ type: 'capture', request: captureRequest }, CAPTURE_TIMEOUT_MS);
			if (reply.type === 'err') {
				console.warn(`[nib-overlay] capture refused (${reply.code}): ${reply.message}`);
				return null;
			}
			const payload = parseCapturePayload(reply.payload);
			if (!payload) {
				console.warn('[nib-overlay] the sidecar answered a capture with something unreadable');
				return null;
			}

			try {
				const stored = await uploadCapture(request, payload.path);
				return {
					assetId: stored.assetId,
					width: payload.width,
					height: payload.height,
					takenAt: payload.takenAt,
					application: payload.application,
					output: payload.output,
					layout: payload.layout,
					redacted: payload.redacted,
				};
			} catch (cause) {
				console.warn(`[nib-overlay] the capture could not be stored: ${String(cause)}`);
				return null;
			}
		},

		[desktopAgentChannels.focusedApplication]: async (): Promise<ApplicationIdentity | null> => {
			const reply = await supervisor.send({ type: 'focus.query' });
			return reply.type === 'ok' ? parseIdentity(reply.payload) : null;
		},

		[desktopAgentChannels.accessibleRegions]: async (): Promise<DetectedRegion[]> => {
			const reply = await supervisor.send({ type: 'accessibility.tree', maxNodes: MAX_ACCESSIBLE_NODES });
			return reply.type === 'ok' ? parseDetectedRegions(reply.payload) : [];
		},

		[desktopAgentChannels.showOverlay]: async (_event: Electron.IpcMainInvokeEvent, spec: OverlaySpec): Promise<boolean> => {
			const reply = await supervisor.send({ type: 'overlay.show', spec });
			if (reply.type === 'err') {
				console.warn(`[nib-overlay] overlay refused (${reply.code}): ${reply.message}`);
				return false;
			}
			// A pointer ring with nothing feeding it is a ring stuck in a corner.
			if (spec.pointer) await supervisor.send({ type: 'pointer.subscribe', hz: 30 });
			return true;
		},

		[desktopAgentChannels.hideOverlay]: async (): Promise<void> => {
			await supervisor.send({ type: 'pointer.unsubscribe' });
			await supervisor.send({ type: 'overlay.hide' });
		},

		[desktopAgentChannels.watchFocus]: async (): Promise<void> => {
			await supervisor.send({ type: 'focus.subscribe' });
		},
	};

	for (const [channel, handler] of Object.entries(handlers)) {
		ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1]);
	}

	return () => {
		for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
		void supervisor.dispose();
	};
}
