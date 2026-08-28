/**
 * Desktop control over the board that is open: capture the screen, find the elements in a
 * capture, highlight them on the desktop itself, and route the result into an ordinary
 * harness session.
 *
 * There is no agent loop here. A capture is a `media` object on the current board, and
 * sending one goes through `HarnessRegistry` → `HarnessAdapter.createSession` →
 * `HarnessSession.send` — the pipeline a typed prompt already uses.
 *
 * Nothing in this plugin can move the pointer or press a key. The overlay's surfaces have
 * an empty input region, so they cannot even receive a click, let alone send one.
 */
import type { Plugin } from '@nib-ui/kernel';
import MonitorIcon from 'phosphor-svelte/lib/MonitorIcon';
import DesktopPane from './DesktopPane.svelte';
import DesktopSettings from './DesktopSettings.svelte';
import { parseDesktopRegions } from './objects';
import { desktopState } from './state.svelte';

declare module '@nib-ui/kernel' {
	interface Services {
		desktopAgent: import('@nib-ui/ui-contracts').DesktopAgentService;
	}
}

export const desktopAgentPlugin: Plugin = {
	name: 'desktop-agent',
	inject: ['panes', 'commands', 'canvas', 'sessions', 'slots'],
	apply(ctx) {
		const panes = ctx.require('panes');
		const canvas = ctx.require('canvas');

		ctx.provide('desktopAgent', desktopState);
		ctx.effect(() => desktopState.attach(canvas, ctx.require('sessions')));
		ctx.effect(() => desktopState.mountLayer(canvas));

		ctx.effect(() =>
			panes.register({ id: 'desktop', kind: 'desktop', title: 'Desktop', icon: MonitorIcon, component: DesktopPane }),
		);
		ctx.effect(() => ctx.require('slots').register('settings.section', { component: DesktopSettings, order: 40 }));

		// A capture is worth exactly what the picture is worth, which `canvas-media` already
		// answers for. What this adds is what was found in it, in the prompt's own terms.
		ctx.effect(() =>
			canvas.registerContextProvider({
				order: 20,
				contextFor: (object) => {
					const stored = parseDesktopRegions(object);
					if (!stored || stored.regions.length === 0) return null;
					const named = stored.regions.filter((region) => region.label && !region.sensitive).length;
					return {
						label: 'Detected elements',
						text: `${stored.regions.length} elements were detected in the capture, ${named} of them named.`,
					};
				},
			}),
		);

		ctx.effect(() =>
			canvas.registerContextMenu({
				order: 20,
				items: (target) => {
					if (!target || target.kind !== 'media') return [];
					const captureId = target.id;
					if (!desktopState.regionsOf(captureId)) return [];
					return [
						{
							kind: 'action',
							id: 'desktop.detect',
							label: 'Find elements in this capture',
							run: () => void desktopState.detect(captureId),
						},
						...(desktopState.canOverlay(captureId)
							? [
									{
										kind: 'action' as const,
										id: 'desktop.overlay',
										label: 'Show these elements on screen',
										run: () => void desktopState.showOverlay(captureId),
									},
								]
							: []),
					];
				},
			}),
		);

		const commands = ctx.require('commands');
		ctx.effect(() =>
			commands.register({ id: 'desktop.toggle', title: 'Toggle desktop pane', run: () => panes.toggle('desktop') }),
		);
		ctx.effect(() =>
			commands.register({
				id: 'desktop.capture',
				title: 'Capture the desktop',
				when: () => desktopState.canCapture,
				run: async () => {
					// Opened first: while disarmed the capture waits on a confirmation that
					// is rendered in the pane, and a command that never opened it would hang.
					panes.open('desktop');
					await desktopState.capture({ mode: 'screen' });
				},
			}),
		);
		ctx.effect(() =>
			commands.register({
				id: 'desktop.hideOverlay',
				title: 'Hide the desktop overlay',
				when: () => desktopState.overlaid !== null,
				run: () => void desktopState.hideOverlay(),
			}),
		);
	},
};

export { applicationName, desktopState } from './state.svelte';
export { loadRoutingConfig, saveRoutingConfig } from './config';
export {
	components,
	close,
	detectRegions,
	DETECTOR_DEFAULTS,
	dilate,
	erode,
	greyscale,
	sobel,
	threshold,
	type Bitmap,
	type Component,
	type DetectorOptions,
} from './detector';
export {
	parseDesktopRegions,
	parseDesktopView,
	parseRegions,
	regionsFor,
	REGIONS_KIND,
	VIEW_KIND,
	VIEW_MIN_SIZE,
	type DesktopRegionsObject,
	type DesktopViewObject,
} from './objects';
export { composeDesktopPrompt, DEFAULT_REGION_LIMIT, sortForReading, type DesktopPromptInput } from './prompt';
export {
	clipToImage,
	describeRegion,
	imagePointAt,
	imageToLayout,
	intersectionArea,
	layoutToImage,
	mergeRegions,
	rectArea,
	rectContains,
	regionAt,
	worldRectFor,
	type CapturePlacement,
	type Point,
} from './regions';
export {
	emptyRoutingConfig,
	MATCH_LEVELS,
	mergeRoutingConfig,
	parseRoutingConfig,
	resolveRouting,
	type ApplicationMatch,
	type CapturePolicy,
	type MatchLevel,
	type RoutingConfig,
	type RoutingDecision,
	type RoutingDefault,
	type RoutingRule,
} from './routing';
