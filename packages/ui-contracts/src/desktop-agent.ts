/**
 * Desktop control: capture, overlay, element detection and the identity of whatever
 * application has focus.
 *
 * This module imports nothing on purpose. The Electron main process is the other end
 * of every one of these types, and it compiles without the DOM lib, so pulling in the
 * package root — which reaches `pixi.js`, `svelte` and `@nib-ui/protocol` — is not
 * something a main-process tsconfig should have to resolve. `DesktopRect` is declared
 * here rather than imported for the same reason `PaneRect` is.
 */

/** Structurally the canvas `Rect`; see the note above. */
export interface DesktopRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * How the overlay is drawn. Chromium speaks `xdg-shell` only, so a Wayland overlay is
 * the sidecar's job; the window fallback is honest only under X11, where always-on-top
 * and absolute positioning actually mean something.
 */
export type OverlayStrategy = 'layer-shell' | 'always-on-top-window' | 'unavailable';

export type CaptureStrategy = 'portal' | 'compositor-tools' | 'unavailable';

export type FocusStrategy = 'compositor-ipc' | 'atspi' | 'unavailable';

/** Wayland has no global cursor API; this says which substitute is available. */
export type PointerStrategy = 'compositor-ipc' | 'unavailable';

export type DesktopSessionType = 'wayland' | 'x11' | 'unknown';

/**
 * What this machine can actually do, resolved once the sidecar has answered. Every
 * capability degrades to `unavailable` with a line in `notes` rather than throwing, so
 * the pane always mounts and always explains itself.
 */
export interface DesktopCapabilities {
	overlay: OverlayStrategy;
	capture: CaptureStrategy;
	focus: FocusStrategy;
	pointer: PointerStrategy;
	/** Shown to the user, never branched on: no compositor is special-cased. */
	compositor: string | null;
	sessionType: DesktopSessionType;
	/** One line per unavailable capability, rendered verbatim. */
	notes: string[];
}

/**
 * Who owns the focused window. Every field is nullable because no Wayland compositor is
 * obliged to answer any of them, and routing has to cope with an application that is
 * only a title.
 */
export interface ApplicationIdentity {
	/** Compositor `app_id`, as `hyprctl clients` or sway's tree reports it. */
	appId: string | null;
	/** The accessible name AT-SPI gives the application. */
	atspiName: string | null;
	/** Desktop entry file name, where the compositor knows it. */
	desktopEntry: string | null;
	title: string | null;
	pid: number | null;
}

export type CaptureMode = 'screen' | 'window' | 'region';

export type CaptureRequest =
	| { mode: 'screen'; output?: string }
	| { mode: 'window'; windowId?: string }
	/** Desktop layout coordinates, not capture pixels: nothing has been captured yet. */
	| { mode: 'region'; rect: DesktopRect };

export interface CaptureResult {
	/** The stored asset; the bytes never reach the renderer. */
	assetId: string;
	/** Intrinsic pixel size, which is what region rects are expressed in. */
	width: number;
	height: number;
	takenAt: number;
	/**
	 * Who had focus when the shutter fired. Stored on the board object rather than
	 * re-queried at send time, by which point focus has long moved on.
	 */
	application: ApplicationIdentity | null;
	output: string | null;
	/**
	 * The desktop-layout box this image covers, where the compositor could say. Null
	 * when it could not, and then a region found in the picture cannot be pointed at
	 * on the screen — so the overlay is not offered rather than aimed at a guess.
	 */
	layout: DesktopRect | null;
	/** How many sensitive fields were blacked out before the file reached the store. */
	redacted: number;
}

export type RegionSource = 'atspi' | 'pixel';

/** One element found inside a capture, in that capture's pixel space. */
export interface DetectedRegion {
	id: string;
	rect: DesktopRect;
	/** The accessible name, where there is one. A pixel region has no name to give. */
	label?: string;
	/** AT-SPI role, or the shape class the pixel detector guessed. */
	role?: string;
	source: RegionSource;
	confidence: number;
	/** AT-SPI marked the node a password field; its pixels are redacted before storage. */
	sensitive?: boolean;
}

export type OverlayTone = 'accent' | 'warn' | 'muted';

export interface OverlayRegion {
	/** Desktop layout coordinates: this is drawn on the desktop, not on the board. */
	rect: DesktopRect;
	label?: string;
	tone: OverlayTone;
}

export interface OverlaySpec {
	regions: OverlayRegion[];
	/** A ring that follows the cursor, where a pointer source exists. */
	pointer?: { radius: number; tone: OverlayTone };
	/** Restricts the overlay to one output; every output when omitted. */
	output?: string;
}

export interface PointerSample {
	x: number;
	y: number;
	output: string | null;
}

/**
 * What the sidecar can determine about itself. The host answers the rest — whether there
 * is a binary at all, which is a question a process that never started cannot be asked.
 */
export interface SidecarCapabilities {
	capture: CaptureStrategy;
	focus: FocusStrategy;
	pointer: PointerStrategy;
	compositor: string | null;
	sessionType: DesktopSessionType;
	/** Whether the compositor advertises `zwlr_layer_shell_v1`, not which strategy wins. */
	layerShell: boolean;
	notes?: string[];
}

/** What the host knows without asking anything: is there a bridge, is there a binary. */
export interface HostReport {
	/** False in a plain browser, and in an Electron build with no desktop-agent module. */
	bridge: boolean;
	/** False when neither `$NIB_OVERLAY_EXECUTABLE` nor `nib-overlay` on `$PATH` resolved. */
	sidecarResolved: boolean;
	/** The sidecar's own answer, absent when it never started. */
	sidecar?: SidecarCapabilities;
}

/** Everything off, with the reason. What a browser gets, and what a failure falls back to. */
export function disabledCapabilities(reason: string): DesktopCapabilities {
	return {
		overlay: 'unavailable',
		capture: 'unavailable',
		focus: 'unavailable',
		pointer: 'unavailable',
		compositor: null,
		sessionType: 'unknown',
		notes: [reason],
	};
}

/**
 * `layer-shell` is the only strategy with something behind it.
 *
 * `always-on-top-window` stays in `OverlayStrategy` because it is the right answer under
 * X11 — a window manager there honours both stacking and absolute position, which
 * `xdg-shell` on Wayland does not — but nothing implements it, so reporting it would be a
 * capability the user only discovers is missing when the highlight never appears. An
 * unimplemented strategy is reported as `unavailable` with the reason.
 */
function overlayStrategy(
	sidecar: SidecarCapabilities,
	sidecarResolved: boolean,
): { strategy: OverlayStrategy; note: string | null } {
	if (sidecarResolved && sidecar.layerShell) return { strategy: 'layer-shell', note: null };
	if (!sidecarResolved) {
		return {
			strategy: 'unavailable',
			note: 'No nib-overlay binary was found. Build it with `task build:overlay` or set $NIB_OVERLAY_EXECUTABLE.',
		};
	}
	if (sidecar.sessionType === 'x11') {
		return {
			strategy: 'unavailable',
			note: 'On X11 the overlay would be an always-on-top window, which is not built yet.',
		};
	}
	return {
		strategy: 'unavailable',
		note: 'This compositor does not implement wlr-layer-shell, and a plain window cannot be positioned on Wayland.',
	};
}

/**
 * The full report: the sidecar's half folded with the host's. This is the only place a
 * strategy is chosen, and it lives here rather than in the plugin because the Electron
 * main process — which holds `sidecarResolved` — is the side that answers the bridge.
 *
 * Nothing here branches on a compositor name. `compositor` is carried so the pane can
 * show it and is never compared against.
 *
 * Notes accumulate in the order a user would want to read them: the overlay first,
 * because it is the capability most likely to be missing, then the two that silently
 * reduce what a capture is worth.
 */
export function describeCapabilities(host: HostReport): DesktopCapabilities {
	if (!host.bridge) {
		return disabledCapabilities('Desktop control needs the desktop app; a browser has no access to the screen.');
	}
	if (!host.sidecar) {
		const detail = host.sidecarResolved
			? 'The nib-overlay sidecar has not reported yet.'
			: 'No nib-overlay binary was found. Build it with `task build:overlay` or set $NIB_OVERLAY_EXECUTABLE.';
		return disabledCapabilities(detail);
	}

	const sidecar = host.sidecar;
	const overlay = overlayStrategy(sidecar, host.sidecarResolved);
	const notes: string[] = [...(sidecar.notes ?? [])];
	if (overlay.note) notes.push(overlay.note);

	if (sidecar.capture === 'unavailable') {
		notes.push('No screen capture is available: neither the desktop portal nor grim answered.');
	}
	if (sidecar.focus === 'unavailable') {
		notes.push('The focused application cannot be identified, so per-application routing falls back to the default.');
	}
	if (sidecar.pointer === 'unavailable') {
		notes.push('This compositor exposes no cursor position, so the overlay cannot follow the pointer.');
	}

	return {
		overlay: overlay.strategy,
		capture: sidecar.capture,
		focus: sidecar.focus,
		pointer: sidecar.pointer,
		compositor: sidecar.compositor,
		sessionType: sidecar.sessionType,
		notes,
	};
}

/** True when at least one thing on this machine is worth offering. */
export function anyCapability(capabilities: DesktopCapabilities): boolean {
	return capabilities.capture !== 'unavailable' || capabilities.overlay !== 'unavailable';
}

export type SidecarStatus = 'stopped' | 'starting' | 'ready' | 'failed';

export interface SidecarState {
	status: SidecarStatus;
	/** Why it failed, or what it is waiting on. Shown in the pane. */
	detail?: string;
}

/**
 * The preload surface. Every method is one `ipcRenderer.invoke` or one `ipcRenderer.on`
 * fan-out — there is no filesystem, no path handling and no `require` on this side of
 * the bridge.
 */
export interface DesktopAgentBridge {
	/** The last report, without starting anything. */
	capabilities(): Promise<DesktopCapabilities>;
	/** Starts the sidecar if it is down, then reports. Never rejects for a missing binary. */
	start(): Promise<DesktopCapabilities>;
	stop(): Promise<void>;
	/** Null when the portal refused or no capture strategy is available. */
	capture(request: CaptureRequest): Promise<CaptureResult | null>;
	focusedApplication(): Promise<ApplicationIdentity | null>;
	/**
	 * Labelled regions from the accessibility tree of whatever has focus now, in
	 * **desktop layout coordinates**. The sidecar does not know which capture is being
	 * asked about, so mapping them onto an image is the caller's job — it holds the
	 * capture's `layout` box and its pixel size, and the sidecar holds neither.
	 */
	accessibleRegions(): Promise<DetectedRegion[]>;
	/** False when the compositor refused the surface; the caller stops offering it. */
	showOverlay(spec: OverlaySpec): Promise<boolean>;
	hideOverlay(): Promise<void>;
	/** Starts `focus` events. Idempotent; there is no matching unwatch. */
	watchFocus(): Promise<void>;
	/** Samples while a subscription is live; calling the result unsubscribes. */
	onPointer(listener: (sample: PointerSample) => void): () => void;
	onFocus(listener: (application: ApplicationIdentity) => void): () => void;
	onSidecarState(listener: (state: SidecarState) => void): () => void;
}

/**
 * The service plugins talk to. It acts on whatever board is open — a capture is a
 * `media` object on that board and a session started from one runs in that board's
 * `cwd` — so there is no workspace of its own to address.
 */
export interface DesktopAgentService {
	/** Null until the report has been fetched; the fully-disabled report in a browser. */
	readonly capabilities: DesktopCapabilities | null;
	readonly sidecar: SidecarState;
	/** Captures skip their per-capture confirmation while this is true. */
	readonly armed: boolean;
	/** False with no board open: there is nowhere to put a capture and no cwd to run in. */
	readonly canCapture: boolean;
	arm(minutes: number): void;
	disarm(): void;
	/** Captures, uploads, places a `media` object on the open board; null when refused. */
	capture(request: CaptureRequest): Promise<string | null>;
	/** Runs the detector chain over a placed capture and stores the regions beside it. */
	detect(objectId: string): Promise<DetectedRegion[]>;
	/** Routes the capture, its regions and `text` into a harness session; the session id. */
	sendToHarness(objectId: string, text: string): Promise<string | null>;
}
