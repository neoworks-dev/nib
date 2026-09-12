/**
 * Where things sit. Layout is decoration (PLAN decision 4): this is the only state
 * that lives outside the vault, and losing it costs an arrangement, never content.
 *
 * Positions are per board, because a board is one directory's canvas (PLAN §5). A
 * topic's contents are laid out on the topic's own board and never on its parent's,
 * so a board's map covers its own directory and nothing deeper.
 */

export interface Size {
  w: number;
  h: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface Placement extends Rect {
  z: number;
  /**
   * Recorded when the item declares one, so a rename the app performs can carry the
   * position across. Never a key: `id:` is opt-in, so most items have none.
   */
  id?: string;
  /**
   * The pile this item is in, if any. A stack is decoration like every other
   * position: it is never a directory and never a file, so being in one changes
   * nothing on disk and losing it costs an arrangement rather than content.
   */
  stack?: string;
}

/** Board directory (`""` for the vault root) to path to where it sits. */
export type PlacementMap = Record<string, Record<string, Placement>>;

/**
 * Where each pile sits, by stack id. Beside `placements` rather than inside it,
 * because a stack has a position of its own that outlives any one member: the
 * pile stays put while things are dragged out of it.
 */
export type StackMap = Record<string, Rect>;

export interface PlacementEntry {
  path: string;
  id: string | null;
  /** The size this entry starts at, overriding the board's default. */
  size?: Size;
}

export interface ReconcileResult {
  placements: Record<string, Placement>;
  /** Paths that gained a position. */
  added: string[];
  /** Paths whose position was dropped because the path is gone. */
  removed: string[];
  /** Paths that took over a position from a vanished path carrying the same id. */
  carried: string[];
  /**
   * The piles that still hold something. A stack whose every member is gone is
   * gone with them: it was only ever the arrangement of those items, so keeping
   * an empty one would leave a pile of nothing that cannot be clicked or undone.
   */
  stacks: StackMap;
}

/** Where a path with no stored position goes, given what is already occupied. */
export type SlotChooser = (occupied: readonly Rect[], size: Size) => { x: number; y: number };

export interface FlowOptions {
  /** Where a row gives up and wraps. */
  maxWidth?: number;
  gap?: number;
}

export interface ReconcileOptions {
  /** The size a newly placed object starts at, before anyone resizes it. */
  size: Size;
  slot?: SlotChooser;
  /** The piles this board had. Absent is the same as none. */
  stacks?: StackMap;
}
const DEFAULT_GAP = 24;
const DEFAULT_FLOW_WIDTH = 1200;
const PLACEMENT_ATTEMPTS = 512;

/**
 * Brings one board's positions in line with what is actually there: an item with no
 * position gets one, a position for a path that is gone is dropped, and a path whose
 * item carries an id that a vanished path also carried takes that position over.
 *
 * The one piece of policy here is which slot a new object gets — `options.slot`.
 * Until the layout question is settled the default flows new objects into rows,
 * which is at least predictable and never overlaps.
 */
export function reconcileBoard(
  entries: readonly PlacementEntry[],
  stored: Readonly<Record<string, Placement>>,
  options: ReconcileOptions,
): ReconcileResult {
  const slot = options.slot ?? flowSlot();
  const placements: Record<string, Placement> = {};
  const occupied: Rect[] = [];
  const added: string[] = [];
  const carried: string[] = [];
  const taken = new Set<string>();
  const byId = indexById(stored);

  for (const entry of entries) {
    const inherited = inherit(entry, stored, taken, byId);

    if (inherited) {
      placements[entry.path] = inherited.placement;
      occupied.push(inherited.placement);
      if (inherited.carried) carried.push(entry.path);
      continue;
    }

    const size = entry.size ?? options.size;
    const spot = slot(occupied, size);
    const placed: Placement = { ...spot, ...size, z: highestZ(placements) + 1 };
    placements[entry.path] = placed;
    occupied.push(placed);
    added.push(entry.path);
  }

  const stacks = survivingStacks(placements, options.stacks);
  // A member pointing at a pile that is not there falls out of it rather than
  // into a broken one: the position it already has is where it stays. Copied
  // rather than edited, because an inherited placement is the caller's object.
  for (const [path, placement] of Object.entries(placements)) {
    if (placement.stack === undefined || stacks[placement.stack] !== undefined) continue;
    const { stack: _gone, ...rest } = placement;
    placements[path] = rest;
  }

  return { placements, added, removed: missingPaths(entries, stored), carried, stacks };
}

/**
 * The piles that still have a member. An item whose stack has gone — because
 * everything else in it was deleted, or because the document named a stack that
 * was never there — keeps its position and simply stops being in a pile.
 */
function survivingStacks(
  placements: Record<string, Placement>,
  stacks: StackMap | undefined,
): StackMap {
  if (stacks === undefined) return {};

  const occupied = new Set<string>();
  for (const placement of Object.values(placements)) {
    if (placement.stack !== undefined) occupied.add(placement.stack);
  }

  const surviving: StackMap = {};
  for (const [id, rect] of Object.entries(stacks)) {
    if (occupied.has(id)) surviving[id] = rect;
  }
  return surviving;
}

/** The board's slice of the vault-wide map, or an empty one. */
export function placementsFor(map: PlacementMap, board: string): Record<string, Placement> {
  return map[board] ?? {};
}

/** The board a vault-relative path belongs to: its directory. */
export function boardOf(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return "";
  return path.slice(0, slash);
}

interface Inherited {
  placement: Placement;
  carried: boolean;
}

/**
 * A stored position for this path, or one left behind by a path that carried the
 * same id. Each stored position is handed out at most once, so a carried position
 * cannot also be claimed directly by the path it came from.
 */
function inherit(
  entry: PlacementEntry,
  stored: Readonly<Record<string, Placement>>,
  taken: Set<string>,
  byId: ReadonlyMap<string, string>,
): Inherited | null {
  if (!taken.has(entry.path)) {
    const direct = stored[entry.path];
    if (direct) {
      taken.add(entry.path);
      return { placement: direct, carried: false };
    }
  }

  if (entry.id === null) return null;
  const source = byId.get(entry.id);
  if (source === undefined || taken.has(source)) return null;
  const placement = stored[source];
  if (!placement) return null;

  taken.add(source);
  return { placement, carried: true };
}

/** The first path carrying each id, in path order, so the choice is stable. */
function indexById(stored: Readonly<Record<string, Placement>>): Map<string, string> {
  const byId = new Map<string, string>();
  for (const path of sortedPaths(stored)) {
    const id = stored[path]?.id;
    if (id === undefined) continue;
    if (byId.has(id)) continue;
    byId.set(id, path);
  }
  return byId;
}

function missingPaths(
  entries: readonly PlacementEntry[],
  stored: Readonly<Record<string, Placement>>,
): string[] {
  const present = new Set(entries.map((entry) => entry.path));
  return sortedPaths(stored).filter((path) => !present.has(path));
}

function sortedPaths(stored: Readonly<Record<string, Placement>>): string[] {
  return Object.keys(stored).sort((left, right) => left.localeCompare(right));
}

function highestZ(placements: Record<string, Placement>): number {
  let highest = 0;
  for (const placement of Object.values(placements)) {
    if (placement.z > highest) highest = placement.z;
  }
  return highest;
}

/**
 * Objects flowed into rows that wrap at `maxWidth`, skipping anything they would overlap. Mixed
 * sizes are the point: a vault holds cards of very different shapes.
 *
 * The same function answers both layout questions in the PLAN: where a newly discovered item sits
 * on a board (5), and how a topic arranges the collection it is (6). A board passes what is already
 * placed; a preview passes only what it has laid out so far.
 */
export function flowSlot(options: FlowOptions = {}): SlotChooser {
  const maxWidth = options.maxWidth ?? DEFAULT_FLOW_WIDTH;
  const gap = options.gap ?? DEFAULT_GAP;

  return (occupied, size) => {
    let x = 0;
    let y = 0;
    let rowHeight = 0;

    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
      if (x > 0 && x + size.w > maxWidth) {
        x = 0;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      if (size.h > rowHeight) rowHeight = size.h;

      const candidate: Rect = { x, y, ...size };
      if (!occupied.some((other) => overlaps(candidate, other))) return { x, y };
      x += size.w + gap;
    }

    // Nothing free in the flow: go below everything rather than on top of it.
    return { x: 0, y: lowestBottom(occupied) + gap };
  };
}

function lowestBottom(occupied: readonly Rect[]): number {
  let bottom = 0;
  for (const rect of occupied) {
    const edge = rect.y + rect.h;
    if (edge > bottom) bottom = edge;
  }
  return bottom;
}

export function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

/**
 * Reads a stored map back. The document is hand-editable and outlives the build that
 * wrote it, so an entry that does not parse is dropped rather than kept: a placement
 * with no usable geometry cannot be rendered and cannot be repaired by guessing.
 */
export function parsePlacements(value: unknown): PlacementMap {
  if (!isRecord(value)) return {};

  const map: PlacementMap = {};
  for (const [board, entries] of Object.entries(value)) {
    if (!isRecord(entries)) continue;

    const placements: Record<string, Placement> = {};
    for (const [path, entry] of Object.entries(entries)) {
      const placement = parsePlacement(entry);
      if (placement) placements[path] = placement;
    }
    // A board with nothing usable is absent rather than empty: the two read the
    // same, and writing the document back stays free of dead keys.
    if (Object.keys(placements).length > 0) map[board] = placements;
  }

  return map;
}

function parsePlacement(value: unknown): Placement | null {
  if (!isRecord(value)) return null;

  const { x, y, w, h, z, id } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(w) || !isFiniteNumber(h)) return null;
  if (w <= 0 || h <= 0) return null;

  const placement: Placement = { x, y, w, h, z: isFiniteNumber(z) ? z : 0 };
  if (typeof id === "string" && id.length > 0) placement.id = id;
  const stack = value["stack"];
  if (typeof stack === "string" && stack.length > 0) placement.stack = stack;
  return placement;
}

/**
 * Reads a stored stack map back. Same rule as a placement: an entry with no
 * usable rectangle is dropped rather than guessed at, and the items that named
 * it fall out of the pile rather than into a broken one.
 */
export function parseStacks(value: unknown): StackMap {
  if (!isRecord(value)) return {};

  const stacks: StackMap = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const { x, y, w, h } = entry;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    if (!isFiniteNumber(w) || !isFiniteNumber(h) || w <= 0 || h <= 0) continue;
    stacks[id] = { x, y, w, h };
  }
  return stacks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
