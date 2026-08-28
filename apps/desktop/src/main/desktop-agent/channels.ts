/**
 * The IPC channel names, in one module so the preload script and the main process cannot
 * drift apart. Nothing else belongs here: the preload is sandboxed and imports this for
 * strings alone.
 */
export const desktopAgentChannels = {
	capabilities: 'desktop-agent:capabilities',
	start: 'desktop-agent:start',
	stop: 'desktop-agent:stop',
	capture: 'desktop-agent:capture',
	focusedApplication: 'desktop-agent:focused-application',
	accessibleRegions: 'desktop-agent:accessible-regions',
	showOverlay: 'desktop-agent:show-overlay',
	hideOverlay: 'desktop-agent:hide-overlay',
	watchFocus: 'desktop-agent:watch-focus',
	/** Pushed to the renderer, not invoked. */
	pointerEvent: 'desktop-agent:pointer',
	focusEvent: 'desktop-agent:focus',
	sidecarStateEvent: 'desktop-agent:sidecar-state',
} as const;
