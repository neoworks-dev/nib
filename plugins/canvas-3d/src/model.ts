import type { CanvasObject } from '@nib-ui/ui-contracts';

/** What the board knows how to hand to a loader, derived from the bytes or the name. */
export type ModelFormat = 'glb' | 'gltf' | 'stl' | 'obj';

/** Where the camera sits, in radians and in multiples of the model's fitted radius. */
export interface ModelOrbit {
	yaw: number;
	pitch: number;
	distance: number;
}

export interface ModelObject extends CanvasObject {
	kind: 'model';
	x: number;
	y: number;
	assetId: string;
	format: ModelFormat;
	/** Persisted so a board reload shows the view the model was left at. */
	yaw: number;
	pitch: number;
	distance: number;
	w?: number;
	h?: number;
	/** The dropped file's name, shown while the model cannot be drawn. */
	name?: string;
}

export const MODEL_MIN_SIZE = 96;
export const MODEL_DEFAULT_SIZE = 320;
export const MODEL_MIN_DISTANCE = 1.4;
export const MODEL_MAX_DISTANCE = 12;
export const MODEL_DEFAULT_ORBIT: ModelOrbit = { yaw: 0.7, pitch: 0.32, distance: 2.9 };

/**
 * Just short of the pole. At exactly ±90° the camera looks straight down its own
 * up vector and the view flips, so the pitch never reaches it.
 */
export const MAX_PITCH = Math.PI / 2 - 0.05;

/** Radians per screen pixel of drag. A full turn is roughly a 400px sweep. */
const YAW_PER_PIXEL = 0.016;
const PITCH_PER_PIXEL = 0.012;
const DISTANCE_PER_PIXEL = 0.02;
/**
 * Multiples of the fitted radius per wheel pixel. Far smaller than a drag's,
 * because a trackpad sends a stream of small deltas where a mouse sends one
 * notch of about a hundred.
 */
const DISTANCE_PER_WHEEL_PIXEL = 0.0025;

const EXTENSIONS: Record<string, ModelFormat> = {
	glb: 'glb',
	gltf: 'gltf',
	stl: 'stl',
	obj: 'obj',
};

/** The types the asset store mints for a model, and what a browser tends to declare. */
const CONTENT_TYPES: Record<string, ModelFormat> = {
	'model/gltf-binary': 'glb',
	'model/gltf+json': 'gltf',
	'model/stl': 'stl',
	'model/obj': 'obj',
};

export function clampPitch(pitch: number): number {
	if (!Number.isFinite(pitch)) return MODEL_DEFAULT_ORBIT.pitch;
	return Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
}

export function clampDistance(distance: number): number {
	if (!Number.isFinite(distance)) return MODEL_DEFAULT_ORBIT.distance;
	return Math.min(MODEL_MAX_DISTANCE, Math.max(MODEL_MIN_DISTANCE, distance));
}

/**
 * The orbit a drag of `deltaX`/`deltaY` screen pixels lands on. Holding shift
 * dollies instead of pitching, because the board owns the wheel for its own zoom.
 *
 * A turntable: the surface follows the cursor. Dragging right spins the model
 * to the right, and dragging down tips its top towards you.
 */
export function orbitAfterDrag(from: ModelOrbit, deltaX: number, deltaY: number, dolly: boolean): ModelOrbit {
	const yaw = from.yaw + deltaX * YAW_PER_PIXEL;
	if (dolly) {
		return { yaw, pitch: from.pitch, distance: clampDistance(from.distance + deltaY * DISTANCE_PER_PIXEL) };
	}
	return { yaw, pitch: clampPitch(from.pitch + deltaY * PITCH_PER_PIXEL), distance: from.distance };
}

/** The orbit a wheel of `deltaY` pixels lands on. The wheel only ever dollies. */
export function orbitAfterWheel(from: ModelOrbit, deltaY: number): ModelOrbit {
	return { ...from, distance: clampDistance(from.distance + deltaY * DISTANCE_PER_WHEEL_PIXEL) };
}

/** Camera position for an orbit, around a model centred on the origin. */
export function orbitCameraPosition(orbit: ModelOrbit): { x: number; y: number; z: number } {
	const radius = clampDistance(orbit.distance);
	const pitch = clampPitch(orbit.pitch);
	return {
		x: radius * Math.cos(pitch) * Math.sin(orbit.yaw),
		y: radius * Math.sin(pitch),
		z: radius * Math.cos(pitch) * Math.cos(orbit.yaw),
	};
}

const MIMES: Record<ModelFormat, string> = {
	glb: 'model/gltf-binary',
	gltf: 'model/gltf+json',
	stl: 'model/stl',
	obj: 'model/obj',
};

/** The type a model is handed to a harness as; it opens the file, it does not look at it. */
export function modelMime(format: ModelFormat): string {
	return MIMES[format];
}

export function modelFormatForName(fileName: string): ModelFormat | null {
	const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
	return EXTENSIONS[extension] ?? null;
}

export function modelFormatForContentType(contentType: string): ModelFormat | null {
	return CONTENT_TYPES[contentType.split(';')[0]!.trim().toLowerCase()] ?? null;
}

function startsWith(bytes: Uint8Array, text: string, offset = 0): boolean {
	if (bytes.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index += 1) {
		if (bytes[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}

/**
 * A binary STL carries no magic number: the only reliable check is that the
 * triangle count in its header accounts for exactly the rest of the file.
 */
function isBinaryStl(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 84) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return 84 + view.getUint32(80, true) * 50 === bytes.byteLength;
}

function isAsciiStl(bytes: Uint8Array): boolean {
	if (!startsWith(bytes, 'solid')) return false;
	const head = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.byteLength, 512)));
	return head.includes('facet');
}

/** Statements a wavefront obj is allowed to open a line with. */
const OBJ_KEYWORDS = new Set([
	'v',
	'vn',
	'vt',
	'vp',
	'f',
	'l',
	'p',
	'o',
	'g',
	's',
	'usemtl',
	'mtllib',
	'mg',
	'cstype',
	'deg',
	'curv',
	'curv2',
	'surf',
	'end',
]);

/**
 * Text with no magic number, and the faces of a large one sit well past any
 * window worth reading, so it is the grammar of the head that identifies it: obj
 * statements only, at least one of them a vertex. Matches what the asset store
 * decides, because the store's verdict is the one the board ends up storing.
 */
function isObj(bytes: Uint8Array): boolean {
	// A utf-8 byte order mark is what a Windows exporter opens the file with.
	const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
	const head = String.fromCharCode(...bytes.subarray(start, start + Math.min(bytes.byteLength - start, 4096)));
	if (head.includes('\0')) return false;

	let vertices = 0;
	const lines = head.split('\n');
	// The last line of the window is almost certainly cut in half.
	for (const line of lines.slice(0, Math.max(1, lines.length - 1))) {
		const statement = line.trim();
		if (statement.length === 0 || statement.startsWith('#')) continue;
		const keyword = statement.slice(0, statement.search(/\s|$/));
		if (!OBJ_KEYWORDS.has(keyword)) return false;
		if (keyword === 'v') vertices += 1;
	}
	return vertices > 0;
}

/** Only the formats whose bytes identify themselves; a `.gltf` is json the store refuses. */
export function modelFormatForBytes(bytes: Uint8Array): ModelFormat | null {
	if (startsWith(bytes, 'glTF')) return 'glb';
	if (isBinaryStl(bytes) || isAsciiStl(bytes)) return 'stl';
	if (isObj(bytes)) return 'obj';
	return null;
}

/** The bytes win over the name, the same way the asset store decides a type. */
export function sniffModelFormat(fileName: string, bytes?: Uint8Array): ModelFormat | null {
	const sniffed = bytes ? modelFormatForBytes(bytes) : null;
	return sniffed ?? modelFormatForName(fileName);
}

/** True for a file worth reading at all, so a paste can be declined before any IO. */
export function isModelFile(file: File): boolean {
	return modelFormatForName(file.name) !== null || modelFormatForContentType(file.type) !== null;
}

export function parseModel(raw: unknown): ModelObject | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Partial<ModelObject>;
	if (candidate.kind !== 'model' || typeof candidate.id !== 'string') return null;
	if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return null;
	if (typeof candidate.assetId !== 'string' || candidate.assetId.length === 0) return null;
	const format = candidate.format;
	if (format !== 'glb' && format !== 'gltf' && format !== 'stl' && format !== 'obj') return null;

	return {
		kind: 'model',
		id: candidate.id,
		x: candidate.x,
		y: candidate.y,
		assetId: candidate.assetId,
		format,
		yaw: typeof candidate.yaw === 'number' && Number.isFinite(candidate.yaw) ? candidate.yaw : MODEL_DEFAULT_ORBIT.yaw,
		pitch: clampPitch(typeof candidate.pitch === 'number' ? candidate.pitch : MODEL_DEFAULT_ORBIT.pitch),
		distance: clampDistance(typeof candidate.distance === 'number' ? candidate.distance : MODEL_DEFAULT_ORBIT.distance),
		...(typeof candidate.w === 'number' && { w: Math.max(MODEL_MIN_SIZE, candidate.w) }),
		...(typeof candidate.h === 'number' && { h: Math.max(MODEL_MIN_SIZE, candidate.h) }),
		...(typeof candidate.name === 'string' && { name: candidate.name }),
	};
}

/**
 * A model has no intrinsic pixel size, so a requested one is only fitted into the
 * default box without upscaling and never allowed below the minimum.
 */
export function fitModelSize(
	width: number,
	height: number,
	box = MODEL_DEFAULT_SIZE,
): { width: number; height: number } {
	if (!(width > 0) || !(height > 0)) return { width: box, height: box };
	const scale = Math.min(1, box / Math.max(width, height));
	return {
		width: Math.max(MODEL_MIN_SIZE, Math.round(width * scale)),
		height: Math.max(MODEL_MIN_SIZE, Math.round(height * scale)),
	};
}
