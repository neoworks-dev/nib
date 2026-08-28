import type { WorkstreamStatus } from './workstream';

export interface BoardTheme {
	background: number;
	grid: number;
	gridAlpha: number;
	card: number;
	cardRaised: number;
	border: number;
	borderStrong: number;
	action: number;
	text: string;
	muted: string;
	dim: string;
	faint: string;
	green: number;
	red: number;
	amber: number;
	blue: number;
	violet: number;
}

/**
 * The board is a canvas, so it cannot inherit the design system's CSS variables
 * the way every other surface does. They are read once per theme change and
 * converted to the numbers Pixi wants.
 */
export function readBoardTheme(root: HTMLElement = document.documentElement): BoardTheme {
	const styles = getComputedStyle(root);
	const read = (name: string, fallback: string) => {
		const value = styles.getPropertyValue(name).trim();
		return value.length > 0 ? value : fallback;
	};
	const readColor = (name: string, fallback: string) => cssColorToNumber(read(name, fallback), fallback);

	return {
		background: readColor('--bg', '#141416'),
		grid: readColor('--text-faint', '#52525b'),
		gridAlpha: 0.5,
		card: readColor('--bg-elevated', '#1c1c1e'),
		cardRaised: readColor('--surface-raised', '#262628'),
		border: readColor('--border', '#29292b'),
		borderStrong: readColor('--border-strong', '#3f3f46'),
		action: readColor('--primary', '#fafafa'),
		text: read('--text', '#fafafa'),
		muted: read('--text-muted', '#a1a1aa'),
		dim: read('--text-dim', '#71717a'),
		faint: read('--text-faint', '#52525b'),
		green: readColor('--ctx-green', '#4ade80'),
		red: readColor('--ctx-red', '#f87171'),
		amber: readColor('--ctx-amber', '#fbbf24'),
		blue: readColor('--ctx-blue', '#60a5fa'),
		violet: readColor('--ctx-violet', '#a78bfa'),
	};
}

let cached: BoardTheme | null = null;
let revision = 0;

/**
 * Read once and held. Renderers ask for the palette every frame, and
 * `getComputedStyle` forces a style recalculation — doing that per frame per
 * object is enough to stall the board on its own.
 */
export function boardTheme(): BoardTheme {
	cached ??= readBoardTheme();
	return cached;
}

/**
 * Bumped on every re-read. Colours are baked into the card textures, so a
 * renderer has to treat a theme switch as a change to everything it drew.
 */
export function themeRevision(): number {
	return revision;
}

/** Called when the document's theme attribute changes. */
export function refreshBoardTheme(): BoardTheme {
	cached = readBoardTheme();
	revision += 1;
	return cached;
}

let colorContext: CanvasRenderingContext2D | null = null;

/** Tokens may be any CSS colour, so the browser is what normalises them to hex. */
export function cssColorToNumber(color: string, fallback: string): number {
	const direct = parseHex(color);
	if (direct !== null) return direct;

	if (!colorContext) colorContext = document.createElement('canvas').getContext('2d');
	if (colorContext) {
		colorContext.fillStyle = '#000000';
		colorContext.fillStyle = color;
		const parsed = parseHex(colorContext.fillStyle);
		if (parsed !== null) return parsed;
	}
	return parseHex(fallback) ?? 0x000000;
}

function parseHex(color: string): number | null {
	const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
	if (!match) return null;
	const digits = match[1]!;
	const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
	return Number.parseInt(full, 16);
}

/** The colour a workstream's state reads as, matching the status badges elsewhere. */
export function statusColor(status: WorkstreamStatus, theme: BoardTheme): number {
	switch (status) {
		case 'working':
			return theme.blue;
		case 'awaiting-permission':
			return theme.amber;
		case 'error':
			return theme.red;
		case 'closed':
			return theme.green;
		case 'unlaunched':
			return theme.violet;
		default:
			return theme.borderStrong;
	}
}

export function statusWord(status: WorkstreamStatus): string {
	switch (status) {
		case 'working':
			return 'working';
		case 'awaiting-permission':
			return 'needs input';
		case 'error':
			return 'error';
		case 'closed':
			return 'completed';
		case 'unlaunched':
			return 'not started';
		case 'detached':
			return 'not loaded';
		default:
			return 'idle';
	}
}
